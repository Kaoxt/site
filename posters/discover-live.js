(() => {
  'use strict';

  const step = document.getElementById('postersCatalogStep');
  if (!step) return;

  const discoverPanel = step.querySelector('[data-catalog-panel="discover"]');
  const popularSearch = document.getElementById('popularListSearch');
  const popularResults = document.getElementById('popularListsResults');
  const userSearch = document.getElementById('browseUserSearch');
  const userResults = document.getElementById('userListsResults');
  const recommendedButtons = [...(discoverPanel?.querySelectorAll('.recommended-users button') || [])];
  if (!discoverPanel || !popularSearch || !popularResults || !userSearch || !userResults) return;

  const STORE_KEY = 'kollection-posters-discover-live-v2';
  const RECOMMENDED_PROFILES = {
    snoak: { provider: 'mdblist', username: 'snoak' },
    gary: { provider: 'mdblist', username: 'garycrawfordgc' },
    kaoxt: { provider: 'mdblist', username: 'kaoxt' },
  };

  let selected = [];
  let popularItems = [];
  let popularLoaded = false;
  let userTimer = 0;
  let userGeneration = 0;
  let activeRecommendedLabel = '';

  const style = document.createElement('style');
  style.textContent = `
    .discover-results-status{min-height:20px;color:#777b84;font-size:12px;line-height:1.4;margin:2px 0 4px}
    .discover-results-status.is-error{color:#ef9a9a}
    .discover-results-status.is-loading{display:inline-flex;align-items:center;gap:8px}
    .discover-results-status.is-loading:before{content:'';width:12px;height:12px;border:2px solid rgba(124,131,255,.25);border-top-color:#7c83ff;border-radius:50%;animation:discoverSpin .7s linear infinite}
    @keyframes discoverSpin{to{transform:rotate(360deg)}}
    .discover-result-list{display:grid;gap:9px}
    .discover-result{display:flex;align-items:center;gap:13px;min-height:68px;padding:12px 14px;border:1px solid rgba(255,255,255,.11);border-radius:13px;background:#101113;cursor:pointer}
    .discover-result:hover{border-color:rgba(255,255,255,.18);background:#131416}
    .discover-result input{appearance:none;width:27px;height:27px;flex:0 0 27px;border:2px solid #4a4d53;border-radius:7px;background:#17181b;display:grid;place-items:center}
    .discover-result input:checked{border-color:#43db7a;background:#43db7a}
    .discover-result input:checked:after{content:'✓';color:#07150c;font-size:18px;font-weight:900}
    .discover-result-copy{display:grid;gap:3px;min-width:0}
    .discover-result-copy strong{font-size:14px;line-height:1.25;color:#f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .discover-result-copy small{font-size:12px;color:#71747c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .discover-provider{margin-left:auto;flex:0 0 auto;padding:5px 8px;border:1px solid rgba(255,255,255,.09);border-radius:999px;color:#858892;font-size:10px;font-weight:800}
    .user-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}
    .user-list-head strong{font-size:13px;color:#f3f4f6}
    .user-list-head[hidden]{display:none}
    .recommended-users button.selected{background:#31343a;box-shadow:inset 0 0 0 1px rgba(67,219,122,.55);color:#fff}
  `;
  document.head.appendChild(style);

  const popularStatus = document.createElement('div');
  popularStatus.className = 'discover-results-status';
  popularResults.before(popularStatus);
  popularResults.classList.add('discover-result-list');

  const userHead = document.createElement('div');
  userHead.className = 'user-list-head';
  userHead.hidden = true;
  userHead.innerHTML = '<strong></strong>';
  const userStatus = document.createElement('div');
  userStatus.className = 'discover-results-status';
  userResults.before(userHead, userStatus);
  userResults.classList.add('discover-result-list');

  const selectedKey = (item) => `${String(item.provider || '').toLowerCase()}:${item.username || ''}:${item.slug || item.url || item.name}`;

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.selected)) selected = saved.selected;
    } catch {}
  }

  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, selected })); } catch {}
  }

  function setStatus(node, text, { error = false, loading = false } = {}) {
    node.textContent = text || '';
    node.classList.toggle('is-error', error);
    node.classList.toggle('is-loading', loading);
  }

  function renderListCards(container, items) {
    container.innerHTML = '';
    const selectedSet = new Set(selected.map(selectedKey));
    items.forEach((item) => {
      const key = selectedKey(item);
      const label = document.createElement('label');
      label.className = 'discover-result';
      label.innerHTML = `<input type="checkbox" ${selectedSet.has(key) ? 'checked' : ''}><span class="discover-result-copy"><strong></strong><small></small></span><span class="discover-provider">MDBList</span>`;
      label.querySelector('strong').textContent = item.name || item.slug || 'Untitled list';
      const meta = [];
      if (item.username) meta.push(`@${item.username}`);
      if (Number(item.itemCount || 0) > 0) meta.push(`${Number(item.itemCount)} items`);
      if (Number(item.likes || 0) > 0) meta.push(`${Number(item.likes)} likes`);
      label.querySelector('small').textContent = meta.length ? meta.join(' • ') : 'MDBList public list';
      label.querySelector('input').addEventListener('change', (event) => {
        if (event.target.checked) {
          if (!selected.some((entry) => selectedKey(entry) === key)) selected.push(item);
        } else {
          selected = selected.filter((entry) => selectedKey(entry) !== key);
        }
        writeState();
      });
      container.appendChild(label);
    });
  }

  function filterPopular() {
    const query = popularSearch.value.trim().toLowerCase();
    const filtered = query ? popularItems.filter((item) => `${item.name} ${item.username} ${item.slug}`.toLowerCase().includes(query)) : popularItems;
    renderListCards(popularResults, filtered);
    setStatus(popularStatus, filtered.length ? `${filtered.length} popular MDBList list${filtered.length === 1 ? '' : 's'}.` : 'No popular lists match that search.');
  }

  async function loadPopularLists(force = false) {
    if (popularLoaded && !force) return;
    setStatus(popularStatus, 'Loading MDBList popular lists…', { loading: true });
    popularResults.innerHTML = '';
    try {
      const response = await fetch('/api/posters-toplists', { headers: { accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Could not load popular lists (${response.status})`);
      popularItems = Array.isArray(data.items) ? data.items : [];
      popularLoaded = true;
      filterPopular();
    } catch (error) {
      setStatus(popularStatus, error?.message || 'Could not load MDBList popular lists.', { error: true });
    }
  }

  function setUserHeading(username, label = '') {
    if (!username) {
      userHead.hidden = true;
      userHead.querySelector('strong').textContent = '';
      return;
    }
    userHead.querySelector('strong').textContent = `@${label || username}'s Lists`;
    userHead.hidden = false;
  }

  async function loadUserLists(username, label = '') {
    const cleanUsername = String(username || '').trim().replace(/^@/, '');
    if (cleanUsername.length < 2) {
      userResults.innerHTML = '';
      setUserHeading('');
      setStatus(userStatus, 'Enter an MDBList username to view public lists.');
      return;
    }
    const requestId = ++userGeneration;
    setUserHeading(cleanUsername, label);
    setStatus(userStatus, `Loading MDBList lists for @${cleanUsername}…`, { loading: true });
    userResults.innerHTML = '';
    try {
      const params = new URLSearchParams({ username: cleanUsername, mode: 'lists', provider: 'mdblist' });
      const response = await fetch(`/api/posters-discover?${params}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (requestId !== userGeneration) return;
      if (!response.ok) throw new Error(data?.error || `Search failed (${response.status})`);
      const items = (Array.isArray(data.items) ? data.items : []).filter((item) => String(item.provider || '').toLowerCase() === 'mdblist');
      renderListCards(userResults, items);
      setStatus(userStatus, items.length ? `${items.length} public MDBList list${items.length === 1 ? '' : 's'} found.` : 'No public MDBList lists found for that user.');
    } catch (error) {
      if (requestId !== userGeneration) return;
      setStatus(userStatus, error?.message || 'Could not load that MDBList user.', { error: true });
    }
  }

  function scheduleUserSearch() {
    clearTimeout(userTimer);
    activeRecommendedLabel = '';
    recommendedButtons.forEach((button) => button.classList.remove('selected'));
    userTimer = setTimeout(() => loadUserLists(userSearch.value), 450);
  }

  function augmentGeneratedJson() {
    const output = document.getElementById('jsonOutput');
    if (!output?.textContent.trim()) return;
    try {
      const data = JSON.parse(output.textContent);
      const payload = selected.map((item) => ({
        id: item.id,
        provider: item.provider || 'MDBList',
        username: item.username || '',
        name: item.name,
        slug: item.slug || '',
        url: item.url || '',
        itemCount: Number(item.itemCount || 0) || 0,
      }));
      if (data.config && typeof data.config === 'object') data.config.discoveredLists = payload;
      else if (data.kollectionPosters && typeof data.kollectionPosters === 'object') data.kollectionPosters.discoveredLists = payload;
      else data.discoveredLists = payload;
      const text = JSON.stringify(data, null, 2);
      output.textContent = text;
      output.dataset.generatedJson = text;
    } catch {}
  }

  popularSearch.addEventListener('input', filterPopular);
  userSearch.addEventListener('input', scheduleUserSearch);
  userSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(userTimer);
      loadUserLists(userSearch.value);
    }
  });

  recommendedButtons.forEach((button) => button.addEventListener('click', () => {
    const label = button.textContent.trim().toLowerCase();
    const profile = RECOMMENDED_PROFILES[label] || { username: button.dataset.username || label };
    activeRecommendedLabel = label;
    recommendedButtons.forEach((item) => item.classList.toggle('selected', item === button));
    userSearch.value = profile.username;
    loadUserLists(profile.username, label);
  }));

  document.addEventListener('kollection:discover-mode', (event) => {
    const mode = event.detail?.mode;
    if (mode === 'smart-lists') loadPopularLists();
    if (mode === 'browse-users' && activeRecommendedLabel) {
      const profile = RECOMMENDED_PROFILES[activeRecommendedLabel];
      if (profile) loadUserLists(profile.username, activeRecommendedLabel);
    }
  });

  document.addEventListener('kollection:catalog-tab', (event) => {
    if (event.detail?.tab === 'discover') loadPopularLists();
  });

  document.getElementById('generateBtn')?.addEventListener('click', () => setTimeout(augmentGeneratedJson, 0));
  document.getElementById('copyBtn')?.addEventListener('click', augmentGeneratedJson, true);
  document.getElementById('downloadBtn')?.addEventListener('click', augmentGeneratedJson, true);

  readState();
  setStatus(userStatus, 'Choose a recommended MDBList user or enter a username.');
  window.KollectionPosterDiscover = {
    loadPopularLists,
    loadUserLists,
    getSelected: () => selected.slice(),
  };
})();