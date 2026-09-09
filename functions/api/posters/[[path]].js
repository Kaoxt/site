const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w780';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badgeSvg(text, kind = 'default') {
  const palette = {
    rating: ['rgba(8,9,12,.90)', '#ffffff'],
    genre: ['rgba(8,9,12,.90)', '#ffffff'],
    age: ['rgba(8,9,12,.90)', '#ffffff'],
    trend: ['rgba(91,108,255,.94)', '#ffffff'],
    default: ['rgba(8,9,12,.90)', '#ffffff'],
  };
  const [bg, fg] = palette[kind] || palette.default;
  const safe = esc(text).slice(0, 34);
  const width = Math.max(74, Math.min(300, 26 + safe.length * 15));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="52" viewBox="0 0 ${width} 52">
    <rect x="1" y="1" width="${width - 2}" height="50" rx="14" fill="${bg}" stroke="rgba(255,255,255,.22)"/>
    <text x="${width / 2}" y="33" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="${fg}">${safe}</text>
  </svg>`;
}

async function tmdbFetch(path, key) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(key)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function resolveTmdbId(type, rawId, key) {
  if (/^\d+$/.test(rawId)) return { type, id: rawId };
  if (/^tt\d+$/i.test(rawId)) {
    const found = await tmdbFetch(`/find/${encodeURIComponent(rawId)}?external_source=imdb_id`, key);
    const list = type === 'tv' ? found.tv_results : found.movie_results;
    if (!list?.length) return null;
    return { type, id: String(list[0].id) };
  }
  return null;
}

function pickCertification(details, type) {
  if (type === 'movie') {
    const us = details.release_dates?.results?.find((x) => x.iso_3166_1 === 'US');
    const cert = us?.release_dates?.find((x) => x.certification)?.certification;
    return cert || '';
  }
  const us = details.content_ratings?.results?.find((x) => x.iso_3166_1 === 'US');
  return us?.rating || '';
}

function choosePoster(details, smart) {
  if (!smart) return details.poster_path || '';
  const candidates = details.images?.posters || [];
  const textless = candidates
    .filter((p) => !p.iso_639_1)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  return textless[0]?.file_path || details.poster_path || '';
}

function badgeUrl(requestUrl, text, kind) {
  const u = new URL('/api/posters/badge', requestUrl.origin);
  u.searchParams.set('text', text);
  u.searchParams.set('kind', kind);
  return u.toString();
}

async function renderPoster(request, env, type, rawId) {
  if (!env.TMDB_API_KEY) {
    return json({
      error: 'TMDB_API_KEY is not configured',
      setup: 'Add TMDB_API_KEY as a Cloudflare Pages secret/environment variable.'
    }, 503);
  }

  const url = new URL(request.url);
  const normalizedType = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const resolved = await resolveTmdbId(normalizedType, rawId, env.TMDB_API_KEY);
  if (!resolved) return json({ error: 'Could not resolve this TMDB/IMDb id.' }, 404);

  const append = normalizedType === 'movie' ? 'images,release_dates' : 'images,content_ratings';
  const details = await tmdbFetch(`/${normalizedType}/${resolved.id}?append_to_response=${append}&include_image_language=en,null`, env.TMDB_API_KEY);

  const smart = url.searchParams.get('source') === 'smart' || url.searchParams.get('smartLayout') === '1';
  const posterPath = choosePoster(details, smart);
  if (!posterPath) return json({ error: 'TMDB has no poster for this title.' }, 404);

  const tagsEnabled = url.searchParams.get('smart') === '1';
  const requested = new Set((url.searchParams.get('tags') || '').split(',').filter(Boolean));
  const draw = [];

  if (tagsEnabled && requested.has('rating') && Number(details.vote_average) > 0) {
    draw.push({
      url: badgeUrl(url, `★ ${Number(details.vote_average).toFixed(1)}`, 'rating'),
      left: 18,
      bottom: 18,
      fit: 'contain',
      height: 52,
    });
  }

  const genre = details.genres?.[0]?.name || '';
  if (tagsEnabled && requested.has('genre') && genre) {
    draw.push({
      url: badgeUrl(url, genre.toUpperCase(), 'genre'),
      right: 18,
      bottom: 18,
      fit: 'contain',
      height: 52,
    });
  }

  const certification = pickCertification(details, normalizedType);
  if (tagsEnabled && requested.has('age') && certification) {
    draw.push({
      url: badgeUrl(url, certification, 'age'),
      right: 18,
      top: 18,
      fit: 'contain',
      height: 52,
    });
  }

  if (smart) {
    const title = String(details.title || details.name || '').trim().slice(0, 38);
    if (title) {
      draw.push({
        text: title,
        color: '#ffffff',
        size: title.length > 24 ? 38 : 48,
        left: 24,
        bottom: tagsEnabled ? 88 : 28,
      });
    }
  }

  const sourceUrl = `${TMDB_IMAGE}${posterPath}`;
  const imageOptions = {
    width: 780,
    fit: 'cover',
    format: 'webp',
    quality: 88,
  };
  if (draw.length) imageOptions.draw = draw;

  let response = await fetch(sourceUrl, { cf: { image: imageOptions } });
  if (!response.ok) {
    // Graceful fallback: return the real TMDB poster even if image transformation is not enabled yet.
    response = await fetch(sourceUrl);
  }

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  headers.set('x-kollection-posters', 'tmdb-v1');
  headers.set('x-kollection-tmdb-id', resolved.id);
  headers.delete('set-cookie');
  return new Response(response.body, { status: response.status, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[2] === 'badge') {
    const text = url.searchParams.get('text') || '';
    const kind = url.searchParams.get('kind') || 'default';
    return new Response(badgeSvg(text, kind), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  }

  // /api/posters/:type/:id.webp
  const type = parts[2];
  const idPart = parts[3] || '';
  const rawId = idPart.replace(/\.webp$/i, '');
  if (!type || !rawId) return json({ error: 'Expected /api/posters/movie/123.webp or /api/posters/tv/123.webp' }, 400);

  try {
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await renderPoster(request, env, type, rawId);
    if (response.ok) context.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    return json({ error: error?.message || 'Poster renderer failed.' }, 502);
  }
}
