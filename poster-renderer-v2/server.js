import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/original';
const POSTER_WIDTH = 780;
const POSTER_HEIGHT = 1170;
const SAFE_MARGIN = 30;

const SMART_TOP_HEIGHT = 76;
const SMART_TOP_GAP = 12;
const SMART_BOTTOM_INFO_TOP = 1064;
const SMART_LOGO_ZONE_TOP = 770;
const SMART_LOGO_ZONE_BOTTOM = 1018;

const ORIGINAL_TOP = 32;
const ORIGINAL_BADGE_HEIGHT = 74;
const ORIGINAL_SECOND_ROW_TOP = ORIGINAL_TOP + ORIGINAL_BADGE_HEIGHT + 16;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

async function dynamicAccent(imageBuffer) {
  try {
    const sample = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'cover' })
      .modulate({ saturation: 1.32, brightness: 0.94 })
      .stats();
    let { r, g, b } = sample.dominant;
    const max = Math.max(r, g, b, 1);
    const min = Math.min(r, g, b);
    if (max - min < 22) {
      r *= 0.72;
      g *= 0.72;
      b *= 0.72;
    } else {
      const target = 138;
      const scale = max > target ? target / max : 1;
      r *= scale;
      g *= scale;
      b *= scale;
    }
    return rgbToHex(r, g, b);
  } catch {
    return '#34343c';
  }
}

function smartTagWidth(text, min = 150, max = 320) {
  return clamp(52 + String(text || '').length * 19, min, max);
}

async function smartTopTag(text, {
  fill = '#191a20',
  fillOpacity = 0.94,
  width,
  fontSize = 34,
} = {}) {
  const resolvedWidth = width || smartTagWidth(text);
  const background = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${SMART_TOP_HEIGHT}">
      <path d="M0 0h${resolvedWidth}v${SMART_TOP_HEIGHT - 10}a10 10 0 0 1-10 10H10A10 10 0 0 1 0 ${SMART_TOP_HEIGHT - 10}z"
        fill="${fill}" fill-opacity="${fillOpacity}"/>
    </svg>`);
  const textLayer = {
    text: {
      text: `<span foreground="#ffffff" weight="bold">${esc(text)}</span>`,
      font: `DejaVu Sans ${fontSize}`,
      width: Math.max(1, resolvedWidth - 28),
      height: SMART_TOP_HEIGHT - 8,
      align: 'center',
      rgba: true,
    },
  };
  const buffer = await sharp({
    create: { width: resolvedWidth, height: SMART_TOP_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: background, top: 0, left: 0 },
    { input: textLayer, gravity: 'center' },
  ]).png().toBuffer();
  return { buffer, width: resolvedWidth, height: SMART_TOP_HEIGHT };
}

async function originalBadgeImage(text, {
  width = 220,
  height = ORIGINAL_BADGE_HEIGHT,
  fill = '#101116',
  fillOpacity = 0.93,
  textColor = '#ffffff',
  fontSize = 32,
  radius = 14,
} = {}) {
  const background = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}"
        fill="${fill}" fill-opacity="${fillOpacity}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
    </svg>`);
  const textLayer = {
    text: {
      text: `<span foreground="${textColor}" weight="bold">${esc(text)}</span>`,
      font: `DejaVu Sans ${fontSize}`,
      width: Math.max(1, width - 28),
      height: Math.max(1, height - 12),
      align: 'center',
      rgba: true,
    },
  };
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: background, top: 0, left: 0 },
    { input: textLayer, gravity: 'center' },
  ]).png().toBuffer();
}

async function smartBottomInfo(genre, ratingLabel) {
  const parts = [];
  if (genre) parts.push(genre);
  if (ratingLabel) parts.push(`★ ${String(ratingLabel).replace(/^★\s*/, '').replace(/^(IMDb|TMDB)\s+/i, '')}`);
  if (!parts.length) return null;
  const text = parts.join(' • ');
  const shadow = {
    text: {
      text: `<span foreground="#000000" alpha="82%" weight="bold">${esc(text)}</span>`,
      font: 'DejaVu Sans 36',
      width: 720,
      height: 68,
      align: 'center',
      rgba: true,
    },
  };
  const foreground = {
    text: {
      text: `<span foreground="#e5e5e8" weight="bold">${esc(text)}</span>`,
      font: 'DejaVu Sans 36',
      width: 720,
      height: 68,
      align: 'center',
      rgba: true,
    },
  };
  return sharp({
    create: { width: 720, height: 72, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: shadow, top: 4, left: 1 },
    { input: foreground, top: 0, left: 0 },
  ]).png().toBuffer();
}

async function titleImage(title) {
  const text = String(title || '').trim();
  if (!text) return null;
  const fontSize = text.length > 30 ? 40 : text.length > 20 ? 46 : 54;
  const shadow = { text: { text: `<span foreground="#000000" alpha="78%" weight="bold">${esc(text)}</span>`, font: `DejaVu Sans ${fontSize}`, width: 700, height: 170, align: 'center', rgba: true } };
  const foreground = { text: { text: `<span foreground="#ffffff" weight="bold">${esc(text)}</span>`, font: `DejaVu Sans ${fontSize}`, width: 700, height: 170, align: 'center', rgba: true } };
  return sharp({ create: { width: 700, height: 174, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, top: 4, left: 1 }, { input: foreground, top: 0, left: 0 }])
    .png().toBuffer();
}

async function smartLogoImage(logoPath) {
  if (!logoPath) return null;
  try {
    const response = await fetch(`${TMDB_LOGO_BASE}${logoPath}`, { headers: { accept: 'image/*' } });
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) return null;
    const maxWidth = 660;
    const maxHeight = 198;
    const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1);
    const width = Math.max(1, Math.round(meta.width * scale));
    const height = Math.max(1, Math.round(meta.height * scale));
    const buffer = await sharp(input).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { buffer, width, height };
  } catch {
    return null;
  }
}

function smartBottomBackdrop() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="450">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset="0.52" stop-color="#000000" stop-opacity="0.10"/>
        <stop offset="0.77" stop-color="#000000" stop-opacity="0.31"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.66"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`);
}

function packSmartTopTags(items) {
  if (!items.length) return [];
  const available = POSTER_WIDTH - SAFE_MARGIN * 2;
  const rows = [];
  let row = [];
  let used = 0;
  for (const item of items) {
    const next = row.length ? used + SMART_TOP_GAP + item.width : item.width;
    if (row.length && next > available) {
      rows.push(row);
      row = [item];
      used = item.width;
    } else {
      row.push(item);
      used = next;
    }
  }
  if (row.length) rows.push(row);

  const placements = [];
  rows.forEach((itemsInRow, rowIndex) => {
    const total = itemsInRow.reduce((sum, item) => sum + item.width, 0) + SMART_TOP_GAP * Math.max(0, itemsInRow.length - 1);
    let left = Math.round((POSTER_WIDTH - total) / 2);
    const top = rowIndex * (SMART_TOP_HEIGHT + 10);
    itemsInRow.forEach((item) => {
      placements.push({ ...item, left, top });
      left += item.width + SMART_TOP_GAP;
    });
  });
  return placements;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function renderPoster(body) {
  const {
    posterPath, sourceUrl, logoPath = '', title = '', smartLayout = false,
    rating = '', ratingLabel = '', genre = '', trend = '', age = '', quality = '', overlayColor = 'dynamic',
  } = body || {};

  const posterUrl = sourceUrl || (posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : '');
  if (!posterUrl) throw new Error('posterPath or sourceUrl is required');
  const res = await fetch(posterUrl, { headers: { accept: 'image/*' } });
  if (!res.ok) throw new Error(`Source image fetch failed: ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());
  const resized = await sharp(input).resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: 'cover' }).png().toBuffer();
  const composites = [];
  const resolvedRatingLabel = ratingLabel || (rating ? `★ ${rating}` : '');

  if (smartLayout) {
    const dynamicFill = overlayColor === 'dynamic' ? await dynamicAccent(resized) : overlayColor;
    composites.push({ input: smartBottomBackdrop(), top: POSTER_HEIGHT - 450, left: 0 });

    const topTags = [];
    if (trend) topTags.push(await smartTopTag(trend, { fill: dynamicFill, width: smartTagWidth(trend, 230, 310) }));
    if (age) topTags.push(await smartTopTag(age, { fill: '#191a20', width: smartTagWidth(age, 145, 205), fontSize: 31 }));
    if (quality) topTags.push(await smartTopTag(quality, { fill: '#191a20', width: smartTagWidth(quality, 150, 215), fontSize: 31 }));
    for (const placement of packSmartTopTags(topTags)) {
      composites.push({ input: placement.buffer, top: placement.top, left: placement.left });
    }

    const logo = await smartLogoImage(logoPath);
    if (logo) {
      const left = Math.round((POSTER_WIDTH - logo.width) / 2);
      const zoneHeight = SMART_LOGO_ZONE_BOTTOM - SMART_LOGO_ZONE_TOP;
      const top = SMART_LOGO_ZONE_TOP + Math.round((zoneHeight - logo.height) / 2);
      composites.push({ input: logo.buffer, top, left });
    } else if (title) {
      const titleBuffer = await titleImage(title);
      if (titleBuffer) composites.push({ input: titleBuffer, top: 810, left: 40 });
    }

    const info = await smartBottomInfo(genre, resolvedRatingLabel);
    if (info) composites.push({ input: info, top: SMART_BOTTOM_INFO_TOP, left: 30 });
  } else {
    // Original artwork keeps its own layout, but uses a larger modern rounded-rectangle treatment.
    if (age) {
      composites.push({ input: await originalBadgeImage(age, { width: 160, fontSize: 31 }), top: ORIGINAL_TOP, left: SAFE_MARGIN });
    }
    if (quality) {
      const width = 170;
      composites.push({ input: await originalBadgeImage(quality, { width, fontSize: 31 }), top: ORIGINAL_TOP, left: POSTER_WIDTH - SAFE_MARGIN - width });
    }
    if (trend) {
      const width = 280;
      const left = Math.round((POSTER_WIDTH - width) / 2);
      composites.push({ input: await originalBadgeImage(trend, { width, height: 76, fill: '#5b6cff', fillOpacity: 0.95, fontSize: 34, radius: 14 }), top: ORIGINAL_TOP, left });
    }
    if (resolvedRatingLabel) {
      const length = String(resolvedRatingLabel).length;
      const width = length <= 6 ? 205 : length <= 10 ? 250 : 300;
      composites.push({ input: await originalBadgeImage(resolvedRatingLabel, { width, fontSize: 33 }), top: ORIGINAL_SECOND_ROW_TOP, left: SAFE_MARGIN });
    }
    if (genre) {
      const width = 270;
      composites.push({ input: await originalBadgeImage(genre, { width, fontSize: 31 }), top: ORIGINAL_SECOND_ROW_TOP, left: POSTER_WIDTH - SAFE_MARGIN - width });
    }
  }

  return sharp(resized).composite(composites).webp({ quality: 88, effort: 4 }).toBuffer();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-overlay-scale-1' }));
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
      'x-kollection-renderer': 'v2-overlay-scale-1',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));