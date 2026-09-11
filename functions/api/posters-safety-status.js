import { readSession } from '../_lib/nuvio-session.js';
import { getPosterUsageStatus } from '../_lib/poster-safety.js';

const DEFAULT_OMDB_CACHE_DAYS = 30;
const DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY = 900;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function positiveInt(value, fallback, min = 1, max = 1000000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function ensureRatingTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS poster_rating_cache (
      provider TEXT NOT NULL,
      item_id TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, item_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poster_provider_usage_daily (
      day TEXT NOT NULL,
      provider TEXT NOT NULL,
      lookups INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, provider)
    )`),
  ]);
}

async function getOmdbUsage(env) {
  const dailyLimit = positiveInt(env.OMDB_MAX_LOOKUPS_PER_DAY, DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY, 1, 1000000);
  const cacheDays = positiveInt(env.OMDB_RATING_CACHE_DAYS, DEFAULT_OMDB_CACHE_DAYS, 1, 365);
  const day = new Date().toISOString().slice(0, 10);

  const fallback = {
    available: Boolean(env.DB),
    lookupsToday: 0,
    dailyLimit,
    remaining: dailyLimit,
    usagePercent: 0,
    cacheDays,
    cachedRatings: 0,
  };

  if (!env.DB) return fallback;

  try {
    await ensureRatingTables(env.DB);

    const [usage, cached] = await Promise.all([
      env.DB.prepare(`
        SELECT lookups
        FROM poster_provider_usage_daily
        WHERE day = ?1 AND provider = 'omdb'
      `).bind(day).first(),
      env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM poster_rating_cache
        WHERE provider = 'imdb'
      `).first(),
    ]);

    const lookupsToday = Math.max(0, Number(usage?.lookups || 0));
    const cachedRatings = Math.max(0, Number(cached?.count || 0));
    const remaining = Math.max(0, dailyLimit - lookupsToday);

    return {
      available: true,
      lookupsToday,
      dailyLimit,
      remaining,
      usagePercent: dailyLimit > 0 ? (lookupsToday / dailyLimit) * 100 : 0,
      cacheDays,
      cachedRatings,
    };
  } catch (error) {
    return { ...fallback, available: false, error: error?.message || String(error) };
  }
}

export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env);
  const adminEmail = String(env.NUVIO_ADMIN_EMAIL || '').trim().toLowerCase();
  const sessionEmail = String(session?.email || '').trim().toLowerCase();

  if (!session || !adminEmail || sessionEmail !== adminEmail) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const [status, omdb] = await Promise.all([
    getPosterUsageStatus(env),
    getOmdbUsage(env),
  ]);

  return json({
    ...status,
    persistentCache: {
      enabled: Boolean(env.POSTER_CACHE || env.IMAGES),
      binding: env.POSTER_CACHE ? 'POSTER_CACHE' : (env.IMAGES ? 'IMAGES' : null),
      strategy: 'edge -> R2 -> renderer',
    },
    omdb,
    defaults: {
      behavior: 'Edge-cache and R2 hits bypass render budgets. The daily render budget is a safety cap for true cache misses.',
      budgetFallback: 'Original TMDB artwork is returned when the global render budget or concurrency guard blocks a render.',
      clientLimit: 'Per-client hourly overages receive HTTP 429.',
      omdbFallback: 'Cached IMDb ratings are reused. New OMDb lookups stop at the daily API guard and fall back to TMDB.',
    },
  });
}
