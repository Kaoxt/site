(() => {
  'use strict';

  const STORAGE_KEY = 'kollection-posters-settings-v1';
  const ALLOWED_TAGS = ['trend', 'quality', 'genre', 'rating', 'age'];
  const RATING_SOURCES = ['average', 'score', 'imdb', 'letterboxd', 'mal', 'rogerebert', 'tomatometer', 'popcornmeter', 'tmdb'];
  const TREND_DETAILS = ['studio', 'director', 'cast', 'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'];
  const LEGACY_RELEASE_DETAILS = ['inCinema', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'];

  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    const source = input.source === 'tmdb' ? 'tmdb' : 'smart';
    const requested = Array.isArray(input.tags) ? input.tags.map(String) : ['trend', 'genre', 'rating'];
    const tags = ALLOWED_TAGS.filter(tag => requested.includes(tag));
    const ratingSource = RATING_SOURCES.includes(String(input.ratingSource || '').toLowerCase())
      ? String(input.ratingSource).toLowerCase()
      : 'average';
    const requestedTrendDetails = new Set(Array.isArray(input.trendDetails)
      ? input.trendDetails.map(String)
      : TREND_DETAILS);
    if (requestedTrendDetails.has('release')) {
      LEGACY_RELEASE_DETAILS.forEach(type => requestedTrendDetails.add(type));
    }
    const trendDetails = TREND_DETAILS.filter(type => requestedTrendDetails.has(type));
    return { source, tags, ratingSource, trendDetails, artworkProvider: 'tmdb' };
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function pattern(value) {
    const settings = normalize(value);
    const params = new URLSearchParams({
      v: '23',
      source: settings.source,
      tags: [...new Set(settings.tags)].sort().join(','),
      ratingSource: settings.ratingSource,
      trendDetails: settings.trendDetails.join(','),
      language: '{language_short}',
    });
    return 'https://kollection.tv/api/posters-v2/{type}/{tmdb_id}.webp?' +
      params.toString().replace('%7Blanguage_short%7D', '{language_short}');
  }

  function label(value) {
    const settings = normalize(value);
    const source = settings.source === 'tmdb' ? 'Original Posters' : 'Smart Overlay Posters';
    const tags = settings.tags.length
      ? settings.tags.map(tag => tag[0].toUpperCase() + tag.slice(1)).join(', ')
      : 'No Smart Tags';
    const rating = settings.tags.includes('rating') ? ' · ' + settings.ratingSource + ' ratings' : '';
    return source + ' · ' + tags + rating;
  }

  function applyToAioConfig(config, value) {
    const settings = normalize(value);
    config.posterRatingProvider = 'custom';
    config.customPosterUrlPattern = pattern(settings);
    config.usePosterProxy = true;
    config.enableRatingPostersForLibrary = true;
    config.catalogs = (config.catalogs || []).map(catalog => ({
      ...catalog,
      enableRatingPosters: true,
    }));
    config.kollectionPosters = {
      version: 4,
      enabled: true,
      posterSource: settings.source,
      ratingSource: settings.ratingSource,
      trendDetails: settings.trendDetails.slice(),
      smartTags: {
        enabled: true,
        tags: settings.tags.slice(),
        trendDetails: settings.trendDetails.slice(),
        fixedPlacement: true,
      },
    };
    return config;
  }

  globalThis.KollectionPosterSettings = Object.freeze({
    STORAGE_KEY,
    normalize,
    readLocal,
    pattern,
    label,
    applyToAioConfig,
  });
})();
