(() => {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));

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

  function install() {
    const editor = window.KollectionFolderEditor;
    if (!editor || editor.__folderOrderUiWrapped) return false;

    const wrapped = {
      ...editor,
      __folderOrderUiWrapped: true,
      render(options) {
        const result = editor.render(options);
        requestAnimationFrame(() => enhance(options, wrapped));
        return result;
      },
    };

    window.KollectionFolderEditor = Object.freeze(wrapped);
    return true;
  }

  function enhance(options, wrapped) {
    const { state, host, collectionGroupKey, collectionFolderKey } = options;
    const grid = host?.querySelector('.folder-edit-grid');
    if (!grid || !state?.customizeGroupKey) return;

    const group = (state.collectionPack || []).find(item => collectionGroupKey(item) === state.customizeGroupKey);
    if (!group) return;

    const groupKey = collectionGroupKey(group);
    state.collectionFolderSortModes ||= {};
    state.collectionFolderOrders ||= {};
    state.collectionDefaultFolderOrders ||= {};

    if (!Array.isArray(state.collectionDefaultFolderOrders[groupKey]) || !state.collectionDefaultFolderOrders[groupKey].length) {
      state.collectionDefaultFolderOrders[groupKey] = (group.folders || []).map(collectionFolderKey).filter(Boolean);
    }

    let toolbar = host.querySelector('.folder-sort-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'folder-sort-toolbar';
      toolbar.innerHTML = `
        <div class="folder-sort-copy">
          <b>Folder order</b>
          <span>Choose how folders in this category are arranged.</span>
        </div>
        <label class="folder-sort-select-wrap">
          <span class="visually-hidden">Folder order</span>
          <select id="folderSortMode" aria-label="Folder order">
            <option value="default">Default</option>
            <option value="alphabetical">Alphabetical</option>
            <option value="custom">Custom</option>
          </select>
        </label>`;
      grid.before(toolbar);
    }

    const select = toolbar.querySelector('#folderSortMode');
    const mode = state.collectionFolderSortModes[groupKey] || 'default';
    select.value = mode;

    select.onchange = () => {
      const nextMode = select.value;
      state.collectionFolderSortModes[groupKey] = nextMode;

      if (nextMode === 'custom') {
        if (!Array.isArray(state.collectionFolderOrders[groupKey]) || !state.collectionFolderOrders[groupKey].length) {
          state.collectionFolderOrders[groupKey] = (group.folders || []).map(collectionFolderKey).filter(Boolean);
        }
        group.folders = rankSort(group.folders || [], collectionFolderKey, state.collectionFolderOrders[groupKey]);
      } else if (nextMode === 'alphabetical') {
        group.folders = alphabetical(group.folders || []);
      } else {
        group.folders = rankSort(group.folders || [], collectionFolderKey, state.collectionDefaultFolderOrders[groupKey]);
      }

      state.backup = null;
      state.previewCollections = null;
      state.finalCollections = null;
      wrapped.render(options);
    };

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
          event.preventDefault();
          event.stopPropagation();
          const order = cards.map(item => item.dataset.folderKey || '').filter(Boolean);
          const key = card.dataset.folderKey || '';
          const from = order.indexOf(key);
          const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
          if (from < 0 || to < 0 || to >= order.length) return;
          [order[from], order[to]] = [order[to], order[from]];
          state.collectionFolderOrders[groupKey] = clone(order);
          group.folders = rankSort(group.folders || [], collectionFolderKey, order);
          state.backup = null;
          state.previewCollections = null;
          state.finalCollections = null;
          wrapped.render(options);
        };
      });
    });
  }

  function init() {
    if (!install()) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (install() || tries > 40) clearInterval(timer);
      }, 100);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
