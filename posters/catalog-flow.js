(() => {
  'use strict';

  const usageChoice = document.getElementById('postersUsageChoice');
  const catalogStep = document.getElementById('postersCatalogStep');
  const configurator = document.getElementById('postersConfigurator');
  const catalogTabs = [...document.querySelectorAll('[data-catalog-tab]')];
  const catalogPanels = [...document.querySelectorAll('[data-catalog-panel]')];
  const catalogCards = [...document.querySelectorAll('.catalog-card')];
  const discoverTabs = [...document.querySelectorAll('.discover-tabs button')];
  const searchInput = document.querySelector('.catalog-search input');
  const nextBtn = document.getElementById('catalogNextBtn');
  const backBtn = document.getElementById('catalogBackBtn');
  const backBottomBtn = document.getElementById('catalogBackBottomBtn');
  const generateBtn = document.getElementById('generateBtn');
  const jsonPanel = document.getElementById('jsonPanel');
  const jsonOutput = document.getElementById('jsonOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const SETTINGS_KEY = 'kollection-posters-catalogs-v1';

  if (!usageChoice || !catalogStep || !configurator) return;

  const catalogIds = ['trending-movies','trending-series','popular-movies','popular-series','top-rated','coming-soon'];
  catalogCards.forEach((card, index) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (input && !input.value) input.value = catalogIds[index] || `catalog-${index + 1}`;
  });

  const readState = () => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  const saveState = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        version: 1,
        tab: catalogTabs.find((tab) => tab.classList.contains('active'))?.dataset.catalogTab || 'default',
        catalogs: catalogCards.filter((card) => card.querySelector('input')?.checked).map((card) => card.querySelector('input').value),
        discoverMode: discoverTabs.find((tab) => tab.classList.contains('active'))?.textContent.trim() || 'Search Lists',
        discoverQuery: searchInput?.value.trim() || ''
      }));
    } catch {}
  };

  const restoreState = () => {
    const state = readState();
    if (!state) return;
    if (Array.isArray(state.catalogs)) {
      const selected = new Set(state.catalogs);
      catalogCards.forEach((card) => {
        const input = card.querySelector('input');
        if (input) input.checked = selected.has(input.value);
      });
    }
    if (state.discoverQuery && searchInput) searchInput.value = state.discoverQuery;
    if (state.discoverMode) {
      discoverTabs.forEach((tab) => tab.classList.toggle('active', tab.textContent.trim() === state.discoverMode));
    }
    if (state.tab) setTab(state.tab, false);
  };

  function setTab(name, persist = true) {
    catalogTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.catalogTab === name));
    catalogPanels.forEach((panel) => { panel.hidden = panel.dataset.catalogPanel !== name; });
    if (persist) saveState();
  }

  const openCatalogStep = () => {
    usageChoice.hidden = true;
    configurator.hidden = true;
    catalogStep.hidden = false;
    catalogStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openConfigurator = () => {
    saveState();
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

  catalogTabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.catalogTab)));
  catalogCards.forEach((card) => card.querySelector('input')?.addEventListener('change', saveState));
  discoverTabs.forEach((tab) => tab.addEventListener('click', () => {
    discoverTabs.forEach((item) => item.classList.toggle('active', item === tab));
    saveState();
  }));
  searchInput?.addEventListener('input', saveState);
  nextBtn?.addEventListener('click', openConfigurator);
  backBtn?.addEventListener('click', returnToUsage);
  backBottomBtn?.addEventListener('click', returnToUsage);

  const getCatalogSelection = () => ({
    mode: catalogTabs.find((tab) => tab.classList.contains('active'))?.dataset.catalogTab || 'default',
    defaultCatalogs: catalogCards.filter((card) => card.querySelector('input')?.checked).map((card) => card.querySelector('input').value),
    discover: {
      mode: discoverTabs.find((tab) => tab.classList.contains('active'))?.textContent.trim() === 'Browse Users' ? 'browse-users' : 'search-lists',
      query: searchInput?.value.trim() || ''
    }
  });

  const buildOutput = () => {
    const source = document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
    const tags = [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
    const ratingSource = document.getElementById('ratingSource')?.value || 'average';
    const provider = document.getElementById('artworkProvider')?.value || 'tmdb';
    const catalogs = getCatalogSelection();
    const pattern = `https://kollection.tv/api/posters-v2/{type}/{tmdb_id}.webp?source=${encodeURIComponent(source)}&provider=${encodeURIComponent(provider)}&tags=${encodeURIComponent(tags.join(','))}&ratingSource=${encodeURIComponent(ratingSource)}`;

    return {
      version: '2.1.0',
      exportedAt: new Date().toISOString(),
      type: 'kollection-posters',
      usageMode: 'setup',
      config: {
        posterSource: source,
        artworkProvider: provider,
        ratingSource,
        smartTags: { enabled: true, tags, adaptivePlacement: true },
        catalogs,
        posterUrlPattern: pattern,
        aiometadata: {
          posterRatingProvider: 'custom',
          usePosterProxy: true,
          customPosterUrlPattern: pattern,
          moviePosterProvider: provider,
          seriesPosterProvider: provider
        }
      }
    };
  };

  if (generateBtn && jsonPanel && jsonOutput) {
    const replacement = generateBtn.cloneNode(true);
    generateBtn.replaceWith(replacement);
    replacement.addEventListener('click', () => {
      const output = buildOutput();
      const text = JSON.stringify(output, null, 2);
      jsonOutput.textContent = text;
      jsonOutput.dataset.generatedJson = text;
      jsonPanel.hidden = false;
      if (copyStatus) copyStatus.textContent = '';
      jsonPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  if (copyBtn) {
    const replacement = copyBtn.cloneNode(true);
    copyBtn.replaceWith(replacement);
    replacement.addEventListener('click', async () => {
      const text = jsonOutput?.dataset.generatedJson || jsonOutput?.textContent || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        if (copyStatus) copyStatus.textContent = 'Copied';
      } catch {
        if (copyStatus) copyStatus.textContent = 'Copy failed';
      }
    });
  }

  if (downloadBtn) {
    const replacement = downloadBtn.cloneNode(true);
    downloadBtn.replaceWith(replacement);
    replacement.addEventListener('click', () => {
      const text = jsonOutput?.dataset.generatedJson || jsonOutput?.textContent || '';
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
    });
  }

  restoreState();
})();