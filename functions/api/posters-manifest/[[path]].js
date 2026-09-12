const POSTER_BASE = 'https://kollection.tv/api/posters-v2';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=120, s-maxage=600' : 'no-store',
      ...headers,
    },
  });
}

function decodeBase64Url(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseConfig(token) {
  let raw;
  try { raw = JSON.parse(decodeBase64Url(token)); }
  catch { throw new Error('Invalid Posters manifest configuration.'); }
  if (!raw || raw.v !== 1) throw new Error('Invalid Posters manifest configuration.');
  const lists = Array.isArray(raw.lists) ? raw.lists.map((item) => ({
    username: String(item?.username || '').trim().replace(/^@/, ''),
    slug: String(item?.slug || '').trim(),
    name: String(item?.name || item?.slug || 'MDBList').trim(),
  })).filter((item) => item.username && item.slug).slice(0, 60) : [];
  const defaults = Array.isArray(raw.defaults) ? raw.defaults.map(String).slice(0, 12) : [];
  return {
    apiKey: String(raw.apiKey || '').trim(),
    lists,
    defaults,
    source: ['smart', 'tmdb'].includes(raw.source) ? raw.source : 'smart',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 8) : ['trend', 'rating'],
    ratingSource: String(raw.ratingSource || 'average'),
    language: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko'].includes(String(raw.language || '').toLowerCase()) ? String(raw.language).toLowerCase() : 'en',
    sort: ['shuffle', 'list', 'newest', 'oldest'].includes(raw.sort) ? raw.sort : 'shuffle',
  };
}

function posterUrl(config, type, id) {
  const params = new URLSearchParams({
    source: config.source,
    tags: [...new Set(config.tags)].sort().join(','),
    ratingSource: config.ratingSource,
    language: config.language,
  });
  const mediaType = type === 'series' ? 'tv' : 'movie';
  return `${POSTER_BASE}/${mediaType}/${encodeURIComponent(id)}.webp?${params}`;
}

function catalogIdForList(item) {
  return `mdblist:${item.username}:${item.slug}`;
}

function manifest(config, token, origin) {
  const catalogs = [];
  for (const id of config.defaults) {
    const map = {
      'trending-movies': ['movie', 'Trending Movies'],
      'trending-series': ['series', 'Trending Series'],
      'popular-movies': ['movie', 'Popular Movies'],
      'popular-series': ['series', 'Popular Series'],
      'top-rated': ['movie', 'Top Rated Movies'],
      'coming-soon': ['movie', 'Coming Soon'],
    };
    if (map[id]) catalogs.push({ id: `default:${id}`, type: map[id][0], name: map[id][1] });
  }
  for (const item of config.lists) {
    catalogs.push({ id: catalogIdForList(item), type: 'movie', name: item.name, extra: [{ name: 'skip', isRequired: false }] });
    catalogs.push({ id: `${catalogIdForList(item)}:series`, type: 'series', name: item.name, extra: [{ name: 'skip', isRequired: false }] });
  }
  return {
    id: `tv.kollection.posters.${token.slice(0, 24)}`,
    version: '1.0.0',
    name: 'The Kollection Posters',
    description: 'Smart Overlay Posters for selected MDBList and Kollection catalogs.',
    logo: `${origin}/favicon.ico`,
    resources: [{ name: 'catalog', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }],
    types: ['movie', 'series'],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false, configurationURL: `${origin}/posters` },
  };
}

function normalizeMdbItem(item, fallbackType, config) {
  const media = String(item?.mediatype || item?.type || fallbackType || 'movie').toLowerCase();
  const type = media === 'show' || media === 'series' || media === 'tv' ? 'series' : 'movie';
  const imdb = String(item?.imdbid || item?.imdb_id || item?.imdb || '').trim();
  const tmdb = String(item?.id || item?.tmdbid || item?.tmdb_id || '').trim();
  const id = /^tt\d+$/i.test(imdb) ? imdb : tmdb ? `tmdb:${tmdb}` : '';
  if (!id) return null;
  const posterId = /^tt\d+$/i.test(imdb) ? imdb : tmdb;
  return {
    id,
    type,
    name: String(item?.title || item?.name || 'Untitled'),
    poster: posterUrl(config, type, posterId),
    description: String(item?.description || ''),
    releaseInfo: String(item?.year || item?.release_year || ''),
  };
}

function applySort(items, sort) {
  if (sort === 'shuffle') {
    return [...items].sort(() => Math.random() - 0.5);
  }
  if (sort === 'newest' || sort === 'oldest') {
    const direction = sort === 'newest' ? -1 : 1;
    return [...items].sort((a, b) => direction * ((Number(a.releaseInfo) || 0) - (Number(b.releaseInfo) || 0)));
  }
  return items;
}

async function fetchMdbList(config, username, slug, type) {
  if (!config.apiKey) throw new Error('MDBList API key missing from manifest configuration.');
  const endpointType = type === 'series' ? 'show' : 'movie';
  const params = new URLSearchParams({ apikey: config.apiKey, limit: '1000' });
  const url = `https://api.mdblist.com/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/items/${endpointType}?${params}`;
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'The Kollection/1.0' }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error(`MDBList returned ${response.status}.`);
  const payload = await response.json().catch(() => []);
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : type === 'series' && Array.isArray(payload?.shows) ? payload.shows : Array.isArray(payload?.movies) ? payload.movies : [];
  return applySort(source.map((item) => normalizeMdbItem(item, type, config)).filter((item) => item?.type === type), config.sort);
}

async function fetchTmdbDefault(config, id, env) {
  const key = String(env.TMDB_API_KEY || '').trim();
  if (!key) return [];
  const map = {
    'trending-movies': ['movie', 'https://api.themoviedb.org/3/trending/movie/day'],
    'trending-series': ['series', 'https://api.themoviedb.org/3/trending/tv/day'],
    'popular-movies': ['movie', 'https://api.themoviedb.org/3/movie/popular'],
    'popular-series': ['series', 'https://api.themoviedb.org/3/tv/popular'],
    'top-rated': ['movie', 'https://api.themoviedb.org/3/movie/top_rated'],
    'coming-soon': ['movie', 'https://api.themoviedb.org/3/movie/upcoming'],
  };
  const entry = map[id];
  if (!entry) return [];
  const url = new URL(entry[1]);
  url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'en-US');
  const response = await fetch(url, { headers: { accept: 'application/json' }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return applySort(rows.map((item) => ({
    id: `tmdb:${item.id}`,
    type: entry[0],
    name: item.title || item.name || 'Untitled',
    poster: posterUrl(config, entry[0], String(item.id)),
    description: item.overview || '',
    releaseInfo: String((item.release_date || item.first_air_date || '').slice(0, 4)),
  })), config.sort);
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const token = parts[2] || '';
  if (!token) return json({ error: 'Missing manifest configuration.' }, 400);
  let config;
  try { config = parseConfig(token); }
  catch (error) { return json({ error: error.message }, 400); }

  const resource = parts[3] || '';
  if (resource === 'manifest.json') return json(manifest(config, token, url.origin), 200, { 'cache-control': 'public, max-age=300, s-maxage=1800' });
  if (resource !== 'catalog') return json({ error: 'Unsupported resource.' }, 404);

  const type = decodeURIComponent(parts[4] || '');
  const catalogId = decodeURIComponent(parts[5] || '').replace(/\.json$/i, '');
  const skipPart = parts.find((part) => /^skip=\d+/i.test(part));
  const skip = skipPart ? Math.max(0, Number(skipPart.split('=')[1]) || 0) : 0;

  try {
    let metas = [];
    if (catalogId.startsWith('default:')) {
      metas = await fetchTmdbDefault(config, catalogId.slice(8), env);
    } else if (catalogId.startsWith('mdblist:')) {
      const raw = catalogId.replace(/:series$/, '');
      const [, username, ...slugParts] = raw.split(':');
      metas = await fetchMdbList(config, username, slugParts.join(':'), type);
    } else {
      return json({ error: 'Unknown catalog.' }, 404);
    }
    return json({ metas: metas.slice(skip, skip + 100) });
  } catch (error) {
    return json({ error: error?.message || 'Could not load catalog.', metas: [] }, 502);
  }
}
