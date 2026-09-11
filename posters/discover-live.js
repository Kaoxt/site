(() => {
  'use strict';

  const step = document.getElementById('postersCatalogStep');
  if (!step) return;

  const discoverPanel = step.querySelector('[data-catalog-panel="discover"]');
  const searchInput = discoverPanel?.querySelector('.catalog-search input');
  const modeButtons = [...(discoverPanel?.querySelectorAll('.discover-tabs button') || [])];
  const recommendedButtons = [...(discoverPanel?.querySelectorAll('.recommended-users button') || [])];
  if (!discoverPanel || !searchInput) return;

  const STORE_KEY = 'kollection-posters-discover-live-v1';
  let timer = 0;
  let generation = 0;
  let selected = [];

  const style = document.createElement('style');
  style.textContent = `
    .discover-live{display:grid;gap:12px;margin-top:6px}
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
    .recommended-users button.selected{background:#31343a;box-shadow:inset 0 0 0 1px rgba(67,219,122,.4);color:#fff}
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'discover-live';
  root.innerHTML = '<div class="discover-status" role="status" aria-live="polite"></div><div class="discover-results"></div>';
  discoverPanel.insertBefore(root, discoverPanel.querySelector('.recommended-label'));
  const status = root.querySelector('.discover-status');
  const results = root.querySelector('.discover-results');

  const currentMode = () => modeButtons.find((button) => button.classList.contains('active'))?.textContent.trim() === 'Browse Users' ? 'users' : 'lists';
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

  function renderLists(items, providerInfo = {}) {
    results.innerHTML = '';
    if (!items.length) {
      const details = [];
      if (providerInfo?.trakt?.error) details.push('Trakt: ' + providerInfo.trakt.error);
      if (providerInfo?.mdblist?.error) details.push('MDBList: ' + providerInfo.mdblist.error);
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
      const meta = [item.username, item.itemCount ? `${item.itemCount} items` : ''].filter(Boolean).join(' • ');
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
        searchInput.value = user.username;
        modeButtons.forEach((button) => button.classList.toggle('active', button.textContent.trim() === 'Search Lists'));
        runSearch(user.username, 'lists');
      });
      results.appendChild(row);
    });
    setStatus(`${users.length} matching account${users.length === 1 ? '' : 's'} found.`);
  }

  async function runSearch(value = searchInput.value, forcedMode = '') {
    const username = String(value || '').trim().replace(/^@/, '');
    if (username.length < 2) {
      results.innerHTML = '';
      setStatus('Enter a Trakt or MDBList username to search.');
      return;
    }
    const mode = forcedMode || currentMode();
    const requestId = ++generation;
    setStatus(mode === 'users' ? `Looking for @${username}…` : `Loading public lists for @${username}…`, false, true);
    try {
      const response = await fetch(`/api/posters-discover?username=${encodeURIComponent(username)}&mode=${mode}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== generation) return;
      if (!response.ok) throw new Error(data?.error || `Search failed (${response.status})`);
      if (mode === 'users') renderUsers(Array.isArray(data.users) ? data.users : []);
      else renderLists(Array.isArray(data.items) ? data.items : [], data.providers || {});
    } catch (error) {
      if (requestId !== generation) return;
      results.innerHTML = '';
      setStatus(error?.message || 'Could not search right now.', true);
    }
  }

  function scheduleSearch() {
    clearTimeout(timer);
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
    const username = button.textContent.trim();
    searchInput.value = username;
    modeButtons.forEach((item) => item.classList.toggle('active', item.textContent.trim() === 'Search Lists'));
    setTimeout(() => runSearch(username, 'lists'), 0);
  }));

  document.getElementById('generateBtn')?.addEventListener('click', () => setTimeout(augmentGeneratedJson, 0));
  document.getElementById('copyBtn')?.addEventListener('click', augmentGeneratedJson, true);
  document.getElementById('downloadBtn')?.addEventListener('click', augmentGeneratedJson, true);

  readState();
  setStatus('Enter a Trakt or MDBList username to load their public lists.');
  window.KollectionPosterDiscover = { search: runSearch, getSelected: () => selected.slice() };
})();
