import { BETTER_POSTERS_TREND_DETAILS, decodeBetterPostersConfig } from '../_lib/better-posters-config-token.js';

const TMDB_API = 'https://api.themoviedb.org/3';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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

async function resolveNativeTarget(context, type, rawId) {
  if (/^tt\d{5,12}$/i.test(rawId)) {
    return { imdbId: rawId.toLowerCase(), posterPath: '' };
  }

  const cacheUrl = new URL(context.request.url);
  cacheUrl.pathname = `/__bp-id/${type}/${encodeURIComponent(rawId)}`;
  cacheUrl.search = '';
  const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

  try {
    const cached = await caches.default.match(cacheRequest);
    if (cached?.ok) return cached.json();
  } catch {}

  const resolved = await resolveTmdbRecord(type, rawId, context.env?.TMDB_API_KEY);
  if (resolved) {
    try {
      const stored = new Response(JSON.stringify(resolved), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=604800, s-maxage=604800',
        },
      });
      context.waitUntil(caches.default.put(cacheRequest, stored).catch(() => {}));
    } catch {}
  }
  return resolved;
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
  edgeKeyUrl.searchParams.set('__kollection_bp_delivery', '4');
  const cacheRequest = new Request(edgeKeyUrl.toString(), { method: 'GET' });

  try {
    const hit = await caches.default.match(cacheRequest);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-kollection-better-posters-cache', 'HIT');
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
    // Preserve a usable normal poster rather than invoking Kollection overlays.
    location = `https://image.tmdb.org/t/p/w500${resolved.posterPath}`;
    fallback = 'tmdb';
  }

  if (!location) return jsonError('Could not resolve this title to a Better Posters-compatible IMDb ID.', 404);

  const headers = new Headers({
    location,
    'cache-control': 'public, max-age=604800, s-maxage=604800',
    'access-control-allow-origin': '*',
    'x-kollection-better-posters-config': configId,
    'x-kollection-better-posters-cache': 'MISS',
    'x-kollection-better-posters-direct': resolved?.imdbId ? '1' : '0',
    'content-location': canonical.pathname,
  });
  if (fallback) headers.set('x-kollection-better-posters-fallback', fallback);

  const direct = new Response(null, { status: 302, headers });
  if (request.method === 'GET') {
    context.waitUntil(caches.default.put(cacheRequest, direct.clone()).catch(() => {}));
  }
  return direct;
}
