import { createHash } from 'node:crypto';

export const SOURCE_CACHE_VERSION = 'tmdb-source-art-v1';
const SOURCE_CACHE_HOST = 'source-cache.internal';
const SOURCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SOURCE_TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 96;
const MEMORY_MAX_BYTES = 24 * 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;

const memory = new Map();
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

function numberHeader(response, name) {
  const value = Number(response.headers.get(name) || 0);
  return Number.isFinite(value) ? value : 0;
}

function cacheUrl(hash) {
  return `http://${SOURCE_CACHE_HOST}/v1/${hash}.bin`;
}

async function readShared(path, hash) {
  const response = await fetch(cacheUrl(hash), {
    headers: {
      accept: 'image/*',
      'x-tmdb-poster-path': path,
    },
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

function touchShared(path, hash, entry, now) {
  if (now - Number(entry.persistedAccessAt || 0) < SOURCE_TOUCH_INTERVAL_MS) return;
  entry.persistedAccessAt = now;
  entry.retentionUntil = now + SOURCE_RETENTION_MS;
  void fetch(cacheUrl(hash), {
    headers: {
      accept: 'image/*',
      'x-tmdb-poster-path': path,
    },
    signal: AbortSignal.timeout(5000),
  }).then(response => response.body?.cancel()).catch(() => {});
}

export async function loadTmdbPosterSource(posterPath) {
  const path = validPosterPath(posterPath);
  if (!path) throw new Error('posterPath is required');
  const now = Date.now();
  const hash = digest(`${SOURCE_CACHE_VERSION}|${path}`);
  const warm = getMemory(hash, now);
  if (warm) {
    touchShared(path, hash, warm, now);
    return {
      ...warm,
      key: hash,
      retentionUntil: now + SOURCE_RETENTION_MS,
      status: 'MEMORY_HIT',
    };
  }

  const shared = await readShared(path, hash);
  const entry = { ...shared };
  setMemory(hash, entry);
  return { ...entry, key: hash };
}

export function resetPosterSourceMemoryForTests() {
  memory.clear();
  memoryBytes = 0;
}
