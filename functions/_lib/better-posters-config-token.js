export const BETTER_POSTERS_TOKEN_VERSION = 'b1';
export const BETTER_POSTERS_RATING_SOURCES = ['average', 'imdb', 'tmdb', 'rottentomatoes', 'metacritic', 'trakt', 'letterboxd', 'rogerebert'];
export const BETTER_POSTERS_LANGUAGES = ['en','es','fr','de','pt-BR','pt-PT','it','nl','pl','ru','tr','ar','ja','ko','zh','hi','sv','cs'];
export const BETTER_POSTERS_TREND_DETAILS = ['studio', 'director', 'cast', 'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'];

const LANGUAGE_CODES = Object.freeze({
  en: 0, es: 1, fr: 2, de: 3, 'pt-BR': 4, 'pt-PT': 5, it: 6, nl: 7, pl: 8,
  ru: 9, tr: 10, ar: 11, ja: 12, ko: 13, zh: 14, hi: 15, sv: 16, cs: 17,
});

function mask(values, allowed) {
  const set = new Set(values || []);
  return allowed.reduce((out, value, index) => set.has(value) ? out | (1 << index) : out, 0);
}

function fromMask(value, allowed) {
  return allowed.filter((_, index) => (value & (1 << index)) !== 0);
}

export function normalizeBetterPostersConfig(value) {
  const input = value && typeof value === 'object' ? value : {};
  const ratingSourceRaw = String(input.ratingSource || 'average').toLowerCase();
  const ratingSource = BETTER_POSTERS_RATING_SOURCES.includes(ratingSourceRaw) ? ratingSourceRaw : 'average';
  const languageRaw = String(input.language || 'en');
  const language = BETTER_POSTERS_LANGUAGES.includes(languageRaw) ? languageRaw : 'en';

  // Better Posters exposes Trend Tags as one native switch. Treat any legacy
  // non-empty Kollection subset as native Trend Tags enabled so old saved
  // setups immediately regain Better Posters' exact wording and appearance.
  let trendTags;
  if (typeof input.trendTags === 'boolean') trendTags = input.trendTags;
  else if (Array.isArray(input.trendDetails)) trendTags = input.trendDetails.length > 0;
  else trendTags = true;

  return {
    qualityTags: input.qualityTags === true,
    genre: input.genre !== false,
    rating: input.rating !== false,
    ageRating: input.ageRating === true,
    ratingSource,
    language,
    trendTags,
    trendDetails: trendTags ? BETTER_POSTERS_TREND_DETAILS.slice() : [],
  };
}

export function encodeBetterPostersConfig(value) {
  const config = normalizeBetterPostersConfig(value);
  let flags = 0;
  if (config.qualityTags) flags |= 1;
  if (config.genre) flags |= 2;
  if (config.rating) flags |= 4;
  if (config.ageRating) flags |= 8;
  const rating = BETTER_POSTERS_RATING_SOURCES.indexOf(config.ratingSource);
  const language = LANGUAGE_CODES[config.language] ?? 0;
  const trend = mask(config.trendDetails, BETTER_POSTERS_TREND_DETAILS);
  return `${BETTER_POSTERS_TOKEN_VERSION}${flags.toString(36)}${rating.toString(36)}${language.toString(36).padStart(1,'0')}${trend.toString(36).padStart(2,'0')}`;
}

export function decodeBetterPostersConfig(token) {
  const match = String(token || '').match(/^b1([0-9a-f])([0-7])([0-9a-h])([0-9a-z]{2})$/i);
  if (!match) return null;
  const flags = parseInt(match[1], 36);
  const ratingIndex = parseInt(match[2], 36);
  const languageIndex = parseInt(match[3], 36);
  const trendMask = parseInt(match[4], 36);
  const language = BETTER_POSTERS_LANGUAGES[languageIndex];
  if (flags > 15 || ratingIndex >= BETTER_POSTERS_RATING_SOURCES.length || !language || trendMask > 1023) return null;
  return normalizeBetterPostersConfig({
    qualityTags: Boolean(flags & 1),
    genre: Boolean(flags & 2),
    rating: Boolean(flags & 4),
    ageRating: Boolean(flags & 8),
    ratingSource: BETTER_POSTERS_RATING_SOURCES[ratingIndex],
    language,
    trendTags: fromMask(trendMask, BETTER_POSTERS_TREND_DETAILS).length > 0,
  });
}
