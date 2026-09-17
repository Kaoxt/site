import { BETTER_POSTERS_TREND_DETAILS, decodeBetterPostersConfig } from '../_lib/better-posters-config-token.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const DELIVERY_VERSION = '5';
const RESOLUTION_TTL_SEC = 30 * 24 * 60 * 60;
const REDIRECT_TTL_SEC = 30 * 24 * 60 * 60;
const NEGATIVE_TTL_SEC = 60 * 60;
const STALE_REDIRECT_SEC = 7 * 24 * 60 * 60;

// Pictorium-style request coalescing, but only for lightweight ID resolution.
// Kollection never renders, composites, converts, or proxies Better Posters images.
const inflightResolutions = new Map();

function jsonError(message, status = 400, cacheControl = 'no-store') {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
    },
  });
}

function typeValue(raw) {
  const value = String(raw || '').toLowerCase();
  if (value === 'movie') return 'movie';
  if (value === 'series' || value === 'tv') return 'series';
  return '';
}

function nativeBetterPostersUrl(config, imdbId) {
  let suffix = '';
  if (!config.genre && config.rating) suffix = 'r';
  else if (config.genre && !config.rating) suffix = 'g';
  else if (!config.genre && !config.rating) suffix = 'n';
  if (config.qualityTags) suffix += 'q';
  if (config.ageRating) suffix += 'a';
  const posterPath = suffix ? `poster-${suffix}` : 'poster';

  const params = new URLSearchParams();
  if (!config.trendTags) params.set('tag', 'none');
  if (config.language !== 'en') params.set('lang', config.language);
  const ratingCodes = {
    imdb: 'IM', tmdb: 'TM', rottentomatoes: 'RT', metacritic: 'MC',
    trakt: 'TR', letterboxd: 'LB', rogerebert: 'RE',
  };
  const ratingCode = config.rating ? ratingCodes[config.ratingSource] : '';
  if (ratingCode) params.set('rs', ratingCode);

  const base = `https://btttr.cc/${posterPath}/imdb/poster-default/${encodeURIComponent(imdbId)}.jpg`;
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

async function tmdbJson(path, apiKey) {
  if (!apiKey) return null;
  const joiner = path.includes('?') ? '&' : '?';
  const response = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(apiKey)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return response.json();
}

async function resolveTmdbRecord(type, rawId, apiKey) {
  const tmdbType = type === 'series' ? 'tv' : 'movie';
  let tmdbId = '';

  const directTmdb = rawId.match(/^tmdb:([1-9]\d{0,11})$/);
  if (directTmdb) tmdbId = directTmdb[1];
  else if (/^[1-9]\d{0,11}$/.test(rawId)) tmdbId = rawId;
  else {
    const tvdb = rawId.match(/^tvdb:([1-9]\d{0,11})$/);
    if (tvdb) {
      const found = await tmdbJson(`/find/${encodeURIComponent(tvdb[1])}?external_source=tvdb_id`, apiKey);
      const results = tmdbType === 'tv' ? found?.tv_results : found?.movie_results;
      tmdbId = results?.[0]?.id ? String(results[0].id) : '';
    }
  }

  if (!tmdbId) return null;
  const details = await tmdbJson(`/${tmdbType}/${encodeURIComponent(tmdbId)}?append_to_response=external_ids`, apiKey);
  if (!details) return null;
  const imdbId = String(details.imdb_id || details.external_ids?.imdb_id || '').toLowerCase();
  return {
    imdbId: /^tt\d{5,12}$/.test(imdbId) ? imdbId : '',
    posterPath: String(details.poster_path || ''),
  };
}

function resolutionCacheRequest(requestUrl, type, rawId) {
  const cacheUrl = new URL(requestUrl);
  cacheUrl.pathname = `/__bp-id/v2/${type}/${encodeURIComponent(rawId)}`;
  cacheUrl.search = '';
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

async function readResolutionCache(cacheRequest) {
  try {
    const cached = await caches.default.match(cacheRequest);
    if (!cached?.ok) return { hit: false, value: null };
    const value = await cached.json();
    if (!value || typeof value !== 'object') return { hit: false, value: null };
    return {
      hit: true,
      value: {
        imdbId: String(value.imdbId || ''),
        posterPath: String(value.posterPath || ''),
      },
    };
  } catch {
    return { hit: false, value: null };
  }
}

function writeResolutionCache(context, cacheRequest, resolved) {
  const value = resolved || { imdbId: '', posterPath: '' };
  const ttl = resolved ? RESOLUTION_TTL_SEC : NEGATIVE_TTL_SEC;
  const stored = new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'x-kollection-bp-resolution': resolved ? 'resolved' : 'negative',
    },
  });
  try {
    context.waitUntil(caches.default.put(cacheRequest, stored).catch(() => {}));
  } catch {}
}

async function resolveNativeTarget(context, type, rawId) {
  if (/^tt\d{5,12}$/i.test(rawId)) {
    return { imdbId: rawId.toLowerCase(), posterPath: '' };
  }

  const cacheRequest = resolutionCacheRequest(context.request.url, type, rawId);
  const cached = await readResolutionCache(cacheRequest);
  if (cached.hit) return cached.value;

  const flightKey = `${type}:${rawId}`;
  const existing = inflightResolutions.get(flightKey);
  if (existing) return existing;

  const pending = (async () => {
    const resolved = await resolveTmdbRecord(type, rawId, context.env?.TMDB_API_KEY);
    writeResolutionCache(context, cacheRequest, resolved);
    return resolved;
  })();

  inflightResolutions.set(flightKey, pending);
  try {
    return await pending;
  } finally {
    if (inflightResolutions.get(flightKey) === pending) inflightResolutions.delete(flightKey);
  }
}

function redirectCacheControl() {
  return `public, max-age=${REDIRECT_TTL_SEC}, s-maxage=${REDIRECT_TTL_SEC}, stale-while-revalidate=${STALE_REDIRECT_SEC}`;
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      },
    });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return jsonError('Method not allowed.', 405);

  // Old folder bridges used speculative poster prewarming. Do not let those
  // probes resolve IDs or contact Better Posters. This keeps Cloudflare usage
  // demand-driven: only posters a client actually requests do any work.
  if (request.headers.get('x-kollection-poster-prewarm') === '1') {
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-kollection-better-posters-prewarm': 'skipped',
        'x-kollection-better-posters-rendering': 'none',
      },
    });
  }

  const publicUrl = new URL(request.url);
  const parts = publicUrl.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'bp') {
    return jsonError('Expected /bp/{configId}/{movie|series}/{id}.webp');
  }

  const configId = String(parts[1] || '').toLowerCase();
  const config = decodeBetterPostersConfig(configId);
  const type = typeValue(parts[2]);
  if (!config || !type) return jsonError('Invalid Better Posters configuration or media type.');

  // Decoder normalizes legacy subset tokens to Better Posters' native all/none
  // Trend Tags switch. This guard makes that contract explicit at the route.
  const nativeTrendShape = config.trendDetails.length === 0 ||
    config.trendDetails.length === BETTER_POSTERS_TREND_DETAILS.length;
  if (!nativeTrendShape) return jsonError('Unsupported legacy Trend Tag subset.');

  let rawId = '';
  try {
    rawId = decodeURIComponent(String(parts[3] || '')).replace(/\.(webp|jpe?g)$/i, '').toLowerCase();
  } catch {}
  if (!/^(tt\d{5,12}|(?:tmdb|tvdb):[1-9]\d{0,11}|[1-9]\d{0,11})$/.test(rawId)) {
    return jsonError('Invalid poster ID.');
  }

  const canonical = new URL(publicUrl.origin + `/bp/${configId}/${type}/${encodeURIComponent(rawId)}.webp`);
  const edgeKeyUrl = new URL(canonical);
  edgeKeyUrl.searchParams.set('__kollection_bp_delivery', DELIVERY_VERSION);
  const cacheRequest = new Request(edgeKeyUrl.toString(), { method: 'GET' });

  try {
    const hit = await caches.default.match(cacheRequest);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-kollection-better-posters-cache', 'HIT');
      headers.set('x-kollection-better-posters-rendering', 'none');
      if (request.method === 'HEAD') {
        await hit.body?.cancel();
        return new Response(null, { status: hit.status, headers });
      }
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
  } catch {}

  const resolved = await resolveNativeTarget(context, type, rawId);
  let location = '';
  let fallback = '';
  if (resolved?.imdbId) {
    location = nativeBetterPostersUrl(config, resolved.imdbId);
  } else if (resolved?.posterPath) {
    // Rare titles without IMDb IDs cannot be requested from Better Posters.
    // Preserve a usable normal TMDB poster. The image is still served by TMDB,
    // never rendered or proxied through Kollection.
    location = `https://image.tmdb.org/t/p/w500${resolved.posterPath}`;
    fallback = 'tmdb';
  }

  if (!location) {
    const miss = jsonError(
      'Could not resolve this title to a Better Posters-compatible IMDb ID.',
      404,
      `public, max-age=${NEGATIVE_TTL_SEC}, s-maxage=${NEGATIVE_TTL_SEC}`
    );
    try { context.waitUntil(caches.default.put(cacheRequest, miss.clone()).catch(() => {})); } catch {}
    return miss;
  }

  const headers = new Headers({
    location,
    'cache-control': redirectCacheControl(),
    'access-control-allow-origin': '*',
    'x-kollection-better-posters-config': configId,
    'x-kollection-better-posters-cache': 'MISS',
    'x-kollection-better-posters-direct': resolved?.imdbId ? '1' : '0',
    'x-kollection-better-posters-rendering': 'none',
    'content-location': canonical.pathname,
  });
  if (fallback) headers.set('x-kollection-better-posters-fallback', fallback);

  // Cache only the tiny redirect response. The Better Posters/TMDB image bytes
  // never pass through this Worker and are never rendered by Cloudflare.
  const direct = new Response(null, { status: 302, headers });
  try { context.waitUntil(caches.default.put(cacheRequest, direct.clone()).catch(() => {})); } catch {}

  if (request.method === 'HEAD') {
    return new Response(null, { status: 302, headers });
  }
  return direct;
}
