(() => {
  'use strict';

  const STORAGE_KEY = 'kollection-posters-settings-v1';

  function codec() {
    if (!globalThis.KollectionPosterConfigToken) throw new Error('Poster config token codec is unavailable.');
    return globalThis.KollectionPosterConfigToken;
  }

  function normalize(value) {
    return codec().normalize(value);
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function configId(value) {
    return codec().encode(normalize(value));
  }

  function pattern(value) {
    return codec().pattern(normalize(value));
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
    config.usePosterProxy = false;
    config.enableRatingPostersForLibrary = true;
    config.catalogs = (config.catalogs || []).map(catalog => ({
      ...catalog,
      enableRatingPosters: true,
    }));
    config.kollectionPosters = {
      version: 5,
      enabled: true,
      configId: configId(settings),
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
    configId,
    pattern,
    label,
    applyToAioConfig,
  });
})();
