const POSTER_BASE = 'https://kollection.tv/api/posters-v2';

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
  if (!config || ![1, 2].includes(config.v) || typeof config.upstream !== 'string') {
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
  return {
    v: 2,
    upstream: upstream.toString(),
    source: ['smart', 'tmdb', 'inherit'].includes(config.source) ? config.source : 'smart',
    tags: Array.isArray(config.tags) ? config.tags.filter((x) => typeof x === 'string') : ['trend', 'rating'],
    ratingSource: typeof config.ratingSource === 'string' ? config.ratingSource : 'average',
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
  const raw = String(id || '');
  if (/^tt\d+$/i.test(raw) || /^\d+$/.test(raw)) return raw;
  let match = /^tmdb(?::(?:movie|tv|series))?:(\d+)$/i.exec(raw);
  if (match) return match[1];
  match = /(?:^|:)tt(\d+)$/i.exec(raw);
  if (match) return `tt${match[1]}`;
  return '';
}

function posterUrl(config, type, id, sourceUrl = '') {
  const normalizedId = normalizePosterId(id);
  if (!normalizedId) return '';
  const mediaType = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const tags = new Set(config.tags);
  if (!tags.has('quality')) tags.add('trend');
  const params = new URLSearchParams({
    source: config.source,
    tags: [...tags].sort().join(','),
    ratingSource: config.ratingSource,
  });
  try {
    const original = new URL(String(sourceUrl || ''));
    if (original.protocol === 'https:' && !original.username && !original.password && original.toString().length <= 1800) {
      params.set('sourceUrl', original.toString());
      params.set('overlayOnly', '1');
    }
  } catch {}
  return `${POSTER_BASE}/${mediaType}/${encodeURIComponent(normalizedId)}.webp?${params}`;
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

function mergedManifest(upstream, token, origin) {
  const catalogs = (Array.isArray(upstream.catalogs) ? upstream.catalogs : [])
    .filter((catalog) => catalog && typeof catalog.id === 'string' && typeof catalog.type === 'string')
    .map((catalog) => ({ ...catalog, id: catalogId(catalog.id) }));
  const declared = Array.isArray(upstream.resources) ? upstream.resources : [];
  const hasMeta = declared.some((r) => r === 'meta' || r?.name === 'meta');
  const resources = [];
  if (catalogs.length) resources.push({ name: 'catalog', types: [...new Set(catalogs.map((c) => c.type))] });
  if (hasMeta) resources.push('meta');
  const types = [...new Set([...(Array.isArray(upstream.types) ? upstream.types : []), ...catalogs.map((c) => c.type)])];
  return {
    id: `tv.kollection.posters.${token.slice(0, 24)}`,
    version: '2.0.0',
    name: `Posters • ${upstream.name || 'Wrapped Addon'}`,
    description: 'The Kollection Posters v2 wrapper. Catalog and metadata pass through while supported movie/show poster artwork is replaced with configured Kollection overlays.',
    logo: 'https://kollection.tv/favicon.ico',
    resources,
    types,
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false, configurationURL: `${origin}/posters` },
  };
}

export async function onRequest({ request }) {
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
      return json(mergedManifest(upstreamManifest, token, url.origin), 200, { 'cache-control': 'public, max-age=300, s-maxage=1800' });
    }

    if (resource === 'catalog') {
      const type = decodeURIComponent(parts[4] || '');
      const encodedCatalog = decodeURIComponent(parts[5] || '').replace(/\.json$/i, '');
      const originalCatalog = decodeCatalogId(encodedCatalog);
      const extraParts = parts.slice(6);
      if (extraParts.length) extraParts[extraParts.length - 1] = extraParts[extraParts.length - 1].replace(/\.json$/i, '');
      const payload = await fetchJson(upstreamResourceUrl(config.upstream, 'catalog', type, originalCatalog, extraParts));
      return json(rewritePayload(payload, config, type));
    }

    if (resource === 'meta') {
      const type = decodeURIComponent(parts[4] || '');
      const id = decodeURIComponent(parts[5] || '').replace(/\.json$/i, '');
      const payload = await fetchJson(upstreamResourceUrl(config.upstream, 'meta', type, id));
      return json(rewritePayload(payload, config, type));
    }

    return json({ error: 'Unsupported Posters addon resource.' }, 404);
  } catch (error) {
    return json({ error: error?.message || 'Posters addon proxy failed.' }, 502);
  }
}
