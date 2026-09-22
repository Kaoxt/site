const POSTER_BASE = 'https://kollection.tv/api/posters-v2';
const TREND_DETAILS = ['studio','director','cast','inCinema','rank','newMovie','comingSoon','newSeries','returningSeries','limitedSeries'];
const LEGACY_RELEASE_DETAILS = ['inCinema','newMovie','comingSoon','newSeries','returningSeries','limitedSeries'];

function normalizeTrendDetails(values) {
  const selected = new Set(Array.isArray(values) ? values.map(String) : TREND_DETAILS);
  if (selected.has('release')) LEGACY_RELEASE_DETAILS.forEach(value => selected.add(value));
  return TREND_DETAILS.filter(value => selected.has(value));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=120, s-maxage=600' : 'no-store',
      ...extraHeaders,
    },
  });
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseConfig(token) {
  let config;
  try {
    config = JSON.parse(decodeBase64Url(token));
  } catch (_) {
    throw new Error('Invalid Posters addon configuration.');
  }
  if (!config || ![1, 2, 3, 4, 5, 6].includes(config.v) || typeof config.upstream !== 'string') {
    throw new Error('Invalid Posters addon configuration.');
  }
  const upstream = new URL(config.upstream);
  if (upstream.protocol !== 'https:' || !upstream.pathname.endsWith('/manifest.json')) {
    throw new Error('Upstream must be a public HTTPS manifest.json URL.');
  }
  const host = upstream.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    throw new Error('Local/private upstreams are not supported.');
  }
  const betterPostersConfigId = /^b1[0-9a-f][0-7][0-9a-h][0-9a-z]{2}$/i.test(String(config.betterPostersConfigId || ''))
    ? String(config.betterPostersConfigId).toLowerCase()
    : '';
  return {
    v: config.v,
    upstream: upstream.toString(),
    source: ['smart', 'tmdb', 'inherit'].includes(config.source) ? config.source : 'smart',
    tags: Array.isArray(config.tags) ? config.tags.filter((x) => typeof x === 'string') : ['trend', 'genre', 'rating'],
    trendDetails: normalizeTrendDetails(config.trendDetails),
    ratingSource: typeof config.ratingSource === 'string' ? config.ratingSource : 'average',
    collectionOnly: config.collectionOnly === true,
    preserveSource: config.preserveSource !== false,
    passthroughPosters: config.passthroughPosters === true,
    betterPostersConfigId,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Kollection-Posters/2.0' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}.`);
  return response.json();
}

function upstreamResourceUrl(manifestUrl, resource, type, id, extras = []) {
  const url = new URL(manifestUrl);
  const basePath = url.pathname.replace(/\/manifest\.json$/i, '');
  const encoded = [resource, type, id, ...extras].map((part) => encodeURIComponent(decodeURIComponent(part)));
  url.pathname = `${basePath}/${encoded.join('/')}.json`.replace(/\/+/g, '/');
  url.search = '';
  return url.toString();
}

function catalogId(originalId) {
  return `kp0_${encodeBase64Url(originalId)}`;
}

function decodeCatalogId(value) {
  const match = /^kp0_([A-Za-z0-9_-]+)$/.exec(value || '');
  if (!match) throw new Error('Unknown Posters catalog id.');
  return decodeBase64Url(match[1]);
}

function normalizePosterId(id) {
  const raw = String(id || '').trim();
  if (/^tt\d+$/i.test(raw) || /^\d+$/.test(raw)) return raw;
  let match = /^tmdb(?::(?:movie|tv|series))?:(\d+)$/i.exec(raw);
  if (match) return `tmdb:${match[1]}`;
  match = /^tvdb(?::(?:movie|tv|series))?:(\d+)$/i.exec(raw);
  if (match) return `tvdb:${match[1]}`;
  match = /(?:^|:)tt(\d+)$/i.exec(raw);
  if (match) return `tt${match[1]}`;
  return '';
}

function posterUrl(config, type, id, sourceUrl = '') {
  const normalizedId = normalizePosterId(id);
  if (!normalizedId) return '';
  const mediaType = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const tags = new Set(config.tags);
  const params = new URLSearchParams({
    v: '24',
    source: config.source,
    tags: [...tags].sort().join(','),
    ratingSource: config.ratingSource,
    trendDetails: config.trendDetails.join(','),
    cv: '4',
  });
  if (config.preserveSource) {
    try {
      const original = new URL(String(sourceUrl || ''));
      if (original.protocol === 'https:' && !original.username && !original.password && original.toString().length <= 1800) {
        params.set('sourceUrl', original.toString());
        params.set('overlayOnly', '1');
      }
    } catch {}
  }
  return `${POSTER_BASE}/${mediaType}/${encodeURIComponent(normalizedId)}.webp?${params}`;
}

function betterPostersPosterUrl(config, type, id) {
  if (!config.betterPostersConfigId) return '';
  const normalizedId = normalizePosterId(id);
  if (!normalizedId) return '';
  const mediaType = type === 'series' || type === 'tv' ? 'series' : 'movie';
  return `https://kollection.tv/bp/${config.betterPostersConfigId}/${mediaType}/${encodeURIComponent(normalizedId)}.webp`;
}

function rewritePassthroughItem(item, config, fallbackType) {
  if (!item || typeof item !== 'object') return item;
  if (config.betterPostersConfigId) {
    try {
      const current = new URL(String(item.poster || ''));
      if (current.hostname === 'kollection.tv' &&
          current.pathname.startsWith(`/bp/${config.betterPostersConfigId}/`)) {
        return item;
      }
    } catch {}
    const replacement = betterPostersPosterUrl(config, item.type || fallbackType, item.id);
    if (replacement) return { ...item, poster: replacement };
  }
  return item;
}

function rewritePassthroughPayload(payload, config, type) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (Array.isArray(payload.metas)) out.metas = payload.metas.map((item) => rewritePassthroughItem(item, config, type));
  if (payload.meta && typeof payload.meta === 'object') out.meta = rewritePassthroughItem(payload.meta, config, type);
  return out;
}

function rewriteMetaItem(item, config, fallbackType) {
  if (!item || typeof item !== 'object') return item;
  const replacement = posterUrl(config, item.type || fallbackType, item.id, item.poster);
  return replacement ? { ...item, poster: replacement } : item;
}

function rewritePayload(payload, config, type) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (Array.isArray(payload.metas)) out.metas = payload.metas.map((item) => rewriteMetaItem(item, config, type));
  if (payload.meta && typeof payload.meta === 'object') out.meta = rewriteMetaItem(payload.meta, config, type);
  return out;
}

function collectPassthroughPosterUrls(payload, limit = 24) {
  const items = [];
  if (Array.isArray(payload?.metas)) items.push(...payload.metas);
  if (payload?.meta && typeof payload.meta === 'object') items.push(payload.meta);

  const urls = [];
  const seen = new Set();
  for (const item of items) {
    if (urls.length >= limit) break;
    try {
      const poster = new URL(String(item?.poster || ''));
      if (poster.protocol !== 'https:' || poster.hostname !== 'kollection.tv') continue;
      if (!/^\/bp\/b1[0-9a-z]+\/(?:movie|series|tv)\//i.test(poster.pathname)) continue;
      const normalized = poster.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {}
  }
  return urls;
}

async function prewarmPassthroughPosters(payload) {
  const urls = collectPassthroughPosterUrls(payload);
  const batchSize = 6;
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    await Promise.allSettled(batch.map(async posterUrl => {
      const response = await fetch(posterUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'image/webp,image/jpeg,image/*',
          'x-kollection-poster-prewarm': '1',
        },
        signal: AbortSignal.timeout(20000),
      });
      await response.body?.cancel();
    }));
  }
}

async function mergedManifest(upstream, token, origin, config) {
  // Keep legacy identities stable; new installs hash the entire configuration.
  const identity = config.v >= 6
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
    : token.slice(0, 24);
  const catalogs = (Array.isArray(upstream.catalogs) ? upstream.catalogs : [])
    .filter((catalog) => catalog && typeof catalog.id === 'string' && typeof catalog.type === 'string')
    .map((catalog) => ({
      ...catalog,
      id: catalogId(catalog.id),
      ...(config.collectionOnly ? { showInHome: false } : {}),
    }));
  const declared = Array.isArray(upstream.resources) ? upstream.resources : [];
  const hasMeta = declared.some((r) => r === 'meta' || r?.name === 'meta');
  const resources = [];
  if (catalogs.length) resources.push({ name: 'catalog', types: [...new Set(catalogs.map((c) => c.type))] });
  if (hasMeta) resources.push('meta');
  const types = [...new Set([...(Array.isArray(upstream.types) ? upstream.types : []), ...catalogs.map((c) => c.type)])];
  return {
    id: `tv.kollection.posters.${identity}`,
    version: '2.0.0',
    name: `Posters • ${upstream.name || 'Wrapped Addon'}`,
    description: config.passthroughPosters
      ? 'The Kollection collection-route bridge. Existing overlay poster URLs pass through, while plain folder artwork falls back to the configured Better Posters route.'
      : 'The Kollection Posters v2 wrapper. Catalog and metadata pass through while supported movie/show poster artwork is replaced with configured Kollection overlays.',
    logo: 'https://kollection.tv/favicon.ico',
    resources,
    types,
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false, configurationURL: `${origin}/posters` },
  };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const token = parts[2] || '';
  if (!token) return json({ error: 'Missing Posters addon configuration.' }, 400);

  let config;
  try { config = parseConfig(token); }
  catch (error) { return json({ error: error.message }, 400); }

  try {
    const upstreamManifest = await fetchJson(config.upstream);
    const resource = parts[3] || '';

    if (resource === 'manifest.json') {
      return json(await mergedManifest(upstreamManifest, token, url.origin, config), 200, { 'cache-control': 'public, max-age=300, s-maxage=1800' });
    }

    if (resource === 'catalog') {
      const type = decodeURIComponent(parts[4] || '');
      const encodedCatalog = decodeURIComponent(parts[5] || '').replace(/\.json$/i, '');
      const originalCatalog = decodeCatalogId(encodedCatalog);
      const extraParts = parts.slice(6);
      if (extraParts.length) extraParts[extraParts.length - 1] = extraParts[extraParts.length - 1].replace(/\.json$/i, '');
      const payload = await fetchJson(upstreamResourceUrl(config.upstream, 'catalog', type, originalCatalog, extraParts));
      if (config.passthroughPosters) {
        const delivered = rewritePassthroughPayload(payload, config, type);
        context.waitUntil(prewarmPassthroughPosters(delivered).catch(() => {}));
        return json(delivered);
      }
      return json(rewritePayload(payload, config, type));
    }

    if (resource === 'meta') {
      const type = decodeURIComponent(parts[4] || '');
      const id = decodeURIComponent(parts[5] || '').replace(/\.json$/i, '');
      const payload = await fetchJson(upstreamResourceUrl(config.upstream, 'meta', type, id));
      if (config.passthroughPosters) {
        const delivered = rewritePassthroughPayload(payload, config, type);
        context.waitUntil(prewarmPassthroughPosters(delivered).catch(() => {}));
        return json(delivered);
      }
      return json(rewritePayload(payload, config, type));
    }

    return json({ error: 'Unsupported Posters addon resource.' }, 404);
  } catch (error) {
    return json({ error: error?.message || 'Posters addon proxy failed.' }, 502);
  }
}
