import http from 'node:http';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { loadTmdbPosterSource, SOURCE_CACHE_VERSION } from './source-loader.js';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/original';
const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
// Layout measurements below are expressed in the original 780px design grid
// and scaled once at render time. This preserves the approved overlay geometry
// while avoiding a 780x1170 intermediate canvas followed by a second resize.
const px = (value) => Math.round(value * POSTER_WIDTH / 780);
const SAFE_MARGIN = px(22);

const SMART_TOP_HEIGHT = px(78);
const SMART_BOTTOM_INFO_TOP = px(1075);
const SMART_AGE_TOP = px(645);
const SMART_LOGO_ZONE_TOP = px(720);
const SMART_LOGO_ZONE_BOTTOM = px(1002);

const ORIGINAL_TOP = px(30);
const ORIGINAL_BADGE_HEIGHT = px(100);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function rgbToHex(r, g, b) { return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`; }

export async function dynamicAccent(imageBuffer, inputOptions) {
  try {
    // stats() ignores pending resize operations. Materialize the small sample
    // first, otherwise every new poster scans all 912,600 full-canvas pixels.
    const thumbnail = await sharp(imageBuffer, inputOptions).resize(64, 64, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
    const sample = await sharp(thumbnail.data, { raw: { width: thumbnail.info.width, height: thumbnail.info.height, channels: thumbnail.info.channels } }).stats();
    let { r, g, b } = sample.dominant;
    const max = Math.max(r, g, b, 1), min = Math.min(r, g, b);
    if (max - min < 22) { r *= 0.72; g *= 0.72; b *= 0.72; }
    else { const target = 150, scale = max > target ? target / max : 1; r *= scale; g *= scale; b *= scale; }
    return rgbToHex(r, g, b);
  } catch { return '#2f2d33'; }
}

function smartTagWidth(text, min = 238, max = 590) {
  // BetterPosters-style labels use generous horizontal padding and a compact
  // height. Longer status text such as "Limited Series" should grow instead
  // of feeling squeezed into the same pill as "#5 Today".
  return clamp(px(128 + String(text || '').length * 34), px(min), px(max));
}

async function smartTopTag(text, { fill = '#29292d', fillOpacity = 0.94, width, fontSize = 48, textColor = '#ffffff' } = {}) {
  const resolvedWidth = width || smartTagWidth(text), safeText = esc(text), radius = px(18), resolvedFontSize = px(fontSize);
  const opticalY = Math.round(SMART_TOP_HEIGHT / 2 + px(2));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${SMART_TOP_HEIGHT}" viewBox="0 0 ${resolvedWidth} ${SMART_TOP_HEIGHT}"><path d="M0 0h${resolvedWidth}v${SMART_TOP_HEIGHT-radius}a${radius} ${radius} 0 0 1-${radius} ${radius}H${radius}A${radius} ${radius} 0 0 1 0 ${SMART_TOP_HEIGHT-radius}z" fill="${fill}" fill-opacity="${fillOpacity}"/><text x="${resolvedWidth/2}" y="${opticalY}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${resolvedFontSize}" font-weight="700" letter-spacing="-0.45" fill="${textColor}">${safeText}</text></svg>`);
  return { buffer: await sharp(svg).png().toBuffer(), width: resolvedWidth, height: SMART_TOP_HEIGHT };
}

async function originalBadgeImage(text, { width = px(250), height = ORIGINAL_BADGE_HEIGHT, fill = '#101116', fillOpacity = 0.93, textColor = '#ffffff', fontSize = 44, radius = 16, strokeOpacity = 0.14 } = {}) {
  const resolvedFontSize = px(fontSize), resolvedRadius = px(radius);
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width-2}" height="${height-2}" rx="${resolvedRadius}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-opacity="${strokeOpacity}" stroke-width="1"/></svg>`);
  const textLayer = { text: { text: `<span foreground="${textColor}" weight="bold">${esc(text)}</span>`, font: `Inter ${resolvedFontSize}`, width: Math.max(1,width-px(34)), height: Math.max(1,height-px(14)), align:'center', rgba:true } };
  return sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:background,top:0,left:0},{input:textLayer,gravity:'center'}]).png().toBuffer();
}

async function smartBottomInfo(genre, ratingLabel) {
  const cleanGenre=String(genre||'').trim().replace(/^Science Fiction$/, 'Sci-Fi').replace(/^Sci-Fi & Fantasy$/, 'Sci-Fi').replace(/^Action & Adventure$/, 'Action'), cleanRating=String(ratingLabel||'').replace(/^★\s*/,'').replace(/^(IMDb|TMDB)\s+/i,'').trim();
  if(!cleanGenre&&!cleanRating)return null;
  const text=cleanGenre&&cleanRating?`${cleanGenre}  ·  ★ ${cleanRating}`:cleanGenre||`★ ${cleanRating}`;
  const width=px(720),height=px(62);
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="shadow" x="-20%" y="-70%" width="140%" height="240%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#000" flood-opacity="0.72"/></filter></defs><text x="${width/2}" y="${height/2}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${px(43)}" font-weight="700" letter-spacing="-0.3" fill="#f2f2f4" fill-opacity="0.94" filter="url(#shadow)">${esc(text)}</text></svg>`);
  return sharp(svg).png().toBuffer();
}

async function titleImage(title){const text=String(title||'').trim();if(!text)return null;const fontSize=px(text.length>30?42:text.length>20?50:60),width=px(700),textHeight=px(180),canvasHeight=px(184);const shadow={text:{text:`<span foreground="#000000" alpha="68%" weight="bold">${esc(text)}</span>`,font:`Inter ${fontSize}`,width,height:textHeight,align:'center',rgba:true}},foreground={text:{text:`<span foreground="#ffffff" weight="bold">${esc(text)}</span>`,font:`Inter ${fontSize}`,width,height:textHeight,align:'center',rgba:true}};return sharp({create:{width,height:canvasHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:shadow,top:px(3),left:px(1)},{input:foreground,top:0,left:0}]).png().toBuffer();}
async function smartLogoImage(logoPath){if(!logoPath)return null;try{const response=await fetch(`${TMDB_LOGO_BASE}${logoPath}`,{headers:{accept:'image/*'},signal:AbortSignal.timeout(3000)});if(!response.ok)return null;const input=Buffer.from(await response.arrayBuffer()),meta=await sharp(input).metadata();if(!meta.width||!meta.height)return null;const scale=Math.min(px(680)/meta.width,px(215)/meta.height,1),width=Math.max(1,Math.round(meta.width*scale)),height=Math.max(1,Math.round(meta.height*scale));return{buffer:await sharp(input).resize(width,height,{fit:'inside',withoutEnlargement:true}).png().toBuffer(),width,height};}catch{return null;}}
function smartBottomBackdrop(){const height=px(275);return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.42" stop-color="#000" stop-opacity="0.04"/><stop offset="0.72" stop-color="#000" stop-opacity="0.20"/><stop offset="1" stop-color="#000" stop-opacity="0.54"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);}
async function readJson(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{};}

export async function renderPoster(body){
 const{posterPath,sourceUrl,logoPath='',title='',smartLayout=false,overlayOnly=false,rating='',ratingLabel='',genre='',trend='',age='',quality='',overlayColor='dynamic'}=body||{};
 const posterUrl=sourceUrl||(posterPath?`${TMDB_IMAGE_BASE}${posterPath}`:'');if(!posterUrl)throw new Error('posterPath or sourceUrl is required');
 const logoPromise=smartLayout&&!overlayOnly&&logoPath?smartLogoImage(logoPath):Promise.resolve(null);
 let source;
 if(!sourceUrl&&posterPath){
  source=await loadTmdbPosterSource(posterPath);
 }else{
  const res=await fetch(posterUrl,{headers:{accept:'image/*'},signal:AbortSignal.timeout(4000)});if(!res.ok)throw new Error(`Source image fetch failed: ${res.status}`);
  source={input:Buffer.from(await res.arrayBuffer()),status:'BYPASS',key:'',retentionUntil:0};
 }
 // Keep the intermediate canvas as pixels; PNG encoding followed immediately
 // by PNG decoding adds CPU work without improving the final WebP image.
 const input=source.input,resized=await sharp(input).resize(POSTER_WIDTH,POSTER_HEIGHT,{fit:'cover'}).raw().toBuffer({resolveWithObject:true}),composites=[];
 const canvasOptions={raw:{width:resized.info.width,height:resized.info.height,channels:resized.info.channels}};
 const resolvedRatingLabel=ratingLabel||(rating?`★ ${rating}`:'');
 const dynamicFill=overlayColor==='dynamic'&&trend?await dynamicAccent(resized.data,canvasOptions):overlayColor;
 if(smartLayout){
  composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-px(275),left:0});
  if(quality){if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,238,590)});composites.push({input:t.buffer,top:0,left:SAFE_MARGIN});}const q=await smartTopTag(quality,{fill:'#f4f4f5',fillOpacity:.96,width:smartTagWidth(quality,108,158),fontSize:39,textColor:'#111318'});composites.push({input:q.buffer,top:0,left:POSTER_WIDTH-SAFE_MARGIN-q.width});}
  else if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,238,590)});composites.push({input:t.buffer,top:0,left:Math.round((POSTER_WIDTH-t.width)/2)});}
  if(age){const width=smartTagWidth(age,132,205),badge=await originalBadgeImage(age,{width,height:px(64),fill:'#111216',fillOpacity:.50,fontSize:34,radius:8,strokeOpacity:.20});composites.push({input:badge,top:SMART_AGE_TOP,left:Math.round((POSTER_WIDTH-width)/2)});}
  if(!overlayOnly){const logo=await logoPromise;if(logo){const left=Math.round((POSTER_WIDTH-logo.width)/2),top=SMART_LOGO_ZONE_TOP+Math.round(((SMART_LOGO_ZONE_BOTTOM-SMART_LOGO_ZONE_TOP)-logo.height)/2);composites.push({input:logo.buffer,top,left});}else if(title){const b=await titleImage(title);if(b)composites.push({input:b,top:px(790),left:px(40)});}}
  const info=await smartBottomInfo(genre,resolvedRatingLabel);if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:px(30)});
 }else{
  if(age){const width=smartTagWidth(age,132,205),badge=await originalBadgeImage(age,{width,height:px(64),fill:'#111216',fillOpacity:.50,fontSize:34,radius:8,strokeOpacity:.20});composites.push({input:badge,top:SMART_AGE_TOP,left:Math.round((POSTER_WIDTH-width)/2)});}
  if(quality){if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,238,590)});composites.push({input:t.buffer,top:0,left:SAFE_MARGIN});}const q=await smartTopTag(quality,{fill:'#f4f4f5',fillOpacity:.96,width:smartTagWidth(quality,108,158),fontSize:39,textColor:'#111318'});composites.push({input:q.buffer,top:0,left:POSTER_WIDTH-SAFE_MARGIN-q.width});}
  else if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,238,590)});composites.push({input:t.buffer,top:0,left:Math.round((POSTER_WIDTH-t.width)/2)});}
  composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-px(275),left:0});
  const info=await smartBottomInfo(genre,resolvedRatingLabel);if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:px(30)});
 }
 const composed=await sharp(resized.data,canvasOptions).composite(composites).raw().toBuffer({resolveWithObject:true});
 const output=await sharp(composed.data,{raw:{width:composed.info.width,height:composed.info.height,channels:composed.info.channels}}).webp({quality:80,effort:3,smartSubsample:true}).toBuffer();
 output.kollectionSourceCache=source.status;
 output.kollectionSourceCacheKey=source.key;
 output.kollectionSourceRetentionUntil=source.retentionUntil;
 return output;
}

const server=http.createServer(async(req,res)=>{try{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,renderer:'kollection-posters-v2-bp-layout-25'}));}if(req.method!=='POST'||req.url!=='/render'){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Not found'}));}const body=await readJson(req),started=Date.now(),output=await renderPoster(body);res.writeHead(200,{'content-type':'image/webp','content-length':String(output.length),'cache-control':'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800','x-kollection-renderer':'v2-bp-layout-25','x-kollection-render-ms':String(Date.now()-started),'x-kollection-source-cache':String(output.kollectionSourceCache||'BYPASS'),'x-kollection-source-cache-version':SOURCE_CACHE_VERSION,'x-kollection-source-cache-key':String(output.kollectionSourceCacheKey||'').slice(0,16),'x-kollection-source-retention-until':String(output.kollectionSourceRetentionUntil||0)});res.end(output);}catch(error){res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:error?.message||'Render failed'}));}});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)server.listen(PORT,'0.0.0.0',()=>console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
