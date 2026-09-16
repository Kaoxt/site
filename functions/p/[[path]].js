import { onRequest as handlePosterV2 } from '../api/posters-v2/[[path]].js';
import { decodePosterConfig, POSTER_VISUAL_VERSION } from '../_lib/poster-config-token.js';

const LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko']);

function error(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function canonicalType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'movie') return 'movie';
  if (type === 'tv' || type === 'series') return 'series';
  return '';
}

function canonicalLanguage(value) {
  const language = String(value || '').toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.has(language) ? language : 'en';
}

function cacheResponse(response, status) {
  const headers = new Headers(response.headers);
  headers.set('x-kollection-config-cache', status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
  if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed.', 405);

  const publicUrl = new URL(request.url);
  const parts = publicUrl.pathname.split('/').filter(Boolean);
  if (parts.length !== 5 || parts[0] !== 'p') {
    return error('Expected /p/{configId}/{language}/{movie|series}/{id}.webp');
  }

  const token = String(parts[1] || '').toLowerCase();
  const settings = decodePosterConfig(token);
  const type = canonicalType(parts[3]);
  if (!settings || !type) return error('Invalid Smart Poster configuration or media type.');

  let rawId = '';
  try {
    rawId = decodeURIComponent(String(parts[4] || '')).replace(/\.(webp|jpe?g)$/i, '').toLowerCase();
  } catch {}
  if (!/^(tt\d{5,12}|(?:tmdb|tvdb):[1-9]\d{0,11}|[1-9]\d{0,11})$/.test(rawId)) {
    return error('Invalid poster ID.');
  }

  const language = canonicalLanguage(parts[2]);
  const canonicalPublicUrl = new URL(publicUrl.origin + `/p/${token}/${language}/${type}/${encodeURIComponent(rawId)}.webp`);
  const edgeCacheUrl = new URL(canonicalPublicUrl);
  edgeCacheUrl.searchParams.set('__kollection_delivery', '2');
  const cacheRequest = new Request(edgeCacheUrl.toString(), { method: 'GET' });

  try {
    const hit = await caches.default.match(cacheRequest);
    if (hit) {
      const etag = hit.headers.get('etag');
      const requestedEtag = request.headers.get('if-none-match') || '';
      if (etag && requestedEtag.split(',').map(value => value.trim()).includes(etag)) {
        const headers = new Headers(hit.headers);
        headers.delete('content-length');
        headers.set('x-kollection-config-cache', 'HIT');
        await hit.body?.cancel();
        return new Response(null, { status: 304, headers });
      }
      const delivered = cacheResponse(hit, 'HIT');
      if (request.method === 'HEAD') {
        await delivered.body?.cancel();
        return new Response(null, { status: delivered.status, headers: delivered.headers });
      }
      return delivered;
    }
  } catch {}

  const inner = new URL(publicUrl.origin + `/api/posters-v2/${type}/${encodeURIComponent(rawId)}.webp`);
  inner.searchParams.set('v', POSTER_VISUAL_VERSION);
  inner.searchParams.set('source', settings.source);
  inner.searchParams.set('provider', settings.artworkProvider || 'tmdb');
  inner.searchParams.set('tags', settings.tags.join(','));
  inner.searchParams.set('ratingSource', settings.ratingSource);
  inner.searchParams.set('trendDetails', settings.trendDetails.join(','));
  inner.searchParams.set('language', language);

  const innerRequest = new Request(inner.toString(), {
    method: request.method,
    headers: request.headers,
  });
  const response = await handlePosterV2({ ...context, request: innerRequest });
  const headers = new Headers(response.headers);
  headers.set('x-kollection-config-id', token);
  headers.set('x-kollection-config-cache', 'MISS');
  headers.set('content-location', canonicalPublicUrl.pathname);
  const delivered = new Response(response.body, { status: response.status, statusText: response.statusText, headers });

  if (request.method === 'GET' && response.status === 200 && /^image\/webp/i.test(headers.get('content-type') || '') && !/no-store/i.test(headers.get('cache-control') || '')) {
    const copy = delivered.clone();
    context.waitUntil(caches.default.put(cacheRequest, copy).catch(() => {}));
  }

  if (request.method === 'HEAD') {
    await delivered.body?.cancel();
    return new Response(null, { status: delivered.status, headers: delivered.headers });
  }
  return delivered;
}
