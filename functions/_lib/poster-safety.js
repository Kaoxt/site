const DEFAULT_MAX_DAILY_RENDERS = 500;
const DEFAULT_MAX_CLIENT_HOURLY_RENDERS = 60;
const DEFAULT_MAX_CONCURRENT_RENDERS = 4;

let activeRenders = 0;
let schemaReady = false;

function intEnv(env, key, fallback, min = 1, max = 1000000) {
  const raw = Number.parseInt(String(env?.[key] ?? ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function enabled(env) {
  const value = String(env?.POSTERS_RENDERING_ENABLED ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

function failOpen(env) {
  const value = String(env?.POSTERS_SAFETY_FAIL_OPEN ?? '0').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(value);
}

async function hashClient(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS poster_usage_daily (
      day TEXT PRIMARY KEY,
      renders INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poster_usage_client_hourly (
      hour TEXT NOT NULL,
      client_hash TEXT NOT NULL,
      renders INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (hour, client_hash)
    )`),
  ]);
  schemaReady = true;
}

async function reserveDbBudget(env, request) {
  const db = env?.DB;
  if (!db) {
    if (failOpen(env)) return { allowed: true, reason: 'db-missing-fail-open' };
    return { allowed: false, reason: 'db-missing' };
  }

  await ensureSchema(db);

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const clientHash = await hashClient(request);
  const maxDaily = intEnv(env, 'POSTERS_MAX_DAILY_RENDERS', DEFAULT_MAX_DAILY_RENDERS, 1, 1000000);
  const maxClientHourly = intEnv(env, 'POSTERS_MAX_CLIENT_HOURLY_RENDERS', DEFAULT_MAX_CLIENT_HOURLY_RENDERS, 1, 100000);

  await db.prepare(
    `INSERT INTO poster_usage_client_hourly (hour, client_hash, renders, updated_at)
     VALUES (?, ?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(hour, client_hash) DO NOTHING`
  ).bind(hour, clientHash).run();

  const clientUpdate = await db.prepare(
    `UPDATE poster_usage_client_hourly
     SET renders = renders + 1, updated_at = CURRENT_TIMESTAMP
     WHERE hour = ? AND client_hash = ? AND renders < ?`
  ).bind(hour, clientHash, maxClientHourly).run();

  if (!clientUpdate?.meta?.changes) {
    return { allowed: false, reason: 'client-hourly-limit', maxClientHourly };
  }

  await db.prepare(
    `INSERT INTO poster_usage_daily (day, renders, updated_at)
     VALUES (?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(day) DO NOTHING`
  ).bind(day).run();

  const dailyUpdate = await db.prepare(
    `UPDATE poster_usage_daily
     SET renders = renders + 1, updated_at = CURRENT_TIMESTAMP
     WHERE day = ? AND renders < ?`
  ).bind(day, maxDaily).run();

  if (!dailyUpdate?.meta?.changes) {
    return { allowed: false, reason: 'daily-render-budget', maxDaily };
  }

  return { allowed: true, reason: 'budget-reserved', maxDaily, maxClientHourly };
}

export async function acquirePosterRenderSlot(env, request) {
  if (!enabled(env)) {
    return { allowed: false, reason: 'rendering-disabled', release() {} };
  }

  const maxConcurrent = intEnv(env, 'POSTERS_MAX_CONCURRENT_RENDERS', DEFAULT_MAX_CONCURRENT_RENDERS, 1, 100);
  if (activeRenders >= maxConcurrent) {
    return { allowed: false, reason: 'concurrency-limit', maxConcurrent, release() {} };
  }

  let budget;
  try {
    budget = await reserveDbBudget(env, request);
  } catch (error) {
    if (failOpen(env)) {
      budget = { allowed: true, reason: 'budget-error-fail-open' };
    } else {
      return { allowed: false, reason: 'budget-error', error: error?.message || String(error), release() {} };
    }
  }

  if (!budget.allowed) {
    return { ...budget, release() {} };
  }

  activeRenders += 1;
  let released = false;
  return {
    ...budget,
    allowed: true,
    activeRenders,
    maxConcurrent,
    release() {
      if (released) return;
      released = true;
      activeRenders = Math.max(0, activeRenders - 1);
    },
  };
}

export async function getPosterUsageStatus(env) {
  const maxDaily = intEnv(env, 'POSTERS_MAX_DAILY_RENDERS', DEFAULT_MAX_DAILY_RENDERS, 1, 1000000);
  const maxClientHourly = intEnv(env, 'POSTERS_MAX_CLIENT_HOURLY_RENDERS', DEFAULT_MAX_CLIENT_HOURLY_RENDERS, 1, 100000);
  const maxConcurrent = intEnv(env, 'POSTERS_MAX_CONCURRENT_RENDERS', DEFAULT_MAX_CONCURRENT_RENDERS, 1, 100);
  const db = env?.DB;
  const status = {
    renderingEnabled: enabled(env),
    failOpen: failOpen(env),
    activeRenders,
    maxConcurrent,
    maxDaily,
    maxClientHourly,
    dailyRenders: null,
  };
  if (!db) return status;
  try {
    await ensureSchema(db);
    const day = new Date().toISOString().slice(0, 10);
    const row = await db.prepare('SELECT renders FROM poster_usage_daily WHERE day = ?').bind(day).first();
    status.dailyRenders = Number(row?.renders || 0);
  } catch {}
  return status;
}
