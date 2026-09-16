(() => {
  'use strict';

  const STORAGE_KEY = 'kollection-better-posters-settings-v2';
  const RATING_SOURCES = Object.freeze([
    'average','imdb','tmdb','rottentomatoes','metacritic','trakt','letterboxd','rogerebert',
  ]);
  const LANGUAGES = Object.freeze([
    'en','es','fr','de','pt-BR','pt-PT','it','nl','pl','ru','tr','ar','ja','ko','zh','hi','sv','cs',
  ]);
  const TREND_DETAILS = Object.freeze([
    'studio','director','cast','inCinema','rank','newMovie','comingSoon','newSeries','returningSeries','limitedSeries',
  ]);
  const LANGUAGE_CODES = Object.freeze({
    en:0, es:1, fr:2, de:3, 'pt-BR':4, 'pt-PT':5, it:6, nl:7, pl:8,
    ru:9, tr:10, ar:11, ja:12, ko:13, zh:14, hi:15, sv:16, cs:17,
  });

  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    const ratingSourceRaw = String(input.ratingSource || 'average').toLowerCase();
    const ratingSource = RATING_SOURCES.includes(ratingSourceRaw) ? ratingSourceRaw : 'average';
    const languageRaw = String(input.language || 'en');
    const language = LANGUAGES.includes(languageRaw) ? languageRaw : 'en';

    let requestedTrend;
    if (Array.isArray(input.trendDetails)) requestedTrend = input.trendDetails.map(String);
    else if (input.trendTags === false) requestedTrend = [];
    else requestedTrend = TREND_DETAILS.slice();

    return {
      qualityTags: input.qualityTags === true,
      genre: input.genre !== false,
      rating: input.rating !== false,
      ageRating: input.ageRating === true,
      ratingSource,
      language,
      trendDetails: TREND_DETAILS.filter(detail => requestedTrend.includes(detail)),
    };
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function trendMask(values) {
    const selected = new Set(values || []);
    return TREND_DETAILS.reduce((mask, value, index) => selected.has(value) ? mask | (1 << index) : mask, 0);
  }

  function configId(value) {
    const settings = normalize(value);
    let flags = 0;
    if (settings.qualityTags) flags |= 1;
    if (settings.genre) flags |= 2;
    if (settings.rating) flags |= 4;
    if (settings.ageRating) flags |= 8;
    const rating = RATING_SOURCES.indexOf(settings.ratingSource);
    const language = LANGUAGE_CODES[settings.language] ?? 0;
    const trend = trendMask(settings.trendDetails);
    return `b1${flags.toString(36)}${rating.toString(36)}${language.toString(36)}${trend.toString(36).padStart(2, '0')}`;
  }

  function posterPath(value) {
    const settings = normalize(value);
    let suffix = '';
    if (!settings.genre && settings.rating) suffix = 'r';
    else if (settings.genre && !settings.rating) suffix = 'g';
    else if (!settings.genre && !settings.rating) suffix = 'n';
    if (settings.qualityTags) suffix += 'q';
    if (settings.ageRating) suffix += 'a';
    return suffix ? `poster-${suffix}` : 'poster';
  }

  function pattern(value) {
    return `https://kollection.tv/bp/${configId(value)}/{type}/{id}.webp`;
  }

  function label(value) {
    const settings = normalize(value);
    const parts = [];
    if (settings.trendDetails.length) parts.push(`Trend: ${settings.trendDetails.length}`);
    if (settings.qualityTags) parts.push('Quality');
    if (settings.genre) parts.push('Genre');
    if (settings.rating) parts.push(settings.ratingSource === 'average' ? 'Rating' : `${settings.ratingSource} rating`);
    if (settings.ageRating) parts.push('Age Rating');
    return `Better Posters + Kollection Trends · ${parts.length ? parts.join(', ') : 'Base poster only'}`;
  }

  function applyToAioConfig(config, value) {
    const settings = normalize(value);
    config.posterRatingProvider = 'custom';
    config.customPosterUrlPattern = pattern(settings);
    config.usePosterProxy = false;
    config.enableRatingPostersForLibrary = true;
    config.catalogs = (config.catalogs || []).map(catalog => ({
      ...catalog,
      enableRatingPosters: true,
    }));
    delete config.kollectionPosters;
    config.kollectionBetterPosters = {
      version: 2,
      enabled: true,
      provider: 'btttr.cc',
      hybridTrendLayer: 'kollection',
      configId: configId(settings),
      settings: { ...settings, trendDetails: settings.trendDetails.slice() },
      posterUrlPattern: config.customPosterUrlPattern,
    };
    return config;
  }

  globalThis.KollectionBetterPostersSettings = Object.freeze({
    STORAGE_KEY,
    RATING_SOURCES,
    LANGUAGES,
    TREND_DETAILS,
    normalize,
    readLocal,
    configId,
    posterPath,
    pattern,
    label,
    applyToAioConfig,
  });
})();