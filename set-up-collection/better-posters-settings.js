(() => {
  'use strict';

  const STORAGE_KEY = 'kollection-better-posters-settings-v1';
  const RATING_SOURCES = Object.freeze([
    'average',
    'imdb',
    'tmdb',
    'rottentomatoes',
    'metacritic',
    'trakt',
    'letterboxd',
    'rogerebert',
  ]);
  const LANGUAGES = Object.freeze([
    'en','es','fr','de','pt-BR','pt-PT','it','nl','pl','ru','tr','ar','ja','ko','zh','hi','sv','cs',
  ]);
  const RATING_CODES = Object.freeze({
    imdb: 'IM',
    tmdb: 'TM',
    rottentomatoes: 'RT',
    metacritic: 'MC',
    trakt: 'TR',
    letterboxd: 'LB',
    rogerebert: 'RE',
  });

  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    const ratingSource = RATING_SOURCES.includes(String(input.ratingSource || '').toLowerCase())
      ? String(input.ratingSource).toLowerCase()
      : 'average';
    const requestedLanguage = String(input.language || 'en');
    const language = LANGUAGES.includes(requestedLanguage) ? requestedLanguage : 'en';

    return {
      trendTags: input.trendTags !== false,
      qualityTags: input.qualityTags === true,
      genre: input.genre !== false,
      rating: input.rating !== false,
      ageRating: input.ageRating === true,
      ratingSource,
      language,
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
    const settings = normalize(value);
    const params = new URLSearchParams();
    if (!settings.trendTags) params.set('tag', 'none');
    if (settings.language !== 'en') params.set('lang', settings.language);
    const ratingCode = settings.rating ? RATING_CODES[settings.ratingSource] : '';
    if (ratingCode) params.set('rs', ratingCode);

    const base = `https://btttr.cc/${posterPath(settings)}/imdb/poster-default/{imdb_id}.jpg`;
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  function label(value) {
    const settings = normalize(value);
    const parts = [];
    if (settings.trendTags) parts.push('Trend Tags');
    if (settings.qualityTags) parts.push('Quality');
    if (settings.genre) parts.push('Genre');
    if (settings.rating) parts.push(settings.ratingSource === 'average' ? 'Rating' : `${settings.ratingSource} rating`);
    if (settings.ageRating) parts.push('Age Rating');
    return `Better Posters · ${parts.length ? parts.join(', ') : 'No overlays'}`;
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
      version: 1,
      enabled: true,
      provider: 'btttr.cc',
      settings: { ...settings },
      posterUrlPattern: config.customPosterUrlPattern,
    };
    return config;
  }

  globalThis.KollectionBetterPostersSettings = Object.freeze({
    STORAGE_KEY,
    RATING_SOURCES,
    LANGUAGES,
    normalize,
    readLocal,
    posterPath,
    pattern,
    label,
    applyToAioConfig,
  });
})();