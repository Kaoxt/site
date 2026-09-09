import { acquirePosterRenderSlot } from '../../_lib/poster-safety.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w780';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf';
const trendMemory = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
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

async function getTrendingRank(type, id, key) {
  const now = Date.now();
  const cached = trendMemory.get(type);
  if (cached && cached.expires > now) {
    const index = cached.ids.indexOf(String(id));
    return index >= 0 ? index + 1 : 0;
  }
  const data = await tmdbFetch(`/trending/${type}/day?language=en-US&page=1`, key);
  const ids = (data.results || []).map((item) => String(item.id));
  trendMemory.set(type, { ids, expires: now + 10 * 60 * 1000 });
  const index = ids.indexOf(String(id));
  return index >= 0 ? index + 1 : 0;
}

function pickCertification(details, type) {
  if (type === 'movie') {
    const us = details.release_dates?.results?.find((x) => x.iso_3166_1 === 'US');
    return us?.release_dates?.find((x) => x.certification)?.certification || '';
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

function textOverlay(text, options = {}) {
  return {
    text: String(text),
    font: { url: FONT_URL },
    color: options.color || '#ffffff',
    size: options.size || 36,
    ...(options.left != null ? { left: options.left } : {}),
    ...(options.right != null ? { right: options.right } : {}),
    ...(options.top != null ? { top: options.top } : {}),
    ...(options.bottom != null ? { bottom: options.bottom } : {}),
  };
}

async function renderPoster(request, env, type, rawId, renderSlot) {
  if (!env.TMDB_API_KEY) {
    return json({ error: 'TMDB_API_KEY is not configured' }, 503);
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

  const tagsEnabled = url.searchParams.get('smart') !== '0';
  const requested = new Set((url.searchParams.get('tags') || '').split(',').filter(Boolean));
  const ratingSource = (url.searchParams.get('ratingSource') || 'average').toLowerCase();
  const qualityOn = requested.has('quality');
  if (!qualityOn) requested.add('trend');

  const draw = [];

  if (tagsEnabled && requested.has('trend')) {
    const rank = await getTrendingRank(normalizedType, resolved.id, env.TMDB_API_KEY);
    if (rank > 0) {
      draw.push(textOverlay(`#${rank} TODAY`, {
        size: 31,
        top: 28,
        ...(qualityOn ? { right: 105 } : { left: 300 }),
      }));
    }
  }

  if (tagsEnabled && requested.has('rating') && Number(details.vote_average) > 0) {
    draw.push(textOverlay(Number(details.vote_average).toFixed(1), {
      size: 38,
      left: 28,
      bottom: 30,
    }));
  }

  const genre = details.genres?.[0]?.name || '';
  if (tagsEnabled && requested.has('genre') && genre) {
    draw.push(textOverlay(genre.toUpperCase(), {
      size: 30,
      right: 28,
      bottom: 30,
    }));
  }

  const certification = pickCertification(details, normalizedType);
  if (tagsEnabled && requested.has('age') && certification) {
    draw.push(textOverlay(certification, {
      size: 30,
      left: 28,
      top: 28,
    }));
  }

  if (smart) {
    const title = String(details.title || details.name || '').trim().slice(0, 38);
    if (title) {
      draw.push(textOverlay(title, {
        size: title.length > 24 ? 40 : 50,
        left: 28,
        bottom: requested.has('rating') || requested.has('genre') ? 112 : 34,
      }));
    }
  }

  const sourceUrl = `${TMDB_IMAGE}${posterPath}`;

  if (!renderSlot.allowed) {
    const fallback = await fetch(sourceUrl);
    const headers = new Headers(fallback.headers);
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-kollection-posters', 'safety-fallback');
    headers.set('x-kollection-safety', renderSlot.reason || 'blocked');
    headers.set('x-kollection-transform', 'blocked');
    headers.delete('set-cookie');
    return new Response(fallback.body, { status: fallback.status, headers });
  }

  const imageOptions = {
    width: 780,
    format: 'webp',
    quality: 88,
    ...(draw.length ? { draw } : {}),
  };

  let response = await fetch(sourceUrl, { cf: { image: imageOptions } });
  const transformStatus = response.status;
  const transformError = response.ok ? null : await response.clone().text().catch(() => null);

  if (url.searchParams.get('debug') === '1') {
    return json({
      resolved: { type: normalizedType, id: resolved.id },
      sourceUrl,
      smart,
      requestedTags: [...requested],
      drawCount: draw.length,
      draw,
      imageOptions,
      safety: {
        reason: renderSlot.reason,
        activeRenders: renderSlot.activeRenders,
        maxConcurrent: renderSlot.maxConcurrent,
        maxDaily: renderSlot.maxDaily,
        maxClientHourly: renderSlot.maxClientHourly,
      },
      transformStatus,
      transformOk: response.ok,
      transformContentType: response.headers.get('content-type'),
      transformError,
      cfResized: response.headers.get('cf-resized') || null,
      cfCacheStatus: response.headers.get('cf-cache-status') || null,
      server: response.headers.get('server') || null,
    });
  }

  let transformed = response.ok;
  if (!response.ok) {
    transformed = false;
    response = await fetch(sourceUrl);
  }

  const headers = new Headers(response.headers);
  headers.set('cache-control', transformed
    ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
    : 'no-store, max-age=0');
  headers.set('x-kollection-posters', 'tmdb-v9-safety');
  headers.set('x-kollection-transform', transformed ? 'applied' : 'fallback');
  headers.set('x-kollection-transform-status', String(transformStatus));
  headers.set('x-kollection-draw-count', String(draw.length));
  headers.set('x-kollection-tmdb-id', resolved.id);
  headers.set('x-kollection-rating-source', ratingSource);
  headers.set('x-kollection-safety', renderSlot.reason || 'budget-reserved');
  if (ratingSource !== 'tmdb') headers.set('x-kollection-rating-fallback', 'tmdb');
  headers.delete('set-cookie');

  return new Response(response.body, { status: response.status, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const type = parts[2];
  const rawId = (parts[3] || '').replace(/\.webp$/i, '');

  if (!type || !rawId) {
    return json({ error: 'Expected /api/posters/movie/123.webp or /api/posters/tv/123.webp' }, 400);
  }

  try {
    const cache = caches.default;
    const debug = url.searchParams.get('debug') === '1';
    if (!debug) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }

    const renderSlot = await acquirePosterRenderSlot(env, request);
    if (!renderSlot.allowed && renderSlot.reason === 'client-hourly-limit') {
      return json({
        error: 'Poster render rate limit reached. Try again later.',
        reason: renderSlot.reason,
      }, 429);
    }

    let response;
    try {
      response = await renderPoster(request, env, type, rawId, renderSlot);
    } finally {
      renderSlot.release();
    }

    if (!debug && response.ok && response.headers.get('x-kollection-transform') === 'applied') {
      context.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  } catch (error) {
    return json({ error: error?.message || 'Poster renderer failed.' }, 502);
  }
}
