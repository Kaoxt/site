import { acquirePosterRenderSlot } from '../../_lib/poster-safety.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const DEFAULT_RENDERER_URL = 'https://poster-renderer.kollection.tv';
const CACHE_VERSION = 'overlay-3';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function tmdbFetch(path, key) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function resolveTmdbId(type, rawId, key) {
  if (/^\d+$/.test(rawId)) return rawId;
  if (!/^tt\d+$/i.test(rawId)) return null;
  const found = await tmdbFetch(`/find/${encodeURIComponent(rawId)}?external_source=imdb_id`, key);
  const list = type === 'tv' ? found.tv_results : found.movie_results;
  return list?.[0]?.id ? String(list[0].id) : null;
}

async function trendLabel(type, id, key) {
  const data = await tmdbFetch(`/trending/${type}/day?language=en-US&page=1`, key);
  const index = (data.results || []).findIndex((item) => String(item.id) === String(id));
  return index >= 0 ? `#${index + 1} Today` : '';
}

function certification(details, type) {
  if (type === 'movie') {
    const us = details.release_dates?.results?.find((x) => x.iso_3166_1 === 'US');
    return us?.release_dates?.find((x) => x.certification)?.certification || '';
  }
  return details.content_ratings?.results?.find((x) => x.iso_3166_1 === 'US')?.rating || '';
}

function cacheRequestFor(request) {
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set('__kollection_renderer', CACHE_VERSION);
  return new Request(cacheUrl.toString(), request);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const type = parts[2] === 'tv' || parts[2] === 'series' ? 'tv' : 'movie';
  const rawId = String(parts[3] || '').replace(/\.webp$/i, '');

  if (!rawId) return json({ error: 'Expected /api/posters-v2/movie/27205.webp' }, 400);
  if (!env.TMDB_API_KEY) return json({ error: 'TMDB_API_KEY is not configured.' }, 503);
  if (!env.POSTERS_RENDERER_AUTH_TOKEN) return json({ error: 'POSTERS_RENDERER_AUTH_TOKEN is not configured.' }, 503);

  const cache = caches.default;
  const cacheRequest = cacheRequestFor(request);
  const cached = await cache.match(cacheRequest);
  if (cached) return cached;

  const slot = await acquirePosterRenderSlot(env, request);
  if (!slot.allowed) {
    return json({ error: 'Poster render budget blocked this uncached render.', reason: slot.reason }, slot.reason === 'client-hourly-limit' ? 429 : 503);
  }

  try {
    const id = await resolveTmdbId(type, rawId, env.TMDB_API_KEY);
    if (!id) return json({ error: 'Could not resolve TMDB/IMDb id.' }, 404);

    const append = type === 'movie' ? 'images,release_dates' : 'images,content_ratings';
    const details = await tmdbFetch(`/${type}/${id}?append_to_response=${append}&include_image_language=en,null`, env.TMDB_API_KEY);
    if (!details.poster_path) return json({ error: 'TMDB has no poster for this title.' }, 404);

    const tags = new Set((url.searchParams.get('tags') || 'trend,rating').split(',').map((v) => v.trim()).filter(Boolean));
    const smartLayout = url.searchParams.get('source') !== 'tmdb';
    const payload = {
      posterPath: details.poster_path,
      title: String(details.title || details.name || '').slice(0, 44),
      rating: tags.has('rating') && Number(details.vote_average) > 0 ? Number(details.vote_average).toFixed(1) : '',
      genre: tags.has('genre') ? (details.genres?.[0]?.name || '') : '',
      age: tags.has('age') ? certification(details, type) : '',
      trend: tags.has('trend') ? await trendLabel(type, id, env.TMDB_API_KEY) : '',
      quality: '',
      smartLayout,
    };

    const rendererBase = String(env.POSTERS_V2_RENDERER_URL || DEFAULT_RENDERER_URL).replace(/\/$/, '');
    const rendered = await fetch(`${rendererBase}/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'image/webp',
        'x-kollection-render-key': String(env.POSTERS_RENDERER_AUTH_TOKEN),
      },
      body: JSON.stringify(payload),
    });

    if (!rendered.ok) {
      const message = await rendered.text().catch(() => '');
      return json({ error: 'Sharp renderer failed.', status: rendered.status, detail: message.slice(0, 500) }, 502);
    }

    const headers = new Headers(rendered.headers);
    headers.set('content-type', 'image/webp');
    headers.set('cache-control', payload.trend
      ? 'public, max-age=900, s-maxage=1800, stale-while-revalidate=3600'
      : 'public, max-age=21600, s-maxage=86400, stale-while-revalidate=604800');
    headers.set('x-kollection-posters', 'v2-sharp');
    headers.set('x-kollection-render-version', CACHE_VERSION);
    headers.set('x-kollection-tmdb-id', id);
    const response = new Response(rendered.body, { status: 200, headers });
    context.waitUntil(cache.put(cacheRequest, response.clone()));
    return response;
  } catch (error) {
    return json({ error: error?.message || 'Posters v2 failed.' }, 502);
  } finally {
    slot.release();
  }
}
