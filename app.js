(() => {
  const STORAGE_KEY = 'nuvio-collection-studio-v1';
  const originalData = structuredClone(window.NUVIO_COLLECTION_DATA || []);
  let data = structuredClone(originalData);
  let order = data.map(c => c.id);
  let activeFilter = 'all';
  let openEditors = new Set();
  let currentView = 'library';

  const els = {
    grid: document.getElementById('collectionGrid'),
    builderList: document.getElementById('builderList'),
    search: document.getElementById('searchInput'),
    filterBar: document.getElementById('filterBar'),
    sort: document.getElementById('sortSelect'),
    results: document.getElementById('resultsLabel'),
    empty: document.getElementById('emptyState'),
    toolbar: document.getElementById('toolbar'),
    library: document.getElementById('collectionLibrary'),
    libraryHero: document.getElementById('libraryView'),
    builder: document.getElementById('builderView'),
    help: document.getElementById('helpView'),
    quickModal: document.getElementById('quickBuildModal'),
    sendModal: document.getElementById('sendModal'),
    fileInput: document.getElementById('fileInput'),
    toast: document.getElementById('toast')
  };

  function loadState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!state) return;
      if (Array.isArray(state.data) && state.data.length) data = state.data;
      if (Array.isArray(state.order)) order = state.order;
    } catch (_) {}
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, order }));
  }

  function selectedFolders(collection) {
    return collection.folders.filter(f => f.enabled);
  }

  function stats() {
    const selectedCollections = data.filter(c => selectedFolders(c).length > 0);
    const folders = selectedCollections.flatMap(selectedFolders);
    return {
      categories: selectedCollections.length,
      folders: folders.length,
      sources: folders.reduce((sum, f) => sum + Number(f.sourceCount || 0), 0)
    };
  }

  function updateStats() {
    const s = stats();
    document.getElementById('statSelected').textContent = s.folders;
    document.getElementById('statCategories').textContent = s.categories;
    document.getElementById('statSources').textContent = s.sources;
    document.getElementById('exportCategories').textContent = s.categories;
    document.getElementById('exportFolders').textContent = s.folders;
  }

  function filterOptions() {
    return [
      ['all', 'All'], ['featured', 'Featured'], ['movies', 'Movies'], ['tv', 'TV'], ['anime', 'Anime'],
      ['networks', 'Networks'], ['classics', 'Classics'], ['scifi', 'Sci-Fi'], ['horror', 'Horror'],
      ['documentary', 'Docs'], ['family', 'Family']
    ];
  }

  function renderFilters() {
    els.filterBar.innerHTML = filterOptions().map(([value, label]) =>
      `<button class="filter-chip ${activeFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`
    ).join('');
  }

  function filteredCollections() {
    const q = (els.search.value || '').trim().toLowerCase();
    let list = data.filter(c => {
      const filterOk = activeFilter === 'all' || c.tags.includes(activeFilter);
      const searchText = [c.title, c.description, ...c.folders.map(f => f.title)].join(' ').toLowerCase();
      return filterOk && (!q || searchText.includes(q));
    });
    if (els.sort.value === 'az') list.sort((a,b) => a.title.localeCompare(b.title));
    if (els.sort.value === 'selected') list.sort((a,b) => selectedFolders(b).length - selectedFolders(a).length);
    if (els.sort.value === 'featured') list.sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id));
    return list;
  }

  function cardTemplate(c) {
    const selected = selectedFolders(c);
    const allOn = selected.length === c.folders.length;
    const noneOn = selected.length === 0;
    const preview = c.folders.slice(0, 5).map(f => `<span class="folder-pill ${f.enabled ? 'on':''}"><span class="tiny-dot"></span>${escapeHtml(f.title)}</span>`).join('');
    const overflow = c.folders.length > 5 ? `<span class="folder-pill">+${c.folders.length - 5} more</span>` : '';
    const editor = openEditors.has(c.id) ? `
      <div class="folder-editor">
        ${c.folders.map(f => `<div class="folder-row">
          <input id="${c.id}-${f.id}" type="checkbox" data-folder-toggle="${c.id}|${f.id}" ${f.enabled ? 'checked':''}>
          <label for="${c.id}-${f.id}">${escapeHtml(f.title)}</label>
          <small>${escapeHtml(f.type)} • ${Number(f.sourceCount || 0)} source${Number(f.sourceCount || 0) === 1 ? '' : 's'}</small>
        </div>`).join('')}
      </div>` : '';

    return `<article class="collection-card" data-accent="${c.accent}">
      <div class="card-top"><div class="card-icon">${c.icon}</div><span class="card-count">${c.folders.length} folders</span></div>
      <div class="card-body"><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.description)}</p></div>
      <div class="folder-preview">${preview}${overflow}</div>
      <div class="card-footer">
        <div><div class="selection-label"><strong>${selected.length}</strong> of ${c.folders.length} selected</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="card-edit" data-edit="${c.id}">${openEditors.has(c.id) ? 'Done' : 'Choose folders'}</button>
          <button class="card-toggle ${allOn ? 'on' : ''}" data-toggle-collection="${c.id}" aria-label="${noneOn ? 'Enable' : 'Toggle'} ${escapeHtml(c.title)}"><span></span></button>
        </div>
      </div>
      ${editor}
    </article>`;
  }

  function renderLibrary() {
    const list = filteredCollections();
    els.grid.innerHTML = list.map(cardTemplate).join('');
    els.empty.classList.toggle('hidden', list.length !== 0);
    const q = (els.search.value || '').trim();
    els.results.textContent = list.length === data.length && !q && activeFilter === 'all'
      ? `Showing all ${data.length} collections`
      : `${list.length} collection${list.length === 1 ? '' : 's'} found`;
    updateStats();
  }

  function renderBuilder() {
    const ordered = order.map(id => data.find(c => c.id === id)).filter(Boolean);
    const selected = ordered.filter(c => selectedFolders(c).length);
    els.builderList.innerHTML = selected.length ? selected.map(c => `
      <div class="builder-row" draggable="true" data-builder-id="${c.id}">
        <div class="drag-handle">⋮⋮</div>
        <div class="builder-icon">${c.icon}</div>
        <div><h3>${escapeHtml(c.title)}</h3><p>${selectedFolders(c).map(f=>escapeHtml(f.title)).join(' • ')}</p></div>
        <div class="builder-badge">${selectedFolders(c).length} selected</div>
      </div>`).join('') : `<div class="empty-state"><h3>Nothing selected yet</h3><p>Go back to Library and turn on a few folders.</p></div>`;
    attachDragEvents();
    updateStats();
  }

  function attachDragEvents() {
    let draggedId = null;
    els.builderList.querySelectorAll('.builder-row').forEach(row => {
      row.addEventListener('dragstart', () => { draggedId = row.dataset.builderId; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); draggedId = null; });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        if (!draggedId || draggedId === row.dataset.builderId) return;
        const from = order.indexOf(draggedId), to = order.indexOf(row.dataset.builderId);
        order.splice(from, 1); order.splice(to, 0, draggedId);
        saveState(); renderBuilder();
      });
    });
  }

  function setView(view) {
    currentView = view;
    const isLibrary = view === 'library';
    els.libraryHero.classList.toggle('hidden', !isLibrary);
    els.library.classList.toggle('hidden', !isLibrary);
    els.toolbar.classList.toggle('hidden', !isLibrary);
    els.builder.classList.toggle('hidden', view !== 'builder');
    els.help.classList.toggle('hidden', view !== 'help');
    document.querySelectorAll('.nav-button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'builder') renderBuilder();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exportShape() {
    return order.map(id => data.find(c => c.id === id)).filter(Boolean).map(c => ({
      id: c.id,
      title: c.title,
      folders: selectedFolders(c).map(f => ({
        id: f.id,
        title: f.title,
        type: f.type,
        sources: f.sources || [],
        tileShape: f.tileShape || 'LANDSCAPE',
        hideTitle: Boolean(f.hideTitle),
        ...(f.nuvio || {})
      }))
    })).filter(c => c.folders.length);
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJson(value) {
    if (!Array.isArray(value)) throw new Error('Expected a JSON array of collections.');
    const incoming = value.map((c, ci) => ({
      id: c.id || `collection-${ci+1}`,
      title: c.title || `Collection ${ci+1}`,
      description: c.description || 'Imported Nuvio collection.',
      icon: c.icon || '◇',
      accent: c.accent || ['cyan','indigo','purple','magenta'][ci % 4],
      tags: Array.isArray(c.tags) ? c.tags : ['featured'],
      folders: (c.folders || []).map((f, fi) => ({
        id: f.id || `folder-${ci+1}-${fi+1}`,
        title: f.title || `Folder ${fi+1}`,
        type: f.type || 'mixed',
        sourceCount: Array.isArray(f.sources) ? f.sources.length : Number(f.sourceCount || 1),
        enabled: f.enabled !== false,
        sources: f.sources || [],
        tileShape: f.tileShape,
        hideTitle: f.hideTitle,
        nuvio: f.nuvio || {}
      }))
    })).filter(c => c.folders.length);
    if (!incoming.length) throw new Error('No collections with folders were found.');
    data = incoming; order = data.map(c=>c.id); openEditors.clear(); saveState(); renderFilters(); renderLibrary(); renderBuilder();
    toast('Collection imported');
  }

  function applyQuickBuild() {
    const watch = document.querySelector('[data-choice="watch"] .selected')?.dataset.value || 'both';
    const interests = [...document.querySelectorAll('#interestChoices .selected')].map(b => b.dataset.value);
    data.forEach(c => c.folders.forEach(f => f.enabled = false));
    data.forEach(c => {
      const watchMatch = watch === 'both' || c.tags.includes(watch) || (watch === 'movies' && c.tags.includes('movies')) || (watch === 'tv' && c.tags.includes('tv'));
      const interestMatch = interests.length === 0 || interests.some(i => c.tags.includes(i));
      if (watchMatch && interestMatch) {
        c.folders.forEach((f, idx) => f.enabled = idx < Math.min(4, c.folders.length));
      }
    });
    saveState(); renderLibrary(); renderBuilder(); closeModal('quickBuildModal'); toast('Quick setup applied');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function toast(message) {
    els.toast.textContent = message; els.toast.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
  function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

  document.addEventListener('click', e => {
    const nav = e.target.closest('.nav-button'); if (nav) return setView(nav.dataset.view);
    const filter = e.target.closest('[data-filter]'); if (filter) { activeFilter = filter.dataset.filter; renderFilters(); renderLibrary(); return; }
    const edit = e.target.closest('[data-edit]'); if (edit) { openEditors.has(edit.dataset.edit) ? openEditors.delete(edit.dataset.edit) : openEditors.add(edit.dataset.edit); renderLibrary(); return; }
    const toggle = e.target.closest('[data-toggle-collection]'); if (toggle) {
      const c = data.find(x => x.id === toggle.dataset.toggleCollection); if (!c) return;
      const allOn = c.folders.every(f => f.enabled); c.folders.forEach(f => f.enabled = !allOn); saveState(); renderLibrary(); renderBuilder(); return;
    }
    const folder = e.target.closest('[data-folder-toggle]'); if (folder) {
      const [cid, fid] = folder.dataset.folderToggle.split('|'); const c = data.find(x=>x.id===cid); const f = c?.folders.find(x=>x.id===fid); if (f) f.enabled = folder.checked;
      saveState(); renderLibrary(); renderBuilder(); return;
    }
    const close = e.target.closest('[data-close]'); if (close) { closeModal(close.dataset.close); return; }
  });

  els.search.addEventListener('input', renderLibrary);
  els.sort.addEventListener('change', renderLibrary);
  document.getElementById('clearButton').addEventListener('click', () => { els.search.value = ''; activeFilter = 'all'; renderFilters(); renderLibrary(); });
  document.getElementById('selectAllButton').addEventListener('click', () => { data.forEach(c => c.folders.forEach(f => f.enabled = true)); saveState(); renderLibrary(); renderBuilder(); toast('Everything selected'); });
  document.getElementById('quickBuildButton').addEventListener('click', () => openModal('quickBuildModal'));
  document.getElementById('sendButton').addEventListener('click', () => openModal('sendModal'));
  document.getElementById('sendExportInstead').addEventListener('click', () => { closeModal('sendModal'); downloadJson('nuvio-collection.json', exportShape()); toast('JSON exported'); });
  document.getElementById('applyQuickBuild').addEventListener('click', applyQuickBuild);
  document.getElementById('importButton').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files?.[0]; if (!file) return;
    try { importJson(JSON.parse(await file.text())); } catch (err) { toast(err.message || 'Could not import JSON'); }
    els.fileInput.value = '';
  });
  document.querySelector('[data-choice="watch"]').addEventListener('click', e => { if (!e.target.matches('button')) return; e.currentTarget.querySelectorAll('button').forEach(b => b.classList.remove('selected')); e.target.classList.add('selected'); });
  document.getElementById('interestChoices').addEventListener('click', e => { if (e.target.matches('button')) e.target.classList.toggle('selected'); });
  document.getElementById('resetOrderButton').addEventListener('click', () => { order = data.map(c=>c.id); saveState(); renderBuilder(); toast('Order reset'); });

  const exportButtons = [document.getElementById('exportButton'), document.getElementById('exportButtonAside')];
  exportButtons.forEach(btn => btn.addEventListener('click', () => { downloadJson('nuvio-collection.json', exportShape()); toast('JSON exported'); }));
  document.getElementById('copyJsonButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(exportShape(), null, 2)); toast('JSON copied'); }
    catch (_) { toast('Clipboard unavailable'); }
  });
  document.getElementById('downloadSampleButton').addEventListener('click', () => downloadJson('nuvio-collection-data.sample.json', data));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden'));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (currentView !== 'library') setView('library'); setTimeout(() => els.search.focus(), 80); }
  });

  loadState();
  renderFilters();
  renderLibrary();
  renderBuilder();
})();
