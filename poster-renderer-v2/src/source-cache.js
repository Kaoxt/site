const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
export const SOURCE_CACHE_VERSION = 'source-art-v1';
export const SOURCE_CACHE_PREFIX = `poster-source/${SOURCE_CACHE_VERSION}/`;
export const SOURCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SOURCE_TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SOURCE_FETCH_TIMEOUT_MS = 4000;
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_MEMORY_MAX_ENTRIES = 128;
const SOURCE_MEMORY_MAX_BYTES = 24 * 1024 * 1024;

const memory = new Map();
const flights = new Map();
let memoryBytes = 0;

function schedule(context, promise) {
  if (context?.waitUntil) context.waitUntil(Promise.resolve(promise).catch(() => {}));
}

function removeMemory(key) {
  const existing = memory.get(key);
  if (!existing) return;
  memory.delete(key);
  memoryBytes = Math.max(0, memoryBytes - existing.bytes.byteLength);
}

function memoryGet(key, now) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (!(entry.retentionUntil > now)) {
    removeMemory(key);
    return null;
  }
  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

function memorySet(key, entry) {
  removeMemory(key);
  memory.set(key, entry);
  memoryBytes += entry.bytes.byteLength;
  while (memory.size > SOURCE_MEMORY_MAX_ENTRIES || memoryBytes > SOURCE_MEMORY_MAX_BYTES) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    removeMemory(oldest);
  }
}

function normalizeContentType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') ? type : 'application/octet-stream';
}

function sourceDescriptor(body) {
  const sourceUrl = String(body?.sourceUrl || '').trim();
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.toString().length > 1800) return null;
      return { url: url.toString(), kind: 'upstream' };
    } catch {
      return null;
    }
  }

  const posterPath = String(body?.posterPath || '').trim();
  if (!posterPath || !posterPath.startsWith('/') || posterPath.length > 512) return null;
  return { url: TMDB_POSTER_BASE + posterPath, kind: 'tmdb-w342' };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sourceCacheIdentity(body) {
  const descriptor = sourceDescriptor(body);
  if (!descriptor) return null;
  const hash = await sha256Hex(`${SOURCE_CACHE_VERSION}|${descriptor.kind}|${descriptor.url}`);
  return {
    ...descriptor,
    hash,
    objectKey: `${SOURCE_CACHE_PREFIX}${hash}.bin`,
  };
}

async function persistSource(bucket, identity, entry, accessedAt) {
  const retentionUntil = accessedAt + SOURCE_RETENTION_MS;
  await bucket.put(identity.objectKey, entry.bytes, {
    httpMetadata: { contentType: entry.contentType },
    customMetadata: {
      cacheVersion: SOURCE_CACHE_VERSION,
      sourceKind: identity.kind,
      fetchedAt: String(entry.fetchedAt),
      lastAccessedAt: String(accessedAt),
      retentionUntil: String(retentionUntil),
    },
  });
  entry.persistedAccessAt = accessedAt;
  entry.lastAccessedAt = accessedAt;
  entry.retentionUntil = retentionUntil;
}

function touchIfNeeded(bucket, identity, entry, context, now) {
  entry.lastAccessedAt = now;
  entry.retentionUntil = now + SOURCE_RETENTION_MS;
  if (!bucket || now - Number(entry.persistedAccessAt || 0) < SOURCE_TOUCH_INTERVAL_MS) return;
  // Mark this access before the asynchronous write so a hot burst cannot queue
  // many full-object metadata touches for the same source image.
  entry.persistedAccessAt = now;
  schedule(context, persistSource(bucket, identity, entry, now));
}

async function fetchSource(identity, fetcher) {
  const response = await fetcher(identity.url, {
    headers: { accept: 'image/webp,image/jpeg,image/*' },
    signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Source image fetch failed: ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > SOURCE_MAX_BYTES) throw new Error('Source image is too large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > SOURCE_MAX_BYTES) throw new Error('Source image is too large');
  return {
    bytes,
    contentType: normalizeContentType(response.headers.get('content-type')),
  };
}

async function loadSource(identity, env, context, fetcher, now) {
  const bucket = env?.SOURCE_ART || null;
  const warm = memoryGet(identity.hash, now);
  if (warm) {
    touchIfNeeded(bucket, identity, warm, context, now);
    return {
      ...warm,
      status: 'MEMORY_HIT',
      hash: identity.hash,
      kind: identity.kind,
    };
  }

  if (bucket) {
    try {
      const object = await bucket.get(identity.objectKey);
      if (object) {
        const metadata = object.customMetadata || {};
        const retentionUntil = Number(metadata.retentionUntil || 0);
        if (retentionUntil > now) {
          const bytes = new Uint8Array(await object.arrayBuffer());
          if (bytes.byteLength && bytes.byteLength <= SOURCE_MAX_BYTES) {
            const persistedAccessAt = Number(metadata.lastAccessedAt || 0);
            const entry = {
              bytes,
              contentType: normalizeContentType(object.httpMetadata?.contentType),
              fetchedAt: Number(metadata.fetchedAt || object.uploaded?.getTime?.() || now),
              lastAccessedAt: now,
              persistedAccessAt,
              retentionUntil: now + SOURCE_RETENTION_MS,
            };
            memorySet(identity.hash, entry);
            touchIfNeeded(bucket, identity, entry, context, now);
            return {
              ...entry,
              status: 'R2_HIT',
              hash: identity.hash,
              kind: identity.kind,
            };
          }
        }
        schedule(context, bucket.delete(identity.objectKey));
      }
    } catch {
      // A cache outage should never prevent the renderer from using origin art.
    }
  }

  const fresh = await fetchSource(identity, fetcher);
  const entry = {
    ...fresh,
    fetchedAt: now,
    lastAccessedAt: now,
    persistedAccessAt: bucket ? now : 0,
    retentionUntil: now + SOURCE_RETENTION_MS,
  };
  memorySet(identity.hash, entry);
  if (bucket) schedule(context, persistSource(bucket, identity, entry, now));
  return {
    ...entry,
    status: bucket ? 'MISS' : 'BYPASS',
    hash: identity.hash,
    kind: identity.kind,
  };
}

export async function prepareSourceArtwork(body, env, context, fetcher = fetch, now = Date.now()) {
  const identity = await sourceCacheIdentity(body);
  if (!identity) return null;

  const existing = flights.get(identity.hash);
  if (existing) {
    const result = await existing;
    return { ...result, status: result.status === 'MISS' ? 'SHARED' : result.status };
  }

  const promise = loadSource(identity, env, context, fetcher, now);
  flights.set(identity.hash, promise);
  try {
    return await promise;
  } finally {
    if (flights.get(identity.hash) === promise) flights.delete(identity.hash);
  }
}

export function shardForSource(hash, fallback = '') {
  const value = String(hash || fallback || '');
  let acc = 2166136261;
  for (let i = 0; i < value.length; i++) {
    acc ^= value.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return acc & 1;
}

export async function pruneExpiredSourceArt(env, now = Date.now(), maxPages = 10) {
  const bucket = env?.SOURCE_ART;
  if (!bucket) return { scanned: 0, deleted: 0, pages: 0 };

  let cursor;
  let scanned = 0;
  let deleted = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page = await bucket.list({
      prefix: SOURCE_CACHE_PREFIX,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    });
    pages++;
    const objects = Array.isArray(page.objects) ? page.objects : [];
    scanned += objects.length;
    const expired = objects
      .filter(object => Number(object.customMetadata?.retentionUntil || 0) <= now)
      .map(object => object.key);
    if (expired.length) {
      await bucket.delete(expired);
      deleted += expired.length;
    }
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }

  return { scanned, deleted, pages };
}

export function resetSourceCacheForTests() {
  memory.clear();
  flights.clear();
  memoryBytes = 0;
}
