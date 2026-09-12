import { acquirePosterRenderSlot } from '../../_lib/poster-safety.js';

const TMDB_API = 'https://api.themoviedb.org/3';
const DEFAULT_RENDERER_URL = 'https://poster-renderer.kollection.tv';
const CACHE_VERSION = 'production-cache-9';
const DEFAULT_OMDB_CACHE_DAYS = 30;
const DEFAULT_OMDB_MAX_LOOKUPS_PER_DAY = 900;
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

function normalizeOverlayLanguage(value) {
  const language = String(value || 'en').toLowerCase().split('-')[0];
  return OVERLAY_LANGUAGES.includes(language) ? language : 'en';
}

function localizeGenre(name, language) {
  if (!name || language === 'en') return name || '';
  return GENRE_TRANSLATIONS[language]?.[name] || name;
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

async function trendLabel(type, id, key, language = 'en') {
  const data = await tmdbFetch(`/trending/${type}/day?language=en-US&page=1`, key);
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
  const requested = new Set(String(value || 'trend,rating').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  return ALLOWED_TAGS.filter((tag) => requested.has(tag));
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
    return 'public, max-age=900, s-maxage=1800, stale-while-revalidate=21600';
  }
  return 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000';
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function readPersistentPoster(env, key, tags) {
  const bucket = posterCacheBucket(env);
  if (!bucket) return null;

  try {
    const object = await bucket.get(key);
    if (!object) return null;

    const tagSet = tags instanceof Set ? tags : new Set(tags || []);
    if (tagSet.has('trend')) {
      const storedDay = String(object.customMetadata?.trendDay || '');
      if (storedDay !== todayUtc()) return null;
    }

    return object;
  } catch {
    return null;
  }
}

async function writePersistentPoster(env, key, bytes, cacheControl, tags) {
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
  const language = normalizeOverlayLanguage(incoming.searchParams.get('language'));
  const overlayColor = incoming.searchParams.get('overlayColor') || 'dynamic';

  cacheUrl.searchParams.set('source', source);
  cacheUrl.searchParams.set('provider', provider);
  cacheUrl.searchParams.set('tags', tags.join(','));
  cacheUrl.searchParams.set('ratingSource', ratingSource);
  cacheUrl.searchParams.set('language', language);
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
    headers.set('x-kollection-persistent-cache', 'BYPASS');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const id = await resolveTmdbId(type, rawId, env.TMDB_API_KEY);
  if (!id) return json({ error: 'Could not resolve TMDB/IMDb id.' }, 404);

  const requestedTags = new Set(normalizeTags(url.searchParams.get('tags')));
  const overlayLanguage = normalizeOverlayLanguage(url.searchParams.get('language'));
  const persistentKey = await persistentPosterKey(type, id, url, preview);
  const persistent = await readPersistentPoster(env, persistentKey, requestedTags);
  if (persistent) {
    const headers = new Headers();
    persistent.writeHttpMetadata(headers);
    headers.set('content-type', 'image/webp');
    headers.set('cache-control', posterCacheControl(preview, requestedTags, requestedTags.has('trend')));
    headers.set('etag', persistent.httpEtag);
    headers.set('x-kollection-cache', 'MISS');
    headers.set('x-kollection-persistent-cache', 'HIT');
    headers.set('x-kollection-cache-scope', preview ? 'preview' : 'production');
    headers.set('x-kollection-render-version', CACHE_VERSION);
    headers.set('x-kollection-overlay-language', overlayLanguage);

    const response = new Response(persistent.body, { status: 200, headers });
    context.waitUntil(cache.put(cacheRequest, response.clone()));
    return response;
  }

  const slot = await acquirePosterRenderSlot(env, request);
  if (!slot.allowed) return json({ error: 'Poster render budget blocked this uncached render.', reason: slot.reason }, slot.reason === 'client-hourly-limit' ? 429 : 503);

  try {
    const append = type === 'movie' ? 'images,release_dates,external_ids' : 'images,content_ratings,external_ids';
    const details = await tmdbFetch(`/${type}/${id}?append_to_response=${append}&include_image_language=en,null&language=en-US`, env.TMDB_API_KEY);
    if (!details.poster_path) return json({ error: 'TMDB has no poster for this title.' }, 404);

    const tags = requestedTags;
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
      genre: tags.has('genre') ? localizeGenre(details.genres?.[0]?.name || '', overlayLanguage) : '',
      age: tags.has('age') ? certification(details, type) : '',
      trend: tags.has('trend') ? await trendLabel(type, id, env.TMDB_API_KEY, overlayLanguage) : '',
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

    const output = await rendered.arrayBuffer();
    const cacheControl = posterCacheControl(preview, tags, Boolean(payload.trend));
    const headers = new Headers(rendered.headers);
    headers.set('content-type', 'image/webp');
    headers.set('cache-control', cacheControl);
    headers.set('x-kollection-posters', 'v2-sharp');
    headers.set('x-kollection-render-version', CACHE_VERSION);
    headers.set('x-kollection-cache', 'MISS');
    headers.set('x-kollection-persistent-cache', 'MISS');
    headers.set('x-kollection-cache-scope', preview ? 'preview' : 'production');
    headers.set('x-kollection-rating-source', rating.source);
    headers.set('x-kollection-rating-status', rating.status);
    headers.set('x-kollection-artwork-source', artwork.source);
    headers.set('x-kollection-logo-source', logo.source);
    headers.set('x-kollection-tmdb-id', id);
    headers.set('x-kollection-overlay-language', overlayLanguage);

    const response = new Response(output, { status: 200, headers });
    context.waitUntil(Promise.all([
      cache.put(cacheRequest, response.clone()),
      writePersistentPoster(env, persistentKey, output.slice(0), cacheControl, tags),
    ]));
    return response;
  } catch (error) {
    return json({ error: error?.message || 'Posters v2 failed.' }, 502);
  } finally {
    slot.release();
  }
}
