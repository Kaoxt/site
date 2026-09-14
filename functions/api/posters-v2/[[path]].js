import { acquirePosterRenderSlot } from '../../_lib/poster-safety.js';
import { acquirePosterLease, cachedPosterJson, delay, singleFlight } from '../../_lib/poster-cache.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const DEFAULT_RENDERER_URL = 'https://poster-renderer.kollection.tv';
const CACHE_VERSION = 'production-cache-19';
// Delivery changes must not invalidate finished artwork in R2.
const DELIVERY_VERSION = 'cache-first-1';
const STALE_TREND_SECONDS = 172800;
const DEFAULT_OMDB_CACHE_DAYS = 30;
const DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY = 900;
const DEFAULT_MDBLIST_CACHE_DAYS = 30;
const ALLOWED_TAGS = ['trend', 'rating', 'genre', 'quality', 'age'];
const OVERLAY_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko'];

const TODAY_LABELS = {
  en: 'Today', es: 'Hoy', fr: "Aujourd’hui", de: 'Heute', it: 'Oggi', pt: 'Hoje', ja: '今日', ko: '오늘',
};

const GENRE_TRANSLATIONS = {
  es: { Action:'Acción', Adventure:'Aventura', Animation:'Animación', Comedy:'Comedia', Crime:'Crimen', Documentary:'Documental', Drama:'Drama', Family:'Familia', Fantasy:'Fantasía', History:'Historia', Horror:'Terror', Music:'Música', Mystery:'Misterio', Romance:'Romance', 'Science Fiction':'Ciencia ficción', 'TV Movie':'Película de TV', Thriller:'Suspenso', War:'Guerra', Western:'Western', 'Action & Adventure':'Acción y aventura', Kids:'Infantil', News:'Noticias', Reality:'Reality', 'Sci-Fi & Fantasy':'Ciencia ficción y fantasía', Soap:'Telenovela', Talk:'Talk show', 'War & Politics':'Guerra y política' },
  fr: { Action:'Action', Adventure:'Aventure', Animation:'Animation', Comedy:'Comédie', Crime:'Crime', Documentary:'Documentaire', Drama:'Drame', Family:'Familial', Fantasy:'Fantastique', History:'Histoire', Horror:'Horreur', Music:'Musique', Mystery:'Mystère', Romance:'Romance', 'Science Fiction':'Science-fiction', 'TV Movie':'Téléfilm', Thriller:'Thriller', War:'Guerre', Western:'Western', 'Action & Adventure':'Action et aventure', Kids:'Jeunesse', News:'Actualités', Reality:'Téléréalité', 'Sci-Fi & Fantasy':'Science-fiction et fantastique', Soap:'Feuilleton', Talk:'Talk-show', 'War & Politics':'Guerre et politique' },
  de: { Action:'Action', Adventure:'Abenteuer', Animation:'Animation', Comedy:'Komödie', Crime:'Krimi', Documentary:'Dokumentation', Drama:'Drama', Family:'Familie', Fantasy:'Fantasy', History:'Historie', Horror:'Horror', Music:'Musik', Mystery:'Mystery', Romance:'Romanze', 'Science Fiction':'Science-Fiction', 'TV Movie':'TV-Film', Thriller:'Thriller', War:'Krieg', Western:'Western', 'Action & Adventure':'Action & Abenteuer', Kids:'Kinder', News:'Nachrichten', Reality:'Reality', 'Sci-Fi & Fantasy':'Sci-Fi & Fantasy', Soap:'Soap', Talk:'Talk', 'War & Politics':'Krieg & Politik' },
  it: { Action:'Azione', Adventure:'Avventura', Animation:'Animazione', Comedy:'Commedia', Crime:'Crime', Documentary:'Documentario', Drama:'Dramma', Family:'Famiglia', Fantasy:'Fantasy', History:'Storia', Horror:'Horror', Music:'Musica', Mystery:'Mistero', Romance:'Romance', 'Science Fiction':'Fantascienza', 'TV Movie':'Film TV', Thriller:'Thriller', War:'Guerra', Western:'Western', 'Action & Adventure':'Azione e avventura', Kids:'Bambini', News:'Notizie', Reality:'Reality', 'Sci-Fi & Fantasy':'Sci-Fi e fantasy', Soap:'Soap', Talk:'Talk', 'War & Politics':'Guerra e politica' },
  pt: { Action:'Ação', Adventure:'Aventura', Animation:'Animação', Comedy:'Comédia', Crime:'Crime', Documentary:'Documentário', Drama:'Drama', Family:'Família', Fantasy:'Fantasia', History:'História', Horror:'Terror', Music:'Música', Mystery:'Mistério', Romance:'Romance', 'Science Fiction':'Ficção científica', 'TV Movie':'Filme de TV', Thriller:'Suspense', War:'Guerra', Western:'Faroeste', 'Action & Adventure':'Ação e aventura', Kids:'Infantil', News:'Notícias', Reality:'Reality', 'Sci-Fi & Fantasy':'Ficção científica e fantasia', Soap:'Novela', Talk:'Talk show', 'War & Politics':'Guerra e política' },
  ja: { Action:'アクション', Adventure:'アドベンチャー', Animation:'アニメーション', Comedy:'コメディ', Crime:'犯罪', Documentary:'ドキュメンタリー', Drama:'ドラマ', Family:'ファミリー', Fantasy:'ファンタジー', History:'歴史', Horror:'ホラー', Music:'音楽', Mystery:'ミステリー', Romance:'ロマンス', 'Science Fiction':'SF', 'TV Movie':'テレビ映画', Thriller:'スリラー', War:'戦争', Western:'西部劇', 'Action & Adventure':'アクション・アドベンチャー', Kids:'キッズ', News:'ニュース', Reality:'リアリティ', 'Sci-Fi & Fantasy':'SF・ファンタジー', Soap:'ソープ', Talk:'トーク', 'War & Politics':'戦争・政治' },
  ko: { Action:'액션', Adventure:'모험', Animation:'애니메이션', Comedy:'코미디', Crime:'범죄', Documentary:'다큐멘터리', Drama:'드라마', Family:'가족', Fantasy:'판타지', History:'역사', Horror:'공포', Music:'음악', Mystery:'미스터리', Romance:'로맨스', 'Science Fiction':'SF', 'TV Movie':'TV 영화', Thriller:'스릴러', War:'전쟁', Western:'서부', 'Action & Adventure':'액션 & 어드벤처', Kids:'키즈', News:'뉴스', Reality:'리얼리티', 'Sci-Fi & Fantasy':'SF & 판타지', Soap:'연속극', Talk:'토크', 'War & Politics':'전쟁 & 정치' },
};

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

function renderFailureCooldownMs(env) {
  return positiveInt(env?.POSTERS_FAILURE_COOLDOWN_SECONDS, 300, 30, 3600) * 1000;
}

function normalizeOverlayLanguage(value) {
  const language = String(value || 'en').toLowerCase().split('-')[0];
  return OVERLAY_LANGUAGES.includes(language) ? language : 'en';
}

function localizeGenre(name, language) {
  if (!name || language === 'en') return name || '';
  return GENRE_TRANSLATIONS[language]?.[name] || name;
}

async function tmdbFetch(path, key, context) {
  const loader = async () => {
    const joiner = path.includes('?') ? '&' : '?';
    const res = await fetch(`${TMDB_API}${path}${joiner}api_key=${encodeURIComponent(key)}`, {
      headers: { accept: 'application/json' },
      signal: context?.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
  };
  if (!context) return loader();
  const trending = path.startsWith('/trending/');
  const ttl = path.startsWith('/find/') ? 30 * 86400 : trending ? 1800 : 86400;
  // Including the day prevents yesterday's cached trend list being used as today's.
  return cachedPosterJson(context, `tmdb:${path}${trending ? ':' + todayUtc() : ''}`, ttl, loader);
}

async function resolveTmdbId(type, rawId, key, context) {
  if (/^\d+$/.test(rawId)) return rawId;
  if (!/^tt\d+$/i.test(rawId)) return null;
  const found = await tmdbFetch(`/find/${encodeURIComponent(rawId)}?external_source=imdb_id`, key, context);
  const list = type === 'tv' ? found.tv_results : found.movie_results;
  return list?.[0]?.id ? String(list[0].id) : null;
}


function theatricalLabel(details, type, region = 'US', now = new Date()) {
  if (type !== 'movie') return '';
  const dates = details.release_dates?.results?.find(item => item.iso_3166_1 === region)?.release_dates || [];
  const today = now.toISOString().slice(0, 10);
  const theatrical = dates.filter(item => [2, 3].includes(Number(item.type)))
    .map(item => String(item.release_date || '').slice(0, 10))
    .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  if (!theatrical.length) return '';
  const first = theatrical[0];
  if (first > today) {
    const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(first + 'T00:00:00Z'));
    return 'Coming ' + formatted;
  }
  const daysSince = (Date.parse(today) - Date.parse(first)) / 86400000;
  const homeReleased = dates.some(item => [4, 5, 6].includes(Number(item.type)) && String(item.release_date || '').slice(0, 10) <= today);
  // TMDB supplies release dates, not live cinema listings. Use a bounded theatrical window.
  return daysSince <= 45 && !homeReleased ? 'In Cinema' : '';
}

async function trendLabel(type, id, key, language = 'en', context) {
  const data = await tmdbFetch(`/trending/${type}/day?language=en-US&page=1`, key, context);
  const index = (data.results || []).findIndex((item) => String(item.id) === String(id));
  return index >= 0 ? `#${index + 1} ${TODAY_LABELS[language] || TODAY_LABELS.en}` : '';
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
  // Defaults apply only when the parameter is absent. An explicit empty
  // tags= value means the user intentionally disabled every Smart Tag.
  const raw = value == null ? 'trend,rating' : String(value);
  const requested = new Set(raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  return ALLOWED_TAGS.filter((tag) => requested.has(tag));
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.toString().length > 1800) return '';
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '0.0.0.0' ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function posterCacheBucket(env) {
  return env?.POSTER_CACHE || env?.IMAGES || null;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function posterVariant(url, preview) {
  return {
    version: CACHE_VERSION,
    scope: preview ? 'preview' : 'production',
    source: url.searchParams.get('source') === 'smart' ? 'smart' : 'tmdb',
    provider: url.searchParams.get('provider') || 'tmdb',
    tags: normalizeTags(url.searchParams.get('tags')),
    ratingSource: normalizeRatingSource(url.searchParams.get('ratingSource')),
    language: normalizeOverlayLanguage(url.searchParams.get('language')),
    overlayColor: url.searchParams.get('overlayColor') || 'dynamic',
    sourceUrl: normalizeSourceUrl(url.searchParams.get('sourceUrl')),
    overlayOnly: url.searchParams.get('overlayOnly') === '1',
  };
}

async function persistentPosterKey(type, id, url, preview) {
  const variant = posterVariant(url, preview);
  const hash = await sha256Hex(JSON.stringify(variant));
  return `poster-cache/${variant.scope}/${type}/${id}/${hash}.webp`;
}

function posterCacheControl(preview, tags, hasTrendValue = false) {
  const tagSet = tags instanceof Set ? tags : new Set(tags || []);
  if (preview && tagSet.size === 0) {
    return 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000';
  }
  if (preview) {
    return hasTrendValue || tagSet.has('trend')
      ? 'public, max-age=30, s-maxage=300'
      : 'public, max-age=60, s-maxage=600';
  }
  if (hasTrendValue || tagSet.has('trend')) {
    return 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400';
  }
  return 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000';
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function readPersistentPoster(env, key) {
  const bucket = posterCacheBucket(env);
  if (!bucket) return null;

  try {
    const object = await bucket.get(key);
    if (!object) return null;

    return object;
  } catch {
    return null;
  }
}

async function writePersistentPoster(env, key, bytes, cacheControl, tags, metadata = {}) {
  const bucket = posterCacheBucket(env);
  if (!bucket) return false;

  const tagSet = tags instanceof Set ? tags : new Set(tags || []);
  try {
    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl,
      },
      customMetadata: {
        rendererVersion: CACHE_VERSION,
        trendDay: tagSet.has('trend') ? todayUtc() : '',
        generatedAt: String(Date.now()),
        ...metadata,
      },
    });
    return true;
  } catch {
    return false;
  }
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

const ratingSchemas = new WeakMap();
async function ensureRatingTables(db) {
  if (ratingSchemas.has(db)) return ratingSchemas.get(db);
  const setup = db.batch([
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
  ]).catch(error => { ratingSchemas.delete(db); throw error; });
  ratingSchemas.set(db, setup);
  return setup;
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

const MDBLIST_RATING_SOURCES = new Set(['average', 'score', 'imdb', 'letterboxd', 'mal', 'rogerebert', 'tomatometer', 'popcornmeter']);

async function readMdblistRecord(db, itemId, maxAgeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  const row = await db.prepare(`
    SELECT value FROM poster_rating_cache
    WHERE provider = 'mdblist-record' AND item_id = ?1 AND updated_at >= ?2
  `).bind(itemId, cutoff).first();
  if (!row?.value) return null;
  try { return JSON.parse(String(row.value)); } catch { return null; }
}

async function writeMdblistRecord(db, itemId, data) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO poster_rating_cache (provider, item_id, value, label, updated_at)
    VALUES ('mdblist-record', ?1, ?2, '', ?3)
    ON CONFLICT(provider, item_id) DO UPDATE SET
      value = excluded.value,
      label = excluded.label,
      updated_at = excluded.updated_at
  `).bind(itemId, JSON.stringify(data), now).run();
}

function formatMdblistRating(record, source, status = 'cache-hit') {
  const ratings = Array.isArray(record?.ratings) ? record.ratings : [];
  const aliases = {
    imdb: ['imdb'], letterboxd: ['letterboxd'], mal: ['myanimelist', 'mal'],
    rogerebert: ['rogerebert'], tomatometer: ['tomatoes'], popcornmeter: ['audience'],
  };
  let value;
  if (source === 'average' || source === 'score') {
    const raw = Number(source === 'average' ? record?.score_average : record?.score);
    if (Number.isFinite(raw) && raw > 0) value = raw / 10;
  } else {
    const rating = ratings.find(item => aliases[source]?.includes(String(item?.source || '').toLowerCase()));
    if (source === 'tomatometer' || source === 'popcornmeter') {
      const raw = Number(rating?.value ?? rating?.score);
      if (Number.isFinite(raw) && raw > 0) {
        const formatted = Math.round(raw) + '%';
        return { value: formatted, label: formatted, source, status };
      }
    } else if (source === 'letterboxd') {
      const score = Number(rating?.score);
      const raw = Number(rating?.value);
      if (Number.isFinite(score) && score > 0) value = score / 10;
      else if (Number.isFinite(raw) && raw > 0) value = raw > 5 ? raw / 2 : raw;
    } else {
      const raw = Number(rating?.value);
      if (Number.isFinite(raw) && raw > 0) value = raw;
    }
  }
  if (!Number.isFinite(value) || value <= 0) return { value: '', label: '', source, status: 'missing' };
  const formatted = value.toFixed(1);
  return { value: formatted, label: formatted, source, status };
}

async function mdblistRating(details, type, source, env, context) {
  if (!env.MDBLIST_API_KEY) {
    if (source === 'imdb') return imdbRating(details, env, context);
    return { value: '', label: '', source, status: 'not-configured' };
  }
  if (!env.DB) return { value: '', label: '', source, status: 'rating-cache-unavailable' };
  const result = await singleFlight(env, `mdblist:${type}:${details.id}`,
    () => loadMdblistRecord(details, type, env, context));
  return result.record ? formatMdblistRating(result.record, source, result.status)
    : { value: '', label: '', source, status: result.status };
}

async function loadMdblistRecord(details, type, env, context) {
  const itemId = `${type}:${details.id}`;
  const cacheDays = positiveInt(env.MDBLIST_RATING_CACHE_DAYS, DEFAULT_MDBLIST_CACHE_DAYS, 1, 365);
  const configuredLimit = Number.parseInt(String(env.MDBLIST_MAX_LOOKUPS_PER_DAY || ''), 10);
  try {
    await ensureRatingTables(env.DB);
    const cached = await readMdblistRecord(env.DB, itemId, cacheDays * 86400);
    if (cached) return { record: cached, status: 'cache-hit' };
    if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
      const reserved = await reserveProviderLookup(env.DB, 'mdblist', configuredLimit);
      if (!reserved) return { status: 'mdblist-daily-limit' };
    }
  } catch {
    return { status: 'rating-cache-error' };
  }
  const mediaType = type === 'tv' ? 'show' : 'movie';
  let response;
  try {
    response = await fetch(`https://api.mdblist.com/tmdb/${mediaType}/${encodeURIComponent(details.id)}?apikey=${encodeURIComponent(env.MDBLIST_API_KEY)}`, {
      headers: { accept: 'application/json' },
      signal: context?.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
  } catch {
    return { status: 'mdblist-network-error' };
  }
  if (!response.ok) return { status: `mdblist-${response.status}` };
  const record = await response.json();
  try { await writeMdblistRecord(env.DB, itemId, record); } catch {}
  return { record, status: 'upstream' };
}

async function imdbRating(details, env, context) {
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
  const response = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(env.OMDB_API_KEY)}&i=${encodeURIComponent(imdbId)}`, {
    headers: { accept: 'application/json' },
    signal: context?.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
  });
  if (!response.ok) return tmdbFallback(details, `omdb-${response.status}`);
  const data = await response.json();
  const value = Number.parseFloat(data?.imdbRating);
  if (!Number.isFinite(value) || value <= 0) return tmdbFallback(details, 'omdb-missing');
  const formatted = value.toFixed(1);
  const label = `IMDb ${formatted}`;
  try { await writeCachedRating(env.DB, 'imdb', imdbId, formatted, label); } catch {}
  return { value: formatted, label, source: 'imdb', status: 'upstream' };
}

async function resolveRating(details, type, requestedSource, env, context) {
  const source = normalizeRatingSource(requestedSource);
  if (source === 'tmdb') return tmdbRating(details, source);
  if (MDBLIST_RATING_SOURCES.has(source)) return mdblistRating(details, type, source, env, context);
  return { value: '', label: '', source, status: 'unsupported' };
}

function aiostreamsQualityConfig(env) {
  const rawUrl = String(env?.POSTERS_AIOSTREAMS_URL || env?.AIOSTREAMS_URL || '').trim();
  const rawAuth = String(env?.POSTERS_AIOSTREAMS_AUTH || env?.AIOSTREAMS_AUTH || '').trim();
  if (!rawUrl || !rawAuth) return null;
  try {
    const url = new URL(rawUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return {
      baseUrl: url.toString().replace(/\/$/, ''),
      authorization: /^Basic\s+/i.test(rawAuth) ? rawAuth : `Basic ${rawAuth}`,
    };
  } catch {
    return null;
  }
}

function qualityCacheSeconds(details) {
  const date = String(details?.release_date || details?.first_air_date || '');
  const releasedAt = Date.parse(date);
  const recent = Number.isFinite(releasedAt) && Date.now() - releasedAt < 14 * 86400000;
  return recent ? 86400 : 30 * 86400;
}

function qualityFromAiostreamsResults(results) {
  let hd = false;
  for (const result of Array.isArray(results) ? results.slice(0, 5) : []) {
    const parsed = result?.parsedFile || {};
    const resolution = String(parsed.resolution || '').toLowerCase();
    const searchable = [
      resolution,
      result?.name,
      result?.title,
      result?.description,
      result?.behaviorHints?.filename,
      result?.behaviorHints?.bingeGroup,
    ].filter(Boolean).join(' ').toUpperCase();

    if (/\b(2160P|4K|UHD)\b/.test(searchable)) return '4K';
    if (/\b1080P\b/.test(searchable)) hd = true;
  }
  return hd ? 'HD' : '';
}

async function resolveQuality(details, type, env, context) {
  const imdbId = String(details?.external_ids?.imdb_id || '');
  if (!imdbId) return { value: '', source: 'aiostreams', status: 'missing-id' };

  const config = aiostreamsQualityConfig(env);
  if (!config) return { value: '', source: 'aiostreams', status: 'not-configured' };
  if (!env.DB) return { value: '', source: 'aiostreams', status: 'quality-cache-unavailable' };

  const provider = 'quality-aiostreams';
  const maxAgeSeconds = qualityCacheSeconds(details);
  try {
    await ensureRatingTables(env.DB);
    const cached = await readCachedRating(env.DB, provider, imdbId, maxAgeSeconds);
    if (cached) return { value: cached.value, source: 'aiostreams', status: 'cache-hit' };
  } catch {
    return { value: '', source: 'aiostreams', status: 'quality-cache-error' };
  }

  const aioType = type === 'tv' ? 'series' : 'movie';
  const aioId = type === 'tv' ? `${imdbId}:1:1` : imdbId;
  let response;
  try {
    const endpoint = new URL(config.baseUrl + '/api/v1/search');
    endpoint.searchParams.set('type', aioType);
    endpoint.searchParams.set('id', aioId);
    response = await fetch(endpoint.toString(), {
      headers: { accept: 'application/json', authorization: config.authorization },
      signal: context?.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
  } catch {
    return { value: '', source: 'aiostreams', status: 'aiostreams-network-error' };
  }

  if (!response.ok) return { value: '', source: 'aiostreams', status: `aiostreams-${response.status}` };

  let payload;
  try { payload = await response.json(); }
  catch { return { value: '', source: 'aiostreams', status: 'aiostreams-invalid-json' }; }

  if (!payload?.success) return { value: '', source: 'aiostreams', status: 'aiostreams-error' };
  const results = payload?.data?.results || [];
  const errors = payload?.data?.errors || {};
  if (!results.length && errors && Object.keys(errors).length) {
    return { value: '', source: 'aiostreams', status: 'aiostreams-provider-error' };
  }

  const value = qualityFromAiostreamsResults(results);
  try { await writeCachedRating(env.DB, provider, imdbId, value, value); } catch {}
  return { value, source: 'aiostreams', status: results.length ? 'upstream' : 'upstream-empty' };
}

function cacheRequestFor(request) {
  const incoming = new URL(request.url);
  const preview = incoming.searchParams.get('preview') === '1';
  const cacheUrl = new URL(`${incoming.origin}${incoming.pathname}`);
  const source = incoming.searchParams.get('source') === 'smart' ? 'smart' : 'tmdb';
  const provider = incoming.searchParams.get('provider') || 'tmdb';
  const tags = normalizeTags(incoming.searchParams.get('tags'));
  const ratingSource = normalizeRatingSource(incoming.searchParams.get('ratingSource'));
  const language = normalizeOverlayLanguage(incoming.searchParams.get('language'));
  const overlayColor = incoming.searchParams.get('overlayColor') || 'dynamic';
  const sourceUrl = normalizeSourceUrl(incoming.searchParams.get('sourceUrl'));
  const overlayOnly = incoming.searchParams.get('overlayOnly') === '1';

  cacheUrl.searchParams.set('source', source);
  cacheUrl.searchParams.set('provider', provider);
  cacheUrl.searchParams.set('tags', tags.join(','));
  cacheUrl.searchParams.set('ratingSource', ratingSource);
  cacheUrl.searchParams.set('language', language);
  cacheUrl.searchParams.set('overlayColor', overlayColor);
  if (sourceUrl) cacheUrl.searchParams.set('sourceUrl', sourceUrl);
  if (overlayOnly) cacheUrl.searchParams.set('overlayOnly', '1');
  cacheUrl.searchParams.set('__kollection_renderer', CACHE_VERSION);
  cacheUrl.searchParams.set('__kollection_delivery', DELIVERY_VERSION);
  cacheUrl.searchParams.set('__kollection_scope', preview ? 'preview' : 'production');

  if (preview) {
    cacheUrl.searchParams.set('preview', '1');
    cacheUrl.searchParams.set('previewVersion', incoming.searchParams.get('previewVersion') || 'default');
  }

  // HEAD and GET share image storage; client cookies and headers don't fragment it.
  return new Request(cacheUrl.toString());
}


async function originalPosterFallback(context, state, reason) {
  const { env } = context;
  try {
    const id = state.idHint || await resolveTmdbId(state.type, state.rawId, env.TMDB_API_KEY, context);
    const metadata = id ? await tmdbFetch('/' + state.type + '/' + id, env.TMDB_API_KEY, context) : null;
    const source = state.sourceUrl || (metadata?.poster_path ? 'https://image.tmdb.org/t/p/w500' + metadata.poster_path : '');
    if (source) {
      const artwork = await fetch(source, {
        headers: { accept: 'image/webp,image/jpeg,image/*' },
        signal: AbortSignal.timeout(4000),
      });
      if (artwork.ok && artwork.body && artwork.headers.get('content-type')?.startsWith('image/')) {
        return new Response(artwork.body, {
          status: 200,
          headers: {
            'content-type': artwork.headers.get('content-type') || 'image/jpeg',
            'access-control-allow-origin': '*',
            // Never store a temporary plain poster as a successful overlay.
            'cache-control': 'no-store',
            'cdn-cache-control': 'no-store',
            'retry-after': '30',
            'x-kollection-poster-fallback': reason,
          },
        });
      }
    }
  } catch {}
  return json({ error: 'Poster artwork is temporarily unavailable.', reason }, 503);
}

async function renderPoster(context, state, id, persistentKey) {
  const { request, env } = context;
  const { url, type, preview, tags, sourceUrl, overlayOnly, overlayLanguage } = state;

  const append = type === 'movie' ? 'images,release_dates,external_ids' : 'images,content_ratings,external_ids';
  const details = await tmdbFetch(`/${type}/${id}?append_to_response=${append}&include_image_language=en,null&language=en-US`, env.TMDB_API_KEY, context);
  if (!details.poster_path && !sourceUrl) throw posterError('artwork-missing');
  const smartLayout = url.searchParams.get('source') === 'smart';
  const artwork = sourceUrl ? { path: '', source: 'upstream-addon' } : choosePoster(details, smartLayout);
  const smartTextless = !overlayOnly && smartLayout && artwork.source === 'smart-textless';
  const logo = chooseLogo(details, smartTextless);
  if (!artwork.path && !sourceUrl) throw posterError('artwork-missing');

  const requestedRatingSource = normalizeRatingSource(url.searchParams.get('ratingSource'));
  const [rating, resolvedTrend, quality] = await Promise.all([
    tags.has('rating')
      ? resolveRating(details, type, requestedRatingSource, env, context)
      : Promise.resolve({ value: '', label: '', source: requestedRatingSource, status: 'disabled' }),
    tags.has('trend')
      ? Promise.resolve(theatricalLabel(details, type, String(env.POSTERS_RELEASE_REGION || 'US').toUpperCase()))
          .then((label) => label || trendLabel(type, id, env.TMDB_API_KEY, overlayLanguage, context))
      : Promise.resolve(''),
    tags.has('quality')
      ? resolveQuality(details, type, env, context)
      : Promise.resolve({ value: '', source: 'aiostreams', status: 'disabled' }),
  ]);
  if (!['ok', 'upstream', 'cache-hit', 'missing', 'disabled', 'not-configured'].includes(rating.status)) {
    // A ratings-provider outage must not replace a good cached overlay with one
    // missing its rating for the entire cache lifetime.
    throw posterError('rating-unavailable');
  }
  if (!['upstream', 'upstream-empty', 'cache-hit', 'missing-id', 'disabled', 'not-configured'].includes(quality.status)) {
    // Don't cache a long-lived poster with a missing quality badge because the
    // configured quality source happened to be unavailable during this request.
    throw posterError('quality-unavailable');
  }

  const payload = {
    posterPath: artwork.path,
    sourceUrl,
    overlayOnly: Boolean(overlayOnly),
    logoPath: overlayOnly ? '' : logo.path,
    title: smartTextless ? String(details.title || details.name || '').slice(0, 80) : '',
    rating: rating.value,
    ratingLabel: rating.label,
    genre: tags.has('genre') ? localizeGenre(details.genres?.[0]?.name || '', overlayLanguage) : '',
    age: tags.has('age') ? certification(details, type) : '',
    trend: resolvedTrend,
    quality: quality.value,
    smartLayout,
    overlayColor: url.searchParams.get('overlayColor') || 'dynamic',
  };

  // Reserve quota and renderer concurrency only after metadata/rating work has
  // succeeded. Provider failures must not consume a render reservation.
  const slot = await acquirePosterRenderSlot(env, request, { signal: context.signal });
  if (!slot.allowed) throw posterError(slot.reason);

  try {
    const rendererBase = String(env.POSTERS_V2_RENDERER_URL || DEFAULT_RENDERER_URL).replace(/\/$/, '');
    const rendered = await fetch(`${rendererBase}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/webp', 'x-kollection-render-key': String(env.POSTERS_RENDERER_AUTH_TOKEN) },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(10000)]),
    });
    if (!rendered.ok) {
      await rendered.body?.cancel();
      throw posterError('renderer-' + rendered.status);
    }

    const output = await rendered.arrayBuffer();
    const signature = new Uint8Array(output, 0, Math.min(12, output.byteLength));
    if (String.fromCharCode(...signature.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...signature.slice(8, 12)) !== 'WEBP') {
      throw posterError('renderer-invalid-image');
    }
    const cacheControl = posterCacheControl(preview, tags, Boolean(payload.trend));
    const headers = new Headers(rendered.headers);
    headers.set('content-type', 'image/webp');
    headers.set('access-control-allow-origin', '*');
    headers.set('cdn-cache-control', cacheControl);
    headers.set('cache-control', cacheControl);
    headers.set('x-kollection-posters', 'v2-sharp');
    headers.set('x-kollection-render-version', CACHE_VERSION);
    headers.set('x-kollection-cache', 'MISS');
    headers.set('x-kollection-persistent-cache', 'MISS');
    headers.set('x-kollection-cache-scope', preview ? 'preview' : 'production');
    headers.set('x-kollection-rating-source', rating.source);
    headers.set('x-kollection-rating-status', rating.status);
    headers.set('x-kollection-quality-source', quality.source);
    headers.set('x-kollection-quality-status', quality.status);
    headers.set('x-kollection-artwork-source', artwork.source);
    headers.set('x-kollection-logo-source', logo.source);
    headers.set('x-kollection-tmdb-id', id);
    headers.set('x-kollection-overlay-language', overlayLanguage);
    headers.set('x-kollection-generated-at', String(Date.now()));
    headers.set('x-kollection-fresh-until', String(freshUntil(Date.now(), state)));
    const result = { body: output, headers: [...headers], status: 200 };
    // Finish the shared-storage write before releasing the cross-Worker lease.
    result.persisted = await saveResult(context, state, persistentKey, result);
    return result;
  } finally {
    slot.release();
  }
}

function posterError(code) {
  return Object.assign(new Error(code), { code });
}

function freshUntil(generatedAt, state, trendDay = '') {
  const ttl = state.preview ? (state.tags.size === 0 ? 3600 : state.tags.has('trend') ? 300 : 600)
    : state.tags.has('trend') ? 21600 : 604800;
  let expires = generatedAt + ttl * 1000;
  if (state.tags.has('trend')) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(trendDay) ? trendDay : new Date(generatedAt).toISOString().slice(0, 10);
    expires = Math.min(expires, Date.parse(day + 'T00:00:00Z') + 86400000);
  }
  return expires;
}

function staleSeconds(state) {
  return state.preview ? 3600 : state.tags.has('trend') ? STALE_TREND_SECONDS : 30 * 86400;
}

function usable(response, state) {
  const expires = Number(response?.headers.get('x-kollection-fresh-until'));
  return response?.ok && expires > 0 && Date.now() < expires + staleSeconds(state) * 1000;
}

function isFresh(response) {
  return Number(response?.headers.get('x-kollection-fresh-until')) > Date.now();
}

function fromResult(result) {
  return new Response(result.body, { status: result.status, headers: result.headers });
}

async function toResult(response) {
  return { body: await response.arrayBuffer(), status: response.status, headers: [...response.headers] };
}

function persistentResponse(object, state) {
  if (!object) return null;
  const metadata = object.customMetadata || {};
  const uploaded = object.uploaded ? new Date(object.uploaded).getTime() : 0;
  const generated = Number(metadata.generatedAt) || uploaded || Date.parse((metadata.trendDay || '1970-01-01') + 'T00:00:00Z');
  if (!Number.isFinite(generated)) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', 'image/webp');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  headers.set('x-kollection-generated-at', String(generated));
  headers.set('x-kollection-fresh-until', String(Number(metadata.freshUntil) || freshUntil(generated, state, metadata.trendDay)));
  headers.set('x-kollection-render-version', CACHE_VERSION);
  headers.set('x-kollection-cache', 'MISS');
  headers.set('x-kollection-persistent-cache', 'HIT');
  headers.set('x-kollection-overlay-language', state.overlayLanguage);
  if (metadata.tmdbId) headers.set('x-kollection-tmdb-id', metadata.tmdbId);
  if (metadata.renderer) headers.set('x-kollection-renderer', metadata.renderer);
  if (metadata.ratingStatus) headers.set('x-kollection-rating-status', metadata.ratingStatus);
  if (metadata.qualitySource) headers.set('x-kollection-quality-source', metadata.qualitySource);
  if (metadata.qualityStatus) headers.set('x-kollection-quality-status', metadata.qualityStatus);
  return new Response(object.body, { headers });
}

async function loadSaved(context, state, key) {
  const response = persistentResponse(await readPersistentPoster(context.env, key), state);
  if (usable(response, state)) return response;
  await response?.body?.cancel();
  return null;
}

async function saveResult(context, state, key, result) {
  const headers = new Headers(result.headers);
  return writePersistentPoster(context.env, key, result.body, headers.get('cache-control') || posterCacheControl(state.preview, state.tags), state.tags, {
    generatedAt: headers.get('x-kollection-generated-at') || String(Date.now()),
    freshUntil: headers.get('x-kollection-fresh-until') || '',
    tmdbId: headers.get('x-kollection-tmdb-id') || state.idHint || '',
    renderer: headers.get('x-kollection-renderer') || '',
    ratingStatus: headers.get('x-kollection-rating-status') || '',
    qualitySource: headers.get('x-kollection-quality-source') || '',
    qualityStatus: headers.get('x-kollection-quality-status') || '',
    // Copying an alias must preserve the original date, not make old tags fresh.
    trendDay: state.tags.has('trend') ? new Date(Number(headers.get('x-kollection-generated-at'))).toISOString().slice(0, 10) : '',
  });
}

async function putEdge(state, response) {
  const headers = new Headers(response.headers);
  const expiry = Number(headers.get('x-kollection-fresh-until'));
  const retention = Math.max(1, Math.floor((expiry - Date.now()) / 1000) + staleSeconds(state));
  // Cache API ignores stale-while-revalidate: retain the body longer internally
  // and enforce freshness ourselves. These headers are never sent to clients.
  headers.set('cache-control', `public, max-age=${retention}`);
  headers.delete('cdn-cache-control');
  headers.delete('age');
  await caches.default.put(state.cacheRequest, new Response(response.body, { headers }));
}

function deliveryResponse(response, state) {
  const headers = new Headers(response.headers);
  const remaining = Math.max(0, Math.floor((Number(headers.get('x-kollection-fresh-until')) - Date.now()) / 1000));
  const stale = remaining === 0;
  const browserAge = stale ? 15 : Math.min(remaining, state.preview ? 60 : state.tags.has('trend') ? 21600 : 86400);
  const cacheControl = stale
    ? 'public, max-age=15, s-maxage=15, stale-while-revalidate=30'
    : `public, max-age=${browserAge}, s-maxage=${remaining}, stale-while-revalidate=60`;
  headers.set('cache-control', cacheControl);
  headers.set('cdn-cache-control', cacheControl);
  headers.set('access-control-allow-origin', '*');
  headers.set('x-kollection-stale', stale ? '1' : '0');
  headers.set('x-kollection-cache-scope', state.preview ? 'preview' : 'production');
  headers.delete('age');
  return new Response(response.body, { status: response.status, headers });
}

async function renderUnderLease(context, state, id, key, background) {
  const alreadySaved = await loadSaved(context, state, key);
  if (isFresh(alreadySaved)) return toResult(alreadySaved);
  await alreadySaved?.body?.cancel();
  const lease = await acquirePosterLease(context.env, key);
  if (!lease.acquired) {
    if (background) return null; // Another request is already refreshing the saved overlay.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await delay(400, context.signal);
      const ready = await loadSaved(context, state, key);
      if (isFresh(ready)) return toResult(ready);
      await ready?.body?.cancel();
    }
    throw posterError('render-in-progress');
  }
  let success = false;
  try {
    // Close the race between the cache read and acquiring the distributed lease.
    const ready = await loadSaved(context, state, key);
    if (isFresh(ready)) { success = true; return await toResult(ready); }
    await ready?.body?.cancel();
    const result = await renderPoster(context, state, id, key);
    success = result.persisted !== false;
    return result;
  } finally {
    // Cool down failures so every catalog scroll doesn't retry an unavailable provider.
    await lease.release(success ? 0 : renderFailureCooldownMs(context.env)).catch(() => {});
  }
}

async function refreshPoster(context, state, background = false) {
  return singleFlight(context.env, `poster-request:${state.rawKey}`, async () => {
    if (!context.env.TMDB_API_KEY || !context.env.POSTERS_RENDERER_AUTH_TOKEN) throw posterError('renderer-not-configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(posterError('render-timeout')), 25000);
    const workContext = { ...context, signal: controller.signal, waitUntil: promise => context.waitUntil(promise) };
    try {
      const id = state.idHint || await resolveTmdbId(state.type, state.rawId, context.env.TMDB_API_KEY, workContext);
      if (!id) throw posterError('id-not-found');
      state.idHint = id;
      const key = await persistentPosterKey(state.type, id, state.url, state.preview);
      state.canonicalKey = key;
      const result = await singleFlight(context.env, `poster-render:${key}`,
        () => renderUnderLease(workContext, state, id, key, background));
      if (!result) return null;
      // Save an IMDb-addressed copy too: subsequent R2 hits need zero ID lookups.
      // The canonical TMDB key still shares work across both supported ID formats.
      await Promise.allSettled([
        putEdge(state, fromResult(result)),
        ...(state.rawKey !== key ? [saveResult(context, state, state.rawKey, result)] : []),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  });
}

function serveSaved(context, state, saved, edgeHit = false) {
  const tmdbId = saved.headers.get('x-kollection-tmdb-id');
  if (/^\d+$/.test(tmdbId || '')) state.idHint = tmdbId;
  if (edgeHit) {
    saved.headers.set('x-kollection-cache', 'HIT');
    saved.headers.set('x-kollection-persistent-cache', 'BYPASS');
  }
  const stale = !isFresh(saved);
  const bodyForCache = edgeHit ? null : saved.clone();
  const alias = !edgeHit && state.canonicalKey && state.canonicalKey !== state.rawKey ? saved.clone() : null;
  context.waitUntil((async () => {
    // Write the old edge entry first, so it can never overwrite a completed refresh.
    if (bodyForCache) await putEdge(state, bodyForCache).catch(() => {});
    if (alias) await saveResult(context, state, state.rawKey, await toResult(alias)).catch(() => {});
    if (stale) await refreshPoster(context, state, true);
  })().catch(() => { /* Keep the last successful overlay on refresh failure. */ }));
  return deliveryResponse(saved, state);
}

async function handlePoster(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  } });
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const type = ['tv', 'series'].includes(parts[2]) ? 'tv' : parts[2] === 'movie' ? 'movie' : '';
  const rawId = String(parts[3] || '').replace(/\.(webp|jpe?g)$/i, '').toLowerCase();
  if (!type || parts.length !== 4 || !/^(tt\d{5,12}|[1-9]\d{0,11})$/.test(rawId)) {
    return json({ error: 'Expected /api/posters-v2/{movie|series}/{tmdb_id|imdb_id}.webp' }, 400);
  }
  const sourceUrl = normalizeSourceUrl(url.searchParams.get('sourceUrl'));
  const state = {
    url, type, rawId, sourceUrl,
    preview: url.searchParams.get('preview') === '1',
    tags: new Set(normalizeTags(url.searchParams.get('tags'))),
    overlayOnly: Boolean(sourceUrl && url.searchParams.get('overlayOnly') === '1'),
    overlayLanguage: normalizeOverlayLanguage(url.searchParams.get('language')),
    cacheRequest: cacheRequestFor(request),
    idHint: /^\d+$/.test(rawId) ? rawId : '',
  };
  try {
    const edge = await caches.default.match(state.cacheRequest);
    if (usable(edge, state)) {
      state.rawKey = await persistentPosterKey(type, rawId, url, state.preview);
      return serveSaved(context, state, new Response(edge.body, { headers: edge.headers }), true);
    }
    await edge?.body?.cancel();
  } catch { /* Fall through to persistent storage if edge caching is unavailable. */ }

  state.rawKey = await persistentPosterKey(type, rawId, url, state.preview);
  // This check deliberately happens BEFORE credentials, TMDB, MDBList, or the renderer.
  const saved = await loadSaved(context, state, state.rawKey);
  if (saved) return serveSaved(context, state, saved);
  try {
    // Reuse pre-upgrade TMDB-keyed images too; metadata caching makes the one-time
    // IMDb alias migration cheap, and its stale poster can be returned immediately.
    if (!state.idHint && env.TMDB_API_KEY) {
      state.idHint = await resolveTmdbId(type, rawId, env.TMDB_API_KEY, context);
      if (state.idHint) {
        state.canonicalKey = await persistentPosterKey(type, state.idHint, url, state.preview);
        const legacy = await loadSaved(context, state, state.canonicalKey);
        if (legacy) return serveSaved(context, state, legacy);
      }
    }
    const result = await refreshPoster(context, state);
    if (result) return deliveryResponse(fromResult(result), state);
    throw posterError('render-in-progress');
  } catch (error) {
    // An overlapping refresh might have completed, or a canonical legacy poster
    // might still be usable. Always prefer that overlay to a plain-art fallback.
    for (const key of new Set([state.rawKey, state.canonicalKey].filter(Boolean))) {
      const lastGood = await loadSaved(context, state, key);
      if (lastGood) return deliveryResponse(lastGood, state);
    }
    if (!env.TMDB_API_KEY) return json({ error: 'Poster service is temporarily unavailable.' }, 503);
    return originalPosterFallback(context, state, error.code || 'render-error');
  }
}

export async function onRequest(context) {
  const started = Date.now();
  let response;
  try { response = await handlePoster(context); }
  catch { response = json({ error: 'Poster service is temporarily unavailable.' }, 503); }
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('x-kollection-delivery', DELIVERY_VERSION);
  headers.set('server-timing', `poster;dur=${Date.now() - started};desc="Poster handler"`);
  if (context.request.method === 'HEAD') await response.body?.cancel();
  return new Response(context.request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}
