(() => {
  'use strict';

  const step = document.getElementById('postersCatalogStep');
  if (!step) return;

  const CONNECTIONS_KEY = 'kollection-posters-connections-v1';
  const STORE_KEY = 'kollection-posters-my-lists-v1';
  const tabs = step.querySelector('.catalog-tabs');
  const discoverTab = step.querySelector('[data-catalog-tab="discover"]');
  if (!tabs || !discoverTab) return;

  const myTab = document.createElement('button');
  myTab.type = 'button';
  myTab.className = 'catalog-tab';
  myTab.dataset.catalogTab = 'my-lists';
  myTab.textContent = 'My Lists';
  myTab.hidden = true;
  tabs.insertBefore(myTab, discoverTab);

  const myPanel = document.createElement('div');
  myPanel.className = 'catalog-panel';
  myPanel.dataset.catalogPanel = 'my-lists';
  myPanel.hidden = true;
  myPanel.innerHTML = `
    <div class="popular-lists-heading"><strong>My Lists</strong><small>Your lists directly from MDBList.</small></div>
    <div id="myListsStatus" class="discover-results-status"></div>
    <div id="myListsResults" class="discover-result-list"></div>`;
  step.querySelector('[data-catalog-panel="discover"]')?.before(myPanel);

  const status = myPanel.querySelector('#myListsStatus');
  const results = myPanel.querySelector('#myListsResults');
  let items = [];
  let selected = [];
  let loadedForKey = '';

  function readConnections() {
    try { return JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function selectedKey(item) {
    return `${String(item?.provider || 'MDBList').toLowerCase()}:${item?.username || ''}:${item?.slug || item?.url || item?.name || ''}`;
  }

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
      selected = Array.isArray(saved.selected) ? saved.selected : [];
    } catch { selected = []; }
  }

  function writeState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, selected })); } catch {}
  }

  function setStatus(text, error = false) {
    status.textContent = text || '';
    status.classList.toggle('is-error', error);
  }

  function render() {
    results.innerHTML = '';
    const selectedSet = new Set(selected.map(selectedKey));
    for (const item of items) {
      const key = selectedKey(item);
      const label = document.createElement('label');
      label.className = 'discover-result';
      label.innerHTML = `<input type="checkbox" ${selectedSet.has(key) ? 'checked' : ''}><span class="discover-result-copy"><strong></strong><small></small></span><span class="discover-provider">MDBList</span>`;
      label.querySelector('strong').textContent = item.name || item.slug || 'Untitled list';
      const meta = [];
      if (item.username) meta.push(`@${item.username}`);
      if (Number(item.itemCount || 0) > 0) meta.push(`${Number(item.itemCount)} items`);
      if (Number(item.likes || 0) > 0) meta.push(`${Number(item.likes)} likes`);
      label.querySelector('small').textContent = meta.length ? meta.join(' • ') : 'Your MDBList list';
      label.querySelector('input').addEventListener('change', (event) => {
        if (event.target.checked) {
          if (!selected.some((entry) => selectedKey(entry) === key)) selected.push(item);
        } else {
          selected = selected.filter((entry) => selectedKey(entry) !== key);
        }
        writeState();
      });
      results.appendChild(label);
    }
    setStatus(items.length ? `${items.length} MDBList list${items.length === 1 ? '' : 's'} found.` : 'No lists were found in MDBList My Lists for this API key.');
  }

  function showMyLists(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    [...step.querySelectorAll('.catalog-tab')].forEach((tab) => {
      const active = tab === myTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    [...step.querySelectorAll('[data-catalog-panel]')].forEach((panel) => { panel.hidden = panel !== myPanel; });
    const discoverTabs = step.querySelector('.discover-tabs');
    if (discoverTabs) discoverTabs.hidden = true;
    document.dispatchEvent(new CustomEvent('kollection:catalog-tab', { detail: { tab: 'my-lists' } }));
    loadMyLists();
  }

  async function loadMyLists(force = false) {
    const key = String(readConnections().mdblistApiKey || '').trim();
    if (!key) {
      syncAvailability();
      return;
    }
    if (!force && loadedForKey === key && items.length) return;
    setStatus('Loading your MDBList My Lists…');
    results.innerHTML = '';
    try {
      const response = await fetch('/api/posters-my-lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ apiKey: key }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Could not load My Lists (${response.status})`);
      items = Array.isArray(data.items) ? data.items : [];
      loadedForKey = key;
      render();
    } catch (error) {
      setStatus(error?.message || 'Could not load your MDBList My Lists.', true);
    }
  }

  function syncAvailability() {
    const connected = Boolean(readConnections().mdblistApiKey);
    myTab.hidden = !connected;
    if (!connected) {
      myPanel.hidden = true;
      loadedForKey = '';
      items = [];
    }
  }

  function mergeWithDiscoverSelections() {
    const discover = window.KollectionPosterDiscover;
    if (!discover?.getSelected || discover.__myListsMerged) return;
    const originalGetSelected = discover.getSelected.bind(discover);
    discover.getSelected = () => {
      const merged = [...originalGetSelected(), ...selected];
      const seen = new Set();
      return merged.filter((item) => {
        const key = selectedKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    discover.__myListsMerged = true;
  }

  myTab.addEventListener('click', showMyLists);
  document.addEventListener('kollection:catalog-tab', (event) => {
    if (event.detail?.tab !== 'my-lists') myPanel.hidden = true;
  });
  document.getElementById('connectionsNextBtn')?.addEventListener('click', () => setTimeout(syncAvailability, 0));
  document.getElementById('saveMdblistKey')?.addEventListener('click', () => setTimeout(syncAvailability, 0));

  readState();
  syncAvailability();
  mergeWithDiscoverSelections();

  window.KollectionPosterMyLists = {
    getSelected: () => selected.slice(),
    load: loadMyLists,
    refresh: () => loadMyLists(true),
  };
})();
