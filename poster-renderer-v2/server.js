import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 8080);
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w780';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/original';
const POSTER_WIDTH = 780;
const POSTER_HEIGHT = 1170;
const SAFE_MARGIN = 30;
const TOP_GAP = 12;
const TOP_ROW_GAP = 10;
const TOP_TAG_HEIGHT = 58;
const BOTTOM_INFO_Y = 1080;
const SMART_LOGO_TOP_MIN = 820;
const SMART_LOGO_BOTTOM_MAX = 1025;
const ORIGINAL_SECOND_ROW_TOP = SAFE_MARGIN + 76;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

async function dynamicAccent(imageBuffer) {
  try {
    const { dominant } = await sharp(imageBuffer).resize(48, 48, { fit: 'cover' }).stats();
    const max = Math.max(dominant.r, dominant.g, dominant.b, 1);
    const target = 118;
    const scale = max > target ? target / max : 1;
    let r = dominant.r * scale;
    let g = dominant.g * scale;
    let b = dominant.b * scale;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 24) {
      r *= 0.72;
      g *= 0.72;
      b *= 0.72;
    }
    return rgbToHex(r, g, b);
  } catch {
    return '#2f3038';
  }
}

function tagWidth(text, { min = 118, max = 240, perChar = 16 } = {}) {
  return clamp(34 + String(text || '').length * perChar, min, max);
}

async function tagImage(text, {
  width,
  height = TOP_TAG_HEIGHT,
  fill = '#191a20',
  fillOpacity = 0.93,
  textColor = '#ffffff',
  fontSize = 27,
  radius = 9,
} = {}) {
  const resolvedWidth = width || tagWidth(text);
  const background = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${resolvedWidth}" height="${height}">
      <rect width="${resolvedWidth}" height="${height}" rx="${radius}" fill="${fill}" fill-opacity="${fillOpacity}"/>
    </svg>`);
  const textLayer = {
    text: {
      text: `<span foreground="${textColor}" weight="bold">${esc(text)}</span>`,
      font: `DejaVu Sans ${fontSize}`,
      width: Math.max(1, resolvedWidth - 24),
      height: Math.max(1, height - 10),
      align: 'center',
      rgba: true,
    },
  };
  const buffer = await sharp({
    create: { width: resolvedWidth, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: background, top: 0, left: 0 },
    { input: textLayer, gravity: 'center' },
  ]).png().toBuffer();
  return { buffer, width: resolvedWidth, height };
}

async function originalPillImage(text, {
  width = 210,
  height = 58,
  fill = '#0b0d12',
  fillOpacity = 0.9,
  textColor = '#ffffff',
  fontSize = 27,
} = {}) {
  return (await tagImage(text, {
    width,
    height,
    fill,
    fillOpacity,
    textColor,
    fontSize,
    radius: Math.floor(height / 2),
  })).buffer;
}

async function bottomInfoImage(text) {
  if (!text) return null;
  const shadow = { text: { text: `<span foreground="#000000" alpha="75%" weight="bold">${esc(text)}</span>`, font: 'DejaVu Sans 28', width: 700, height: 58, align: 'center', rgba: true } };
  const foreground = { text: { text: `<span foreground="#e4e4e7" weight="bold">${esc(text)}</span>`, font: 'DejaVu Sans 28', width: 700, height: 58, align: 'center', rgba: true } };
  return sharp({ create: { width: 700, height: 62, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, top: 3, left: 1 }, { input: foreground, top: 0, left: 0 }])
    .png().toBuffer();
}

async function titleImage(title) {
  const text = String(title || '').trim();
  if (!text) return null;
  const fontSize = text.length > 30 ? 34 : text.length > 20 ? 39 : 46;
  const shadow = { text: { text: `<span foreground="#000000" alpha="75%" weight="bold">${esc(text)}</span>`, font: `DejaVu Sans ${fontSize}`, width: 680, height: 150, align: 'center', rgba: true } };
  const foreground = { text: { text: `<span foreground="#ffffff" weight="bold">${esc(text)}</span>`, font: `DejaVu Sans ${fontSize}`, width: 680, height: 150, align: 'center', rgba: true } };
  return sharp({ create: { width: 680, height: 154, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
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
    const maxWidth = 620;
    const maxHeight = 165;
    const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1);
    const width = Math.max(1, Math.round(meta.width * scale));
    const height = Math.max(1, Math.round(meta.height * scale));
    const buffer = await sharp(input).resize(width, height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { buffer, width, height };
  } catch {
    return null;
  }
}

function bottomLogoBackdrop(height = 390) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset="0.42" stop-color="#000000" stop-opacity="0.10"/>
        <stop offset="0.70" stop-color="#000000" stop-opacity="0.30"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.60"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`);
}

function packTopTags(items) {
  const rows = [];
  const available = POSTER_WIDTH - SAFE_MARGIN * 2;
  let row = [];
  let used = 0;
  for (const item of items) {
    const next = row.length ? used + TOP_GAP + item.width : item.width;
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
    const totalWidth = itemsInRow.reduce((sum, item) => sum + item.width, 0) + TOP_GAP * Math.max(0, itemsInRow.length - 1);
    let left = Math.round((POSTER_WIDTH - totalWidth) / 2);
    const top = SAFE_MARGIN + rowIndex * (TOP_TAG_HEIGHT + TOP_ROW_GAP);
    itemsInRow.forEach((item) => {
      placements.push({ ...item, left, top });
      left += item.width + TOP_GAP;
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
    composites.push({ input: bottomLogoBackdrop(), top: POSTER_HEIGHT - 390, left: 0 });

    const topTags = [];
    if (age) topTags.push(await tagImage(age, { width: tagWidth(age, { min: 112, max: 170, perChar: 16 }), fill: '#191a20' }));
    if (trend) topTags.push(await tagImage(trend, { width: tagWidth(trend, { min: 184, max: 244, perChar: 15 }), fill: dynamicFill, fillOpacity: 0.94 }));
    if (quality) topTags.push(await tagImage(quality, { width: tagWidth(quality, { min: 120, max: 190, perChar: 15 }), fill: '#191a20' }));
    for (const placement of packTopTags(topTags)) composites.push({ input: placement.buffer, top: placement.top, left: placement.left });

    const bottomParts = [];
    if (genre) bottomParts.push(genre);
    if (resolvedRatingLabel) bottomParts.push(resolvedRatingLabel);
    if (bottomParts.length) {
      const info = await bottomInfoImage(bottomParts.join(' • '));
      if (info) composites.push({ input: info, top: BOTTOM_INFO_Y, left: 40 });
    }

    const logo = await smartLogoImage(logoPath);
    if (logo) {
      const left = Math.round((POSTER_WIDTH - logo.width) / 2);
      const centeredTop = Math.round((SMART_LOGO_TOP_MIN + SMART_LOGO_BOTTOM_MAX - logo.height) / 2);
      const top = clamp(centeredTop, SMART_LOGO_TOP_MIN, SMART_LOGO_BOTTOM_MAX - logo.height);
      composites.push({ input: logo.buffer, top, left });
    } else if (title) {
      const titleBuffer = await titleImage(title);
      if (titleBuffer) composites.push({ input: titleBuffer, top: 855, left: 50 });
    }
  } else {
    // TMDB Original keeps its own restrained pill layout and never uses the Smart/BetterPosters treatment.
    if (age) composites.push({ input: await originalPillImage(age, { width: 138, height: 58, fontSize: 25 }), top: SAFE_MARGIN, left: SAFE_MARGIN });
    if (quality) composites.push({ input: await originalPillImage(quality, { width: 150, height: 60, fontSize: 25 }), top: SAFE_MARGIN, left: POSTER_WIDTH - SAFE_MARGIN - 150 });
    if (trend) {
      const trendWidth = 220;
      const trendLeft = quality ? 350 : Math.round((POSTER_WIDTH - trendWidth) / 2);
      composites.push({ input: await originalPillImage(trend, { width: trendWidth, height: 60, fill: '#5b6cff', fillOpacity: 0.94, fontSize: 25 }), top: SAFE_MARGIN, left: trendLeft });
    }
    if (resolvedRatingLabel) {
      const width = String(resolvedRatingLabel).length <= 6 ? 165 : String(resolvedRatingLabel).length <= 10 ? 205 : 245;
      composites.push({ input: await originalPillImage(resolvedRatingLabel, { width, height: 62, fontSize: 27 }), top: ORIGINAL_SECOND_ROW_TOP, left: SAFE_MARGIN });
    }
    if (genre) {
      const width = 230;
      composites.push({ input: await originalPillImage(genre, { width, height: 58, fontSize: 24 }), top: ORIGINAL_SECOND_ROW_TOP + 2, left: POSTER_WIDTH - SAFE_MARGIN - width });
    }
  }

  return sharp(resized).composite(composites).webp({ quality: 88, effort: 4 }).toBuffer();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, renderer: 'kollection-posters-v2-smart-better-1' }));
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
      'x-kollection-renderer': 'v2-smart-better-1',
      'x-kollection-render-ms': String(Date.now() - started),
    });
    res.end(output);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error?.message || 'Render failed' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kollection Posters v2 renderer listening on ${PORT}`));
