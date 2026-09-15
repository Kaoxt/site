(() => {
  'use strict';

  if (window.KollectionFolderEditor) return;

  const ART_BASE = 'https://raw.githubusercontent.com/Kaoxt/The-Kollection/main/images';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function folderKey(folder, makeKey) {
    return makeKey(folder);
  }

  function isForYouFolder(folder) {
    return String(folder?.title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ') === 'for you';
  }

  function bingecatReady(state) {
    return !state?.bingecatSkipped &&
      Boolean(state?.bingecatManifestUrl) &&
      Boolean(state?.bingecatManifest?.id || state?.bingecatAddonId);
  }

  function folderAvailable(state, folder) {
    return !isForYouFolder(folder) || bingecatReady(state);
  }

  function selectedFolderKeys(state, group, groupKey, makeFolderKey) {
    state.selectedCollectionFolderIds ||= {};
    const key = groupKey(group);
    const all = [...new Set((group?.folders || [])
      .filter(folder => folderAvailable(state, folder))
      .map(folder => folderKey(folder, makeFolderKey))
      .filter(Boolean))];
    const existing = state.selectedCollectionFolderIds[key];
    const groupIsSelected = (state.selectedCollectionGroupIds || []).includes(key);

    if (!Array.isArray(existing) || (groupIsSelected && existing.length === 0 && all.length)) {
      state.selectedCollectionFolderIds[key] = all.slice();
      return new Set(all);
    }

    const valid = new Set(all);
    const cleaned = [...new Set(existing.filter(id => valid.has(id)))];

    if (groupIsSelected && existing.length > 0 && cleaned.length === 0 && all.length) {
      state.selectedCollectionFolderIds[key] = all.slice();
      return new Set(all);
    }

    if (cleaned.length !== existing.length || cleaned.some((id, index) => id !== existing[index])) {
      state.selectedCollectionFolderIds[key] = cleaned;
    }
    return new Set(cleaned);
  }

  function ensureFolderSelections(state, groups, groupKey, makeFolderKey) {
    state.selectedCollectionFolderIds ||= {};
    for (const group of groups || []) selectedFolderKeys(state, group, groupKey, makeFolderKey);
  }

  function emitSelection(state) {
    window.dispatchEvent(new CustomEvent('kollection:collection-selection-changed', {
      detail: {
        selectedCollectionGroupIds: Array.isArray(state.selectedCollectionGroupIds)
          ? state.selectedCollectionGroupIds.slice()
          : [],
        selectedCollectionFolderIds: clone(state.selectedCollectionFolderIds || {}),
      },
    }));
  }

  function invalidate(state) {
    state.backup = null;
    state.previewCollections = null;
    state.finalCollections = null;
    emitSelection(state);
  }

  function encodePath(path) {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join('/');
  }

  function artworkCandidates(group, folder) {
    const candidates = [];
    const original = String(folder?.coverImageUrl || '').trim();

    if (original) {
      try {
        const parsed = new URL(original, window.location.href);
        const legacyPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
        if (legacyPath) candidates.push(`${ART_BASE}/${encodePath(legacyPath)}`);
      } catch {}
    }

    if (group?.title && folder?.title) {
      candidates.push(`${ART_BASE}/${encodePath(`${group.title}/${folder.title}/cover.webp`)}`);
    }

    if (original) candidates.push(original);
    return [...new Set(candidates.filter(Boolean))];
  }

  function cardImage(group, folder, esc) {
    const candidates = artworkCandidates(group, folder);
    if (!candidates.length) return '<span class="folder-art-fallback" aria-hidden="true"></span>';
    const first = candidates[0];
    const rest = candidates.slice(1);
    return `<img class="folder-edit-art" src="${esc(first)}" alt="" loading="lazy" decoding="async" data-fallbacks="${esc(JSON.stringify(rest))}">`;
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll('img[data-fallbacks]').forEach(img => {
      img.addEventListener('error', () => {
        let list = [];
        try { list = JSON.parse(img.dataset.fallbacks || '[]'); } catch {}
        const next = list.shift();
        if (next) {
          img.dataset.fallbacks = JSON.stringify(list);
          img.src = next;
          return;
        }
        img.hidden = true;
        img.parentElement?.classList.add('art-missing');
      });
    });
  }

  function rankSort(items, keyFn, preferred) {
    const source = Array.isArray(items) ? items.slice() : [];
    const rank = new Map((preferred || []).map((key, index) => [key, index]));
    return source.sort((a, b) => {
      const ak = keyFn(a);
      const bk = keyFn(b);
      const ai = rank.has(ak) ? rank.get(ak) : Number.MAX_SAFE_INTEGER;
      const bi = rank.has(bk) ? rank.get(bk) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  function alphabetical(items) {
    return (items || []).slice().sort((a, b) =>
      String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' })
    );
  }

  function ensureFolderOrderState(state, group, groupKey, makeFolderKey) {
    const key = groupKey(group);
    state.collectionFolderSortModes ||= {};
    state.collectionFolderOrders ||= {};
    state.collectionDefaultFolderOrders ||= {};

    if (!Array.isArray(state.collectionDefaultFolderOrders[key]) || !state.collectionDefaultFolderOrders[key].length) {
      state.collectionDefaultFolderOrders[key] = (group.folders || []).map(folder => folderKey(folder, makeFolderKey)).filter(Boolean);
    }
    return key;
  }

  function applyFolderOrder(state, group, groupKey, makeFolderKey) {
    const key = ensureFolderOrderState(state, group, groupKey, makeFolderKey);
    const mode = state.collectionFolderSortModes[key] || 'default';
    if (mode === 'alphabetical') {
      group.folders = alphabetical(group.folders || []);
    } else if (mode === 'custom') {
      group.folders = rankSort(group.folders || [], folder => folderKey(folder, makeFolderKey), state.collectionFolderOrders[key] || []);
    } else {
      group.folders = rankSort(group.folders || [], folder => folderKey(folder, makeFolderKey), state.collectionDefaultFolderOrders[key] || []);
    }
  }

  function filterPack(pack, state, groupKey, makeFolderKey) {
    ensureFolderSelections(state, pack || [], groupKey, makeFolderKey);
    const selectedGroups = new Set(state.selectedCollectionGroupIds || []);

    return (pack || [])
      .filter(group => selectedGroups.has(groupKey(group)))
      .map(group => {
        applyFolderOrder(state, group, groupKey, makeFolderKey);
        const selectedFolders = selectedFolderKeys(state, group, groupKey, makeFolderKey);
        const next = clone(group);
        next.folders = (next.folders || []).filter(folder => selectedFolders.has(folderKey(folder, makeFolderKey)));
        return next;
      })
      .filter(group => (group.folders || []).length > 0);
  }

  function countSelectedFolders(state, groups, groupKey, makeFolderKey) {
    const selectedGroups = new Set(state.selectedCollectionGroupIds || []);
    return (groups || []).reduce((count, group) => {
      if (!selectedGroups.has(groupKey(group))) return count;
      return count + selectedFolderKeys(state, group, groupKey, makeFolderKey).size;
    }, 0);
  }

  const SMART_OVERLAY_TAGS = Object.freeze([
    ['trend', 'Trend Tag'],
    ['quality', 'Quality'],
    ['genre', 'Genre'],
    ['rating', 'Rating'],
    ['age', 'Age Rating'],
  ]);

  const SMART_TREND_DETAILS = Object.freeze([
    ['studio', 'Notable Studios'],
    ['director', 'Notable Directors'],
    ['cast', 'Notable Cast'],
    ['inCinema', 'In Cinema'],
    ['rank', 'Daily Rank'],
    ['newMovie', 'New Movie'],
    ['comingSoon', 'Coming Soon'],
    ['newSeries', 'New Series'],
    ['returningSeries', 'Returning Series'],
    ['limitedSeries', 'Limited Series'],
  ]);

  function editingSavedSetup() {
    const params = new URLSearchParams(window.location.search);
    return params.get('edit') === '1' && Boolean(params.get('saved'));
  }

  function currentPosterSettings(state) {
    const helper = window.KollectionPosterSettings;
    if (!helper) return {
      source: 'smart',
      tags: ['trend', 'genre', 'rating'],
      ratingSource: 'average',
      trendDetails: SMART_TREND_DETAILS.map(([value]) => value),
    };
    return helper.normalize(state.posterSettings || helper.readLocal?.() || {});
  }

  function smartOverlayEditorHtml(state, esc) {
    if (!editingSavedSetup()) return '';
    const settings = currentPosterSettings(state);
    state.posterSettings = settings;
    const enabled = Boolean(state.posterOverlaysEnabled);
    const summary = window.KollectionPosterSettings?.label(settings) || 'Smart Overlay Posters';

    return `
      <section class="existing-smart-overlay-editor" aria-labelledby="existingSmartOverlayTitle">
        <div class="existing-smart-overlay-copy-main">
          <h3 id="existingSmartOverlayTitle">Smart Overlay Posters</h3>
          <p id="existingSmartOverlaySummary">${enabled ? esc(summary) : 'Smart Overlay Posters are off for this collection.'}</p>
        </div>
        <div class="existing-smart-overlay-actions">
          <button class="ghost small" id="configureSmartOverlayBtn" type="button" aria-haspopup="dialog" aria-controls="smartOverlayModalRoot">Configure</button>
        </div>
        <input id="posterOverlaysEnabled" type="checkbox" ${enabled ? 'checked' : ''} hidden>
        <input id="posterSettingsJson" type="hidden" value="${esc(JSON.stringify(settings))}">
      </section>`;
  }

  function closeSmartOverlayModal(root) {
    if (!root) return;
    root.remove();
    document.documentElement.classList.remove('smart-overlay-modal-open');
  }

  function openSmartOverlayModal(state, host, invalidateState) {
    document.getElementById('smartOverlayModalRoot')?.remove();

    const helper = window.KollectionPosterSettings;
    const current = currentPosterSettings(state);
    const tags = new Set(current.tags || []);
    const trendDetails = new Set(current.trendDetails || []);
    const root = document.createElement('div');
    root.id = 'smartOverlayModalRoot';
    root.className = 'smart-overlay-modal-root';
    root.innerHTML = `
      <div class="smart-overlay-modal-backdrop">
        <section class="smart-overlay-modal" role="dialog" aria-modal="true" aria-labelledby="smartOverlayModalTitle">
          <header class="smart-overlay-modal-head">
            <div>
              <h3 id="smartOverlayModalTitle">Smart Overlay Posters</h3>
              <p>Choose which poster overlays this saved collection should use in Nuvio.</p>
            </div>
            <button class="smart-overlay-modal-x" type="button" aria-label="Close Smart Overlay Posters"></button>
          </header>
          <div class="smart-overlay-modal-body">
            <label class="smart-overlay-modal-master">
              <input id="smartOverlayModalEnabled" type="checkbox" ${state.posterOverlaysEnabled ? 'checked' : ''}>
              <span><b>Use Smart Overlay Posters</b><small>Apply your selected overlays across Home rows, collection folders, and AIOMetadata posters.</small></span>
            </label>

            <div id="smartOverlayModalControls" class="smart-overlay-modal-controls" ${state.posterOverlaysEnabled ? '' : 'hidden'}>
              <div class="smart-overlay-modal-group">
                <div class="smart-overlay-modal-group-copy"><b>Poster overlays</b><span>Turn individual overlay types on or off.</span></div>
                <div class="smart-overlay-modal-grid">
                  ${SMART_OVERLAY_TAGS.map(([value, label]) => `
                    <label class="smart-overlay-modal-choice">
                      <input type="checkbox" data-smart-overlay-tag value="${value}" ${tags.has(value) ? 'checked' : ''}>
                      <span>${label}</span>
                    </label>`).join('')}
                </div>
              </div>

              <div id="smartOverlayModalTrendDetails" class="smart-overlay-modal-group" ${tags.has('trend') ? '' : 'hidden'}>
                <div class="smart-overlay-modal-group-copy"><b>Trend Tag details</b><span>Choose which labels are allowed in the Trend Tag area.</span></div>
                <div class="smart-overlay-modal-grid trend-details">
                  ${SMART_TREND_DETAILS.map(([value, label]) => `
                    <label class="smart-overlay-modal-choice">
                      <input type="checkbox" data-smart-trend-detail value="${value}" ${trendDetails.has(value) ? 'checked' : ''}>
                      <span>${label}</span>
                    </label>`).join('')}
                </div>
              </div>

              <div class="smart-overlay-modal-advanced">
                <span>Need poster source, rating provider, or other advanced options?</span>
                <a class="ghost small" href="/posters" target="_blank" rel="noopener">Advanced settings</a>
              </div>
            </div>

            <p id="smartOverlayModalStatus" class="smart-overlay-modal-status" role="status"></p>
          </div>
          <footer class="smart-overlay-modal-footer">
            <button class="smart-overlay-modal-button" id="cancelSmartOverlayBtn" type="button">Cancel</button>
            <button class="smart-overlay-modal-button primary" id="saveSmartOverlayBtn" type="button">Save changes</button>
          </footer>
        </section>
      </div>`;

    document.body.appendChild(root);
    document.documentElement.classList.add('smart-overlay-modal-open');

    const backdrop = root.querySelector('.smart-overlay-modal-backdrop');
    const closeButton = root.querySelector('.smart-overlay-modal-x');
    const cancelButton = root.querySelector('#cancelSmartOverlayBtn');
    const saveButton = root.querySelector('#saveSmartOverlayBtn');
    const enabledInput = root.querySelector('#smartOverlayModalEnabled');
    const controls = root.querySelector('#smartOverlayModalControls');
    const trendGroup = root.querySelector('#smartOverlayModalTrendDetails');
    const status = root.querySelector('#smartOverlayModalStatus');

    const refreshVisibility = () => {
      controls.hidden = !enabledInput.checked;
      const trendOn = Boolean(root.querySelector('[data-smart-overlay-tag][value="trend"]')?.checked);
      if (trendGroup) trendGroup.hidden = !enabledInput.checked || !trendOn;
      status.textContent = '';
    };

    let keyHandler = null;
    const close = () => {
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      closeSmartOverlayModal(root);
    };
    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) close();
    });
    enabledInput.addEventListener('change', refreshVisibility);
    root.querySelectorAll('[data-smart-overlay-tag]').forEach(input => input.addEventListener('change', refreshVisibility));

    keyHandler = event => {
      if (event.key !== 'Escape' || !document.body.contains(root)) return;
      close();
    };
    document.addEventListener('keydown', keyHandler);

    saveButton.addEventListener('click', () => {
      const nextEnabled = Boolean(enabledInput.checked);
      const nextTags = [...root.querySelectorAll('[data-smart-overlay-tag]:checked')].map(input => input.value);
      const nextTrendDetails = [...root.querySelectorAll('[data-smart-trend-detail]:checked')].map(input => input.value);

      if (nextEnabled && nextTags.includes('trend') && !nextTrendDetails.length) {
        status.textContent = 'Choose at least one Trend Tag detail, or turn off Trend Tag.';
        return;
      }

      const nextSettings = helper
        ? helper.normalize({ ...current, tags: nextTags, trendDetails: nextTrendDetails })
        : { ...current, tags: nextTags, trendDetails: nextTrendDetails };

      state.posterOverlaysEnabled = nextEnabled;
      state.posterSettings = nextSettings;

      const savedEnabled = host.querySelector('#posterOverlaysEnabled');
      const savedJson = host.querySelector('#posterSettingsJson');
      const summary = host.querySelector('#existingSmartOverlaySummary');
      if (savedEnabled) savedEnabled.checked = nextEnabled;
      if (savedJson) savedJson.value = JSON.stringify(nextSettings);
      if (summary) summary.textContent = nextEnabled
        ? (helper?.label(nextSettings) || 'Smart Overlay Posters')
        : 'Smart Overlay Posters are off for this collection.';
      invalidateState(state);
      window.dispatchEvent(new CustomEvent('kollection:poster-settings-changed', {
        detail: {
          enabled: nextEnabled,
          settings: clone(nextSettings),
          source: 'existing-setup',
        },
      }));
      close();
    });

    refreshVisibility();
    setTimeout(() => closeButton.focus(), 0);
  }

  function bindSmartOverlayEditor(state, host, invalidateState) {
    if (!editingSavedSetup()) return;
    const configure = host.querySelector('#configureSmartOverlayBtn');
    if (!configure) return;
    configure.addEventListener('click', () => openSmartOverlayModal(state, host, invalidateState));
  }

  function render(options) {
    const {
      state, host, panel, $, $$, esc, alert, loading, setStep,
      collectionGroupKey, collectionFolderKey, groupStats, packUsesBingecat, prepareReview,
    } = options;

    const groups = state.collectionPack || [];
    ensureFolderSelections(state, groups, collectionGroupKey, collectionFolderKey);
    emitSelection(state);

    const activeKey = state.customizeGroupKey || null;
    const activeGroup = groups.find(group => collectionGroupKey(group) === activeKey);
    if (activeGroup) {
      renderGroupEditor(activeGroup, options);
      return true;
    }

    const selectedGroups = new Set(state.selectedCollectionGroupIds || []);
    const selectedCount = groups.filter(group => selectedGroups.has(collectionGroupKey(group))).length;
    const folderCount = countSelectedFolders(state, groups, collectionGroupKey, collectionFolderKey);

    host.innerHTML = panel(
      'STEP 5 · CUSTOMIZE',
      'Choose and edit your collection',
      'Choose the sections you want first, then open any selected section to remove individual folders. Only the folders you keep will be added to Nuvio and used to prepare AIOMetadata.',
      `${smartOverlayEditorHtml(state, esc)}
      <div class="card collection-editor-shell">
        <div class="collection-select-toolbar">
          <div>
            <b id="sectionSelectionCount">${selectedCount} of ${groups.length} sections selected</b>
            <span id="folderSelectionCount">${folderCount} folders included</span>
          </div>
          <div class="action-group">
            <button class="ghost small" id="selectAllSections" type="button">Select all</button>
            <button class="ghost small" id="clearSections" type="button">Clear all</button>
          </div>
        </div>
        <div class="collection-category-list">
          ${groups.map(group => {
            const key = collectionGroupKey(group);
            const on = selectedGroups.has(key);
            const stats = groupStats(group);
            const selectedFolders = selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey).size;
            return `<div class="collection-category-row ${on ? 'selected' : ''}" data-group-key="${esc(key)}">
              <label class="collection-category-toggle">
                <input class="section-checkbox" type="checkbox" value="${esc(key)}" ${on ? 'checked' : ''}>
                <span class="collection-section-check" aria-hidden="true"></span>
                <span class="collection-category-copy">
                  <b>${esc(group.title || 'Untitled section')}</b>
                  <small data-category-count>${selectedFolders} of ${stats.folders} folders selected${packUsesBingecat([group]) ? ' · includes For You' : ''}</small>
                </span>
              </label>
              <button class="collection-edit-button" type="button" data-edit-group="${esc(key)}" ${on ? '' : 'disabled'}>Edit</button>
            </div>`;
          }).join('')}
        </div>
        <div class="callout" style="margin-top:18px"><strong>Your choices control the final collection.</strong> Removing a folder here also prevents AIOMetadata catalogs used only by that folder from being provisioned. Unrelated personal Nuvio groups remain untouched.</div>
        <div class="actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="nextBtn" ${selectedCount ? '' : 'disabled'}>Continue to review</button></div>
      </div>`
    );

    bindSmartOverlayEditor(state, host, invalidate);

    const syncOverview = () => {
      state.selectedCollectionGroupIds = $$('.section-checkbox:checked').map(input => input.value);
      state.collectionSelectionInitialized = true;
      const selectedNow = new Set(state.selectedCollectionGroupIds);

      for (const group of groups) {
        const key = collectionGroupKey(group);
        const row = host.querySelector(`.collection-category-row[data-group-key="${CSS.escape(key)}"]`);
        const checked = selectedNow.has(key);
        if (checked) selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey);
        row?.classList.toggle('selected', checked);
        const editButton = row?.querySelector('[data-edit-group]');
        if (editButton) editButton.disabled = !checked;
      }

      const groupCount = groups.filter(group => selectedNow.has(collectionGroupKey(group))).length;
      const selectedFolders = countSelectedFolders(state, groups, collectionGroupKey, collectionFolderKey);
      $('#sectionSelectionCount').textContent = `${groupCount} of ${groups.length} sections selected`;
      $('#folderSelectionCount').textContent = `${selectedFolders} folders included`;
      $('#nextBtn').disabled = groupCount === 0 || selectedFolders === 0;
      invalidate(state);
    };

    $$('.section-checkbox').forEach(input => { input.onchange = syncOverview; });

    $$('[data-edit-group]').forEach(button => {
      button.onclick = () => {
        if (button.disabled) return;
        state.customizeGroupKey = button.dataset.editGroup || null;
        render(options);
      };
    });

    $('#selectAllSections').onclick = () => {
      $$('.section-checkbox').forEach(input => { input.checked = true; });
      for (const group of groups) {
        const key = collectionGroupKey(group);
        state.selectedCollectionFolderIds[key] = (group.folders || [])
          .filter(folder => folderAvailable(state, folder))
          .map(folder => folderKey(folder, collectionFolderKey))
          .filter(Boolean);
      }
      syncOverview();
    };

    $('#clearSections').onclick = () => {
      $$('.section-checkbox').forEach(input => { input.checked = false; });
      syncOverview();
    };

    $('#backBtn').onclick = () => setStep(3);
    $('#nextBtn').onclick = async () => {
      syncOverview();
      const selectedPack = filterPack(state.collectionPack || [], state, collectionGroupKey, collectionFolderKey);
      if (!selectedPack.length) return alert('Choose at least one collection folder to continue.', 'error');
      try {
        loading('Preparing your selected collection folders…');
        await prepareReview();
        setStep(5);
      } catch (error) {
        state.customizeGroupKey = null;
        render(options);
        alert(error.message, 'error');
      }
    };

    return true;
  }

  function renderGroupEditor(group, options) {
    const {
      state, host, panel, $, $$, esc,
      collectionGroupKey, collectionFolderKey,
    } = options;

    const groupKey = ensureFolderOrderState(state, group, collectionGroupKey, collectionFolderKey);
    applyFolderOrder(state, group, collectionGroupKey, collectionFolderKey);
    const folders = group.folders || [];
    const selected = selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey);
    const total = folders.length;
    const sortMode = state.collectionFolderSortModes[groupKey] || 'default';

    host.innerHTML = panel(
      'STEP 5 · CUSTOMIZE',
      `Edit ${esc(group.title || 'collection section')}`,
      'Tap a folder to include or remove it. Your artwork is loaded from the The-Kollection image repository so this editor matches the collection you will see in Nuvio.',
      `<div class="card collection-editor-shell folder-editor-view">
        <div class="folder-editor-toolbar">
          <button class="ghost small folder-editor-back" id="doneEditingBtn" type="button">← Categories</button>
          <div class="folder-editor-count"><b id="folderEditCount">${selected.size} of ${total} folders selected</b><span>Removed folders will not be added to this section.</span></div>
          <div class="action-group">
            <button class="ghost small" id="selectAllFolders" type="button">Select all</button>
            <button class="ghost small" id="clearFolders" type="button">Clear all</button>
          </div>
        </div>
        <div class="folder-sort-toolbar">
          <div class="folder-sort-copy"><b>Folder order</b><span>Choose how cover images in this category are arranged.</span></div>
          <label class="folder-sort-select-wrap">
            <span class="visually-hidden">Folder order</span>
            <select id="folderSortMode" aria-label="Folder order">
              <option value="default" ${sortMode === 'default' ? 'selected' : ''}>Default</option>
              <option value="alphabetical" ${sortMode === 'alphabetical' ? 'selected' : ''}>Alphabetical</option>
              <option value="custom" ${sortMode === 'custom' ? 'selected' : ''}>Custom</option>
            </select>
          </label>
        </div>
        <div class="folder-edit-grid">
          ${folders.map((folder, index) => {
            const key = folderKey(folder, collectionFolderKey);
            const available = folderAvailable(state, folder);
            const on = available && selected.has(key);
            return `<div class="folder-edit-card-wrap ${available ? '' : 'bingecat-unavailable'}" data-order-key="${esc(key)}">
              <button class="folder-edit-card ${on ? 'selected' : 'removed'}" type="button" data-folder-key="${esc(key)}" data-folder-available="${available ? 'true' : 'false'}" aria-pressed="${on ? 'true' : 'false'}" ${available ? '' : 'disabled'}>
                <span class="folder-edit-image">
                  ${cardImage(group, folder, esc)}
                  <span class="folder-edit-shade" aria-hidden="true"></span>
                  <span class="folder-edit-state" aria-hidden="true">${on ? '✓' : '×'}</span>
                </span>
                <span class="folder-edit-meta"><b>${esc(folder.title || 'Untitled folder')}</b><small>${available ? (on ? 'Included' : 'Removed') : 'Bingecat not set up'}</small></span>
              </button>
              ${sortMode === 'custom' ? `<div class="folder-card-order">
                <button type="button" class="folder-order-button" data-direction="up" aria-label="Move ${esc(folder.title || 'folder')} up" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="folder-order-button" data-direction="down" aria-label="Move ${esc(folder.title || 'folder')} down" ${index === folders.length - 1 ? 'disabled' : ''}>↓</button>
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="actions folder-editor-actions"><button class="ghost" id="doneEditingBottomBtn" type="button">Done editing</button></div>
      </div>`
    );

    bindImageFallbacks(host);

    const writeSelection = (set) => {
      state.selectedCollectionFolderIds[groupKey] = [...set];
      const groups = new Set(state.selectedCollectionGroupIds || []);
      if (set.size) groups.add(groupKey);
      else groups.delete(groupKey);
      state.selectedCollectionGroupIds = [...groups];
      state.collectionSelectionInitialized = true;
      invalidate(state);
    };

    const refreshCards = (set) => {
      $('#folderEditCount').textContent = `${set.size} of ${total} folders selected`;
      $('.folder-edit-card').forEach(card => {
        const available = card.dataset.folderAvailable !== 'false';
        const on = available && set.has(card.dataset.folderKey || '');
        card.classList.toggle('selected', on);
        card.classList.toggle('removed', !on);
        card.setAttribute('aria-pressed', String(on));
        const stateMark = card.querySelector('.folder-edit-state');
        const status = card.querySelector('.folder-edit-meta small');
        if (stateMark) stateMark.textContent = on ? '✓' : '×';
        if (status) status.textContent = available ? (on ? 'Included' : 'Removed') : 'Bingecat not set up';
      });
    };

    $('.folder-edit-card').forEach(card => {
      card.onclick = () => {
        if (card.dataset.folderAvailable === 'false') return;
        const set = selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey);
        const key = card.dataset.folderKey || '';
        if (set.has(key)) set.delete(key); else set.add(key);
        writeSelection(set);
        refreshCards(set);
      };
    });

    $('#folderSortMode').onchange = (event) => {
      const mode = event.target.value;
      state.collectionFolderSortModes[groupKey] = mode;
      if (mode === 'custom' && (!Array.isArray(state.collectionFolderOrders[groupKey]) || !state.collectionFolderOrders[groupKey].length)) {
        state.collectionFolderOrders[groupKey] = folders.map(folder => folderKey(folder, collectionFolderKey)).filter(Boolean);
      }
      applyFolderOrder(state, group, collectionGroupKey, collectionFolderKey);
      invalidate(state);
      renderGroupEditor(group, options);
    };

    $$('.folder-order-button').forEach(button => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wrappers = $$('.folder-edit-card-wrap');
        const wrapper = button.closest('.folder-edit-card-wrap');
        const order = wrappers.map(item => item.dataset.orderKey || '').filter(Boolean);
        const key = wrapper?.dataset.orderKey || '';
        const from = order.indexOf(key);
        const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        state.collectionFolderOrders[groupKey] = order;
        group.folders = rankSort(group.folders || [], folder => folderKey(folder, collectionFolderKey), order);
        invalidate(state);
        renderGroupEditor(group, options);
      };
    });

    $('#selectAllFolders').onclick = () => {
      const set = new Set(folders
        .filter(folder => folderAvailable(state, folder))
        .map(folder => folderKey(folder, collectionFolderKey))
        .filter(Boolean));
      writeSelection(set);
      refreshCards(set);
    };

    $('#clearFolders').onclick = () => {
      const set = new Set();
      writeSelection(set);
      refreshCards(set);
    };

    const done = () => {
      state.customizeGroupKey = null;
      render(options);
    };
    $('#doneEditingBtn').onclick = done;
    $('#doneEditingBottomBtn').onclick = done;
  }

  window.KollectionFolderEditor = Object.freeze({ render, filterPack, ensureFolderSelections });
})();