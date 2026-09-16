import { onRequest as handlePosterV2 } from '../api/posters-v2/[[path]].js';
import { BETTER_POSTERS_TREND_DETAILS, decodeBetterPostersConfig } from '../_lib/better-posters-config-token.js';

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

function nativeBetterPostersUrl(config, imdbId, trendEnabled) {
  let suffix = '';
  if (!config.genre && config.rating) suffix = 'r';
  else if (config.genre && !config.rating) suffix = 'g';
  else if (!config.genre && !config.rating) suffix = 'n';
  if (config.qualityTags) suffix += 'q';
  if (config.ageRating) suffix += 'a';
  const posterPath = suffix ? `poster-${suffix}` : 'poster';

  const params = new URLSearchParams();
  if (!trendEnabled) params.set('tag', 'none');
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

  let rawId = '';
  try {
    rawId = decodeURIComponent(String(parts[3] || '')).replace(/\.(webp|jpe?g)$/i, '').toLowerCase();
  } catch {}
  if (!/^(tt\d{5,12}|(?:tmdb|tvdb):[1-9]\d{0,11}|[1-9]\d{0,11})$/.test(rawId)) {
    return jsonError('Invalid poster ID.');
  }

  const canonical = new URL(publicUrl.origin + `/bp/${configId}/${type}/${encodeURIComponent(rawId)}.webp`);
  const edgeKeyUrl = new URL(canonical);
  edgeKeyUrl.searchParams.set('__kollection_bp_delivery', '2');
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

  const allTrendDetails = config.trendDetails.length === BETTER_POSTERS_TREND_DETAILS.length;
  const noTrendDetails = config.trendDetails.length === 0;
  if (/^tt\d{5,12}$/i.test(rawId) && (allTrendDetails || noTrendDetails)) {
    const location = nativeBetterPostersUrl(config, rawId, allTrendDetails);
    const headers = new Headers({
      location,
      'cache-control': 'public, max-age=604800, s-maxage=604800',
      'access-control-allow-origin': '*',
      'x-kollection-better-posters-config': configId,
      'x-kollection-better-posters-cache': 'MISS',
      'x-kollection-better-posters-direct': '1',
      'content-location': canonical.pathname,
    });
    const direct = new Response(null, { status: 302, headers });
    if (request.method === 'GET') {
      context.waitUntil(caches.default.put(cacheRequest, direct.clone()).catch(() => {}));
    }
    return direct;
  }

  const inner = new URL(publicUrl.origin + `/api/posters-v2/${type}/${encodeURIComponent(rawId)}.webp`);
  inner.searchParams.set('v', '27');
  inner.searchParams.set('source', 'tmdb');
  inner.searchParams.set('provider', 'btttr');
  inner.searchParams.set('tags', config.trendDetails.length ? 'trend' : '');
  inner.searchParams.set('trendDetails', config.trendDetails.join(','));
  inner.searchParams.set('language', config.language);
  inner.searchParams.set('overlayOnly', '1');
  inner.searchParams.set('bpQuality', config.qualityTags ? '1' : '0');
  inner.searchParams.set('bpGenre', config.genre ? '1' : '0');
  inner.searchParams.set('bpRating', config.rating ? '1' : '0');
  inner.searchParams.set('bpAge', config.ageRating ? '1' : '0');
  inner.searchParams.set('bpRatingSource', config.ratingSource);

  const buildFiltered = async () => {
    const response = await handlePosterV2({
      ...context,
      request: new Request(inner.toString(), { method: request.method, headers: request.headers }),
    });
    const headers = new Headers(response.headers);
    headers.set('x-kollection-better-posters-config', configId);
    headers.set('x-kollection-better-posters-cache', 'MISS');
    headers.set('content-location', canonical.pathname);
    const delivered = new Response(response.body, { status: response.status, statusText: response.statusText, headers });

    const directBetterPosters = response.status === 302 &&
      /^https:\/\/btttr\.cc\//i.test(headers.get('location') || '');
    const cacheableImage = response.status === 200 &&
      /^image\//i.test(headers.get('content-type') || '');
    if (request.method === 'GET' && (cacheableImage || directBetterPosters) &&
        !/no-store/i.test(headers.get('cache-control') || '')) {
      await caches.default.put(cacheRequest, delivered.clone()).catch(() => {});
    }
    return delivered;
  };

  const customTrendSubset = config.trendDetails.length > 0 &&
    config.trendDetails.length < BETTER_POSTERS_TREND_DETAILS.length;

  // Never make Nuvio wait on a cold custom-subset decision when AIOMetadata has
  // already supplied an IMDb ID. Better Posters can display the complete base
  // poster immediately; Kollection resolves/renders the allowed Trend Tag in
  // parallel and saves the final response under this same /bp/ cache key.
  const prewarmRequest = request.headers.get('x-kollection-poster-prewarm') === '1';
  if (request.method === 'GET' && !prewarmRequest && customTrendSubset && /^tt\d{5,12}$/i.test(rawId)) {
    context.waitUntil((async () => {
      const filtered = await buildFiltered();
      await filtered.body?.cancel();
    })().catch(() => {}));

    const location = nativeBetterPostersUrl(config, rawId, false);
    return new Response(null, {
      status: 302,
      headers: {
        location,
        // The provisional /bp/ response must never stick. The btttr.cc image it
        // points at remains independently cacheable and therefore displays fast.
        'cache-control': 'private, no-store',
        'cdn-cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-kollection-better-posters-config': configId,
        'x-kollection-better-posters-cache': 'MISS',
        'x-kollection-better-posters-provisional': '1',
        'content-location': canonical.pathname,
      },
    });
  }

  const delivered = await buildFiltered();
  if (request.method === 'HEAD') {
    await delivered.body?.cancel();
    return new Response(null, { status: delivered.status, headers: delivered.headers });
  }
  return delivered;
}
