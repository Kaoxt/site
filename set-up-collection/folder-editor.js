(() => {
  'use strict';

  if (window.KollectionFolderEditor) return;

  const ART_BASE = 'https://raw.githubusercontent.com/Kaoxt/The-Kollection/main/images';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function folderKey(folder, makeKey) {
    // collectionFolderKey expects the folder object. Passing folder.id/title here
    // caused every folder to collapse to an empty key, so all cards toggled together.
    return makeKey(folder);
  }

  function selectedFolderKeys(state, group, groupKey, makeFolderKey) {
    state.selectedCollectionFolderIds ||= {};
    const key = groupKey(group);
    const all = [...new Set((group?.folders || []).map(folder => folderKey(folder, makeFolderKey)).filter(Boolean))];
    const existing = state.selectedCollectionFolderIds[key];
    const groupIsSelected = (state.selectedCollectionGroupIds || []).includes(key);

    // Folder selections are opt-out. A selected category starts with every folder selected.
    // Repair stale state from earlier editor builds that saved an empty/invalid key list.
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

  function filterPack(pack, state, groupKey, makeFolderKey) {
    ensureFolderSelections(state, pack || [], groupKey, makeFolderKey);
    const selectedGroups = new Set(state.selectedCollectionGroupIds || []);

    return (pack || [])
      .filter(group => selectedGroups.has(groupKey(group)))
      .map(group => {
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
      `<div class="card collection-editor-shell">
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

    const groupKey = collectionGroupKey(group);
    const folders = group.folders || [];
    const selected = selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey);
    const total = folders.length;

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
        <div class="folder-edit-grid">
          ${folders.map(folder => {
            const key = folderKey(folder, collectionFolderKey);
            const on = selected.has(key);
            return `<button class="folder-edit-card ${on ? 'selected' : 'removed'}" type="button" data-folder-key="${esc(key)}" aria-pressed="${on ? 'true' : 'false'}">
              <span class="folder-edit-image">
                ${cardImage(group, folder, esc)}
                <span class="folder-edit-shade" aria-hidden="true"></span>
                <span class="folder-edit-state" aria-hidden="true">${on ? '✓' : '×'}</span>
              </span>
              <span class="folder-edit-meta"><b>${esc(folder.title || 'Untitled folder')}</b><small>${on ? 'Included' : 'Removed'}</small></span>
            </button>`;
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
      $$('.folder-edit-card').forEach(card => {
        const on = set.has(card.dataset.folderKey || '');
        card.classList.toggle('selected', on);
        card.classList.toggle('removed', !on);
        card.setAttribute('aria-pressed', String(on));
        const stateMark = card.querySelector('.folder-edit-state');
        const status = card.querySelector('.folder-edit-meta small');
        if (stateMark) stateMark.textContent = on ? '✓' : '×';
        if (status) status.textContent = on ? 'Included' : 'Removed';
      });
    };

    $$('.folder-edit-card').forEach(card => {
      card.onclick = () => {
        const set = selectedFolderKeys(state, group, collectionGroupKey, collectionFolderKey);
        const key = card.dataset.folderKey || '';
        if (set.has(key)) set.delete(key); else set.add(key);
        writeSelection(set);
        refreshCards(set);
      };
    });

    $('#selectAllFolders').onclick = () => {
      const set = new Set(folders.map(folder => folderKey(folder, collectionFolderKey)).filter(Boolean));
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