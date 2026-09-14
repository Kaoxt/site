// Only share public poster work within the same deployment/bindings.
const flights = new WeakMap();
const leaseSchemas = new WeakMap();

export function posterBucket(env) {
  return env.POSTER_CACHE || env.IMAGES || null;
}

export async function singleFlight(env, key, work, retainUntil = () => null) {
  const scope = posterBucket(env) || env.DB || env;
  let pending = flights.get(scope);
  if (!pending) flights.set(scope, pending = new Map());
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(work);
  pending.set(key, promise);
  let result;
  const cleanup = () => { if (pending.get(key) === promise) pending.delete(key); };
  try {
    result = await promise;
    return result;
  } finally {
    // A completed image can be returned immediately while its storage writes
    // finish. Keep sharing those bytes until storage can satisfy new requests.
    const completion = retainUntil(result);
    if (completion) Promise.resolve(completion).then(cleanup, cleanup);
    else cleanup();
  }
}

export async function digestKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Cache metadata independently of poster style. API keys never enter cache URLs or R2.
export async function cachedPosterJson(context, key, ttlSeconds, loader) {
  const { env } = context;
  return singleFlight(env, `metadata:${key}`, async () => {
    const hash = await digestKey(key);
    const request = new Request(`${new URL(context.request.url).origin}/__poster-data/${hash}`);
    const cache = caches.default;
    const bucket = posterBucket(env);
    const objectKey = `poster-data/v1/${hash}.json`;
    let record;
    try {
      const response = await cache.match(request);
      if (response) record = await response.json();
      if (record?.expiresAt > Date.now()) return record.value;
      if (bucket) {
        const object = await bucket.get(objectKey);
        if (object) record = await object.json();
        if (record?.expiresAt > Date.now()) {
          context.waitUntil(cache.put(request, metadataResponse(record)).catch(() => {}));
          return record.value;
        }
      }
    } catch { /* Cache outages must not prevent an upstream read. */ }

    const value = await loader();
    record = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
    context.waitUntil(Promise.allSettled([
      cache.put(request, metadataResponse(record)),
      ...(bucket ? [bucket.put(objectKey, JSON.stringify(record), {
        httpMetadata: { contentType: 'application/json' },
      })] : []),
    ]));
    return value;
  });
}

function metadataResponse(record) {
  return new Response(JSON.stringify(record), { headers: {
    'content-type': 'application/json',
    'cache-control': `public, max-age=${Math.max(1, Math.floor((record.expiresAt - Date.now()) / 1000))}`,
  } });
}

async function ensureLeaseTable(db) {
  if (!leaseSchemas.has(db)) {
    const setup = db.prepare(`CREATE TABLE IF NOT EXISTS poster_render_leases (
      cache_key TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`).run().catch(error => {
      leaseSchemas.delete(db);
      throw error;
    });
    leaseSchemas.set(db, setup);
  }
  await leaseSchemas.get(db);
}

// A short atomic D1 lease prevents different Worker instances rendering the same
// variant. No lease is needed without shared storage; the render budget still applies.
export async function acquirePosterLease(env, key) {
  if (!env.DB || !posterBucket(env)) return { acquired: true, async release() {} };
  const db = env.DB;
  await ensureLeaseTable(db);
  const owner = crypto.randomUUID();
  const now = Date.now();
  const result = await db.prepare(`
    INSERT INTO poster_render_leases (cache_key, owner, expires_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(cache_key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
    WHERE poster_render_leases.expires_at <= ?4
  `).bind(key, owner, now + 60000, now).run();
  const acquired = Number(result?.meta?.changes || 0) > 0;
  return {
    acquired,
    async release(retryAfterMs = 0) {
      if (!acquired) return;
      if (retryAfterMs) {
        await db.prepare('UPDATE poster_render_leases SET expires_at = ?1 WHERE cache_key = ?2 AND owner = ?3')
          .bind(Date.now() + retryAfterMs, key, owner).run();
      } else {
        await db.prepare('DELETE FROM poster_render_leases WHERE cache_key = ?1 AND owner = ?2')
          .bind(key, owner).run();
      }
    },
  };
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
