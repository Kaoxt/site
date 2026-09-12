import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/original';
const POSTER_WIDTH = 780;
const POSTER_HEIGHT = 1170;
const SAFE_MARGIN = 30;

const SMART_TOP_HEIGHT = 100;
const SMART_BOTTOM_INFO_TOP = 1068;
const SMART_AGE_TOP = 645;
const SMART_LOGO_ZONE_TOP = 720;
const SMART_LOGO_ZONE_BOTTOM = 1002;

const ORIGINAL_TOP = 30;
const ORIGINAL_BADGE_HEIGHT = 100;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function rgbToHex(r, g, b) { return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`; }

async function dynamicAccent(imageBuffer) {
  try {
    const sample = await sharp(imageBuffer).resize(64, 64, { fit: 'cover' }).modulate({ saturation: 1.22, brightness: 0.96 }).stats();
    let { r, g, b } = sample.dominant;
    const max = Math.max(r, g, b, 1), min = Math.min(r, g, b);
    if (max - min < 22) { r *= 0.72; g *= 0.72; b *= 0.72; }
    else { const target = 150, scale = max > target ? target / max : 1; r *= scale; g *= scale; b *= scale; }
    return rgbToHex(r, g, b);
  } catch { return '#3b6f96'; }
}

function smartTagWidth(text, min = 220, max = 430) { return clamp(72 + String(text || '').length * 28, min, max); }

async function smartTopTag(text, { fill = '#3b6f96', fillOpacity = 0.9, width, fontSize = 46, textColor = '#ffffff' } = {}) {
  const resolvedWidth = width || smartTagWidth(text), safeText = esc(text), radius = 7;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${SMART_TOP_HEIGHT}" viewBox="0 0 ${resolvedWidth} ${SMART_TOP_HEIGHT}"><path d="M0 0h${resolvedWidth}v${SMART_TOP_HEIGHT-radius}a${radius} ${radius} 0 0 1-${radius} ${radius}H${radius}A${radius} ${radius} 0 0 1 0 ${SMART_TOP_HEIGHT-radius}z" fill="${fill}" fill-opacity="${fillOpacity}"/><text x="${resolvedWidth/2}" y="${SMART_TOP_HEIGHT/2}" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans" font-size="${fontSize}" font-weight="700" letter-spacing="-0.35" fill="${textColor}">${safeText}</text></svg>`);
  return { buffer: await sharp(svg).png().toBuffer(), width: resolvedWidth, height: SMART_TOP_HEIGHT };
}

async function originalBadgeImage(text, { width = 250, height = ORIGINAL_BADGE_HEIGHT, fill = '#101116', fillOpacity = 0.93, textColor = '#ffffff', fontSize = 44, radius = 16, strokeOpacity = 0.14 } = {}) {
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width-2}" height="${height-2}" rx="${radius}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-opacity="${strokeOpacity}" stroke-width="2"/></svg>`);
  const textLayer = { text: { text: `<span foreground="${textColor}" weight="bold">${esc(text)}</span>`, font: `DejaVu Sans ${fontSize}`, width: Math.max(1,width-34), height: Math.max(1,height-14), align:'center', rgba:true } };
  return sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:background,top:0,left:0},{input:textLayer,gravity:'center'}]).png().toBuffer();
}

async function smartBottomInfo(genre, ratingLabel) {
  const cleanGenre=String(genre||'').trim(), cleanRating=String(ratingLabel||'').replace(/^★\s*/,'').replace(/^(IMDb|TMDB)\s+/i,'').trim();
  if(!cleanGenre&&!cleanRating)return null;
  const text=cleanGenre&&cleanRating?`${cleanGenre} • ★ ${cleanRating}`:cleanGenre||`★ ${cleanRating}`;
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="72" viewBox="0 0 720 72"><defs><filter id="shadow" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.48"/></filter></defs><text x="360" y="36" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans" font-size="44" font-weight="600" letter-spacing="-0.2" fill="#dedee3" fill-opacity="0.82" filter="url(#shadow)">${esc(text)}</text></svg>`);
  return sharp(svg).png().toBuffer();
}

async function titleImage(title){const text=String(title||'').trim();if(!text)return null;const fontSize=text.length>30?42:text.length>20?50:60;const shadow={text:{text:`<span foreground="#000000" alpha="68%" weight="bold">${esc(text)}</span>`,font:`DejaVu Sans ${fontSize}`,width:700,height:180,align:'center',rgba:true}},foreground={text:{text:`<span foreground="#ffffff" weight="bold">${esc(text)}</span>`,font:`DejaVu Sans ${fontSize}`,width:700,height:180,align:'center',rgba:true}};return sharp({create:{width:700,height:184,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:shadow,top:3,left:1},{input:foreground,top:0,left:0}]).png().toBuffer();}
async function smartLogoImage(logoPath){if(!logoPath)return null;try{const response=await fetch(`${TMDB_LOGO_BASE}${logoPath}`,{headers:{accept:'image/*'}});if(!response.ok)return null;const input=Buffer.from(await response.arrayBuffer()),meta=await sharp(input).metadata();if(!meta.width||!meta.height)return null;const scale=Math.min(680/meta.width,215/meta.height,1),width=Math.max(1,Math.round(meta.width*scale)),height=Math.max(1,Math.round(meta.height*scale));return{buffer:await sharp(input).resize(width,height,{fit:'inside',withoutEnlargement:true}).png().toBuffer(),width,height};}catch{return null;}}
function smartBottomBackdrop(){return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="330"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.48" stop-color="#000" stop-opacity="0.05"/><stop offset="0.76" stop-color="#000" stop-opacity="0.20"/><stop offset="1" stop-color="#000" stop-opacity="0.48"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);}
async function readJson(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{};}

async function renderPoster(body){
 const{posterPath,sourceUrl,logoPath='',title='',smartLayout=false,rating='',ratingLabel='',genre='',trend='',age='',quality='',overlayColor='dynamic'}=body||{};
 const posterUrl=sourceUrl||(posterPath?`${TMDB_IMAGE_BASE}${posterPath}`:'');if(!posterUrl)throw new Error('posterPath or sourceUrl is required');
 const res=await fetch(posterUrl,{headers:{accept:'image/*'}});if(!res.ok)throw new Error(`Source image fetch failed: ${res.status}`);
 const input=Buffer.from(await res.arrayBuffer()),resized=await sharp(input).resize(POSTER_WIDTH,POSTER_HEIGHT,{fit:'cover'}).png().toBuffer(),composites=[];
 const resolvedRatingLabel=ratingLabel||(rating?`★ ${rating}`:'');
 if(smartLayout){
  const dynamicFill=overlayColor==='dynamic'?await dynamicAccent(resized):overlayColor;composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-330,left:0});
  if(quality){if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,300,390)});composites.push({input:t.buffer,top:0,left:SAFE_MARGIN});}const q=await smartTopTag(quality,{fill:'#f3f4f6',fillOpacity:.9,width:smartTagWidth(quality,112,160),fontSize:42,textColor:'#111318'});composites.push({input:q.buffer,top:0,left:POSTER_WIDTH-SAFE_MARGIN-q.width});}
  else if(trend){const t=await smartTopTag(trend,{fill:dynamicFill,width:smartTagWidth(trend,300,390)});composites.push({input:t.buffer,top:0,left:Math.round((POSTER_WIDTH-t.width)/2)});}
  if(age){const width=smartTagWidth(age,132,205),badge=await originalBadgeImage(age,{width,height:72,fill:'#111216',fillOpacity:.42,fontSize:38,radius:7,strokeOpacity:.22});composites.push({input:badge,top:SMART_AGE_TOP,left:Math.round((POSTER_WIDTH-width)/2)});}
  const logo=await smartLogoImage(logoPath);if(logo){const left=Math.round((POSTER_WIDTH-logo.width)/2),top=SMART_LOGO_ZONE_TOP+Math.round(((SMART_LOGO_ZONE_BOTTOM-SMART_LOGO_ZONE_TOP)-logo.height)/2);composites.push({input:logo.buffer,top,left});}else if(title){const b=await titleImage(title);if(b)composites.push({input:b,top:790,left:40});}
  const info=await smartBottomInfo(genre,resolvedRatingLabel);if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:30});
 }else{
  if(age){const width=smartTagWidth(age,132,205),badge=await originalBadgeImage(age,{width,height:72,fill:'#111216',fillOpacity:.42,fontSize:38,radius:7,strokeOpacity:.22});composites.push({input:badge,top:SMART_AGE_TOP,left:Math.round((POSTER_WIDTH-width)/2)});}
  if(quality){const width=190;composites.push({input:await originalBadgeImage(quality,{width,height:92,fill:'#f3f4f6',fillOpacity:.9,textColor:'#111318',fontSize:44,radius:8,strokeOpacity:.05}),top:0,left:POSTER_WIDTH-SAFE_MARGIN-width});}
  if(trend){const t=await smartTopTag(trend,{fill:'#4c83b2',fillOpacity:.9,width:smartTagWidth(trend,300,390)});composites.push({input:t.buffer,top:0,left:Math.round((POSTER_WIDTH-t.width)/2)});}
  composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-330,left:0});
  const info=await smartBottomInfo(genre,resolvedRatingLabel);if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:30});
 }
 return sharp(resized).composite(composites).webp({quality:88,effort:4}).toBuffer();
}

const server=http.createServer(async(req,res)=>{try{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,renderer:'kollection-posters-v2-bp-layout-12'}));}if(req.method!=='POST'||req.url!=='/render'){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Not found'}));}const body=await readJson(req),started=Date.now(),output=await renderPoster(body);res.writeHead(200,{'content-type':'image/webp','content-length':String(output.length),'cache-control':'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800','x-kollection-renderer':'v2-bp-layout-12','x-kollection-render-ms':String(Date.now()-started)});res.end(output);}catch(error){res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:error?.message||'Render failed'}));}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
