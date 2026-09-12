(() => {
  'use strict';

  const step = document.getElementById('postersCatalogStep');
  const discoverView = step?.querySelector('[data-discover-view="smart-lists"]');
  if (!step || !discoverView) return;

  const STORE_KEY = 'kollection-posters-trakt-lists-v1';
  let items = [];
  let selected = [];
  let loaded = false;
  let loading = false;

  const section = document.createElement('section');
  section.className = 'trakt-personal-lists';
  section.hidden = true;
  section.innerHTML = `
    <div class="trakt-lists-heading">
      <div><strong>Your Trakt Lists</strong><small>Lists from your connected Trakt account.</small></div>
      <button class="trakt-lists-refresh" type="button" aria-label="Refresh Trakt lists">Refresh</button>
    </div>
    <div class="trakt-lists-status"></div>
    <div class="trakt-lists-results"></div>
  `;

  const firstHeading = discoverView.querySelector('.popular-lists-heading');
  if (firstHeading) firstHeading.before(section);
  else discoverView.prepend(section);

  const status = section.querySelector('.trakt-lists-status');
  const results = section.querySelector('.trakt-lists-results');
  const refreshBtn = section.querySelector('.trakt-lists-refresh');

  const style = document.createElement('style');
  style.textContent = `
    .trakt-personal-lists{display:grid;gap:9px;margin:0 0 22px}.trakt-personal-lists[hidden]{display:none!important}
    .trakt-lists-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:4px}
    .trakt-lists-heading>div{display:grid;gap:3px}.trakt-lists-heading strong{font-size:14px;color:#f3f4f6}.trakt-lists-heading small{font-size:12px;color:#747780}
    .trakt-lists-refresh{border:1px solid rgba(255,255,255,.1);border-radius:9px;background:#17181b;color:#a6a9b0;padding:7px 10px;font:inherit;font-size:11px;font-weight:800;cursor:pointer}
    .trakt-lists-refresh:hover{background:#202125;color:#fff}.trakt-lists-refresh:disabled{opacity:.5;cursor:default}
    .trakt-lists-status{min-height:18px;color:#777b84;font-size:12px;line-height:1.4}
    .trakt-lists-status.is-error{color:#ef9a9a}.trakt-lists-status.is-loading{display:flex;align-items:center;gap:8px}
    .trakt-lists-status.is-loading:before{content:'';width:12px;height:12px;border:2px solid rgba(124,131,255,.25);border-top-color:#7c83ff;border-radius:50%;animation:traktListSpin .7s linear infinite}
    @keyframes traktListSpin{to{transform:rotate(360deg)}}
    .trakt-lists-results{display:grid;gap:9px}
    .trakt-list-card{display:flex;align-items:center;gap:13px;min-height:68px;padding:12px 14px;border:1px solid rgba(255,255,255,.11);border-radius:13px;background:#101113;cursor:pointer}
    .trakt-list-card:hover{border-color:rgba(255,255,255,.18);background:#131416}
    .trakt-list-card input{appearance:none;width:27px;height:27px;flex:0 0 27px;border:2px solid #4a4d53;border-radius:7px;background:#17181b;display:grid;place-items:center}
    .trakt-list-card input:checked{border-color:#43db7a;background:#43db7a}.trakt-list-card input:checked:after{content:'✓';color:#07150c;font-size:18px;font-weight:900}
    .trakt-list-copy{display:grid;gap:3px;min-width:0;flex:1}.trakt-list-copy strong{font-size:14px;line-height:1.25;color:#f3f4f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trakt-list-copy small{font-size:12px;color:#71747c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .trakt-provider-pill{margin-left:auto;flex:0 0 auto;padding:5px 8px;border:1px solid rgba(237,31,35,.28);border-radius:999px;color:#ff7779;font-size:10px;font-weight:800}
  `;
  document.head.appendChild(style);

  const keyFor = (item) => `trakt:${item.id || item.ids?.trakt || item.name}`;

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.selected)) selected = saved.selected;
    } catch {}
  }

  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, selected })); } catch {}
  }

  function setStatus(text, { error = false, loading: busy = false } = {}) {
    status.textContent = text || '';
    status.classList.toggle('is-error', error);
    status.classList.toggle('is-loading', busy);
  }

  function render() {
    results.innerHTML = '';
    const selectedKeys = new Set(selected.map(keyFor));
    items.forEach((item) => {
      const key = keyFor(item);
      const label = document.createElement('label');
      label.className = 'trakt-list-card';
      label.innerHTML = `<input type="checkbox" ${selectedKeys.has(key) ? 'checked' : ''}><span class="trakt-list-copy"><strong></strong><small></small></span><span class="trakt-provider-pill">Trakt</span>`;
      label.querySelector('strong').textContent = item.name || 'Untitled list';
      const meta = [];
      if (Number(item.itemCount || 0) > 0) meta.push(`${Number(item.itemCount)} items`);
      if (Number(item.likes || 0) > 0) meta.push(`${Number(item.likes)} likes`);
      if (item.privacy) meta.push(item.privacy);
      label.querySelector('small').textContent = meta.length ? meta.join(' • ') : 'Personal Trakt list';
      label.querySelector('input').addEventListener('change', (event) => {
        if (event.target.checked) {
          if (!selected.some((entry) => keyFor(entry) === key)) selected.push(item);
        } else {
          selected = selected.filter((entry) => keyFor(entry) !== key);
        }
        writeState();
      });
      results.appendChild(label);
    });
  }

  async function loadTraktLists(force = false) {
    if (loading || (loaded && !force)) return;
    loading = true;
    refreshBtn.disabled = true;
    setStatus('Loading your Trakt lists…', { loading: true });
    try {
      const response = await fetch(`/api/posters-trakt-lists${force ? '?refresh=1' : ''}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || data?.connected === false) {
        section.hidden = true;
        loaded = false;
        return;
      }
      if (!response.ok) throw new Error(data?.error || `Could not load Trakt lists (${response.status})`);

      items = (Array.isArray(data.items) ? data.items : []).map((item) => ({ ...item, provider: 'Trakt' }));
      section.hidden = false;
      loaded = true;
      render();
      setStatus(items.length
        ? `${items.length} Trakt list${items.length === 1 ? '' : 's'} available${data.cached ? ' • cached' : ''}.`
        : 'Your Trakt account does not have any personal lists yet.');
    } catch (error) {
      section.hidden = false;
      setStatus(error?.message || 'Could not load your Trakt lists.', { error: true });
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  function getSelected() {
    return selected.slice();
  }

  function mergeIntoGeneratedJson() {
    const output = document.getElementById('jsonOutput');
    if (!output?.textContent.trim()) return;
    try {
      const data = JSON.parse(output.textContent);
      const traktLists = getSelected();
      const target = data.config && typeof data.config === 'object'
        ? data.config
        : data.kollectionPosters && typeof data.kollectionPosters === 'object'
          ? data.kollectionPosters
          : data;
      const existing = Array.isArray(target.discoveredLists) ? target.discoveredLists : [];
      const merged = [...existing];
      const seen = new Set(existing.map((item) => `${String(item.provider || '').toLowerCase()}:${item.id || item.slug || item.name}`));
      traktLists.forEach((item) => {
        const key = `trakt:${item.id || item.ids?.trakt || item.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({
          id: item.id,
          provider: 'Trakt',
          name: item.name,
          description: item.description || '',
          itemCount: Number(item.itemCount || 0) || 0,
          likes: Number(item.likes || 0) || 0,
          ids: item.ids || {},
        });
      });
      target.discoveredLists = merged;
      const text = JSON.stringify(data, null, 2);
      output.textContent = text;
      output.dataset.generatedJson = text;
    } catch {}
  }

  function wrapDiscoverApi() {
    const api = window.KollectionPosterDiscover;
    if (!api || api.__traktWrapped) return false;
    const originalGetSelected = typeof api.getSelected === 'function' ? api.getSelected.bind(api) : () => [];
    api.getSelected = () => [...originalGetSelected(), ...getSelected()];
    api.loadTraktLists = loadTraktLists;
    api.getSelectedTrakt = getSelected;
    api.__traktWrapped = true;
    return true;
  }

  readState();
  if (!wrapDiscoverApi()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (wrapDiscoverApi() || attempts > 40) clearInterval(timer);
    }, 50);
  }

  refreshBtn.addEventListener('click', () => loadTraktLists(true));
  document.addEventListener('kollection:discover-mode', (event) => {
    if (event.detail?.mode === 'smart-lists') loadTraktLists();
  });
  document.addEventListener('kollection:catalog-tab', (event) => {
    if (event.detail?.tab === 'discover') loadTraktLists();
  });

  document.getElementById('generateBtn')?.addEventListener('click', () => setTimeout(mergeIntoGeneratedJson, 20));
  document.getElementById('copyBtn')?.addEventListener('click', mergeIntoGeneratedJson, true);
  document.getElementById('downloadBtn')?.addEventListener('click', mergeIntoGeneratedJson, true);
})();