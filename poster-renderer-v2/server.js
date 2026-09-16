import http from 'node:http';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { loadBtttrPosterSource, loadTmdbLogoSource, loadTmdbPosterSource, SOURCE_CACHE_VERSION } from './source-loader.js';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const logoCache = new Map();
const logoFlights = new Map();
const LOGO_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const LOGO_CACHE_MAX_ENTRIES = 64;
const LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let logoCacheBytes = 0;

function deleteLogo(key) {
 const entry=logoCache.get(key);
 if(!entry)return;
 logoCache.delete(key);
 logoCacheBytes-=entry.image.buffer.length;
}

export function resetLogoCacheForTests() {
 logoCache.clear();logoFlights.clear();logoCacheBytes=0;
}
// Layout measurements below are expressed in the original 780px design grid
// and scaled once at render time. This preserves the approved overlay geometry
// while avoiding a 780x1170 intermediate canvas followed by a second resize.
const px = (value) => Math.round(value * POSTER_WIDTH / 780);
const SAFE_MARGIN = px(22);

const SMART_TOP_HEIGHT = px(100);
const BETTER_POSTERS_TOP_HEIGHT = px(92);
const BETTER_POSTERS_BADGE_FILL = '#2f2d33';
const SMART_BOTTOM_INFO_TOP = px(1050);
const SMART_AGE_TOP = px(625);
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
    if (max - min < 22) { r *= 0.62; g *= 0.62; b *= 0.62; }
    else { const target = 112, scale = max > target ? target / max : 1; r *= scale; g *= scale; b *= scale; }
    return rgbToHex(r, g, b);
  } catch { return '#2f2d33'; }
}

function betterPostersTrendFontSize(text) {
  const length = String(text || '').length;
  if (length > 22) return 31;
  if (length > 17) return 34;
  if (length > 12) return 38;
  return 42;
}

function betterPostersTagWidth(text, min = 132, max = 390) {
  // Match Better Posters' compact pill proportions: modest side padding and
  // text-driven growth, rather than the much wider Smart Layout tag formula.
  return clamp(px(64 + String(text || '').length * 24), px(min), px(max));
}

async function betterPostersTrendTag(text) {
  const width = betterPostersTagWidth(text);
  const height = BETTER_POSTERS_TOP_HEIGHT;
  const radius = px(8);
  const fontSize = px(betterPostersTrendFontSize(text));
  const safeText = esc(text);
  const opticalY = Math.round(height / 2 + px(1));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 0h${width}v${height-radius}a${radius} ${radius} 0 0 1-${radius} ${radius}H${radius}A${radius} ${radius} 0 0 1 0 ${height-radius}z" fill="${BETTER_POSTERS_BADGE_FILL}" fill-opacity=".94"/><text x="${width/2}" y="${opticalY}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${fontSize}" font-weight="700" letter-spacing="-.32" fill="#fff" fill-opacity=".96">${safeText}</text></svg>`);
  return { buffer: await sharp(svg).png().toBuffer(), width, height };
}

async function addBetterPostersTrendTag(composites, { trend = '', qualityReserved = false } = {}) {
  if (!trend) return;
  const tag = await betterPostersTrendTag(trend);
  const left = qualityReserved
    ? SAFE_MARGIN
    : Math.round((POSTER_WIDTH - tag.width) / 2);
  composites.push({ input: tag.buffer, top: 0, left });
}

function smartTagWidth(text, min = 238, max = 590) {
  // BetterPosters-style labels use generous horizontal padding and a compact
  // height. Longer status text such as "Limited Series" should grow instead
  // of feeling squeezed into the same pill as "#5 Today".
  return clamp(px(142 + String(text || '').length * 38), px(min), px(max));
}

async function smartTopTag(text, { fill = '#29292d', fillOpacity = 0.94, width, fontSize = 60, textColor = '#ffffff' } = {}) {
  const resolvedWidth = width || smartTagWidth(text), safeText = esc(text), radius = px(18), resolvedFontSize = px(fontSize);
  const opticalY = Math.round(SMART_TOP_HEIGHT / 2 + px(2));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${SMART_TOP_HEIGHT}" viewBox="0 0 ${resolvedWidth} ${SMART_TOP_HEIGHT}"><path d="M0 0h${resolvedWidth}v${SMART_TOP_HEIGHT-radius}a${radius} ${radius} 0 0 1-${radius} ${radius}H${radius}A${radius} ${radius} 0 0 1 0 ${SMART_TOP_HEIGHT-radius}z" fill="${fill}" fill-opacity="${fillOpacity}"/><text x="${resolvedWidth/2}" y="${opticalY}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${resolvedFontSize}" font-weight="700" letter-spacing="-0.45" fill="${textColor}">${safeText}</text></svg>`);
  return { buffer: await sharp(svg).png().toBuffer(), width: resolvedWidth, height: SMART_TOP_HEIGHT };
}

async function smartAuxTag(text) {
  const width = smartTagWidth(text, 126, 250), height = px(70), radius = px(16), safeText = esc(text), fontSize = px(40);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="#111216" fill-opacity=".74" stroke="#fff" stroke-opacity=".12"/><text x="${width/2}" y="${height/2 + px(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${fontSize}" font-weight="700" letter-spacing="-.25" fill="#f5f5f6">${safeText}</text></svg>`);
  return { buffer: await sharp(svg).png().toBuffer(), width, height };
}

function smartTrendFontSize(text) {
  const length = String(text || '').length;
  if (length > 21) return 42;
  if (length > 16) return 47;
  if (length > 11) return 53;
  return 60;
}

async function addSmartTopTags(composites, { trend = '', quality = '', audio = '', dynamicFill = '#29292d' } = {}) {
  if (quality) {
    const q = await smartTopTag(quality, {
      fill: '#f4f4f5',
      fillOpacity: .96,
      width: smartTagWidth(quality, 122, 305),
      fontSize: String(quality).length > 8 ? 39 : 46,
      textColor: '#111318',
    });
    const qLeft = POSTER_WIDTH - SAFE_MARGIN - q.width;
    if (trend) {
      const availableWidth = Math.max(px(250), qLeft - SAFE_MARGIN - px(18));
      const width = Math.min(smartTagWidth(trend, 250, 620), availableWidth);
      const t = await smartTopTag(trend, {
        fill: dynamicFill,
        width,
        fontSize: smartTrendFontSize(trend),
      });
      composites.push({ input: t.buffer, top: 0, left: SAFE_MARGIN });
    }
    composites.push({ input: q.buffer, top: 0, left: qLeft });
    if (audio) {
      const a = await smartAuxTag(audio);
      composites.push({ input: a.buffer, top: SMART_TOP_HEIGHT + px(12), left: POSTER_WIDTH - SAFE_MARGIN - a.width });
    }
    return;
  }
  if (trend) {
    const t = await smartTopTag(trend, {
      fill: dynamicFill,
      width: smartTagWidth(trend, 250, 620),
      fontSize: smartTrendFontSize(trend),
    });
    composites.push({ input: t.buffer, top: 0, left: Math.round((POSTER_WIDTH - t.width) / 2) });
  }
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
  const width=px(720),height=px(82);
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="shadow" x="-20%" y="-70%" width="140%" height="240%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#000" flood-opacity="0.72"/></filter></defs><text x="${width/2}" y="${height/2}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, DejaVu Sans" font-size="${px(54)}" font-weight="700" letter-spacing="-0.3" fill="#f2f2f4" fill-opacity="0.94" filter="url(#shadow)">${esc(text)}</text></svg>`);
  return sharp(svg).png().toBuffer();
}

async function titleImage(title){const text=String(title||'').trim();if(!text)return null;const fontSize=px(text.length>30?42:text.length>20?50:60),width=px(700),textHeight=px(180),canvasHeight=px(184);const shadow={text:{text:`<span foreground="#000000" alpha="68%" weight="bold">${esc(text)}</span>`,font:`Inter ${fontSize}`,width,height:textHeight,align:'center',rgba:true}},foreground={text:{text:`<span foreground="#ffffff" weight="bold">${esc(text)}</span>`,font:`Inter ${fontSize}`,width,height:textHeight,align:'center',rgba:true}};return sharp({create:{width,height:canvasHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:shadow,top:px(3),left:px(1)},{input:foreground,top:0,left:0}]).png().toBuffer();}
export async function fitTitleImage(input) {
 const trimmed=await sharp(input).trim({background:'#00000000',threshold:0}).png().toBuffer();
 const {data,info}=await sharp(trimmed).resize(px(680),px(215),{fit:'inside'}).png().toBuffer({resolveWithObject:true});
 return {buffer:data,width:info.width,height:info.height};
}
export function titlePlacement(image) {
 return {left:Math.round((POSTER_WIDTH-image.width)/2),top:SMART_LOGO_ZONE_TOP+Math.round(((SMART_LOGO_ZONE_BOTTOM-SMART_LOGO_ZONE_TOP)-image.height)/2)};
}
async function smartLogoImage(logoPath){
 if(!logoPath)return null;
 const cached=logoCache.get(logoPath);
 if(cached&&cached.expiresAt>Date.now()){
  logoCache.delete(logoPath);logoCache.set(logoPath,cached);
  return cached.image;
 }
 deleteLogo(logoPath);
 if(logoFlights.has(logoPath))return logoFlights.get(logoPath);
 const work=loadLogoImage(logoPath);
 logoFlights.set(logoPath,work);
 try{return await work;}
 finally{if(logoFlights.get(logoPath)===work)logoFlights.delete(logoPath);}
}

async function loadLogoImage(logoPath){
 try{
  const source=await loadTmdbLogoSource(logoPath);
  const image=await fitTitleImage(source.input);
  // Keep the fitted result in memory while the original w500 logo is also
  // retained in the shared R2 source cache for future container instances.
  if(image.buffer.length<=LOGO_CACHE_MAX_BYTES){
   logoCache.set(logoPath,{image,expiresAt:Date.now()+LOGO_CACHE_TTL_MS});
   logoCacheBytes+=image.buffer.length;
   while(logoCache.size>LOGO_CACHE_MAX_ENTRIES||logoCacheBytes>LOGO_CACHE_MAX_BYTES)deleteLogo(logoCache.keys().next().value);
  }
  return image;
 }catch{return null;}
}
function smartBottomBackdrop(){const height=px(275);return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.42" stop-color="#000" stop-opacity="0.04"/><stop offset="0.72" stop-color="#000" stop-opacity="0.20"/><stop offset="1" stop-color="#000" stop-opacity="0.54"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);}
async function readJson(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{};}

export async function warmPosterAssets(body){
 const{posterPath,sourceUrl='',logoPath='',smartLayout=false,overlayOnly=false}=body||{};
 const jobs=[];
 if(posterPath)jobs.push(loadTmdbPosterSource(posterPath));
 if(sourceUrl&&String(sourceUrl).startsWith('https://btttr.cc/'))jobs.push(loadBtttrPosterSource(sourceUrl));
 if(smartLayout&&!overlayOnly&&logoPath)jobs.push(smartLogoImage(logoPath));
 await Promise.allSettled(jobs);
 return {warmed:jobs.length};
}

export async function renderPoster(body){
 const{posterPath,sourceUrl,logoPath='',title='',smartLayout=false,overlayOnly=false,rating='',ratingLabel='',genre='',trend='',age='',quality='',audio='',overlayColor='dynamic',betterPostersBadge=false,betterPostersQuality=false}=body||{};
 const posterUrl=sourceUrl||(posterPath?`${TMDB_IMAGE_BASE}${posterPath}`:'');if(!posterUrl)throw new Error('posterPath or sourceUrl is required');
 const logoPromise=smartLayout&&!overlayOnly&&logoPath?smartLogoImage(logoPath):Promise.resolve(null);
 let source;
 if(!sourceUrl&&posterPath){
  source=await loadTmdbPosterSource(posterPath);
 }else if(sourceUrl&&String(sourceUrl).startsWith('https://btttr.cc/')){
  source=await loadBtttrPosterSource(sourceUrl);
 }else{
  const res=await fetch(posterUrl,{headers:{accept:'image/*'},signal:AbortSignal.timeout(4000)});if(!res.ok)throw new Error(`Source image fetch failed: ${res.status}`);
  source={input:Buffer.from(await res.arrayBuffer()),status:'BYPASS',key:'',retentionUntil:0};
 }
 // Keep the intermediate canvas as pixels; PNG encoding followed immediately
 // by PNG decoding adds CPU work without improving the final WebP image.
 const input=source.input,resized=await sharp(input).resize(POSTER_WIDTH,POSTER_HEIGHT,{fit:'cover'}).raw().toBuffer({resolveWithObject:true}),composites=[];
 const canvasOptions={raw:{width:resized.info.width,height:resized.info.height,channels:resized.info.channels}};
 const resolvedRatingLabel=ratingLabel||(rating?`★ ${rating}`:'');
 // Build independent overlay assets in parallel. Composite order stays exactly
 // the same, so this only shortens renderer CPU time and does not change layout.
 const topTagsPromise=(async()=>{
  const top=[];
  if(betterPostersBadge){
   await addBetterPostersTrendTag(top,{trend,qualityReserved:betterPostersQuality});
  }else{
   const dynamicFill=overlayColor==='dynamic'&&trend?await dynamicAccent(resized.data,canvasOptions):overlayColor;
   await addSmartTopTags(top,{trend,quality,audio,dynamicFill});
  }
  return top;
 })();
 const agePromise=age?(async()=>{
  const width=smartTagWidth(age,146,230);
  const badge=await originalBadgeImage(age,{width,height:px(82),fill:'#111216',fillOpacity:.50,fontSize:42,radius:10,strokeOpacity:.20});
  return {input:badge,top:SMART_AGE_TOP,left:Math.round((POSTER_WIDTH-width)/2)};
 })():Promise.resolve(null);
 const infoPromise=smartBottomInfo(genre,resolvedRatingLabel);
 const finalLogoPromise=smartLayout&&!overlayOnly?(async()=>{
  let logo=await logoPromise;
  if(!logo&&title){const b=await titleImage(title);if(b)logo=await fitTitleImage(b);}
  return logo;
 })():Promise.resolve(null);
 const[topTags,ageComposite,logo,info]=await Promise.all([topTagsPromise,agePromise,finalLogoPromise,infoPromise]);
 if(smartLayout){
  composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-px(300),left:0});
  composites.push(...topTags);
  if(ageComposite)composites.push(ageComposite);
  if(logo)composites.push({input:logo.buffer,...titlePlacement(logo)});
  if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:px(30)});
 }else{
  if(ageComposite)composites.push(ageComposite);
  composites.push(...topTags);
  composites.push({input:smartBottomBackdrop(),top:POSTER_HEIGHT-px(300),left:0});
  if(info)composites.push({input:info,top:SMART_BOTTOM_INFO_TOP,left:px(30)});
 }
 const output=await sharp(resized.data,canvasOptions).composite(composites).webp({quality:80,effort:3,smartSubsample:true}).toBuffer();
 output.kollectionSourceCache=source.status;
 output.kollectionSourceCacheKey=source.key;
 output.kollectionSourceRetentionUntil=source.retentionUntil;
 return output;
}

const server=http.createServer(async(req,res)=>{try{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,renderer:'kollection-posters-v2-bp-layout-30'}));}if(req.method==='POST'&&req.url==='/warm'){const body=await readJson(req),started=Date.now(),result=await warmPosterAssets(body);res.writeHead(204,{'cache-control':'no-store','x-kollection-warm-ms':String(Date.now()-started),'x-kollection-warmed-assets':String(result.warmed)});return res.end();}if(req.method!=='POST'||req.url!=='/render'){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Not found'}));}const body=await readJson(req),started=Date.now(),output=await renderPoster(body);res.writeHead(200,{'content-type':'image/webp','content-length':String(output.length),'cache-control':'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800','x-kollection-renderer':'v2-bp-layout-30','x-kollection-render-ms':String(Date.now()-started),'x-kollection-source-cache':String(output.kollectionSourceCache||'BYPASS'),'x-kollection-source-cache-version':SOURCE_CACHE_VERSION,'x-kollection-source-cache-key':String(output.kollectionSourceCacheKey||'').slice(0,16),'x-kollection-source-retention-until':String(output.kollectionSourceRetentionUntil||0)});res.end(output);}catch(error){res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:error?.message||'Render failed'}));}});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)server.listen(PORT,'0.0.0.0',()=>console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
