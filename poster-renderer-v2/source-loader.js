import { createHash } from 'node:crypto';

export const SOURCE_CACHE_VERSION = 'tmdb-source-art-v1';
export const LOGO_SOURCE_CACHE_VERSION = 'tmdb-logo-art-v1';
export const BTTTR_SOURCE_CACHE_VERSION = 'btttr-source-art-v1';
const SOURCE_CACHE_HOST = 'source-cache.internal';
const SOURCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SOURCE_TOUCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 96;
const MEMORY_MAX_BYTES = 24 * 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;

const memory = new Map();
const pending = new Map();
let memoryBytes = 0;

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function deleteMemory(key) {
  const entry = memory.get(key);
  if (!entry) return;
  memory.delete(key);
  memoryBytes = Math.max(0, memoryBytes - entry.input.length);
}

function getMemory(key, now = Date.now()) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (!(entry.retentionUntil > now)) {
    deleteMemory(key);
    return null;
  }
  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

function setMemory(key, entry) {
  deleteMemory(key);
  memory.set(key, entry);
  memoryBytes += entry.input.length;
  while (memory.size > MEMORY_MAX_ENTRIES || memoryBytes > MEMORY_MAX_BYTES) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    deleteMemory(oldest);
  }
}

function validPosterPath(value) {
  const path = String(value || '').trim();
  return /^\/[A-Za-z0-9._/-]{1,500}$/.test(path) ? path : '';
}

function validBtttrUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'btttr.cc' || url.username || url.password) return '';
    if (!/^\/poster(?:-[a-z]+)?\/imdb\/poster-default\/tt\d{5,12}\.jpg$/i.test(url.pathname)) return '';
    if (url.toString().length > 1800) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function numberHeader(response, name) {
  const value = Number(response.headers.get(name) || 0);
  return Number.isFinite(value) ? value : 0;
}

function cacheUrl(hash) {
  return `http://${SOURCE_CACHE_HOST}/v1/${hash}.bin`;
}

async function readBtttrShared(sourceUrl, hash) {
  const response = await fetch(cacheUrl(hash), {
    headers: {
      accept: 'image/*',
      'x-tmdb-asset-type': 'btttr',
      'x-btttr-source-url': sourceUrl,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Shared Better Posters source cache failed: ${response.status}`);
  const input = Buffer.from(await response.arrayBuffer());
  if (!input.length || input.length > MAX_BYTES) throw new Error('Source image is too large');
  return {
    input,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    status: response.headers.get('x-source-cache') || 'R2_HIT',
    fetchedAt: numberHeader(response, 'x-source-fetched-at') || Date.now(),
    persistedAccessAt: numberHeader(response, 'x-source-last-accessed-at') || Date.now(),
    retentionUntil: numberHeader(response, 'x-source-retention-until') || Date.now() + SOURCE_RETENTION_MS,
  };
}

function touchBtttrShared(sourceUrl, hash, entry, now) {
  if (now - Number(entry.persistedAccessAt || 0) < SOURCE_TOUCH_INTERVAL_MS) return;
  entry.persistedAccessAt = now;
  entry.retentionUntil = now + SOURCE_RETENTION_MS;
  void fetch(cacheUrl(hash), {
    headers: {
      accept: 'image/*',
      'x-tmdb-asset-type': 'btttr',
      'x-btttr-source-url': sourceUrl,
    },
    signal: AbortSignal.timeout(5000),
  }).then(response => response.body?.cancel()).catch(() => {});
}

async function readShared(path, hash, kind = 'poster') {
  const headers = { accept: 'image/*', 'x-tmdb-asset-type': kind };
  headers[kind === 'logo' ? 'x-tmdb-logo-path' : 'x-tmdb-poster-path'] = path;
  const response = await fetch(cacheUrl(hash), {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Shared source cache failed: ${response.status}`);
  const input = Buffer.from(await response.arrayBuffer());
  if (!input.length || input.length > MAX_BYTES) throw new Error('Source image is too large');
  return {
    input,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    status: response.headers.get('x-source-cache') || 'R2_HIT',
    fetchedAt: numberHeader(response, 'x-source-fetched-at') || Date.now(),
    persistedAccessAt: numberHeader(response, 'x-source-last-accessed-at') || Date.now(),
    retentionUntil: numberHeader(response, 'x-source-retention-until') || Date.now() + SOURCE_RETENTION_MS,
  };
}

function touchShared(path, hash, entry, now, kind = 'poster') {
  if (now - Number(entry.persistedAccessAt || 0) < SOURCE_TOUCH_INTERVAL_MS) return;
  entry.persistedAccessAt = now;
  entry.retentionUntil = now + SOURCE_RETENTION_MS;
  const headers = { accept: 'image/*', 'x-tmdb-asset-type': kind };
  headers[kind === 'logo' ? 'x-tmdb-logo-path' : 'x-tmdb-poster-path'] = path;
  void fetch(cacheUrl(hash), {
    headers,
    signal: AbortSignal.timeout(5000),
  }).then(response => response.body?.cancel()).catch(() => {});
}

async function loadTmdbAsset(pathValue, {
  kind = 'poster',
  version = SOURCE_CACHE_VERSION,
  base = 'https://image.tmdb.org/t/p/w342',
  requiredLabel = 'posterPath',
} = {}) {
  const path = validPosterPath(pathValue);
  if (!path) throw new Error(`${requiredLabel} is required`);
  const now = Date.now();
  const hash = digest(`${version}|${path}`);
  const warm = getMemory(hash, now);
  if (warm) {
    if (warm.status !== 'ORIGIN_FALLBACK') touchShared(path, hash, warm, now, kind);
    return {
      ...warm,
      key: hash,
      retentionUntil: now + SOURCE_RETENTION_MS,
      status: 'MEMORY_HIT',
    };
  }

  // Variants of one title can arrive together before the LRU has any bytes.
  // Share the entire lookup (including fallback) instead of downloading each.
  if (pending.has(hash)) return pending.get(hash);
  const work = loadColdSource(path, hash, now, { kind, base });
  pending.set(hash, work);
  try { return await work; }
  finally { if (pending.get(hash) === work) pending.delete(hash); }
}

export function loadTmdbPosterSource(posterPath) {
  return loadTmdbAsset(posterPath);
}

export function loadTmdbLogoSource(logoPath) {
  return loadTmdbAsset(logoPath, {
    kind: 'logo',
    version: LOGO_SOURCE_CACHE_VERSION,
    base: 'https://image.tmdb.org/t/p/w500',
    requiredLabel: 'logoPath',
  });
}

export async function loadBtttrPosterSource(sourceUrlValue) {
  const sourceUrl = validBtttrUrl(sourceUrlValue);
  if (!sourceUrl) throw new Error('Valid btttr.cc sourceUrl is required');
  const now = Date.now();
  const hash = digest(`${BTTTR_SOURCE_CACHE_VERSION}|${sourceUrl}`);
  const warm = getMemory(hash, now);
  if (warm) {
    if (warm.status !== 'ORIGIN_FALLBACK') touchBtttrShared(sourceUrl, hash, warm, now);
    return {
      ...warm,
      key: hash,
      retentionUntil: now + SOURCE_RETENTION_MS,
      status: 'MEMORY_HIT',
    };
  }

  if (pending.has(hash)) return pending.get(hash);
  const work = (async () => {
    let shared;
    try {
      shared = await readBtttrShared(sourceUrl, hash);
    } catch {
      const response = await fetch(sourceUrl, {
        headers: { accept: 'image/webp,image/jpeg,image/*' },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Better Posters source failed: ${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Source image is too large');
      const input = Buffer.from(await response.arrayBuffer());
      if (!input.length || input.length > MAX_BYTES) throw new Error('Source image is too large');
      if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Invalid source image');
      shared = {
        input,
        contentType: response.headers.get('content-type'),
        status: 'ORIGIN_FALLBACK',
        fetchedAt: now,
        persistedAccessAt: 0,
        retentionUntil: now + 60000,
      };
    }
    const entry = { ...shared };
    setMemory(hash, entry);
    return { ...entry, key: hash };
  })();
  pending.set(hash, work);
  try { return await work; }
  finally { if (pending.get(hash) === work) pending.delete(hash); }
}

async function loadColdSource(path, hash, now, { kind = 'poster', base = 'https://image.tmdb.org/t/p/w342' } = {}) {
  let shared;
  try {
    shared = await readShared(path, hash, kind);
  } catch {
    // The shared cache accelerates artwork delivery; it must not disable overlays.
    const response = await fetch(`${base}${path}`, {
      headers: { accept: 'image/webp,image/jpeg,image/*' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`TMDB source failed: ${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Source image is too large');
    const input = Buffer.from(await response.arrayBuffer());
    if (!input.length || input.length > MAX_BYTES) throw new Error('Source image is too large');
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Invalid source image');
    shared = {
      input,
      contentType: response.headers.get('content-type'),
      status: 'ORIGIN_FALLBACK',
      fetchedAt: now,
      persistedAccessAt: 0,
      // Retry shared storage soon, while avoiding an origin fetch per render.
      retentionUntil: now + 60000,
    };
  }
  const entry = { ...shared };
  setMemory(hash, entry);
  return { ...entry, key: hash };
}

export function resetPosterSourceMemoryForTests() {
  memory.clear();
  pending.clear();
  memoryBytes = 0;
}
