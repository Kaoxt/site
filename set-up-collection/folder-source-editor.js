(() => {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const originalFetch = window.fetch.bind(window);
  let savedOverrides = {};
  let activeOptions = null;

  const keyFor = (groupKey, folderKey) => `${groupKey}::${folderKey}`;

  function collectionRequest(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
      return /^\/api\/account\/collections(?:\/[^/]+)?$/.test(url.pathname);
    } catch { return false; }
  }

  window.fetch = async function(input, init = {}) {
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    let nextInit = init;
    if (collectionRequest(input) && ['POST', 'PATCH', 'PUT'].includes(method) && init?.body) {
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

  function extractNumericId(raw, provider) {
    const value = String(raw || '').trim();
    if (/^\d+$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (provider === 'tmdb') return url.pathname.match(/\/collection\/(\d+)/i)?.[1] || '';
      if (provider === 'trakt') return url.pathname.match(/\/lists\/(\d+)/i)?.[1] || '';
      if (provider === 'mdblist') return url.pathname.match(/\/(?:lists|list)\/(\d+)(?:\/|$)/i)?.[1] || '';
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
    const base = { id: catalogId, type, name: override.name || folderTitle || catalogId, enabled: true, showInHome: false, source: provider, enableRatingPosters: true };
    if (provider === 'mdblist') return { ...base, sort: 'default', order: 'asc', genreSelection: 'standard', metadata: { itemCount: 0, url: override.url || `https://mdblist.com/lists/${id}` } };
    if (provider === 'trakt') return { ...base, sort: 'default', sortDirection: 'asc', metadata: { itemCount: 0, url: override.url || `https://trakt.tv/lists/${id}` } };
    return { ...base, metadata: { listId: String(id), listName: override.name || folderTitle || catalogId, itemCount: 0, url: override.url || `https://www.themoviedb.org/collection/${id}` } };
  }

  function normalizeArtworkUrl(value) {
    let url = String(value || '').trim();
    if (!url) return '';

    // Canonical Robert Downey Jr. artwork folder includes the period after "Jr.".
    url = url
      .replace('/images/Actors/Robert%20Downey%20Jr/', '/images/Actors/Robert%20Downey%20Jr./')
      .replace('/images/Actors/Robert Downey Jr/', '/images/Actors/Robert Downey Jr./')
      .replace('/Actors/Robert%20Downey%20Jr/', '/Actors/Robert%20Downey%20Jr./')
      .replace('/Actors/Robert Downey Jr/', '/Actors/Robert Downey Jr./');

    return url;
  }

  function artworkFrom(folder) {
    return {
      coverImageUrl: normalizeArtworkUrl(folder?.coverImageUrl),
      titleLogoUrl: normalizeArtworkUrl(folder?.titleLogoUrl),
      heroBackdropUrl: normalizeArtworkUrl(folder?.heroBackdropUrl),
      coverEmoji: String(folder?.coverEmoji || ''),
    };
  }

  function findExistingFolder(state, gk, fk, groupKey, folderKey) {
    for (const group of state.existingCollections || []) {
      if (groupKey(group) !== gk) continue;
      const match = (group.folders || []).find(folder => folderKey(folder) === fk);
      if (match) return match;
    }
    return null;
  }

  function ensureDefaults(state, folder, gk, fk, groupKey, folderKey) {
    state.collectionFolderDefaults ||= {};
    const mapKey = keyFor(gk, fk);
    if (state.collectionFolderDefaults[mapKey]) return state.collectionFolderDefaults[mapKey];
    const existing = findExistingFolder(state, gk, fk, groupKey, folderKey);
    const baseline = existing || folder;
    state.collectionFolderDefaults[mapKey] = {
      sources: clone(baseline?.sources || folder?.sources || []),
      catalogSources: clone(baseline?.catalogSources || folder?.catalogSources || []),
      artwork: artworkFrom(baseline),
    };
    return state.collectionFolderDefaults[mapKey];
  }

  function applyOverrides(options) {
    if (!options?.state) return;
    activeOptions = options;
    const { state, collectionGroupKey, collectionFolderKey } = options;
    state.collectionFolderSourceOverrides ||= clone(savedOverrides || {});
    if (Object.keys(state.collectionFolderSourceOverrides || {}).length) savedOverrides = clone(state.collectionFolderSourceOverrides);
    state.aiCatalogLibrary ||= [];

    for (const group of state.collectionPack || []) {
      const gk = collectionGroupKey(group);
      for (const folder of group.folders || []) {
        const fk = collectionFolderKey(folder);
        const mapKey = keyFor(gk, fk);
        const defaults = ensureDefaults(state, folder, gk, fk, collectionGroupKey, collectionFolderKey);
        const override = state.collectionFolderSourceOverrides[mapKey];

        if (override?.provider && override?.id) {
          const catalogId = catalogIdFor(override.provider, override.id);
          const source = { provider: 'addon', addonId: 'aio-metadata', catalogId, type: override.provider === 'tmdb' ? 'movie' : (override.type || 'all') };
          folder.sources = [clone(source)];
          folder.catalogSources = [clone(source)];
          const catalog = catalogFor(override, folder.title || 'Custom catalog');
          const index = state.aiCatalogLibrary.findIndex(item => item?.id === catalog.id);
          if (index >= 0) state.aiCatalogLibrary[index] = catalog; else state.aiCatalogLibrary.push(catalog);
        } else {
          folder.sources = clone(defaults.sources || []);
          folder.catalogSources = clone(defaults.catalogSources || []);
        }

        const art = override?.artwork && typeof override.artwork === 'object' ? override.artwork : defaults.artwork;
        if (art) {
          folder.coverImageUrl = normalizeArtworkUrl(art.coverImageUrl);
          folder.titleLogoUrl = normalizeArtworkUrl(art.titleLogoUrl);
          folder.heroBackdropUrl = normalizeArtworkUrl(art.heroBackdropUrl);
          folder.coverEmoji = String(art.coverEmoji ?? '');
        }
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
            <div><span class="folder-source-kicker">EDIT COLLECTION FOLDER</span><h3 id="folderSourceTitle">Edit folder</h3></div>
            <button class="folder-source-close" type="button" aria-label="Close" data-source-close>×</button>
          </header>
          <div class="folder-source-body">
            <section class="folder-edit-section">
              <div class="folder-edit-section-head"><b>Catalog source</b><span>Keep the Kollection default or replace this folder with your own list.</span></div>
              <div class="field"><label for="folderSourceProvider">Provider</label><select id="folderSourceProvider"><option value="">Keep current / default source</option><option value="mdblist">MDBList</option><option value="tmdb">TMDB Collection</option><option value="trakt">Trakt List</option></select></div>
              <div class="field" id="folderSourceValueRow"><label for="folderSourceValue">List / collection ID or URL</label><input id="folderSourceValue" type="text" autocomplete="off"><small id="folderSourceHint"></small></div>
              <div class="field" id="folderSourceTypeRow"><label for="folderSourceType">Media type</label><select id="folderSourceType"><option value="all">Movies + Series</option><option value="movie">Movies</option><option value="series">Series</option></select></div>
              <div class="field" id="folderSourceNameRow"><label for="folderSourceName">Catalog name <span class="optional">(optional)</span></label><input id="folderSourceName" type="text" autocomplete="off" placeholder="Uses the cover folder name by default"></div>
            </section>
            <section class="folder-edit-section artwork-section">
              <div class="folder-edit-section-head"><b>Artwork and folder behavior</b><span>Edit the artwork fields Nuvio uses for collection folders.</span></div>
              <div class="field"><label for="folderCoverImage">Cover image URL</label><input id="folderCoverImage" type="url" inputmode="url" autocomplete="off" placeholder="https://…/cover.webp"><small>Poster or landscape image shown for the folder.</small></div>
              <div class="field"><label for="folderCoverEmoji">Cover emoji <span class="optional">(optional)</span></label><input id="folderCoverEmoji" type="text" autocomplete="off" placeholder="Optional fallback marker"></div>
              <div class="field"><label for="folderTitleLogo">Title logo URL</label><input id="folderTitleLogo" type="url" inputmode="url" autocomplete="off" placeholder="https://…/logo.webp"></div>
              <div class="field"><label for="folderHeroBackdrop">Hero backdrop URL</label><input id="folderHeroBackdrop" type="url" inputmode="url" autocomplete="off" placeholder="https://…/backdrop.webp"></div>
              <div class="folder-artwork-preview-grid" aria-label="Artwork previews">
                <figure class="folder-artwork-preview"><div class="folder-artwork-preview-frame cover"><img id="folderCoverPreview" alt="Cover preview"><span>Preview unavailable</span></div><figcaption>Cover</figcaption></figure>
                <figure class="folder-artwork-preview"><div class="folder-artwork-preview-frame logo"><img id="folderLogoPreview" alt="Title logo preview"><span>Preview unavailable</span></div><figcaption>Title logo</figcaption></figure>
                <figure class="folder-artwork-preview wide"><div class="folder-artwork-preview-frame backdrop"><img id="folderBackdropPreview" alt="Hero backdrop preview"><span>Preview unavailable</span></div><figcaption>Hero backdrop</figcaption></figure>
              </div>
            </section>
            <div id="folderSourceError" class="folder-source-error" role="status"></div>
          </div>
          <footer class="folder-source-actions"><button class="ghost" id="folderSourceReset" type="button">Restore defaults</button><button class="btn" id="folderSourceSave" type="button">Save changes</button></footer>
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
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
  }

  function bindPreview(root, inputSelector, imageSelector) {
    const input = root.querySelector(inputSelector);
    const image = root.querySelector(imageSelector);
    const frame = image?.closest('.folder-artwork-preview-frame');
    if (!input || !image || !frame) return;
    const update = () => {
      const url = input.value.trim();
      frame.classList.toggle('empty', !url);
      image.hidden = !url;
      if (!url) { image.removeAttribute('src'); return; }
      image.src = url;
    };
    image.onerror = () => { image.hidden = true; frame.classList.add('empty'); };
    image.onload = () => { image.hidden = false; frame.classList.remove('empty'); };
    input.oninput = update;
    update();
  }

  function openModal(group, folder, gk, fk) {
    const { state, collectionGroupKey, collectionFolderKey } = activeOptions || {};
    if (!state) return;
    const root = ensureModal();
    const mapKey = keyFor(gk, fk);
    const defaults = ensureDefaults(state, folder, gk, fk, collectionGroupKey, collectionFolderKey);
    const existing = state.collectionFolderSourceOverrides?.[mapKey] || {};
    const artwork = { ...(defaults?.artwork || artworkFrom(folder)), ...(existing.artwork || {}) };

    root.querySelector('#folderSourceTitle').textContent = `Edit ${folder.title || 'folder'}`;
    root.querySelector('#folderSourceProvider').value = existing.provider || '';
    root.querySelector('#folderSourceValue').value = existing.url || existing.id || '';
    root.querySelector('#folderSourceType').value = existing.type || 'all';
    root.querySelector('#folderSourceName').value = existing.name || '';
    root.querySelector('#folderCoverImage').value = artwork.coverImageUrl || '';
    root.querySelector('#folderCoverEmoji').value = artwork.coverEmoji || '';
    root.querySelector('#folderTitleLogo').value = artwork.titleLogoUrl || '';
    root.querySelector('#folderHeroBackdrop').value = artwork.heroBackdropUrl || '';
    root.querySelector('#folderSourceError').textContent = '';

    const syncProvider = () => {
      const provider = root.querySelector('#folderSourceProvider').value;
      root.querySelector('#folderSourceValueRow').hidden = !provider;
      root.querySelector('#folderSourceTypeRow').hidden = !provider || provider === 'tmdb';
      root.querySelector('#folderSourceNameRow').hidden = !provider;
      const input = root.querySelector('#folderSourceValue');
      const hint = root.querySelector('#folderSourceHint');
      if (!provider) { hint.textContent = ''; return; }
      if (provider === 'tmdb') { input.placeholder = 'TMDB collection ID or URL'; hint.textContent = 'TMDB collections contain movies only.'; }
      else if (provider === 'trakt') { input.placeholder = 'Trakt numeric list ID or URL'; hint.textContent = 'Public Trakt list IDs work directly.'; }
      else { input.placeholder = 'MDBList numeric list ID'; hint.textContent = 'Your saved MDBList API key is used by AIOMetadata.'; }
    };
    root.querySelector('#folderSourceProvider').onchange = syncProvider;
    syncProvider();
    bindPreview(root, '#folderCoverImage', '#folderCoverPreview');
    bindPreview(root, '#folderTitleLogo', '#folderLogoPreview');
    bindPreview(root, '#folderHeroBackdrop', '#folderBackdropPreview');

    root.querySelector('#folderSourceSave').onclick = () => {
      const provider = root.querySelector('#folderSourceProvider').value;
      const raw = root.querySelector('#folderSourceValue').value.trim();
      let sourceData = {};
      if (provider) {
        const id = extractNumericId(raw, provider);
        if (!id) {
          root.querySelector('#folderSourceError').textContent = `Enter a valid ${provider === 'tmdb' ? 'TMDB collection' : provider === 'trakt' ? 'Trakt list' : 'MDBList list'} ID or supported URL.`;
          return;
        }
        sourceData = { provider, id, url: /^https?:\/\//i.test(raw) ? raw : '', type: provider === 'tmdb' ? 'movie' : root.querySelector('#folderSourceType').value, name: root.querySelector('#folderSourceName').value.trim() };
      }
      state.collectionFolderSourceOverrides ||= {};
      state.collectionFolderSourceOverrides[mapKey] = {
        ...sourceData,
        artwork: {
          coverImageUrl: root.querySelector('#folderCoverImage').value.trim(),
          coverEmoji: root.querySelector('#folderCoverEmoji').value.trim(),
          titleLogoUrl: root.querySelector('#folderTitleLogo').value.trim(),
          heroBackdropUrl: root.querySelector('#folderHeroBackdrop').value.trim(),
        },
      };
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
      folder.sources = clone(defaults.sources || []);
      folder.catalogSources = clone(defaults.catalogSources || []);
      Object.assign(folder, clone(defaults.artwork || {}));
      state.backup = null; state.previewCollections = null; state.finalCollections = null;
      window.dispatchEvent(new CustomEvent('kollection:folder-source-overrides-changed', { detail: clone(savedOverrides) }));
      closeModal();
      window.KollectionFolderEditor?.render?.(activeOptions);
    };

    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
  }

  function addEditButtons(options) {
    const { host, state, collectionGroupKey, collectionFolderKey } = options;
    if (!state?.customizeGroupKey) return;
    const group = (state.collectionPack || []).find(item => collectionGroupKey(item) === state.customizeGroupKey);
    if (!group) return;
    const gk = collectionGroupKey(group);
    const folders = group.folders || [];

    host.querySelectorAll('.folder-edit-card-wrap').forEach((wrap, index) => {
      if (wrap.querySelector('.folder-source-edit')) return;
      const fk = wrap.dataset.orderKey || '';
      const folder = folders.find(item => collectionFolderKey(item) === fk) || folders[index];
      if (!folder) return;
      const actualKey = collectionFolderKey(folder);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'folder-source-edit';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${folder.title || 'folder'}`);
      edit.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        openModal(group, folder, gk, actualKey);
      };
      let actions = wrap.querySelector('.folder-card-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'folder-card-actions';
        wrap.appendChild(actions);
      }
      actions.appendChild(edit);
      if (state.collectionFolderSourceOverrides?.[keyFor(gk, actualKey)]) wrap.classList.add('has-custom-source');
    });
  }

  function install() {
    const original = window.KollectionFolderEditor;
    if (!original || original.__folderSourceEditorWrappedV2) return false;
    const wrapped = {
      ...original,
      __folderSourceEditorWrappedV2: true,
      render(options) {
        activeOptions = options;
        applyOverrides(options);
        const result = original.render(options);
        requestAnimationFrame(() => addEditButtons(options));
        setTimeout(() => addEditButtons(options), 80);
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
      const timer = setInterval(() => { tries += 1; if (install() || tries > 60) clearInterval(timer); }, 100);
    }
    const panel = document.getElementById('panelHost');
    if (panel) {
      new MutationObserver(() => {
        if (activeOptions) requestAnimationFrame(() => addEditButtons(activeOptions));
      }).observe(panel, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();