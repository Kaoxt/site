(() => {
  'use strict';

  const usageChoice = document.getElementById('postersUsageChoice');
  const catalogStep = document.getElementById('postersCatalogStep');
  const configurator = document.getElementById('postersConfigurator');
  if (!usageChoice || !catalogStep || !configurator) return;

  const connectionStep = document.createElement('section');
  connectionStep.id = 'postersConnectionStep';
  connectionStep.className = 'posters-catalog-step posters-connection-step';
  connectionStep.hidden = true;
  connectionStep.setAttribute('data-page-content', '');
  connectionStep.setAttribute('aria-label', 'Connect list services');
  connectionStep.innerHTML = `
    <div class="config-routebar"><button id="connectionsBackBtn" class="route-back" type="button">‹ Back</button><div><span>SMART OVERLAY POSTERS</span><strong>Connect list services</strong></div></div>
    <div class="catalog-shell connection-shell">
      <div class="connection-intro"><span class="section-kicker">CONNECT ACCOUNTS</span><p>Connect a list service to use personal or community lists. You can also continue with public lists.</p></div>

      <div class="connection-card" data-connection="mdblist">
        <div class="connection-copy"><strong>MDBList</strong><small>Community curated lists</small></div>
        <button id="mdblistToggleBtn" class="connection-action" type="button">Add Key</button>
        <div id="mdblistKeyPanel" class="connection-key-panel" hidden>
          <label for="mdblistApiKey">MDBList API key</label>
          <div class="connection-key-row"><input id="mdblistApiKey" type="password" autocomplete="off" placeholder="Enter API key"><button id="saveMdblistKey" type="button">Save</button></div>
          <small id="mdblistKeyStatus">Stored only in this browser for your Posters setup.</small>
        </div>
      </div>

      <div class="connection-card" data-connection="trakt">
        <div class="connection-copy"><strong>Trakt</strong><small>Watchlist, recommendations, history</small></div>
        <button id="traktConnectBtn" class="connection-action" type="button">Connect</button>
        <small id="traktConnectStatus" class="connection-status">Connect your Trakt account to use personal Trakt data.</small>
      </div>

      <div class="catalog-actions connection-actions">
        <button id="connectionsNextBtn" class="catalog-next" type="button">Next</button>
        <button id="connectionsSkipBtn" class="catalog-back" type="button">Skip — use public lists</button>
      </div>
    </div>`;
  catalogStep.before(connectionStep);

  const connectionStyle = document.createElement('style');
  connectionStyle.textContent = `
    .posters-connection-step{width:100%;max-width:760px;margin:0 auto 44px;padding:0 18px;box-sizing:border-box}
    .posters-connection-step .config-routebar,.connection-shell{width:100%;max-width:680px;margin-left:auto;margin-right:auto}
    .connection-shell{margin-top:18px}
    .connection-intro{display:grid;gap:8px;margin-bottom:18px}.connection-intro p{margin:0;color:#84878f;font-size:13px;line-height:1.5}
    .connection-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;padding:18px 18px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:#101113;margin-bottom:10px}
    .connection-copy{display:grid;gap:4px}.connection-copy strong{font-size:16px;color:#f5f6f8}.connection-copy small{font-size:12px;color:#6f727a}
    .connection-action{min-width:92px;min-height:44px;padding:0 15px;border:0;border-radius:10px;background:#242529;color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer}
    .connection-action.is-connected{background:rgba(67,219,122,.17);color:#6ff09a;box-shadow:inset 0 0 0 1px rgba(67,219,122,.32)}
    .connection-key-panel{grid-column:1/-1;display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}.connection-key-panel[hidden]{display:none!important}
    .connection-key-panel>label{font-size:12px;color:#9a9da5;font-weight:700}.connection-key-row{display:grid;grid-template-columns:1fr auto;gap:8px}.connection-key-row input{min-height:46px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:#0a0b0d;color:#fff;padding:0 12px;font:inherit;font-size:13px;outline:0}.connection-key-row input:focus{border-color:rgba(124,131,255,.7)}.connection-key-row button{min-width:78px;border:0;border-radius:10px;background:#fff;color:#111;font:inherit;font-weight:800}.connection-key-panel>small,.connection-status{grid-column:1/-1;color:#6e7179;font-size:11px;line-height:1.4}.connection-status.is-error{color:#ef9a9a}.connection-status.is-connected{color:#6ff09a}
    .connection-actions{margin-top:22px}
    @media(max-width:600px){.posters-connection-step{padding:0 14px}.connection-card{padding:16px 14px}.connection-copy strong{font-size:15px}.connection-action{min-width:86px}.connection-key-row{grid-template-columns:1fr}.connection-key-row button{min-height:44px}}
  `;
  document.head.appendChild(connectionStyle);

  const catalogTabs = [...catalogStep.querySelectorAll('[data-catalog-tab]')];
  const catalogPanels = [...catalogStep.querySelectorAll('[data-catalog-panel]')];
  const catalogCards = [...catalogStep.querySelectorAll('.catalog-card')];
  const discoverTabsWrap = catalogStep.querySelector('.discover-tabs');
  const discoverTabs = [...catalogStep.querySelectorAll('.discover-tabs button')];
  const discoverViews = [...catalogStep.querySelectorAll('[data-discover-view]')];
  const nextBtn = document.getElementById('catalogNextBtn');
  const backBtn = document.getElementById('catalogBackBtn');
  const backBottomBtn = document.getElementById('catalogBackBottomBtn');
  const configuratorBackBtn = document.getElementById('postersBackBtn');
  const connectionsBackBtn = document.getElementById('connectionsBackBtn');
  const connectionsNextBtn = document.getElementById('connectionsNextBtn');
  const connectionsSkipBtn = document.getElementById('connectionsSkipBtn');
  const mdblistToggleBtn = document.getElementById('mdblistToggleBtn');
  const mdblistKeyPanel = document.getElementById('mdblistKeyPanel');
  const mdblistApiKey = document.getElementById('mdblistApiKey');
  const saveMdblistKey = document.getElementById('saveMdblistKey');
  const mdblistKeyStatus = document.getElementById('mdblistKeyStatus');
  const traktConnectBtn = document.getElementById('traktConnectBtn');
  const traktConnectStatus = document.getElementById('traktConnectStatus');
  const generateBtn = document.getElementById('generateBtn');
  const jsonOutput = document.getElementById('jsonOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const SETTINGS_KEY = 'kollection-posters-catalogs-v5';
  const CONNECTIONS_KEY = 'kollection-posters-connections-v1';
  let smartFlowActive = false;

  const catalogIds = ['trending-movies', 'trending-series', 'popular-movies', 'popular-series', 'top-rated', 'coming-soon'];
  catalogCards.forEach((card, index) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (input) input.value = catalogIds[index] || `catalog-${index + 1}`;
  });

  const currentCatalogTab = () => catalogTabs.find((tab) => tab.classList.contains('active'))?.dataset.catalogTab || 'default';
  const currentDiscoverMode = () => discoverTabs.find((tab) => tab.classList.contains('active'))?.dataset.discoverMode || 'smart-lists';

  const readConnections = () => {
    try { return JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}') || {}; } catch { return {}; }
  };
  const writeConnections = (patch) => {
    const next = { ...readConnections(), ...patch };
    try { localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(next)); } catch {}
    return next;
  };

  const syncConnectionUi = () => {
    const saved = readConnections();
    const hasKey = Boolean(saved.mdblistApiKey);
    mdblistToggleBtn.textContent = hasKey ? 'Key Saved' : 'Add Key';
    mdblistToggleBtn.classList.toggle('is-connected', hasKey);
    if (hasKey) mdblistKeyStatus.textContent = 'MDBList API key saved in this browser.';
    const params = new URLSearchParams(location.search);
    const traktConnected = saved.traktConnected === true || params.get('trakt') === 'connected';
    if (params.get('trakt') === 'connected' && !saved.traktConnected) writeConnections({ traktConnected: true });
    traktConnectBtn.textContent = traktConnected ? 'Connected' : 'Connect';
    traktConnectBtn.classList.toggle('is-connected', traktConnected);
    traktConnectStatus.textContent = traktConnected ? 'Trakt account connected.' : 'Connect your Trakt account to use personal Trakt data.';
    traktConnectStatus.classList.toggle('is-connected', traktConnected);
  };

  const syncSelectedStyles = () => {
    catalogCards.forEach((card) => card.classList.toggle('selected', Boolean(card.querySelector('input')?.checked)));
  };

  const getCatalogSelection = () => {
    const defaultCatalogs = catalogCards.map((card) => ({
      id: card.querySelector('input')?.value || '',
      name: card.querySelector('strong')?.textContent.trim() || '',
      provider: card.querySelector('small')?.textContent.trim() || '',
      enabled: Boolean(card.querySelector('input')?.checked),
    }));
    const connections = readConnections();
    return {
      mode: currentCatalogTab(),
      defaultCatalogs,
      enabledCatalogs: defaultCatalogs.filter((item) => item.enabled).map((item) => item.id),
      connections: {
        mdblist: Boolean(connections.mdblistApiKey),
        trakt: Boolean(connections.traktConnected),
      },
      discover: {
        mode: currentDiscoverMode(),
        selectedLists: window.KollectionPosterDiscover?.getSelected?.() || [],
      },
    };
  };

  const saveState = () => {
    syncSelectedStyles();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 5, ...getCatalogSelection() })); } catch {}
  };

  function setDiscoverMode(mode, persist = true) {
    const resolved = mode === 'browse-users' ? 'browse-users' : 'smart-lists';
    discoverTabs.forEach((tab) => {
      const active = tab.dataset.discoverMode === resolved;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    discoverViews.forEach((view) => { view.hidden = view.dataset.discoverView !== resolved; });
    if (persist) saveState();
    document.dispatchEvent(new CustomEvent('kollection:discover-mode', { detail: { mode: resolved } }));
  }

  function setTab(name, persist = true) {
    const resolved = name === 'discover' ? 'discover' : 'default';
    catalogTabs.forEach((tab) => {
      const active = tab.dataset.catalogTab === resolved;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    catalogPanels.forEach((panel) => { panel.hidden = panel.dataset.catalogPanel !== resolved; });
    if (discoverTabsWrap) discoverTabsWrap.hidden = resolved !== 'discover';
    if (resolved === 'discover') setDiscoverMode(currentDiscoverMode(), false);
    if (persist) saveState();
    document.dispatchEvent(new CustomEvent('kollection:catalog-tab', { detail: { tab: resolved } }));
  }

  const restoreSelections = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && Array.isArray(saved.defaultCatalogs)) {
        const byId = new Map(saved.defaultCatalogs.map((item) => [item.id, item]));
        catalogCards.forEach((card) => {
          const input = card.querySelector('input');
          const item = byId.get(input?.value);
          if (input && item && typeof item.enabled === 'boolean') input.checked = item.enabled;
        });
      }
    } catch {}
    syncSelectedStyles();
    syncConnectionUi();
  };

  const showOnly = (section) => {
    usageChoice.hidden = section !== usageChoice;
    connectionStep.hidden = section !== connectionStep;
    catalogStep.hidden = section !== catalogStep;
    configurator.hidden = section !== configurator;
  };

  const openConnectionStep = () => {
    smartFlowActive = true;
    showOnly(connectionStep);
    syncConnectionUi();
    connectionStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openCatalogStep = () => {
    smartFlowActive = true;
    showOnly(catalogStep);
    setDiscoverMode('smart-lists', false);
    setTab('default', false);
    catalogStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openConfigurator = () => {
    saveState();
    smartFlowActive = true;
    showOnly(configurator);
    const routeKicker = document.getElementById('routeKicker');
    const routeTitle = document.getElementById('routeTitle');
    if (routeKicker) routeKicker.textContent = 'SMART OVERLAY POSTERS';
    if (routeTitle) routeTitle.textContent = 'Configure Posters';
    window.KollectionPosterPreview?.refresh?.({ hard: true });
    configurator.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const returnToUsage = () => {
    smartFlowActive = false;
    saveState();
    showOnly(usageChoice);
    usageChoice.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.addEventListener('click', (event) => {
    const setup = event.target.closest?.('[data-usage="setup"]');
    if (!setup) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openConnectionStep();
  }, true);

  mdblistToggleBtn?.addEventListener('click', () => {
    mdblistKeyPanel.hidden = !mdblistKeyPanel.hidden;
    if (!mdblistKeyPanel.hidden) mdblistApiKey.focus();
  });
  saveMdblistKey?.addEventListener('click', () => {
    const key = String(mdblistApiKey.value || '').trim();
    if (!key) {
      mdblistKeyStatus.textContent = 'Enter an MDBList API key first.';
      return;
    }
    writeConnections({ mdblistApiKey: key });
    mdblistApiKey.value = '';
    mdblistKeyPanel.hidden = true;
    syncConnectionUi();
  });
  traktConnectBtn?.addEventListener('click', async () => {
    if (readConnections().traktConnected) return;
    traktConnectBtn.disabled = true;
    traktConnectStatus.classList.remove('is-error');
    traktConnectStatus.textContent = 'Checking Trakt connection setup…';
    try {
      const response = await fetch('/api/posters-trakt-status', { cache: 'no-store', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (data?.configured && data?.authorizeUrl) {
        location.href = data.authorizeUrl;
        return;
      }
      traktConnectStatus.textContent = 'Trakt connection needs the site Trakt app credentials configured first.';
      traktConnectStatus.classList.add('is-error');
    } catch {
      traktConnectStatus.textContent = 'Trakt connection is not available yet.';
      traktConnectStatus.classList.add('is-error');
    } finally {
      traktConnectBtn.disabled = false;
    }
  });

  connectionsNextBtn?.addEventListener('click', openCatalogStep);
  connectionsSkipBtn?.addEventListener('click', openCatalogStep);
  connectionsBackBtn?.addEventListener('click', returnToUsage);

  configuratorBackBtn?.addEventListener('click', (event) => {
    if (!smartFlowActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCatalogStep();
  }, true);

  catalogTabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.catalogTab)));
  discoverTabs.forEach((tab) => tab.addEventListener('click', () => setDiscoverMode(tab.dataset.discoverMode)));
  catalogCards.forEach((card) => card.querySelector('input')?.addEventListener('change', saveState));
  nextBtn?.addEventListener('click', openConfigurator);
  backBtn?.addEventListener('click', openConnectionStep);
  backBottomBtn?.addEventListener('click', openConnectionStep);

  const mergeCatalogSelectionIntoGeneratedJson = () => {
    if (!jsonOutput?.textContent.trim()) return '';
    try {
      const data = JSON.parse(jsonOutput.textContent);
      const catalogs = getCatalogSelection();
      if (data.config && typeof data.config === 'object') data.config.catalogSelection = catalogs;
      else if (data.kollectionPosters && typeof data.kollectionPosters === 'object') data.kollectionPosters.catalogSelection = catalogs;
      else data.catalogSelection = catalogs;
      const text = JSON.stringify(data, null, 2);
      jsonOutput.textContent = text;
      jsonOutput.dataset.generatedJson = text;
      return text;
    } catch { return jsonOutput.textContent; }
  };

  generateBtn?.addEventListener('click', () => { saveState(); setTimeout(mergeCatalogSelectionIntoGeneratedJson, 0); });
  copyBtn?.addEventListener('click', async (event) => {
    if (!smartFlowActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = mergeCatalogSelectionIntoGeneratedJson();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); if (copyStatus) copyStatus.textContent = 'JSON copied to clipboard.'; }
    catch { if (copyStatus) copyStatus.textContent = 'Clipboard access was blocked. Select the JSON above and copy it manually.'; }
  }, true);
  downloadBtn?.addEventListener('click', (event) => {
    if (!smartFlowActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = mergeCatalogSelectionIntoGeneratedJson();
    if (!text) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kollection-posters-config.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, true);

  restoreSelections();
  setDiscoverMode('smart-lists', false);
  setTab('default', false);
})();