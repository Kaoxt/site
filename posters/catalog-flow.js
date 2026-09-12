(() => {
  'use strict';

  const usageChoice = document.getElementById('postersUsageChoice');
  const catalogStep = document.getElementById('postersCatalogStep');
  const configurator = document.getElementById('postersConfigurator');
  if (!usageChoice || !catalogStep || !configurator) return;

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
  const generateBtn = document.getElementById('generateBtn');
  const jsonOutput = document.getElementById('jsonOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const SETTINGS_KEY = 'kollection-posters-catalogs-v4';
  let smartFlowActive = false;

  const catalogIds = ['trending-movies', 'trending-series', 'popular-movies', 'popular-series', 'top-rated', 'coming-soon'];
  catalogCards.forEach((card, index) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (input) input.value = catalogIds[index] || `catalog-${index + 1}`;
  });

  const currentCatalogTab = () => catalogTabs.find((tab) => tab.classList.contains('active'))?.dataset.catalogTab || 'default';
  const currentDiscoverMode = () => discoverTabs.find((tab) => tab.classList.contains('active'))?.dataset.discoverMode || 'smart-lists';

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
    return {
      mode: currentCatalogTab(),
      defaultCatalogs,
      enabledCatalogs: defaultCatalogs.filter((item) => item.enabled).map((item) => item.id),
      discover: {
        mode: currentDiscoverMode(),
        selectedLists: window.KollectionPosterDiscover?.getSelected?.() || [],
      },
    };
  };

  const saveState = () => {
    syncSelectedStyles();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 4, ...getCatalogSelection() }));
    } catch {}
  };

  function setDiscoverMode(mode, persist = true) {
    const resolved = mode === 'browse-users' ? 'browse-users' : 'smart-lists';
    discoverTabs.forEach((tab) => {
      const active = tab.dataset.discoverMode === resolved;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    discoverViews.forEach((view) => {
      view.hidden = view.dataset.discoverView !== resolved;
    });
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
    catalogPanels.forEach((panel) => {
      panel.hidden = panel.dataset.catalogPanel !== resolved;
    });
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
  };

  const openCatalogStep = () => {
    smartFlowActive = true;
    usageChoice.hidden = true;
    configurator.hidden = true;
    catalogStep.hidden = false;
    setDiscoverMode('smart-lists', false);
    setTab('default', false);
    catalogStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openConfigurator = () => {
    saveState();
    smartFlowActive = true;
    usageChoice.hidden = true;
    catalogStep.hidden = true;
    configurator.hidden = false;
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
    catalogStep.hidden = true;
    configurator.hidden = true;
    usageChoice.hidden = false;
    usageChoice.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.addEventListener('click', (event) => {
    const setup = event.target.closest?.('[data-usage="setup"]');
    if (!setup) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCatalogStep();
  }, true);

  configuratorBackBtn?.addEventListener('click', (event) => {
    if (!smartFlowActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    configurator.hidden = true;
    catalogStep.hidden = false;
    setTab('default', false);
    catalogStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, true);

  catalogTabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.catalogTab)));
  discoverTabs.forEach((tab) => tab.addEventListener('click', () => setDiscoverMode(tab.dataset.discoverMode)));
  catalogCards.forEach((card) => card.querySelector('input')?.addEventListener('change', saveState));
  nextBtn?.addEventListener('click', openConfigurator);
  backBtn?.addEventListener('click', returnToUsage);
  backBottomBtn?.addEventListener('click', returnToUsage);

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
    } catch {
      return jsonOutput.textContent;
    }
  };

  generateBtn?.addEventListener('click', () => {
    saveState();
    setTimeout(mergeCatalogSelectionIntoGeneratedJson, 0);
  });

  copyBtn?.addEventListener('click', async (event) => {
    if (!smartFlowActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = mergeCatalogSelectionIntoGeneratedJson();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (copyStatus) copyStatus.textContent = 'JSON copied to clipboard.';
    } catch {
      if (copyStatus) copyStatus.textContent = 'Clipboard access was blocked. Select the JSON above and copy it manually.';
    }
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