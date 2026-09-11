(() => {
  'use strict';

  const usageChoice = document.getElementById('postersUsageChoice');
  const catalogStep = document.getElementById('postersCatalogStep');
  const configurator = document.getElementById('postersConfigurator');
  if (!usageChoice || !catalogStep || !configurator) return;

  const catalogTabs = [...catalogStep.querySelectorAll('[data-catalog-tab]')];
  const catalogPanels = [...catalogStep.querySelectorAll('[data-catalog-panel]')];
  const catalogCards = [...catalogStep.querySelectorAll('.catalog-card')];
  const discoverTabs = [...catalogStep.querySelectorAll('.discover-tabs button')];
  const searchInput = catalogStep.querySelector('.catalog-search input');
  const recommendedButtons = [...catalogStep.querySelectorAll('.recommended-users button')];
  const nextBtn = document.getElementById('catalogNextBtn');
  const backBtn = document.getElementById('catalogBackBtn');
  const backBottomBtn = document.getElementById('catalogBackBottomBtn');
  const configuratorBackBtn = document.getElementById('postersBackBtn');
  const generateBtn = document.getElementById('generateBtn');
  const jsonOutput = document.getElementById('jsonOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const SETTINGS_KEY = 'kollection-posters-catalogs-v2';
  let smartFlowActive = false;

  const catalogIds = ['trending-movies', 'trending-series', 'popular-movies', 'popular-series', 'top-rated', 'coming-soon'];
  catalogCards.forEach((card, index) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (input) input.value = catalogIds[index] || `catalog-${index + 1}`;
  });

  const currentCatalogTab = () => catalogTabs.find((tab) => tab.classList.contains('active'))?.dataset.catalogTab || 'default';
  const currentDiscoverMode = () => discoverTabs.find((tab) => tab.classList.contains('active'))?.textContent.trim() === 'Browse Users' ? 'browse-users' : 'search-lists';

  const getCatalogSelection = () => ({
    mode: currentCatalogTab(),
    defaultCatalogs: catalogCards.map((card) => ({
      id: card.querySelector('input')?.value || '',
      name: card.querySelector('strong')?.textContent.trim() || '',
      provider: card.querySelector('small')?.textContent.trim() || '',
      enabled: Boolean(card.querySelector('input')?.checked),
    })),
    discover: {
      mode: currentDiscoverMode(),
      query: searchInput?.value.trim() || '',
      recommendedUsers: recommendedButtons.filter((button) => button.classList.contains('selected')).map((button) => button.textContent.trim()),
    },
  });

  const saveState = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 2, ...getCatalogSelection() })); } catch {}
  };

  function setTab(name, persist = true) {
    const resolved = name === 'discover' ? 'discover' : 'default';
    catalogTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.catalogTab === resolved));
    catalogPanels.forEach((panel) => { panel.hidden = panel.dataset.catalogPanel !== resolved; });
    if (persist) saveState();
  }

  const restoreState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      if (Array.isArray(saved.defaultCatalogs)) {
        const byId = new Map(saved.defaultCatalogs.map((item) => [item.id, item]));
        catalogCards.forEach((card) => {
          const input = card.querySelector('input');
          const item = byId.get(input?.value);
          if (input && item && typeof item.enabled === 'boolean') input.checked = item.enabled;
        });
      }
      if (searchInput && typeof saved.discover?.query === 'string') searchInput.value = saved.discover.query;
      const selectedUsers = new Set(Array.isArray(saved.discover?.recommendedUsers) ? saved.discover.recommendedUsers : []);
      recommendedButtons.forEach((button) => button.classList.toggle('selected', selectedUsers.has(button.textContent.trim())));
      discoverTabs.forEach((tab) => {
        const mode = tab.textContent.trim() === 'Browse Users' ? 'browse-users' : 'search-lists';
        tab.classList.toggle('active', mode === (saved.discover?.mode || 'search-lists'));
      });
      setTab(saved.mode, false);
    } catch {}
  };

  const openCatalogStep = () => {
    smartFlowActive = true;
    usageChoice.hidden = true;
    configurator.hidden = true;
    catalogStep.hidden = false;
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
    catalogStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, true);

  catalogTabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.catalogTab)));
  catalogCards.forEach((card) => card.querySelector('input')?.addEventListener('change', saveState));
  discoverTabs.forEach((tab) => tab.addEventListener('click', () => {
    discoverTabs.forEach((item) => item.classList.toggle('active', item === tab));
    saveState();
  }));
  recommendedButtons.forEach((button) => button.addEventListener('click', () => {
    button.classList.toggle('selected');
    saveState();
  }));
  searchInput?.addEventListener('input', saveState);
  nextBtn?.addEventListener('click', openConfigurator);
  backBtn?.addEventListener('click', returnToUsage);
  backBottomBtn?.addEventListener('click', returnToUsage);

  const mergeCatalogSelectionIntoGeneratedJson = () => {
    if (!jsonOutput?.textContent.trim()) return '';
    try {
      const data = JSON.parse(jsonOutput.textContent);
      const catalogs = getCatalogSelection();
      if (data.config && typeof data.config === 'object') {
        data.config.catalogSelection = catalogs;
      } else if (data.kollectionPosters && typeof data.kollectionPosters === 'object') {
        data.kollectionPosters.catalogSelection = catalogs;
      } else {
        data.catalogSelection = catalogs;
      }
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

  restoreState();
})();
