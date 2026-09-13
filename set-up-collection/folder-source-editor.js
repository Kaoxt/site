(() => {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const originalFetch = window.fetch.bind(window);
  let savedOverrides = {};
  let activeOptions = null;

  function collectionRequest(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
      return /^\/api\/account\/collections(?:\/[^/]+)?$/.test(url.pathname);
    } catch { return false; }
  }

  window.fetch = async function(input, init = {}) {
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    let nextInit = init;

    if (collectionRequest(input) && ['POST','PATCH','PUT'].includes(method) && init?.body) {
      try {
        const payload = JSON.parse(init.body);
        if (payload?.config && typeof payload.config === 'object') {
          payload.config.folderSourceOverrides = clone(savedOverrides || {});
          nextInit = { ...init, body: JSON.stringify(payload) };
        }
      } catch {}
    }

    const response = await originalFetch(input, nextInit);
    if (collectionRequest(input) && method === 'GET' && response.ok) {
      try {
        const data = await response.clone().json();
        const incoming = data?.collection?.config?.folderSourceOverrides;
        if (incoming && typeof incoming === 'object') savedOverrides = clone(incoming);
      } catch {}
    }
    return response;
  };

  function keyFor(groupKey, folderKey) {
    return `${groupKey}::${folderKey}`;
  }

  function extractNumericId(raw, provider) {
    const value = String(raw || '').trim();
    if (/^\d+$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (provider === 'tmdb') {
        const match = url.pathname.match(/\/collection\/(\d+)/i);
        if (match) return match[1];
      }
      if (provider === 'trakt') {
        const match = url.pathname.match(/\/lists\/(\d+)/i);
        if (match) return match[1];
      }
      if (provider === 'mdblist') {
        const match = url.pathname.match(/\/(?:lists|list)\/(\d+)(?:\/|$)/i);
        if (match) return match[1];
      }
    } catch {}
    return '';
  }

  function catalogIdFor(provider, id) {
    if (provider === 'mdblist') return `mdblist.${id}`;
    if (provider === 'tmdb') return `tmdb.collection.${id}`;
    if (provider === 'trakt') return `trakt.list.${id}`;
    return '';
  }

  function catalogFor(override, folderTitle) {
    const provider = override.provider;
    const id = override.id;
    const type = provider === 'tmdb' ? 'movie' : (override.type || 'all');
    const catalogId = catalogIdFor(provider, id);
    const base = {
      id: catalogId,
      type,
      name: override.name || folderTitle || catalogId,
      enabled: true,
      showInHome: false,
      source: provider,
      enableRatingPosters: true,
    };
    if (provider === 'mdblist') {
      return {
        ...base,
        sort: 'default',
        order: 'asc',
        genreSelection: 'standard',
        metadata: { itemCount: 0, url: override.url || `https://mdblist.com/lists/${id}` },
      };
    }
    if (provider === 'trakt') {
      return {
        ...base,
        sort: 'default',
        sortDirection: 'asc',
        metadata: { itemCount: 0, url: override.url || `https://trakt.tv/lists/${id}` },
      };
    }
    return {
      ...base,
      metadata: {
        listId: String(id),
        listName: override.name || folderTitle || catalogId,
        itemCount: 0,
        url: override.url || `https://www.themoviedb.org/collection/${id}`,
      },
    };
  }

  function applyOverrides(options) {
    if (!options?.state) return;
    activeOptions = options;
    const { state, collectionGroupKey, collectionFolderKey } = options;
    state.collectionFolderSourceOverrides ||= clone(savedOverrides || {});
    if (Object.keys(savedOverrides || {}).length && !Object.keys(state.collectionFolderSourceOverrides || {}).length) {
      state.collectionFolderSourceOverrides = clone(savedOverrides);
    } else if (Object.keys(state.collectionFolderSourceOverrides || {}).length) {
      savedOverrides = clone(state.collectionFolderSourceOverrides);
    }

    state.aiCatalogLibrary ||= [];
    for (const group of state.collectionPack || []) {
      const gk = collectionGroupKey(group);
      for (const folder of group.folders || []) {
        const fk = collectionFolderKey(folder);
        const override = state.collectionFolderSourceOverrides[keyFor(gk, fk)];
        if (!override?.provider || !override?.id) continue;
        const catalogId = catalogIdFor(override.provider, override.id);
        const source = { provider: 'addon', addonId: 'aio-metadata', catalogId, type: override.provider === 'tmdb' ? 'movie' : (override.type || 'all') };
        folder.sources = [clone(source)];
        folder.catalogSources = [clone(source)];
        const catalog = catalogFor(override, folder.title || 'Custom catalog');
        const index = state.aiCatalogLibrary.findIndex(item => item?.id === catalog.id);
        if (index >= 0) state.aiCatalogLibrary[index] = catalog;
        else state.aiCatalogLibrary.push(catalog);
      }
    }
  }

  function ensureModal() {
    let root = document.getElementById('folderSourceEditorModal');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'folderSourceEditorModal';
    root.className = 'folder-source-modal-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="folder-source-backdrop" data-source-close>
        <section class="folder-source-modal" role="dialog" aria-modal="true" aria-labelledby="folderSourceTitle">
          <header class="folder-source-modal-head">
            <div><span class="folder-source-kicker">CUSTOM SOURCE</span><h3 id="folderSourceTitle">Edit folder source</h3></div>
            <button class="folder-source-close" type="button" aria-label="Close" data-source-close>×</button>
          </header>
          <div class="folder-source-body">
            <div class="field"><label for="folderSourceProvider">Provider</label><select id="folderSourceProvider"><option value="mdblist">MDBList</option><option value="tmdb">TMDB Collection</option><option value="trakt">Trakt List</option></select></div>
            <div class="field"><label for="folderSourceValue">List / collection ID or URL</label><input id="folderSourceValue" type="text" autocomplete="off" placeholder="Paste an ID or supported URL"><small id="folderSourceHint">Use the numeric MDBList list ID.</small></div>
            <div class="field" id="folderSourceTypeRow"><label for="folderSourceType">Media type</label><select id="folderSourceType"><option value="all">Movies + Series</option><option value="movie">Movies</option><option value="series">Series</option></select></div>
            <div class="field"><label for="folderSourceName">Catalog name <span class="optional">(optional)</span></label><input id="folderSourceName" type="text" autocomplete="off" placeholder="Uses the cover folder name by default"></div>
            <div id="folderSourceError" class="folder-source-error" role="status"></div>
          </div>
          <footer class="folder-source-actions"><button class="ghost" id="folderSourceReset" type="button">Restore default</button><button class="btn" id="folderSourceSave" type="button">Save source</button></footer>
        </section>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', event => {
      if (event.target === root.querySelector('.folder-source-backdrop') || event.target.closest('[data-source-close]')) closeModal();
    });
    return root;
  }

  function closeModal() {
    const root = document.getElementById('folderSourceEditorModal');
    if (!root) return;
    root.classList.remove('open'); root.setAttribute('aria-hidden','true');
  }

  function openModal(group, folder, groupKey, folderKey) {
    const root = ensureModal();
    const { state } = activeOptions || {};
    if (!state) return;
    const mapKey = keyFor(groupKey, folderKey);
    const existing = state.collectionFolderSourceOverrides?.[mapKey] || {};
    root.dataset.mapKey = mapKey;
    root.dataset.folderTitle = folder.title || '';
    root.querySelector('#folderSourceTitle').textContent = `Edit ${folder.title || 'folder'}`;
    root.querySelector('#folderSourceProvider').value = existing.provider || 'mdblist';
    root.querySelector('#folderSourceValue').value = existing.url || existing.id || '';
    root.querySelector('#folderSourceType').value = existing.type || 'all';
    root.querySelector('#folderSourceName').value = existing.name || '';
    root.querySelector('#folderSourceError').textContent = '';

    const syncProvider = () => {
      const provider = root.querySelector('#folderSourceProvider').value;
      const typeRow = root.querySelector('#folderSourceTypeRow');
      const input = root.querySelector('#folderSourceValue');
      const hint = root.querySelector('#folderSourceHint');
      typeRow.hidden = provider === 'tmdb';
      if (provider === 'tmdb') {
        input.placeholder = 'TMDB collection ID or themoviedb.org/collection/... URL';
        hint.textContent = 'TMDB collections contain movies only.';
      } else if (provider === 'trakt') {
        input.placeholder = 'Trakt numeric list ID or trakt.tv/lists/... URL';
        hint.textContent = 'Public Trakt list IDs work directly; private lists may require Trakt authorization in AIOMetadata.';
      } else {
        input.placeholder = 'MDBList numeric list ID';
        hint.textContent = 'Use the numeric MDBList list ID. Your saved MDBList API key is used by AIOMetadata.';
      }
    };
    root.querySelector('#folderSourceProvider').onchange = syncProvider;
    syncProvider();

    root.querySelector('#folderSourceSave').onclick = () => {
      const provider = root.querySelector('#folderSourceProvider').value;
      const raw = root.querySelector('#folderSourceValue').value.trim();
      const id = extractNumericId(raw, provider);
      if (!id) {
        root.querySelector('#folderSourceError').textContent = `Enter a valid ${provider === 'tmdb' ? 'TMDB collection' : provider === 'trakt' ? 'Trakt list' : 'MDBList list'} numeric ID${provider !== 'mdblist' ? ' or supported URL' : ''}.`;
        return;
      }
      const override = {
        provider,
        id,
        url: /^https?:\/\//i.test(raw) ? raw : '',
        type: provider === 'tmdb' ? 'movie' : root.querySelector('#folderSourceType').value,
        name: root.querySelector('#folderSourceName').value.trim(),
      };
      state.collectionFolderSourceOverrides ||= {};
      state.collectionFolderSourceOverrides[mapKey] = override;
      savedOverrides = clone(state.collectionFolderSourceOverrides);
      applyOverrides(activeOptions);
      state.backup = null; state.previewCollections = null; state.finalCollections = null;
      window.dispatchEvent(new CustomEvent('kollection:folder-source-overrides-changed', { detail: clone(savedOverrides) }));
      closeModal();
      window.KollectionFolderEditor?.render?.(activeOptions);
    };

    root.querySelector('#folderSourceReset').onclick = () => {
      if (state.collectionFolderSourceOverrides?.[mapKey]) delete state.collectionFolderSourceOverrides[mapKey];
      savedOverrides = clone(state.collectionFolderSourceOverrides || {});
      closeModal();
      window.location.reload();
    };

    root.classList.add('open'); root.setAttribute('aria-hidden','false');
  }

  function addEditButtons(options) {
    const { host, state, collectionGroupKey, collectionFolderKey } = options;
    if (!state?.customizeGroupKey) return;
    const group = (state.collectionPack || []).find(item => collectionGroupKey(item) === state.customizeGroupKey);
    if (!group) return;
    const groupKey = collectionGroupKey(group);
    host.querySelectorAll('.folder-edit-card').forEach(card => {
      const folderKey = card.dataset.folderKey || '';
      const folder = (group.folders || []).find(item => collectionFolderKey(item) === folderKey);
      const meta = card.querySelector('.folder-edit-meta');
      if (!folder || !meta || meta.querySelector('.folder-source-edit')) return;
      const title = meta.querySelector('b');
      if (title) {
        const row = document.createElement('span');
        row.className = 'folder-title-edit-row';
        title.replaceWith(row);
        row.appendChild(title);
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'folder-source-edit'; edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit source for ${folder.title || 'folder'}`);
        edit.onclick = event => { event.preventDefault(); event.stopPropagation(); openModal(group, folder, groupKey, folderKey); };
        row.appendChild(edit);
      }
      const override = state.collectionFolderSourceOverrides?.[keyFor(groupKey, folderKey)];
      if (override) card.classList.add('has-custom-source');
    });
  }

  function install() {
    const original = window.KollectionFolderEditor;
    if (!original || original.__folderSourceEditorWrapped) return false;
    const wrapped = {
      ...original,
      __folderSourceEditorWrapped: true,
      render(options) {
        activeOptions = options;
        applyOverrides(options);
        const result = original.render(options);
        requestAnimationFrame(() => addEditButtons(options));
        return result;
      },
      filterPack(pack, state, groupKey, folderKey) {
        applyOverrides({ ...(activeOptions || {}), state, collectionGroupKey: groupKey, collectionFolderKey: folderKey });
        return original.filterPack(pack, state, groupKey, folderKey);
      },
    };
    window.KollectionFolderEditor = Object.freeze(wrapped);
    return true;
  }

  function init() {
    if (!install()) {
      let tries = 0;
      const timer = setInterval(() => { tries += 1; if (install() || tries > 50) clearInterval(timer); }, 100);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();