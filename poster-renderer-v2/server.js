import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function pillSvg(text, {
  width = 210,
  height = 58,
  fill = '#0b0d12',
  fillOpacity = 0.9,
  stroke = '#ffffff',
  strokeOpacity = 0.2,
  textColor = '#ffffff',
  fontSize = 28,
} = {}) {
  const safe = esc(text);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${Math.floor(height / 2)}"
        fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="2"/>
      <text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2) + Math.floor(fontSize * 0.36)}"
        text-anchor="middle" fill="${textColor}" font-family="DejaVu Sans, sans-serif"
        font-size="${fontSize}" font-weight="700">${safe}</text>
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
    rating = '',
    genre = '',
    trend = '',
    age = '',
    quality = '',
  } = body || {};

  const posterUrl = sourceUrl || (posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : '');
  if (!posterUrl) throw new Error('posterPath or sourceUrl is required');

  const res = await fetch(posterUrl, { headers: { accept: 'image/*' } });
  if (!res.ok) throw new Error(`Source image fetch failed: ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  const composites = [];

  // Match the Posters page preview: age top-left, trend top-center,
  // quality top-right, rating bottom-left, genre bottom-center.
  if (age) {
    composites.push({
      input: pillSvg(age, { width: 138, height: 58, fontSize: 25 }),
      top: 24,
      left: 24,
    });
  }

  if (quality) {
    composites.push({
      input: pillSvg(quality, { width: 150, height: 60, fontSize: 25 }),
      top: 24,
      left: 606,
    });
  }

  if (trend) {
    const trendWidth = 220;
    const trendLeft = quality ? 362 : Math.round((780 - trendWidth) / 2);
    composites.push({
      input: pillSvg(trend, {
        width: trendWidth,
        height: 60,
        fill: '#5b6cff',
        fillOpacity: 0.94,
        strokeOpacity: 0.18,
        fontSize: 25,
      }),
      top: 24,
      left: trendLeft,
    });
  }

  if (rating) {
    composites.push({
      input: pillSvg(`★ ${rating}`, { width: 165, height: 62, fontSize: 27 }),
      top: 1084,
      left: 24,
    });
  }

  if (genre) {
    const genreWidth = 230;
    composites.push({
      input: pillSvg(genre, { width: genreWidth, height: 58, fontSize: 24 }),
      top: 1088,
      left: Math.round((780 - genreWidth) / 2),
    });
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
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-sharp-overlay-2' }));
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
      'x-kollection-renderer': 'v2-sharp-overlay-2',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
