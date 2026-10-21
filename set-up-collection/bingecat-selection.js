(() => {
  'use strict';

  const KINDS = new Set(['ai', 'because_watched', 'latest', 'list_for_you', 'random_public']);
  const DEFAULT_KINDS = new Set(['ai', 'because_watched', 'random_public']);
  const typeOf = c => String(c?.type || c?.content_type || '').toLowerCase();
  const key = c => c?.kind ? `${c.kind}:${typeOf(c)}` : `catalog:${typeOf(c)}:${c?.id || ''}`;
  const usable = c => c?.id && !c.isSearch && ['movie', 'series'].includes(typeOf(c)) && (!c.kind || KINDS.has(c.kind));
  const rank = c => {
    const name = String(c.name || '').toLowerCase();
    if (name === 'ai recommendations') return 0;
    if (name.startsWith('because you watched')) return 1;
    if (name.startsWith('latest')) return 2;
    if (name === 'list for you') return 3;
    return 10;
  };

  function catalogs(list) {
    const unique = new Map();
    for (const c of [...(list || [])].filter(usable).sort((a, b) => Number(a.position || 0) - Number(b.position || 0))) {
      if (!unique.has(key(c))) unique.set(key(c), c);
    }
    return [...unique.values()];
  }

  function options(list, recommendations = []) {
    const available = catalogs(list);
    const byKey = new Map(available.map(c => [key(c), c]));
    const rows = new Map();
    for (const r of recommendations) {
      if (!KINDS.has(r.kind) || !['movie', 'series'].includes(typeOf(r))) continue;
      const id = key(r);
      rows.set(id, { key: id, kind: r.kind, type: typeOf(r), status: r,
        catalog: r.state === 'disabled' || r.enabled === false ? null : byKey.get(id) || null });
    }
    for (const c of available) {
      const id = key(c);
      if (!rows.has(id)) rows.set(id, { key: id, kind: c.kind, type: typeOf(c), catalog: c, status: null });
    }
    return [...rows.values()];
  }

  function defaults(list) {
    const available = catalogs(list);
    if (available.some(c => c.kind)) return available.filter(c => DEFAULT_KINDS.has(c.kind)).map(key);
    // Preserve the legacy three-per-type manifest mapping until the user chooses differently.
    const ordered = available.map((c, index) => ({ c, index })).sort((a, b) => rank(a.c) - rank(b.c) || a.index - b.index).map(x => x.c);
    return ['movie', 'series'].flatMap(type => ordered.filter(c => typeOf(c) === type).slice(0, 3).map(key));
  }

  function selected(list, selection) {
    const keys = new Set(Array.isArray(selection?.keys) ? selection.keys : defaults(list));
    return catalogs(list).filter(c => keys.has(key(c)));
  }

  function selection(manifestUrl, list, previous, recommendations = []) {
    const available = new Set(options(list, recommendations).filter(row => row.catalog).map(row => row.key));
    const keys = previous?.manifestUrl === manifestUrl && Array.isArray(previous.keys) ? previous.keys : defaults(list);
    return { manifestUrl, keys: [...new Set(keys)].filter(id => available.has(id)) };
  }

  function rewrite(collections, addonId, list, selection, placeholders = {}) {
    const chosen = addonId ? selected(list, selection) : [];
    for (const group of collections || []) for (const folder of group.folders || []) {
      for (const field of ['sources', 'catalogSources']) {
        const original = folder[field];
        if (!Array.isArray(original)) continue;
        const isBingecat = s => String(s?.addonId || '').startsWith('com.aicat.');
        const templates = original.filter(isBingecat);
        if (!templates.length) continue;
        const types = new Set(templates.map(typeOf));
        const replacements = chosen.filter(c => types.has(typeOf(c))).map(c => {
          const template = templates.find(s => s.catalogId === c.id || placeholders[s.catalogId]?.join(':') === key(c))
            || templates.find(s => typeOf(s) === typeOf(c)) || templates[0];
          const source = { ...template, type: typeOf(c), addonId, catalogId: c.id };
          if (field === 'sources') source.provider = 'addon';
          else delete source.provider;
          return source;
        });
        // Insert the chosen catalogs once; retain every unrelated source and folder setting.
        let inserted = false;
        folder[field] = original.flatMap(s => {
          if (!isBingecat(s)) return [s];
          if (inserted) return [];
          inserted = true;
          return replacements;
        });
      }
    }
  }

  window.KollectionBingecatSelection = Object.freeze({ key, catalogs, options, defaults, selected, selection, rewrite });
})();
