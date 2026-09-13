(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const editMode = params.get('edit') === '1' && Boolean(params.get('saved'));
  const originalFetch = window.fetch.bind(window);
  let restoredPreference = null;
  let currentPreference = { mode: 'default', order: [] };
  let editAdvanceBusy = false;

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

  // Keep category ordering in the existing saved-setup config without changing the API schema.
  // In edit mode, completed setups are presented to the restore layer as Step 5 so the user
  // lands directly in Customize rather than being pushed through Review/Done again.
  window.fetch = async function(input, init = {}) {
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    let nextInit = init;

    if (collectionRequest(input) && (method === 'POST' || method === 'PATCH' || method === 'PUT') && init?.body) {
      try {
        const payload = JSON.parse(init.body);
        if (payload?.config && typeof payload.config === 'object') {
          payload.config.categorySortMode = currentPreference.mode || 'default';
          payload.config.categoryOrder = Array.isArray(currentPreference.order) ? currentPreference.order.slice() : [];
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
          mode: ['default', 'alphabetical', 'custom'].includes(item.config.categorySortMode)
            ? item.config.categorySortMode
            : 'default',
          order: Array.isArray(item.config.categoryOrder) ? item.config.categoryOrder.slice() : [],
        };
        currentPreference = clone(restoredPreference);
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

  function groupOrder(groups, groupKey, mode, customOrder, defaultOrder) {
    const source = Array.isArray(groups) ? groups.slice() : [];
    if (mode === 'alphabetical') {
      return source.sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' }));
    }

    const preferred = mode === 'custom' ? customOrder : defaultOrder;
    const rank = new Map((preferred || []).map((key, index) => [key, index]));
    return source.sort((a, b) => {
      const aKey = groupKey(a);
      const bKey = groupKey(b);
      const ai = rank.has(aKey) ? rank.get(aKey) : Number.MAX_SAFE_INTEGER;
      const bi = rank.has(bKey) ? rank.get(bKey) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  function enhanceOverview(options, rerender) {
    const { state, host, collectionGroupKey } = options;
    const list = host.querySelector('.collection-category-list');
    if (!list || host.querySelector('.category-order-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'category-order-toolbar';
    toolbar.innerHTML = `
      <div class="category-order-copy">
        <b>Category order</b>
        <span>Choose the original order, alphabetical order, or arrange categories yourself.</span>
      </div>
      <label class="category-order-select-wrap">
        <span class="visually-hidden">Category order</span>
        <select id="categoryOrderMode" aria-label="Category order">
          <option value="default">Default</option>
          <option value="alphabetical">Alphabetical</option>
          <option value="custom">Custom</option>
        </select>
      </label>`;
    list.before(toolbar);

    const select = toolbar.querySelector('#categoryOrderMode');
    select.value = state.collectionCategorySortMode || 'default';
    select.onchange = () => {
      state.collectionCategorySortMode = select.value;
      if (select.value === 'custom' && (!Array.isArray(state.collectionCategoryOrder) || !state.collectionCategoryOrder.length)) {
        state.collectionCategoryOrder = (state.collectionPack || []).map(collectionGroupKey);
      }
      currentPreference = {
        mode: state.collectionCategorySortMode,
        order: Array.isArray(state.collectionCategoryOrder) ? state.collectionCategoryOrder.slice() : [],
      };
      rerender(options);
    };

    if ((state.collectionCategorySortMode || 'default') !== 'custom') return;

    const rows = Array.from(list.querySelectorAll('.collection-category-row'));
    rows.forEach((row, index) => {
      row.classList.add('custom-order-row');
      const controls = document.createElement('div');
      controls.className = 'category-order-move';
      controls.innerHTML = `
        <button type="button" class="category-move-button" data-direction="up" aria-label="Move category up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="category-move-button" data-direction="down" aria-label="Move category down" title="Move down" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button>`;
      row.appendChild(controls);

      controls.querySelectorAll('.category-move-button').forEach((button) => {
        button.onclick = () => {
          const key = row.dataset.groupKey || '';
          const order = rows.map((item) => item.dataset.groupKey || '').filter(Boolean);
          const from = order.indexOf(key);
          const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
          if (from < 0 || to < 0 || to >= order.length) return;
          [order[from], order[to]] = [order[to], order[from]];
          state.collectionCategoryOrder = order;
          currentPreference = { mode: 'custom', order: order.slice() };
          rerender(options);
        };
      });
    });
  }

  function installEditorWrapper() {
    const original = window.KollectionFolderEditor;
    if (!original || original.__categoryOrderWrapped) return false;

    const wrapped = {
      ...original,
      __categoryOrderWrapped: true,
      render(options) {
        const { state, collectionGroupKey } = options;
        const groups = state.collectionPack || [];

        if (!Array.isArray(state.collectionDefaultGroupOrder) || !state.collectionDefaultGroupOrder.length) {
          state.collectionDefaultGroupOrder = groups.map(collectionGroupKey);
        }

        if (restoredPreference && !state.collectionCategoryPreferenceRestored) {
          state.collectionCategorySortMode = restoredPreference.mode;
          state.collectionCategoryOrder = restoredPreference.order.slice();
          state.collectionCategoryPreferenceRestored = true;
        }

        state.collectionCategorySortMode ||= 'default';
        state.collectionCategoryOrder ||= [];
        state.collectionPack = groupOrder(
          groups,
          collectionGroupKey,
          state.collectionCategorySortMode,
          state.collectionCategoryOrder,
          state.collectionDefaultGroupOrder,
        );

        currentPreference = {
          mode: state.collectionCategorySortMode,
          order: Array.isArray(state.collectionCategoryOrder) ? state.collectionCategoryOrder.slice() : [],
        };

        const result = original.render(options);
        requestAnimationFrame(() => enhanceOverview(options, wrapped.render));
        return result;
      },
      filterPack(pack, state, groupKey, makeFolderKey) {
        const ordered = groupOrder(
          pack,
          groupKey,
          state.collectionCategorySortMode || 'default',
          state.collectionCategoryOrder || [],
          state.collectionDefaultGroupOrder || (pack || []).map(groupKey),
        );
        return original.filterPack(ordered, state, groupKey, makeFolderKey);
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
    if (!editMode || editAdvanceBusy || currentStepIndex() !== 2) return;
    const builtIn = document.getElementById('builtInTab')?.classList.contains('active');
    const key = document.getElementById('mdblist')?.value?.trim();
    const host = document.getElementById('aiHost')?.value;
    const next = document.getElementById('nextBtn');
    if (!builtIn || !key || !host || !next || next.disabled) return;

    editAdvanceBusy = true;
    setTimeout(() => {
      try {
        if (currentStepIndex() === 2 && document.getElementById('mdblist')?.value?.trim()) next.click();
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
