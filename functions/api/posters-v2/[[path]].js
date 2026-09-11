import { acquirePosterRenderSlot } from '../../_lib/poster-safety.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const DEFAULT_RENDERER_URL = 'https://poster-renderer.kollection.tv';
const CACHE_VERSION = 'production-cache-5';
const DEFAULT_OMDB_CACHE_DAYS = 30;
const DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY = 900;
const ALLOWED_TAGS = ['trend', 'rating', 'genre', 'quality', 'age'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function positiveInt(value, fallback, min = 1, max = 1000000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function tmdbFetch(path, key) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function resolveTmdbId(type, rawId, key) {
  if (/^\d+$/.test(rawId)) return rawId;
  if (!/^tt\d+$/i.test(rawId)) return null;
  const found = await tmdbFetch(`/find/${encodeURIComponent(rawId)}?external_source=imdb_id`, key);
  const list = type === 'tv' ? found.tv_results : found.movie_results;
  return list?.[0]?.id ? String(list[0].id) : null;
}

async function trendLabel(type, id, key) {
  const data = await tmdbFetch(`/trending/${type}/day?language=en-US&page=1`, key);
  const index = (data.results || []).findIndex((item) => String(item.id) === String(id));
  return index >= 0 ? `#${index + 1} Today` : '';
}

function certification(details, type) {
  if (type === 'movie') {
    const us = details.release_dates?.results?.find((x) => x.iso_3166_1 === 'US');
    return us?.release_dates?.find((x) => x.certification)?.certification || '';
  }
  return details.content_ratings?.results?.find((x) => x.iso_3166_1 === 'US')?.rating || '';
}

function choosePoster(details, smartLayout) {
  const original = details.poster_path || '';
  if (!smartLayout) return { path: original, source: 'tmdb-original' };

  const candidates = Array.isArray(details.images?.posters) ? details.images.posters : [];
  const textless = candidates
    .filter((poster) => poster?.file_path && !poster.iso_639_1 && poster.file_path !== original)
    .sort((a, b) => {
      const votes = Number(b.vote_count || 0) - Number(a.vote_count || 0);
      if (votes !== 0) return votes;
      return Number(b.vote_average || 0) - Number(a.vote_average || 0);
    });

  if (textless[0]?.file_path) return { path: textless[0].file_path, source: 'smart-textless' };
  return { path: original, source: 'smart-fallback-original' };
}

function chooseLogo(details, enabled) {
  if (!enabled) return { path: '', source: 'disabled' };
  const logos = Array.isArray(details.images?.logos) ? details.images.logos : [];
  if (!logos.length) return { path: '', source: 'title-fallback' };

  const languageRank = (logo) => {
    const language = String(logo?.iso_639_1 || '').toLowerCase();
    if (language === 'en') return 3;
    if (!language) return 2;
    return 1;
  };

  const ranked = logos
    .filter((logo) => logo?.file_path)
    .sort((a, b) => {
      const language = languageRank(b) - languageRank(a);
      if (language !== 0) return language;
      const votes = Number(b.vote_count || 0) - Number(a.vote_count || 0);
      if (votes !== 0) return votes;
      return Number(b.vote_average || 0) - Number(a.vote_average || 0);
    });

  return ranked[0]?.file_path
    ? { path: ranked[0].file_path, source: 'tmdb-logo' }
    : { path: '', source: 'title-fallback' };
}

function normalizeRatingSource(value) {
  const source = String(value || 'average').toLowerCase();
  return ['average', 'score', 'imdb', 'letterboxd', 'mal', 'rogerebert', 'tomatometer', 'popcornmeter', 'tmdb'].includes(source)
    ? source
    : 'average';
}

function normalizeTags(value) {
  const requested = new Set(String(value || 'trend,rating').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  return ALLOWED_TAGS.filter((tag) => requested.has(tag));
}

function tmdbRating(details, source, status = 'ok') {
  const value = Number(details.vote_average);
  if (!Number.isFinite(value) || value <= 0) return { value: '', label: '', source, status: 'missing' };
  const formatted = value.toFixed(1);
  if (source === 'tmdb') return { value: formatted, label: `TMDB ${formatted}`, source: 'tmdb', status };
  return { value: formatted, label: `★ ${formatted}`, source, status };
}

function tmdbFallback(details, reason) {
  const fallback = tmdbRating(details, 'tmdb', `fallback-${reason}`);
  return { ...fallback, requestedSource: 'imdb' };
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

async function readCachedRating(db, provider, itemId, maxAgeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  const row = await db.prepare(`
    SELECT value, label, updated_at
    FROM poster_rating_cache
    WHERE provider = ?1 AND item_id = ?2 AND updated_at >= ?3
  `).bind(provider, itemId, cutoff).first();
  if (!row) return null;
  return { value: String(row.value || ''), label: String(row.label || ''), source: provider, status: 'cache-hit' };
}

async function reserveProviderLookup(db, provider, dailyLimit) {
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare(`
    INSERT INTO poster_provider_usage_daily (day, provider, lookups)
    VALUES (?1, ?2, 0)
    ON CONFLICT(day, provider) DO NOTHING
  `).bind(day, provider).run();
  const result = await db.prepare(`
    UPDATE poster_provider_usage_daily
    SET lookups = lookups + 1
    WHERE day = ?1 AND provider = ?2 AND lookups < ?3
  `).bind(day, provider, dailyLimit).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function writeCachedRating(db, provider, itemId, value, label) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO poster_rating_cache (provider, item_id, value, label, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(provider, item_id) DO UPDATE SET
      value = excluded.value,
      label = excluded.label,
      updated_at = excluded.updated_at
  `).bind(provider, itemId, value, label, now).run();
}

async function imdbRating(details, env) {
  const imdbId = details.external_ids?.imdb_id || '';
  if (!imdbId) return { value: '', label: '', source: 'imdb', status: 'missing-id' };
  if (!env.OMDB_API_KEY) return { value: '', label: '', source: 'imdb', status: 'not-configured' };
  if (!env.DB) return tmdbFallback(details, 'rating-cache-unavailable');
  const cacheDays = positiveInt(env.OMDB_RATING_CACHE_DAYS, DEFAULT_OMDB_CACHE_DAYS, 1, 365);
  const dailyLimit = positiveInt(env.OMDB_MAX_LOOKUPS_PER_DAY, DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY, 1, 1000000);
  try {
    await ensureRatingTables(env.DB);
    const cached = await readCachedRating(env.DB, 'imdb', imdbId, cacheDays * 86400);
    if (cached) return cached;
    const reserved = await reserveProviderLookup(env.DB, 'omdb', dailyLimit);
    if (!reserved) return tmdbFallback(details, 'omdb-daily-limit');
  } catch {
    return tmdbFallback(details, 'rating-cache-error');
  }
  const response = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(env.OMDB_API_KEY)}&i=${encodeURIComponent(imdbId)}`, { headers: { accept: 'application/json' } });
  if (!response.ok) return tmdbFallback(details, `omdb-${response.status}`);
  const data = await response.json();
  const value = Number.parseFloat(data?.imdbRating);
  if (!Number.isFinite(value) || value <= 0) return tmdbFallback(details, 'omdb-missing');
  const formatted = value.toFixed(1);
  const label = `IMDb ${formatted}`;
  try { await writeCachedRating(env.DB, 'imdb', imdbId, formatted, label); } catch {}
  return { value: formatted, label, source: 'imdb', status: 'upstream' };
}

async function resolveRating(details, requestedSource, env) {
  const source = normalizeRatingSource(requestedSource);
  if (source === 'imdb') return imdbRating(details, env);
  if (source === 'tmdb' || source === 'score' || source === 'average') return tmdbRating(details, source);
  return { value: '', label: '', source, status: 'unsupported' };
}

function cacheRequestFor(request) {
  const incoming = new URL(request.url);
  const preview = incoming.searchParams.get('preview') === '1';
  const cacheUrl = new URL(`${incoming.origin}${incoming.pathname}`);
  const source = incoming.searchParams.get('source') === 'smart' ? 'smart' : 'tmdb';
  const provider = incoming.searchParams.get('provider') || 'tmdb';
  const tags = normalizeTags(incoming.searchParams.get('tags'));
  const ratingSource = normalizeRatingSource(incoming.searchParams.get('ratingSource'));
  const overlayColor = incoming.searchParams.get('overlayColor') || 'dynamic';

  cacheUrl.searchParams.set('source', source);
  cacheUrl.searchParams.set('provider', provider);
  cacheUrl.searchParams.set('tags', tags.join(','));
  cacheUrl.searchParams.set('ratingSource', ratingSource);
  cacheUrl.searchParams.set('overlayColor', overlayColor);
  cacheUrl.searchParams.set('__kollection_renderer', CACHE_VERSION);
  cacheUrl.searchParams.set('__kollection_scope', preview ? 'preview' : 'production');

  if (preview) {
    cacheUrl.searchParams.set('preview', '1');
    cacheUrl.searchParams.set('previewVersion', incoming.searchParams.get('previewVersion') || 'default');
  }

  return new Request(cacheUrl.toString(), request);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const type = parts[2] === 'tv' || parts[2] === 'series' ? 'tv' : 'movie';
  const rawId = String(parts[3] || '').replace(/\.webp$/i, '');
  if (!rawId) return json({ error: 'Expected /api/posters-v2/movie/27205.webp' }, 400);
  if (!env.TMDB_API_KEY) return json({ error: 'TMDB_API_KEY is not configured.' }, 503);
  if (!env.POSTERS_RENDERER_AUTH_TOKEN) return json({ error: 'POSTERS_RENDERER_AUTH_TOKEN is not configured.' }, 503);

  const preview = url.searchParams.get('preview') === '1';
  const cache = caches.default;
  const cacheRequest = cacheRequestFor(request);
  const cached = await cache.match(cacheRequest);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-kollection-cache', 'HIT');
    headers.set('x-kollection-cache-scope', preview ? 'preview' : 'production');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const slot = await acquirePosterRenderSlot(env, request);
  if (!slot.allowed) return json({ error: 'Poster render budget blocked this uncached render.', reason: slot.reason }, slot.reason === 'client-hourly-limit' ? 429 : 503);

  try {
    const id = await resolveTmdbId(type, rawId, env.TMDB_API_KEY);
    if (!id) return json({ error: 'Could not resolve TMDB/IMDb id.' }, 404);
    const append = type === 'movie' ? 'images,release_dates,external_ids' : 'images,content_ratings,external_ids';
    const details = await tmdbFetch(`/${type}/${id}?append_to_response=${append}&include_image_language=en,null`, env.TMDB_API_KEY);
    if (!details.poster_path) return json({ error: 'TMDB has no poster for this title.' }, 404);

    const tags = new Set(normalizeTags(url.searchParams.get('tags')));
    const smartLayout = url.searchParams.get('source') === 'smart';
    const artwork = choosePoster(details, smartLayout);
    const smartTextless = smartLayout && artwork.source === 'smart-textless';
    const logo = chooseLogo(details, smartTextless);
    if (!artwork.path) return json({ error: 'TMDB has no poster artwork for this title.' }, 404);

    const requestedRatingSource = normalizeRatingSource(url.searchParams.get('ratingSource'));
    const rating = tags.has('rating') ? await resolveRating(details, requestedRatingSource, env) : { value: '', label: '', source: requestedRatingSource, status: 'disabled' };
    const payload = {
      posterPath: artwork.path,
      logoPath: logo.path,
      title: smartTextless ? String(details.title || details.name || '').slice(0, 80) : '',
      rating: rating.value,
      ratingLabel: rating.label,
      genre: tags.has('genre') ? (details.genres?.[0]?.name || '') : '',
      age: tags.has('age') ? certification(details, type) : '',
      trend: tags.has('trend') ? await trendLabel(type, id, env.TMDB_API_KEY) : '',
      quality: '',
      smartLayout,
      overlayColor: url.searchParams.get('overlayColor') || 'dynamic',
    };

    const rendererBase = String(env.POSTERS_V2_RENDERER_URL || DEFAULT_RENDERER_URL).replace(/\/$/, '');
    const rendered = await fetch(`${rendererBase}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/webp', 'x-kollection-render-key': String(env.POSTERS_RENDERER_AUTH_TOKEN) },
      body: JSON.stringify(payload),
    });
    if (!rendered.ok) {
      const message = await rendered.text().catch(() => '');
      return json({ error: 'Sharp renderer failed.', status: rendered.status, detail: message.slice(0, 500) }, 502);
    }

    const headers = new Headers(rendered.headers);
    headers.set('content-type', 'image/webp');
    if (preview && tags.size === 0) {
      // Client-side configurator previews request artwork/logo/title only.
      // Those base renders are reusable across users and tag combinations, so cache them aggressively.
      headers.set('cache-control', 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000');
    } else if (preview) {
      headers.set('cache-control', payload.trend ? 'public, max-age=30, s-maxage=300' : 'public, max-age=60, s-maxage=600');
    } else if (payload.trend) {
      headers.set('cache-control', 'public, max-age=900, s-maxage=1800, stale-while-revalidate=21600');
    } else {
      headers.set('cache-control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    }
    headers.set('x-kollection-posters', 'v2-sharp');
    headers.set('x-kollection-render-version', CACHE_VERSION);
    headers.set('x-kollection-cache', 'MISS');
    headers.set('x-kollection-cache-scope', preview ? 'preview' : 'production');
    headers.set('x-kollection-rating-source', rating.source);
    headers.set('x-kollection-rating-status', rating.status);
    headers.set('x-kollection-artwork-source', artwork.source);
    headers.set('x-kollection-logo-source', logo.source);
    headers.set('x-kollection-tmdb-id', id);
    const response = new Response(rendered.body, { status: 200, headers });
    context.waitUntil(cache.put(cacheRequest, response.clone()));
    return response;
  } catch (error) {
    return json({ error: error?.message || 'Posters v2 failed.' }, 502);
  } finally {
    slot.release();
  }
}