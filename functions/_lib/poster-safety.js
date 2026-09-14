import { delay } from './poster-cache.js';

const DEFAULT_MAX_DAILY_RENDERS = 500;
const DEFAULT_MAX_CLIENT_HOURLY_RENDERS = 60;
const DEFAULT_MAX_CONCURRENT_RENDERS = 4;
const DEFAULT_CONSERVE_AT_PERCENT = 95;
const DEFAULT_HARD_STOP_AT_PERCENT = 98;

let activeRenders = 0;
let queuedRenders = 0;
let conservationMode = false;
const schemaReady = new WeakMap();

function intEnv(env, key, fallback, min = 1, max = 1000000) {
  const raw = Number.parseInt(String(env?.[key] ?? ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function percentEnv(env, key, fallback) {
  return intEnv(env, key, fallback, 1, 100);
}

function enabled(env) {
  const value = String(env?.POSTERS_RENDERING_ENABLED ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

function failOpen(env) {
  const value = String(env?.POSTERS_SAFETY_FAIL_OPEN ?? '0').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(value);
}

function thresholds(env, maxDaily) {
  const conservePercent = percentEnv(env, 'POSTERS_CONSERVE_AT_PERCENT', DEFAULT_CONSERVE_AT_PERCENT);
  const requestedHardStop = percentEnv(env, 'POSTERS_HARD_STOP_AT_PERCENT', DEFAULT_HARD_STOP_AT_PERCENT);
  const hardStopPercent = Math.max(conservePercent, requestedHardStop);
  return {
    conservePercent,
    hardStopPercent,
    conserveAt: Math.max(1, Math.floor(maxDaily * (conservePercent / 100))),
    hardStopAt: Math.max(1, Math.floor(maxDaily * (hardStopPercent / 100))),
  };
}

async function hashClient(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function ensureSchema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const setup = db.batch([
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
  ]).catch(error => {
    schemaReady.delete(db);
    throw error;
  });
  schemaReady.set(db, setup);
  return setup;
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
  const policy = thresholds(env, maxDaily);

  // Initialize independent counters together instead of two network round trips.
  await db.batch([
    db.prepare(`INSERT INTO poster_usage_daily (day, renders, updated_at)
     VALUES (?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(day) DO NOTHING`).bind(day),
    db.prepare(`INSERT INTO poster_usage_client_hourly (hour, client_hash, renders, updated_at)
     VALUES (?, ?, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(hour, client_hash) DO NOTHING`).bind(hour, clientHash),
  ]);

  const clientUpdate = await db.prepare(
    `UPDATE poster_usage_client_hourly
     SET renders = renders + 1, updated_at = CURRENT_TIMESTAMP
     WHERE hour = ? AND client_hash = ? AND renders < ?
       AND EXISTS (SELECT 1 FROM poster_usage_daily WHERE day = ? AND renders < ?)`
  ).bind(hour, clientHash, maxClientHourly, day, policy.hardStopAt).run();

  if (!clientUpdate?.meta?.changes) {
    const dailyRow = await db.prepare('SELECT renders FROM poster_usage_daily WHERE day = ?').bind(day).first();
    if (Number(dailyRow?.renders || 0) >= policy.hardStopAt) {
      return { allowed: false, reason: 'hard-stop-budget', maxDaily, dailyRenders: Number(dailyRow.renders), ...policy };
    }
    return { allowed: false, reason: 'client-hourly-limit', maxClientHourly };
  }

  const dailyUpdate = await db.prepare(
    `UPDATE poster_usage_daily
     SET renders = renders + 1, updated_at = CURRENT_TIMESTAMP
     WHERE day = ? AND renders < ? RETURNING renders`
  ).bind(day, policy.hardStopAt).first();

  if (!dailyUpdate) {
    return {
      allowed: false,
      reason: 'hard-stop-budget',
      maxDaily,
      dailyRenders: policy.hardStopAt,
      ...policy,
    };
  }

  const currentDaily = Number(dailyUpdate.renders);
  const conservationMode = currentDaily - 1 >= policy.conserveAt;
  return {
    allowed: true,
    reason: conservationMode ? 'budget-reserved-conservation' : 'budget-reserved',
    conservationMode,
    maxDaily,
    maxClientHourly,
    dailyRenders: currentDaily,
    ...policy,
  };
}

export async function acquirePosterRenderSlot(env, request, { signal, waitMs = 5000 } = {}) {
  if (!enabled(env)) {
    return { allowed: false, reason: 'rendering-disabled', release() {} };
  }

  const maxConcurrent = intEnv(env, 'POSTERS_MAX_CONCURRENT_RENDERS', DEFAULT_MAX_CONCURRENT_RENDERS, 1, 100);
  if (queuedRenders >= 64) return { allowed: false, reason: 'render-queue-full', release() {} };
  // A short bounded queue handles catalog bursts instead of immediately dropping
  // overlays. Reserve capacity BEFORE awaiting D1, and charge only admitted work.
  const deadline = Date.now() + Math.min(5000, Math.max(0, waitMs));
  queuedRenders += 1;
  try {
    while (activeRenders >= (conservationMode ? 1 : maxConcurrent)) {
      if (Date.now() >= deadline) return { allowed: false, reason: 'render-queue-timeout', release() {} };
      await delay(Math.min(50, Math.max(1, deadline - Date.now())), signal);
    }
    if (signal?.aborted) throw signal.reason;
  } finally {
    queuedRenders -= 1;
  }
  activeRenders += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRenders = Math.max(0, activeRenders - 1);
  };
  let budget;
  try {
    budget = await reserveDbBudget(env, request);
  } catch (error) {
    if (failOpen(env)) budget = { allowed: true, reason: 'budget-error-fail-open', conservationMode: false };
    else budget = { allowed: false, reason: 'budget-error' };
  }
  if (!budget.allowed || signal?.aborted) {
    release();
    return { ...budget, allowed: false, reason: signal?.aborted ? 'render-timeout' : budget.reason, release() {} };
  }
  conservationMode = Boolean(budget.conservationMode);
  return {
    ...budget,
    allowed: true,
    activeRenders,
    maxConcurrent: conservationMode ? 1 : maxConcurrent,
    release,
  };
}

export async function getPosterUsageStatus(env) {
  const maxDaily = intEnv(env, 'POSTERS_MAX_DAILY_RENDERS', DEFAULT_MAX_DAILY_RENDERS, 1, 1000000);
  const maxClientHourly = intEnv(env, 'POSTERS_MAX_CLIENT_HOURLY_RENDERS', DEFAULT_MAX_CLIENT_HOURLY_RENDERS, 1, 100000);
  const maxConcurrent = intEnv(env, 'POSTERS_MAX_CONCURRENT_RENDERS', DEFAULT_MAX_CONCURRENT_RENDERS, 1, 100);
  const policy = thresholds(env, maxDaily);
  const db = env?.DB;
  const status = {
    renderingEnabled: enabled(env),
    failOpen: failOpen(env),
    activeRenders,
    maxConcurrent,
    maxDaily,
    maxClientHourly,
    ...policy,
    dailyRenders: null,
    usagePercent: null,
    conservationMode: false,
    hardStopped: false,
  };
  if (!db) return status;
  try {
    await ensureSchema(db);
    const day = new Date().toISOString().slice(0, 10);
    const row = await db.prepare('SELECT renders FROM poster_usage_daily WHERE day = ?').bind(day).first();
    status.dailyRenders = Number(row?.renders || 0);
    status.usagePercent = maxDaily > 0 ? Number(((status.dailyRenders / maxDaily) * 100).toFixed(2)) : 0;
    status.conservationMode = status.dailyRenders >= policy.conserveAt && status.dailyRenders < policy.hardStopAt;
    status.hardStopped = status.dailyRenders >= policy.hardStopAt;
  } catch {}
  return status;
}
