(() => {
  'use strict';

  const step = document.getElementById('postersCatalogStep');
  if (!step) return;

  const discoverPanel = step.querySelector('[data-catalog-panel="discover"]');
  const searchInput = discoverPanel?.querySelector('.catalog-search input');
  const modeButtons = [...(step.querySelectorAll('.discover-tabs button') || [])];
  const discoverSearchTools = step.querySelector('.discover-search-tools');
  const discoverChoiceButtons = [...step.querySelectorAll('[data-discover-choice]')];
  const popularListsButton = document.getElementById('popularListsButton');
  const popularListsResults = document.getElementById('popularListsResults');
  const recommendedButtons = [...(discoverPanel?.querySelectorAll('.recommended-users button') || [])];
  if (!discoverPanel || !searchInput) return;

  const STORE_KEY = 'kollection-posters-discover-live-v1';
  const RECOMMENDED_PROFILES = {
    snoak: { provider: 'mdblist', username: 'snoak' },
    gary: { provider: 'mdblist', username: 'garycrawfordgc' },
    kaoxt: { provider: 'mdblist', username: 'kaoxt' },
  };
  let timer = 0;
  let generation = 0;
  let selected = [];
  let activeRecommendedLabel = '';
  let activeProvider = '';

  const style = document.createElement('style');
  style.textContent = `
    .discover-live{display:grid;gap:12px;margin-top:14px}
    .discover-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}
    .discover-list-head strong{font-size:14px;line-height:1.2;color:#f3f4f6}
    .discover-list-head[hidden]{display:none}
    .discover-status{min-height:22px;color:#777b84;font-size:13px;line-height:1.4}
    .discover-status.is-error{color:#ef9a9a}
    .discover-results{display:grid;gap:10px}
    .discover-result{display:flex;align-items:center;gap:14px;min-height:78px;padding:14px 16px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:#101113;cursor:pointer}
    .discover-result:hover{border-color:rgba(255,255,255,.18);background:#131416}
    .discover-result input{appearance:none;width:30px;height:30px;flex:0 0 30px;border:2px solid #4a4d53;border-radius:8px;background:#17181b;display:grid;place-items:center}
    .discover-result input:checked{border-color:#43db7a;background:#43db7a}
    .discover-result input:checked:after{content:'✓';color:#07150c;font-size:20px;font-weight:900}
    .discover-result-copy{display:grid;gap:4px;min-width:0}
    .discover-result-copy strong{font-size:16px;line-height:1.2;color:#f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .discover-result-copy small{font-size:13px;color:#71747c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .discover-provider{margin-left:auto;flex:0 0 auto;padding:6px 9px;border:1px solid rgba(255,255,255,.1);border-radius:999px;color:#979aa3;font-size:11px;font-weight:800;letter-spacing:.02em}
    .discover-user{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:#101113}
    .discover-user button{border:0;border-radius:10px;padding:10px 13px;background:#fff;color:#111;font:inherit;font-weight:800;cursor:pointer}
    .discover-loading{display:inline-flex;align-items:center;gap:8px}.discover-loading:before{content:'';width:13px;height:13px;border:2px solid rgba(124,131,255,.25);border-top-color:#7c83ff;border-radius:50%;animation:discoverSpin .7s linear infinite}@keyframes discoverSpin{to{transform:rotate(360deg)}}
    .recommended-users button.selected{background:#31343a;box-shadow:inset 0 0 0 1px rgba(67,219,122,.55);color:#fff}
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'discover-live';
  root.innerHTML = '<div class="discover-list-head" hidden><strong></strong></div><div class="discover-status" role="status" aria-live="polite"></div><div class="discover-results"></div>';
  const recommendedUsers = discoverPanel.querySelector('.recommended-users');
  if (recommendedUsers) recommendedUsers.insertAdjacentElement('afterend', root);
  else discoverPanel.appendChild(root);
  const listHead = root.querySelector('.discover-list-head');
  const listHeadTitle = listHead.querySelector('strong');
  const status = root.querySelector('.discover-status');
  const results = root.querySelector('.discover-results');

  const currentMode = () => modeButtons.find((button) => button.classList.contains('active'))?.dataset.discoverMode === 'browse-users' ? 'users' : 'lists';
  const selectedKey = (item) => `${item.provider}:${item.username}:${item.slug || item.url || item.name}`;

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.selected)) selected = saved.selected;
    } catch {}
  }

  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, selected })); } catch {}
  }

  function setStatus(text, error = false, loading = false) {
    status.textContent = text || '';
    status.classList.toggle('is-error', error);
    status.classList.toggle('discover-loading', loading);
  }

  function setListHeading(username, label = '') {
    if (!username) {
      listHead.hidden = true;
      listHeadTitle.textContent = '';
      return;
    }
    const display = label || username;
    listHeadTitle.textContent = `@${display}'s Lists`;
    listHead.hidden = false;
  }

  function renderLists(items, providerInfo = {}, username = '') {
    results.innerHTML = '';
    setListHeading(username, activeRecommendedLabel);
    if (!items.length) {
      const details = [];
      if (providerInfo?.mdblist?.error) details.push('MDBList: ' + providerInfo.mdblist.error);
      if (providerInfo?.trakt?.error) details.push('Trakt: ' + providerInfo.trakt.error);
      setStatus(details.length ? `No lists found. ${details.join(' · ')}` : 'No public lists found for that username.', Boolean(details.length));
      return;
    }
    const selectedSet = new Set(selected.map(selectedKey));
    items.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'discover-result';
      const key = selectedKey(item);
      label.innerHTML = `<input type="checkbox" ${selectedSet.has(key) ? 'checked' : ''}><span class="discover-result-copy"><strong></strong><small></small></span><span class="discover-provider"></span>`;
      label.querySelector('strong').textContent = item.name || item.slug || 'Untitled list';
      const meta = [item.provider || '', item.itemCount ? `${item.itemCount} items` : ''].filter(Boolean).join(' • ');
      label.querySelector('small').textContent = meta;
      label.querySelector('.discover-provider').textContent = item.provider || '';
      label.querySelector('input').addEventListener('change', (event) => {
        if (event.target.checked) {
          if (!selected.some((entry) => selectedKey(entry) === key)) selected.push(item);
        } else {
          selected = selected.filter((entry) => selectedKey(entry) !== key);
        }
        writeState();
      });
      results.appendChild(label);
    });
    setStatus(`${items.length} public list${items.length === 1 ? '' : 's'} found. Select any you want to include.`);
  }

  function renderUsers(users) {
    results.innerHTML = '';
    setListHeading('');
    if (!users.length) {
      setStatus('No matching public Trakt or MDBList user found.');
      return;
    }
    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'discover-user';
      row.innerHTML = '<span class="discover-result-copy"><strong></strong><small></small></span><button type="button">View lists</button>';
      row.querySelector('strong').textContent = user.name || user.username;
      row.querySelector('small').textContent = `${user.provider} • @${user.username}`;
      row.querySelector('button').addEventListener('click', () => {
        activeRecommendedLabel = user.username;
        searchInput.value = user.username;
        modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.discoverMode === 'smart-lists'));
        runSearch(user.username, 'lists', String(user.provider || '').toLowerCase());
      });
      results.appendChild(row);
    });
    setStatus(`${users.length} matching account${users.length === 1 ? '' : 's'} found.`);
  }

  async function runSearch(value = searchInput.value, forcedMode = '', provider = '') {
    const username = String(value || '').trim().replace(/^@/, '');
    if (username.length < 2) {
      results.innerHTML = '';
      setListHeading('');
      setStatus('Enter a Trakt or MDBList username to search.');
      return;
    }
    const mode = forcedMode || currentMode();
    const providerFilter = String(provider || activeProvider || '').toLowerCase();
    const requestId = ++generation;
    const providerLabel = providerFilter === 'mdblist' ? 'MDBList ' : providerFilter === 'trakt' ? 'Trakt ' : '';
    setStatus(mode === 'users' ? `Looking for @${username}…` : `Loading ${providerLabel}public lists for @${username}…`, false, true);
    try {
      const query = new URLSearchParams({ username, mode });
      if (providerFilter) query.set('provider', providerFilter);
      const response = await fetch(`/api/posters-discover?${query.toString()}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== generation) return;
      if (!response.ok) throw new Error(data?.error || `Search failed (${response.status})`);
      if (mode === 'users') {
        const users = Array.isArray(data.users) ? data.users : [];
        const filteredUsers = providerFilter ? users.filter((user) => String(user.provider || '').toLowerCase() === providerFilter) : users;
        renderUsers(filteredUsers);
      } else {
        const items = Array.isArray(data.items) ? data.items : [];
        const filteredItems = providerFilter ? items.filter((item) => String(item.provider || '').toLowerCase() === providerFilter) : items;
        renderLists(filteredItems, data.providers || {}, username);
      }
    } catch (error) {
      if (requestId !== generation) return;
      results.innerHTML = '';
      setListHeading(username, activeRecommendedLabel);
      setStatus(error?.message || 'Could not search right now.', true);
    }
  }

  function scheduleSearch() {
    clearTimeout(timer);
    activeRecommendedLabel = '';
    recommendedButtons.forEach((button) => button.classList.remove('selected'));
    timer = setTimeout(() => runSearch(), 450);
  }

  function augmentGeneratedJson() {
    const output = document.getElementById('jsonOutput');
    if (!output?.textContent.trim()) return;
    try {
      const data = JSON.parse(output.textContent);
      const payload = selected.map((item) => ({
        id: item.id,
        provider: item.provider,
        username: item.username,
        name: item.name,
        slug: item.slug || '',
        url: item.url || '',
        itemCount: Number(item.itemCount || 0) || 0,
      }));
      if (data.config && typeof data.config === 'object') {
        data.config.discoveredLists = payload;
      } else if (data.kollectionPosters && typeof data.kollectionPosters === 'object') {
        data.kollectionPosters.discoveredLists = payload;
      } else {
        data.discoveredLists = payload;
      }
      const text = JSON.stringify(data, null, 2);
      output.textContent = text;
      output.dataset.generatedJson = text;
    } catch {}
  }


  function renderPopularLists(items) {
    if (!popularListsResults) return;
    popularListsResults.innerHTML = '';
    if (!items.length) {
      popularListsResults.innerHTML = '<div class="discover-status is-error">No popular MDBList lists were available right now.</div>';
      popularListsResults.hidden = false;
      return;
    }
    const selectedSet = new Set(selected.map(selectedKey));
    const heading = document.createElement('div');
    heading.className = 'popular-lists-heading';
    heading.innerHTML = '<strong>Popular MDBList Lists</strong><small>Select any lists you want to include.</small>';
    popularListsResults.appendChild(heading);
    items.slice(0, 40).forEach((item) => {
      const label = document.createElement('label');
      label.className = 'discover-result';
      const key = selectedKey(item);
      label.innerHTML = `<input type="checkbox" ${selectedSet.has(key) ? 'checked' : ''}><span class="discover-result-copy"><strong></strong><small></small></span><span class="discover-provider">MDBList</span>`;
      label.querySelector('strong').textContent = item.name || item.slug || 'Untitled list';
      label.querySelector('small').textContent = item.username ? `@${item.username}` : 'Popular public list';
      label.querySelector('input').addEventListener('change', (event) => {
        if (event.target.checked) {
          if (!selected.some((entry) => selectedKey(entry) === key)) selected.push(item);
        } else {
          selected = selected.filter((entry) => selectedKey(entry) !== key);
        }
        writeState();
      });
      popularListsResults.appendChild(label);
    });
    popularListsResults.hidden = false;
  }

  async function loadPopularLists() {
    if (!popularListsButton || !popularListsResults) return;
    popularListsButton.disabled = true;
    popularListsResults.hidden = false;
    popularListsResults.innerHTML = '<div class="discover-status discover-loading">Loading popular MDBList lists…</div>';
    try {
      const response = await fetch('/api/posters-discover?mode=toplists&provider=mdblist', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Could not load lists (${response.status})`);
      renderPopularLists(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      popularListsResults.innerHTML = `<div class="discover-status is-error">${String(error?.message || 'Could not load MDBList popular lists.')}</div>`;
    } finally {
      popularListsButton.disabled = false;
    }
  }

  popularListsButton?.addEventListener('click', loadPopularLists);

  discoverChoiceButtons.forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    activeProvider = button.dataset.discoverChoice === 'trakt' ? 'trakt' : 'mdblist';
    discoverChoiceButtons.forEach((item) => item.classList.toggle('selected', item === button));
    if (discoverSearchTools) discoverSearchTools.hidden = false;
    searchInput.placeholder = activeProvider === 'trakt' ? 'Enter Trakt username…' : 'Enter MDBList username…';
    if (activeProvider === 'trakt') {
      recommendedButtons.forEach((item) => item.hidden = true);
      const label = discoverPanel.querySelector('.recommended-label');
      if (label) label.hidden = true;
    } else {
      recommendedButtons.forEach((item) => item.hidden = false);
      const label = discoverPanel.querySelector('.recommended-label');
      if (label) label.hidden = false;
    }
    results.innerHTML = '';
    setListHeading('');
    setStatus(`Enter a ${activeProvider === 'trakt' ? 'Trakt' : 'MDBList'} username to search.`);
    discoverSearchTools.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  searchInput.addEventListener('input', scheduleSearch);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(timer);
      runSearch();
    }
  });

  modeButtons.forEach((button) => button.addEventListener('click', () => {
    if (searchInput.value.trim().length >= 2) setTimeout(() => runSearch(), 0);
  }));

  recommendedButtons.forEach((button) => button.addEventListener('click', () => {
    const label = button.textContent.trim().toLowerCase();
    const profile = RECOMMENDED_PROFILES[label] || {
      provider: button.dataset.provider || '',
      username: button.dataset.username || button.textContent.trim(),
    };
    activeRecommendedLabel = label;
    recommendedButtons.forEach((item) => item.classList.toggle('selected', item === button));
    searchInput.value = profile.username;
    modeButtons.forEach((item) => item.classList.toggle('active', item.dataset.discoverMode === 'smart-lists'));
    setTimeout(() => runSearch(profile.username, 'lists', profile.provider), 0);
  }));

  document.getElementById('generateBtn')?.addEventListener('click', () => setTimeout(augmentGeneratedJson, 0));
  document.getElementById('copyBtn')?.addEventListener('click', augmentGeneratedJson, true);
  document.getElementById('downloadBtn')?.addEventListener('click', augmentGeneratedJson, true);

  readState();
  setStatus('Enter a Trakt or MDBList username to load their public lists.');
  window.KollectionPosterDiscover = { search: runSearch, getSelected: () => selected.slice() };
})();