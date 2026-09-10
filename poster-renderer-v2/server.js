import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';
const POSTER_WIDTH = 780;
const POSTER_HEIGHT = 1170;
const SAFE_MARGIN = 30;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function pillImage(text, {
  width = 210,
  height = 58,
  fill = '#0b0d12',
  fillOpacity = 0.9,
  stroke = '#ffffff',
  strokeOpacity = 0.2,
  textColor = '#ffffff',
  fontSize = 28,
} = {}) {
  const background = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${Math.floor(height / 2)}"
        fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="2"/>
    </svg>`);

  const safeText = esc(text);
  const textLayer = {
    text: {
      text: `<span foreground="${textColor}" weight="bold">${safeText}</span>`,
      font: `DejaVu Sans ${fontSize}`,
      width: Math.max(1, width - 24),
      height: Math.max(1, height - 14),
      align: 'center',
      rgba: true,
    },
  };

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: background, top: 0, left: 0 },
      { input: textLayer, gravity: 'center' },
    ])
    .png()
    .toBuffer();
}

function ratingBadgeWidth(label) {
  const length = String(label || '').length;
  if (length <= 6) return 165;
  if (length <= 10) return 205;
  return 245;
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
    ratingLabel = '',
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

  if (age) {
    composites.push({
      input: await pillImage(age, { width: 138, height: 58, fontSize: 25 }),
      top: SAFE_MARGIN,
      left: SAFE_MARGIN,
    });
  }

  if (quality) {
    const width = 150;
    composites.push({
      input: await pillImage(quality, { width, height: 60, fontSize: 25 }),
      top: SAFE_MARGIN,
      left: POSTER_WIDTH - SAFE_MARGIN - width,
    });
  }

  if (trend) {
    const trendWidth = 220;
    const trendLeft = quality ? 350 : Math.round((POSTER_WIDTH - trendWidth) / 2);
    composites.push({
      input: await pillImage(trend, {
        width: trendWidth,
        height: 60,
        fill: '#5b6cff',
        fillOpacity: 0.94,
        strokeOpacity: 0.18,
        fontSize: 25,
      }),
      top: SAFE_MARGIN,
      left: trendLeft,
    });
  }

  const resolvedRatingLabel = ratingLabel || (rating ? `★ ${rating}` : '');
  if (resolvedRatingLabel) {
    const width = ratingBadgeWidth(resolvedRatingLabel);
    const height = 62;
    composites.push({
      input: await pillImage(resolvedRatingLabel, { width, height, fontSize: 27 }),
      top: POSTER_HEIGHT - SAFE_MARGIN - height,
      left: SAFE_MARGIN,
    });
  }

  if (genre) {
    const genreWidth = 230;
    const height = 58;
    composites.push({
      input: await pillImage(genre, { width: genreWidth, height, fontSize: 24 }),
      top: POSTER_HEIGHT - SAFE_MARGIN - height,
      left: Math.round((POSTER_WIDTH - genreWidth) / 2),
    });
  }

  return sharp(input)
    .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: 'cover' })
    .composite(composites)
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-sharp-rating-1' }));
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
      'x-kollection-renderer': 'v2-sharp-rating-1',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
