(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const editMode = params.get('edit') === '1' && Boolean(params.get('saved'));
  const originalFetch = window.fetch.bind(window);
  let restoredPreference = null;
  let currentPreference = {
    categoryOrder: [],
    folderSortModes: {},
    folderOrders: {},
  };
  let editAdvanceBusy = false;
  let editRestoreAdvanceEnabled = editMode;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function collectionRequest(url) {
    try {
      const parsed = new URL(typeof url === 'string' ? url : url?.url || '', window.location.href);
      return /^\/api\/account\/collections(?:\/[^/]+)?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  window.fetch = async function(input, init = {}) {
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    let nextInit = init;

    if (collectionRequest(input) && (method === 'POST' || method === 'PATCH' || method === 'PUT') && init?.body) {
      try {
        const payload = JSON.parse(init.body);
        if (payload?.config && typeof payload.config === 'object') {
          payload.config.categoryOrder = Array.isArray(currentPreference.categoryOrder)
            ? currentPreference.categoryOrder.slice()
            : [];
          payload.config.folderSortModes = clone(currentPreference.folderSortModes || {});
          payload.config.folderOrders = clone(currentPreference.folderOrders || {});
          delete payload.config.categorySortMode;
          nextInit = { ...init, body: JSON.stringify(payload) };
        }
      } catch {}
    }

    const response = await originalFetch(input, nextInit);
    if (!collectionRequest(input) || method !== 'GET' || !response.ok) return response;

    try {
      const data = await response.clone().json();
      const item = data?.collection;
      if (item?.config && typeof item.config === 'object') {
        restoredPreference = {
          legacyCategoryMode: item.config.categorySortMode || '',
          categoryOrder: Array.isArray(item.config.categoryOrder) ? item.config.categoryOrder.slice() : [],
          folderSortModes: item.config.folderSortModes && typeof item.config.folderSortModes === 'object'
            ? clone(item.config.folderSortModes)
            : {},
          folderOrders: item.config.folderOrders && typeof item.config.folderOrders === 'object'
            ? clone(item.config.folderOrders)
            : {},
        };
        currentPreference = clone({
          categoryOrder: restoredPreference.categoryOrder,
          folderSortModes: restoredPreference.folderSortModes,
          folderOrders: restoredPreference.folderOrders,
        });
      }

      if (editMode && item) {
        const adjusted = clone(data);
        adjusted.collection.draftStep = 4;
        return new Response(JSON.stringify(adjusted), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {}

    return response;
  };

  function rankSort(items, keyFn, preferred) {
    const source = Array.isArray(items) ? items.slice() : [];
    const rank = new Map((preferred || []).map((key, index) => [key, index]));
    return source.sort((a, b) => {
      const ai = rank.has(keyFn(a)) ? rank.get(keyFn(a)) : Number.MAX_SAFE_INTEGER;
      const bi = rank.has(keyFn(b)) ? rank.get(keyFn(b)) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  function alphabetical(items, titleFn) {
    return (items || []).slice().sort((a, b) => String(titleFn(a) || '').localeCompare(String(titleFn(b) || ''), undefined, { sensitivity: 'base' }));
  }

  function applyFolderOrder(state, group, groupKey, folderKey) {
    if (!group) return;
    state.collectionDefaultFolderOrders ||= {};
    state.collectionFolderSortModes ||= {};
    state.collectionFolderOrders ||= {};

    const key = groupKey(group);
    if (!Array.isArray(state.collectionDefaultFolderOrders[key]) || !state.collectionDefaultFolderOrders[key].length) {
      state.collectionDefaultFolderOrders[key] = (group.folders || []).map(folderKey).filter(Boolean);
    }

    const mode = state.collectionFolderSortModes[key] || 'default';
    if (mode === 'alphabetical') {
      group.folders = alphabetical(group.folders || [], folder => folder?.title || '');
    } else if (mode === 'custom') {
      group.folders = rankSort(group.folders || [], folderKey, state.collectionFolderOrders[key] || []);
    } else {
      group.folders = rankSort(group.folders || [], folderKey, state.collectionDefaultFolderOrders[key]);
    }
  }

  function syncPreferenceFromState(state) {
    currentPreference = {
      categoryOrder: Array.isArray(state.collectionCategoryOrder) ? state.collectionCategoryOrder.slice() : [],
      folderSortModes: clone(state.collectionFolderSortModes || {}),
      folderOrders: clone(state.collectionFolderOrders || {}),
    };
  }

  function enhanceOverview(options, rerender) {
    const { state, host, collectionGroupKey } = options;
    const list = host.querySelector('.collection-category-list');
    if (!list) return;

    const rows = Array.from(list.querySelectorAll('.collection-category-row'));
    rows.forEach((row, index) => {
      if (row.querySelector('.category-order-move')) return;
      row.classList.add('custom-order-row');
      const controls = document.createElement('div');
      controls.className = 'category-order-move';
      controls.innerHTML = `
        <button type="button" class="category-move-button" data-direction="up" aria-label="Move category up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="category-move-button" data-direction="down" aria-label="Move category down" title="Move down" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button>`;
      row.appendChild(controls);

      controls.querySelectorAll('.category-move-button').forEach((button) => {
        button.onclick = () => {
          const order = rows.map(item => item.dataset.groupKey || '').filter(Boolean);
          const key = row.dataset.groupKey || '';
          const from = order.indexOf(key);
          const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
          if (from < 0 || to < 0 || to >= order.length) return;
          [order[from], order[to]] = [order[to], order[from]];
          state.collectionCategoryOrder = order;
          syncPreferenceFromState(state);
          rerender(options);
        };
      });
    });
  }

  function enhanceFolderView(options, rerender) {
    const { state, host, collectionGroupKey, collectionFolderKey } = options;
    const grid = host.querySelector('.folder-edit-grid');
    if (!grid) return;
    const group = (state.collectionPack || []).find(item => collectionGroupKey(item) === state.customizeGroupKey);
    if (!group) return;
    const groupKey = collectionGroupKey(group);

    if (!host.querySelector('.folder-sort-toolbar')) {
      const toolbar = document.createElement('div');
      toolbar.className = 'folder-sort-toolbar';
      toolbar.innerHTML = `
        <div class="folder-sort-copy"><b>Folder order</b><span>Choose how folders in this category are arranged.</span></div>
        <label class="folder-sort-select-wrap">
          <span class="visually-hidden">Folder order</span>
          <select id="folderSortMode" aria-label="Folder order">
            <option value="default">Default</option>
            <option value="alphabetical">Alphabetical</option>
            <option value="custom">Custom</option>
          </select>
        </label>`;
      grid.before(toolbar);
      const select = toolbar.querySelector('#folderSortMode');
      select.value = state.collectionFolderSortModes?.[groupKey] || 'default';
      select.onchange = () => {
        state.collectionFolderSortModes ||= {};
        state.collectionFolderOrders ||= {};
        state.collectionFolderSortModes[groupKey] = select.value;
        if (select.value === 'custom' && (!Array.isArray(state.collectionFolderOrders[groupKey]) || !state.collectionFolderOrders[groupKey].length)) {
          state.collectionFolderOrders[groupKey] = (group.folders || []).map(collectionFolderKey).filter(Boolean);
        }
        applyFolderOrder(state, group, collectionGroupKey, collectionFolderKey);
        syncPreferenceFromState(state);
        rerender(options);
      };
    }

    const mode = state.collectionFolderSortModes?.[groupKey] || 'default';
    if (mode !== 'custom') return;

    const cards = Array.from(grid.querySelectorAll('.folder-edit-card'));
    cards.forEach((card, index) => {
      if (card.querySelector('.folder-card-order')) return;
      const controls = document.createElement('span');
      controls.className = 'folder-card-order';
      controls.innerHTML = `
        <button type="button" class="folder-order-button" data-direction="up" aria-label="Move folder up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="folder-order-button" data-direction="down" aria-label="Move folder down" title="Move down" ${index === cards.length - 1 ? 'disabled' : ''}>↓</button>`;
      card.appendChild(controls);
      controls.querySelectorAll('.folder-order-button').forEach(button => {
        button.onclick = event => {
          event.stopPropagation();
          const order = cards.map(item => item.dataset.folderKey || '').filter(Boolean);
          const key = card.dataset.folderKey || '';
          const from = order.indexOf(key);
          const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
          if (from < 0 || to < 0 || to >= order.length) return;
          [order[from], order[to]] = [order[to], order[from]];
          state.collectionFolderOrders[groupKey] = order;
          group.folders = rankSort(group.folders || [], collectionFolderKey, order);
          syncPreferenceFromState(state);
          rerender(options);
        };
      });
    });
  }

  function installEditorWrapper() {
    const original = window.KollectionFolderEditor;
    if (!original || original.__categoryOrderWrappedV2) return false;

    const wrapped = {
      ...original,
      __categoryOrderWrappedV2: true,
      render(options) {
        const { state, collectionGroupKey, collectionFolderKey } = options;
        const groups = state.collectionPack || [];

        if (!Array.isArray(state.collectionDefaultGroupOrder) || !state.collectionDefaultGroupOrder.length) {
          state.collectionDefaultGroupOrder = groups.map(collectionGroupKey);
        }

        if (restoredPreference && !state.collectionOrderPreferenceRestored) {
          let categoryOrder = restoredPreference.categoryOrder.slice();
          if (!categoryOrder.length && restoredPreference.legacyCategoryMode === 'alphabetical') {
            categoryOrder = alphabetical(groups, group => group?.title || '').map(collectionGroupKey);
          }
          state.collectionCategoryOrder = categoryOrder.length ? categoryOrder : state.collectionDefaultGroupOrder.slice();
          state.collectionFolderSortModes = clone(restoredPreference.folderSortModes || {});
          state.collectionFolderOrders = clone(restoredPreference.folderOrders || {});
          state.collectionOrderPreferenceRestored = true;
        }

        state.collectionCategoryOrder ||= state.collectionDefaultGroupOrder.slice();
        state.collectionFolderSortModes ||= {};
        state.collectionFolderOrders ||= {};
        state.collectionPack = rankSort(groups, collectionGroupKey, state.collectionCategoryOrder);
        for (const group of state.collectionPack) applyFolderOrder(state, group, collectionGroupKey, collectionFolderKey);
        syncPreferenceFromState(state);

        const result = original.render(options);
        requestAnimationFrame(() => {
          if (state.customizeGroupKey) enhanceFolderView(options, wrapped.render);
          else enhanceOverview(options, wrapped.render);
        });
        return result;
      },
      filterPack(pack, state, groupKey, makeFolderKey) {
        const orderedGroups = rankSort(
          pack,
          groupKey,
          state.collectionCategoryOrder || state.collectionDefaultGroupOrder || (pack || []).map(groupKey),
        );
        for (const group of orderedGroups) applyFolderOrder(state, group, groupKey, makeFolderKey);
        return original.filterPack(orderedGroups, state, groupKey, makeFolderKey);
      },
    };

    window.KollectionFolderEditor = Object.freeze(wrapped);
    return true;
  }

  function currentStepIndex() {
    const text = document.getElementById('mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Number(match[1]) - 1 : -1;
  }

  function advanceEditRestore() {
    const step = currentStepIndex();
    if (step >= 4) {
      editRestoreAdvanceEnabled = false;
      return;
    }
    if (!editRestoreAdvanceEnabled || !editMode || editAdvanceBusy || step !== 2) return;
    const builtIn = document.getElementById('builtInTab')?.classList.contains('active');
    const key = document.getElementById('mdblist')?.value?.trim();
    const host = document.getElementById('aiHost')?.value;
    const next = document.getElementById('nextBtn');
    if (!builtIn || !key || !host || !next || next.disabled) return;

    editAdvanceBusy = true;
    setTimeout(() => {
      try {
        if (editRestoreAdvanceEnabled && currentStepIndex() === 2 && document.getElementById('mdblist')?.value?.trim()) next.click();
      } finally {
        setTimeout(() => { editAdvanceBusy = false; }, 400);
      }
    }, 120);
  }

  function init() {
    installEditorWrapper();
    const panel = document.getElementById('panelHost');
    if (panel) {
      new MutationObserver(() => {
        installEditorWrapper();
        advanceEditRestore();
      }).observe(panel, { childList: true, subtree: true });
    }
    document.addEventListener('input', advanceEditRestore, true);
    document.addEventListener('change', advanceEditRestore, true);
    setTimeout(advanceEditRestore, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
