const SOURCE_VERSION = 'tmdb-source-art-v1';
const LOGO_SOURCE_VERSION = 'tmdb-logo-art-v1';
const SOURCE_PREFIX = `poster-source/${SOURCE_VERSION}/`;
const LOGO_SOURCE_PREFIX = `poster-source/${LOGO_SOURCE_VERSION}/`;
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w500';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

function objectHash(request) {
  const match = new URL(request.url).pathname.match(/^\/v1\/([0-9a-f]{64})\.bin$/);
  return match?.[1] || '';
}

function assetRequest(request) {
  const kind = request.headers.get('x-tmdb-asset-type') === 'logo' ? 'logo' : 'poster';
  const path = String(
    kind === 'logo'
      ? request.headers.get('x-tmdb-logo-path')
      : request.headers.get('x-tmdb-poster-path')
  || '').trim();
  if (!/^\/[A-Za-z0-9._/-]{1,500}$/.test(path)) return null;
  return kind === 'logo'
    ? { kind, path, version: LOGO_SOURCE_VERSION, prefix: LOGO_SOURCE_PREFIX, base: TMDB_LOGO_BASE }
    : { kind, path, version: SOURCE_VERSION, prefix: SOURCE_PREFIX, base: TMDB_POSTER_BASE };
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function imageType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') ? type : 'application/octet-stream';
}

function sourceResponse(bytes, contentType, metadata, cacheStatus) {
  return new Response(bytes, {
    headers: {
      'content-type': contentType,
      'cache-control': 'private, no-store',
      'x-source-cache': cacheStatus,
      'x-source-fetched-at': String(metadata.fetchedAt || ''),
      'x-source-last-accessed-at': String(metadata.lastAccessedAt || ''),
      'x-source-retention-until': String(metadata.retentionUntil || ''),
      'x-source-cache-version': metadata.version || SOURCE_VERSION,
    },
  });
}

export async function sourceCacheOutbound(request, env) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });

  const hash = objectHash(request);
  const asset = assetRequest(request);
  if (!hash || !asset) return new Response(null, { status: 400 });

  const expected = await digest(`${asset.version}|${asset.path}`);
  if (expected !== hash) return new Response(null, { status: 400 });

  const key = `${asset.prefix}${hash}.bin`;
  const now = Date.now();

  try {
    const object = await env.SOURCE_ART.get(key);
    if (object) {
      const metadata = object.customMetadata || {};
      if (Number(metadata.retentionUntil || 0) > now) {
        const bytes = await object.arrayBuffer();
        const accessedAt = Number(metadata.lastAccessedAt || 0);
        const nextMetadata = {
          fetchedAt: Number(metadata.fetchedAt || object.uploaded?.getTime?.() || now),
          lastAccessedAt: now,
          retentionUntil: now + RETENTION_MS,
        };
        if (now - accessedAt >= TOUCH_INTERVAL_MS) {
          // OutboundHandlerContext has no waitUntil. Finish persistence here.
          await env.SOURCE_ART.put(key, bytes, {
            httpMetadata: { contentType: object.httpMetadata?.contentType || 'application/octet-stream' },
            customMetadata: {
              fetchedAt: String(nextMetadata.fetchedAt),
              lastAccessedAt: String(now),
              retentionUntil: String(nextMetadata.retentionUntil),
            },
          }).catch(() => {});
        }
        return sourceResponse(bytes, object.httpMetadata?.contentType || 'application/octet-stream', { ...nextMetadata, version: asset.version }, 'R2_HIT');
      }
      await env.SOURCE_ART.delete(key).catch(() => {});
    }
  } catch {
    // R2 is an acceleration layer; continue to TMDB if it is temporarily unavailable.
  }

  const origin = await fetch(asset.base + asset.path, {
    headers: { accept: 'image/webp,image/jpeg,image/*' },
    signal: AbortSignal.timeout(4000),
  });
  if (!origin.ok) return new Response(null, { status: origin.status || 502 });

  const declared = Number(origin.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return new Response(null, { status: 413 });
  const bytes = await origin.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return new Response(null, { status: 413 });

  const contentType = imageType(origin.headers.get('content-type'));
  const metadata = {
    fetchedAt: now,
    lastAccessedAt: now,
    retentionUntil: now + RETENTION_MS,
    version: asset.version,
  };
  try { await env.SOURCE_ART.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      fetchedAt: String(now),
      lastAccessedAt: String(now),
      retentionUntil: String(metadata.retentionUntil),
    },
  }); } catch { /* Source persistence must not prevent overlay rendering. */ }

  return sourceResponse(bytes, contentType, { ...metadata, version: asset.version }, 'MISS');
}

async function prunePrefix(env, prefix, now, maxPages) {
  let cursor;
  let pages = 0;
  do {
    const page = await env.SOURCE_ART.list({
      prefix,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    });
    const expired = (page.objects || [])
      .filter(object => Number(object.customMetadata?.retentionUntil || 0) <= now)
      .map(object => object.key);
    if (expired.length) await env.SOURCE_ART.delete(expired);
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < maxPages);
}

export async function pruneExpiredSourceArt(env, now = Date.now(), maxPages = 50) {
  await prunePrefix(env, SOURCE_PREFIX, now, maxPages);
  await prunePrefix(env, LOGO_SOURCE_PREFIX, now, maxPages);
}
