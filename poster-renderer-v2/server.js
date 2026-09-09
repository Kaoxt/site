import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function pillSvg(text, { width = 210, height = 58, fill = 'rgba(12,14,18,.82)', textColor = '#fff', fontSize = 28 } = {}) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${Math.floor(height / 2)}" fill="${fill}" stroke="rgba(255,255,255,.14)"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700">${esc(text)}</text>
    </svg>`);
}

function bottomTextSvg(title, rating, genre) {
  const safeTitle = esc(title || '');
  const safeMeta = esc([genre, rating ? `★ ${rating}` : ''].filter(Boolean).join(' · '));
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="780" height="220">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.82)"/></linearGradient></defs>
      <rect width="780" height="220" fill="url(#g)"/>
      <text x="36" y="145" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="700">${safeTitle}</text>
      <text x="36" y="194" fill="rgba(255,255,255,.88)" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="600">${safeMeta}</text>
    </svg>`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function renderPoster(body) {
  const {
    posterPath,
    sourceUrl,
    title = '',
    rating = '',
    genre = '',
    trend = '',
    age = '',
    smartLayout = true,
    quality = '',
  } = body || {};

  const posterUrl = sourceUrl || (posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : '');
  if (!posterUrl) throw new Error('posterPath or sourceUrl is required');

  const res = await fetch(posterUrl, { headers: { accept: 'image/*' } });
  if (!res.ok) throw new Error(`Source image fetch failed: ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  const composites = [];
  if (trend) composites.push({ input: pillSvg(trend, { width: 220, height: 60 }), top: 24, left: quality ? 520 : 280 });
  if (quality) composites.push({ input: pillSvg(quality, { width: 150, height: 60 }), top: 24, left: 606 });
  if (age) composites.push({ input: pillSvg(age, { width: 140, height: 54, fontSize: 25 }), top: 98, left: 24 });

  if (smartLayout) {
    composites.push({ input: bottomTextSvg(title, rating, genre), top: 950, left: 0 });
  } else {
    if (rating) composites.push({ input: pillSvg(`★ ${rating}`, { width: 150, height: 58 }), top: 1100, left: 24 });
    if (genre) composites.push({ input: pillSvg(genre, { width: 220, height: 58, fontSize: 25 }), top: 1100, left: 536 });
  }

  return sharp(input)
    .resize(780, 1170, { fit: 'cover' })
    .composite(composites)
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-sharp' }));
    }

    if (req.method !== 'POST' || req.url !== '/render') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }

    const body = await readJson(req);
    const started = Date.now();
    const output = await renderPoster(body);
    res.writeHead(200, {
      'content-type': 'image/webp',
      'content-length': String(output.length),
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'x-kollection-renderer': 'v2-sharp',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
