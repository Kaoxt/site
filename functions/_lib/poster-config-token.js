export const TOKEN_VERSION = 'k3';
export const POSTER_VISUAL_VERSION = '25';
export const ALLOWED_TAGS = ['trend', 'quality', 'genre', 'rating', 'age'];
export const RATING_SOURCES = ['average', 'score', 'imdb', 'letterboxd', 'mal', 'rogerebert', 'tomatometer', 'popcornmeter', 'tmdb'];
export const TREND_DETAILS = ['studio', 'director', 'cast', 'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'];
const LEGACY_RELEASE_DETAILS = ['inCinema', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'];

export function normalizePosterConfig(value) {
  const input = value && typeof value === 'object' ? value : {};
  const source = input.source === 'tmdb' ? 'tmdb' : 'smart';
  const requestedTags = Array.isArray(input.tags) ? input.tags.map(String) : ['trend', 'genre', 'rating'];
  const tags = ALLOWED_TAGS.filter(tag => requestedTags.includes(tag));
  const ratingRaw = String(input.ratingSource || '').toLowerCase();
  const ratingSource = RATING_SOURCES.includes(ratingRaw) ? ratingRaw : 'average';
  const requestedTrend = new Set(Array.isArray(input.trendDetails) ? input.trendDetails.map(String) : TREND_DETAILS);
  if (requestedTrend.has('release')) LEGACY_RELEASE_DETAILS.forEach(type => requestedTrend.add(type));
  const trendDetails = TREND_DETAILS.filter(type => requestedTrend.has(type));
  return { source, tags, ratingSource, trendDetails, artworkProvider: 'tmdb' };
}

function bitMask(values, allowed) {
  const selected = new Set(values || []);
  return allowed.reduce((mask, value, index) => selected.has(value) ? mask | (1 << index) : mask, 0);
}

function valuesFromMask(mask, allowed) {
  return allowed.filter((_, index) => (mask & (1 << index)) !== 0);
}

export function encodePosterConfig(value) {
  const settings = normalizePosterConfig(value);
  const source = settings.source === 'tmdb' ? 't' : 's';
  const tags = bitMask(settings.tags, ALLOWED_TAGS).toString(36);
  const rating = RATING_SOURCES.indexOf(settings.ratingSource).toString(36);
  const trend = bitMask(settings.trendDetails, TREND_DETAILS).toString(36).padStart(2, '0');
  return `${TOKEN_VERSION}${source}${tags}${rating}${trend}`;
}

export function decodePosterConfig(token) {
  const match = String(token || '').toLowerCase().match(/^(k[123])([st])([0-9a-v])([0-8])([0-9a-z]{2})$/);
  if (!match) return null;
  const tagMask = parseInt(match[3], 36);
  const ratingIndex = parseInt(match[4], 36);
  const trendMask = parseInt(match[5], 36);
  if (tagMask > 31 || ratingIndex >= RATING_SOURCES.length || trendMask > 1023) return null;
  const settings = normalizePosterConfig({
    source: match[2] === 't' ? 'tmdb' : 'smart',
    tags: valuesFromMask(tagMask, ALLOWED_TAGS),
    ratingSource: RATING_SOURCES[ratingIndex],
    trendDetails: valuesFromMask(trendMask, TREND_DETAILS),
  });
  settings.artworkProvider = 'tmdb';
  return settings;
}
