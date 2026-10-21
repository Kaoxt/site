(() => {
  'use strict';

  // AIOMetadata's Catalogs > Import accepts version 1 catalog-share files,
  // not a full configuration backup. Keep account and poster settings out.
  const CATALOG_FIELDS = [
    'id', 'name', 'type', 'source', 'sourceUrl', 'showInHome', 'genres', 'manifestData',
    'sort', 'order', 'sortDirection', 'cacheTTL', 'displayType', 'genreSelection',
    'filter_score_min', 'filter_score_max', 'minVotes', 'randomizePerPage',
    'pageSize', 'mergedInto', 'metadata', 'tags',
  ];

  function buildPayload(catalogs) {
    const selected = new Map();
    for (const catalog of Array.isArray(catalogs) ? catalogs : []) {
      if (!catalog || !['id', 'name', 'type', 'source'].every(key =>
        typeof catalog[key] === 'string' && catalog[key].trim()
      )) {
        throw new Error('A catalog is missing its ID, name, type, or source. Open Edit and prepare the setup again before exporting.');
      }
      const key = JSON.stringify([catalog.id, catalog.type]);
      if (selected.has(key)) continue;
      const copy = {};
      for (const field of CATALOG_FIELDS) {
        if (catalog[field] !== undefined) copy[field] = JSON.parse(JSON.stringify(catalog[field]));
      }
      // Required collection catalogs must be available after import. Omit
      // enableRatingPosters: matching catalogs retain their choice on Merge,
      // while new catalogs inherit the target's global poster provider.
      copy.enabled = true;
      if (copy.metadata && typeof copy.metadata === 'object') {
        delete copy.metadata.useUpstreamArt;
      }
      selected.set(key, copy);
    }
    if (!selected.size) throw new Error('No AIOMetadata catalogs are selected for export.');
    return { version: 1, exportedAt: new Date().toISOString(), catalogs: [...selected.values()] };
  }

  window.KollectionCatalogExport = Object.freeze({ buildPayload });
})();
