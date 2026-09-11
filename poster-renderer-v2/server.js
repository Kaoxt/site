import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/original';
const POSTER_WIDTH = 780;
const POSTER_HEIGHT = 1170;
const SAFE_MARGIN = 30;
const SMART_BADGE_TOP = 845;
const SMART_TITLE_BOTTOM = POSTER_HEIGHT - SAFE_MARGIN;
const ORIGINAL_SECOND_ROW_TOP = SAFE_MARGIN + 76;

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

async function titleImage(title) {
  const text = String(title || '').trim();
  if (!text) return null;
  const fontSize = text.length > 30 ? 34 : text.length > 20 ? 39 : 46;
  return sharp({
    text: {
      text: `<span foreground="#ffffff" weight="bold">${esc(text)}</span>`,
      font: `DejaVu Sans ${fontSize}`,
      width: 680,
      height: 150,
      align: 'center',
      rgba: true,
    },
  }).png().toBuffer();
}

async function smartLogoImage(logoPath) {
  if (!logoPath) return null;
  try {
    const response = await fetch(`${TMDB_LOGO_BASE}${logoPath}`, { headers: { accept: 'image/*' } });
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) return null;

    const maxWidth = 620;
    const maxHeight = 155;
    const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1);
    const width = Math.max(1, Math.round(meta.width * scale));
    const height = Math.max(1, Math.round(meta.height * scale));
    const buffer = await sharp(input)
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    return { buffer, width, height };
  } catch {
    return null;
  }
}

function bottomLogoBackdrop(height = 325) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0"/>
          <stop offset="0.40" stop-color="#000000" stop-opacity="0.14"/>
          <stop offset="0.68" stop-color="#000000" stop-opacity="0.34"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`);
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
    logoPath = '',
    title = '',
    smartLayout = false,
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
  const resolvedRatingLabel = ratingLabel || (rating ? `★ ${rating}` : '');

  if (smartLayout) {
    // Smart Layout reserves the very bottom of the poster for the title/logo.
    // Metadata sits above that title zone so badges never cover or touch the movie name.
    composites.push({
      input: bottomLogoBackdrop(),
      top: POSTER_HEIGHT - 325,
      left: 0,
    });
  }

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

  if (resolvedRatingLabel) {
    const width = ratingBadgeWidth(resolvedRatingLabel);
    const height = 62;
    composites.push({
      input: await pillImage(resolvedRatingLabel, { width, height, fontSize: 27 }),
      top: smartLayout ? SMART_BADGE_TOP : ORIGINAL_SECOND_ROW_TOP,
      left: SAFE_MARGIN,
    });
  }

  if (genre) {
    const genreWidth = 230;
    const height = 58;
    composites.push({
      input: await pillImage(genre, { width: genreWidth, height, fontSize: 24 }),
      top: smartLayout ? SMART_BADGE_TOP + 2 : ORIGINAL_SECOND_ROW_TOP + 2,
      left: smartLayout
        ? POSTER_WIDTH - SAFE_MARGIN - genreWidth
        : POSTER_WIDTH - SAFE_MARGIN - genreWidth,
    });
  }

  if (smartLayout) {
    const logo = await smartLogoImage(logoPath);

    if (logo) {
      const left = Math.round((POSTER_WIDTH - logo.width) / 2);
      const top = Math.max(940, SMART_TITLE_BOTTOM - logo.height);
      composites.push({ input: logo.buffer, top, left });
    } else if (title) {
      const titleBuffer = await titleImage(title);
      if (titleBuffer) {
        composites.push({
          input: titleBuffer,
          top: SMART_TITLE_BOTTOM - 150,
          left: 50,
        });
      }
    }
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
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-sharp-original-safe-1' }));
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
      'x-kollection-renderer': 'v2-sharp-original-safe-1',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
