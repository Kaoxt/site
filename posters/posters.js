(() => {
  'use strict';

  const usageChoice = document.getElementById('postersUsageChoice');
  const configurator = document.getElementById('postersConfigurator');
  const usageButtons = [...document.querySelectorAll('[data-usage]')];
  const backBtn = document.getElementById('postersBackBtn');
  const routeKicker = document.getElementById('routeKicker');
  const routeTitle = document.getElementById('routeTitle');

  const sourceInputs = [...document.querySelectorAll('input[name="posterSource"]')];
  const sourceCards = [...document.querySelectorAll('.choice-card')];
  const smartTagsEnabled = document.getElementById('smartTagsEnabled');
  const tagOptions = document.getElementById('tagOptions');
  const tagInputs = [...document.querySelectorAll('.tag-option input[type="checkbox"]')];
  const posterMocks = [...document.querySelectorAll('.poster-mock')];
  const previewDescription = document.getElementById('previewDescription');
  const configFile = document.getElementById('configFile');
  const clearImport = document.getElementById('clearImport');
  const importStatus = document.getElementById('importStatus');
  const generateBtn = document.getElementById('generateBtn');
  const jsonPanel = document.getElementById('jsonPanel');
  const jsonOutput = document.getElementById('jsonOutput');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const generateHint = document.getElementById('generateHint');

  const previewSamples = [
    { type: 'movie', id: '27205' },
    { type: 'movie', id: '155' },
    { type: 'tv', id: '1399' }
  ];

  const previewStyle = document.createElement('style');
  previewStyle.textContent = `
    .poster-service-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1}
    .poster-mock.service-live .poster-art,.poster-mock.service-live .overlay{display:none!important}
    .poster-mock.service-loading::after{content:"Loading…";position:absolute;inset:auto 10px 10px;z-index:5;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;text-align:center}
  `;
  document.head.appendChild(previewStyle);

  posterMocks.forEach((posterMock, index) => {
    const sample = previewSamples[index];
    if (!sample) return;
    const img = document.createElement('img');
    img.className = 'poster-service-image';
    img.alt = 'Live TMDB poster preview';
    img.loading = 'eager';
    img.decoding = 'async';
    img.hidden = true;
    img.addEventListener('load', () => {
      posterMock.classList.remove('service-loading');
      posterMock.classList.add('service-live');
      img.hidden = false;
    });
    img.addEventListener('error', () => {
      posterMock.classList.remove('service-loading', 'service-live');
      img.hidden = true;
    });
    posterMock.prepend(img);
  });

  let importedConfig = null;
  let importedFileName = '';
  let generatedJson = '';
  let usageMode = '';

  const openConfigurator = (mode) => {
    usageMode = mode;
    usageChoice.hidden = true;
    configurator.hidden = false;

    if (mode === 'addon') {
      routeKicker.textContent = 'AIOMETADATA / OTHER ADDON';
      routeTitle.textContent = 'Generate poster settings';
      generateHint.textContent = importedConfig
        ? 'Your existing AIOmetadata JSON will be preserved; only poster-related fields are changed when your selections require it.'
        : 'Configure Posters, then generate the poster URL and JSON settings for AIOmetadata or another compatible addon.';
    } else {
      routeKicker.textContent = 'POSTERS SETUP';
      routeTitle.textContent = 'Configure Posters';
      generateHint.textContent = importedConfig
        ? 'Your existing AIOmetadata JSON will be preserved; only poster-related fields are changed when your selections require it.'
        : 'You can generate a Posters configuration now. Import an AIOmetadata JSON first to preserve a complete existing setup.';
    }

    refreshPreview();
    configurator.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const returnToUsage = () => {
    usageMode = '';
    configurator.hidden = true;
    usageChoice.hidden = false;
    usageChoice.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  usageButtons.forEach((button) => button.addEventListener('click', () => openConfigurator(button.dataset.usage)));
  backBtn?.addEventListener('click', returnToUsage);

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'inherit';
  const selectedTags = () => tagInputs.filter((input) => input.checked).map((input) => input.value);

  const sourceLabel = (source) => ({
    inherit: 'Using your AIOmetadata poster setting',
    tmdb: 'Using TMDB Original artwork',
    smart: 'Using Smart Layout artwork'
  }[source] || 'Using your AIOmetadata poster setting');

  const refreshServicePreviews = (source, enabled, tags) => {
    posterMocks.forEach((posterMock, index) => {
      const sample = previewSamples[index];
      const img = posterMock.querySelector('.poster-service-image');
      if (!sample || !img) return;
      posterMock.classList.remove('service-live');
      posterMock.classList.add('service-loading');
      img.hidden = true;
      const params = new URLSearchParams({
        source,
        smart: enabled ? '1' : '0',
        tags: [...tags].join(','),
        preview: '1'
      });
      img.src = `/api/posters/${sample.type}/${sample.id}.webp?${params.toString()}`;
    });
  };

  const refreshPreview = () => {
    const source = selectedSource();
    const enabled = smartTagsEnabled.checked;
    const enabledTags = new Set(selectedTags());

    sourceCards.forEach((card) => card.classList.toggle('selected', card.querySelector('input')?.checked));
    tagOptions.classList.toggle('disabled', !enabled);
    tagOptions.setAttribute('aria-disabled', String(!enabled));

    posterMocks.forEach((posterMock) => {
      posterMock.classList.toggle('tags-off', !enabled);
      posterMock.classList.toggle('smart-layout', source === 'smart');
      posterMock.querySelectorAll('[data-tag]').forEach((badge) => {
        badge.classList.toggle('tag-hidden', !enabledTags.has(badge.dataset.tag));
      });
    });

    refreshServicePreviews(source, enabled, enabledTags);

    const tagText = enabled
      ? `${enabledTags.size} Smart Tag${enabledTags.size === 1 ? '' : 's'} enabled. Tag positions remain fixed.`
      : 'Smart Tags are currently off.';
    const inheritNote = source === 'inherit'
      ? ' The live examples use TMDB artwork for previewing, while your generated AIOmetadata config preserves its existing poster provider.'
      : '';
    previewDescription.textContent = `${sourceLabel(source)}. ${tagText}${inheritNote}`;
  };

  const normalizeAioExport = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The selected file is not a JSON configuration object.');
    if (value.config && typeof value.config === 'object' && !Array.isArray(value.config)) {
      return { wrapper: value, config: value.config };
    }
    return { wrapper: null, config: value };
  };

  const getMovieArtObject = (config) => {
    if (!config.artProviders || typeof config.artProviders !== 'object') config.artProviders = {};
    const current = config.artProviders.movie;
    if (current && typeof current === 'object' && !Array.isArray(current)) return current;
    const inherited = typeof current === 'string' && current ? current : 'meta';
    config.artProviders.movie = { poster: inherited, background: inherited, logo: inherited };
    return config.artProviders.movie;
  };

  const getSeriesArtObject = (config) => {
    if (!config.artProviders || typeof config.artProviders !== 'object') config.artProviders = {};
    const current = config.artProviders.series;
    if (current && typeof current === 'object' && !Array.isArray(current)) return current;
    const inherited = typeof current === 'string' && current ? current : 'meta';
    config.artProviders.series = { poster: inherited, background: inherited, logo: inherited };
    return config.artProviders.series;
  };

  const posterPattern = () => {
    const source = selectedSource();
    const tags = selectedTags().join(',');
    const enabled = smartTagsEnabled.checked ? '1' : '0';
    return `https://kollection.tv/api/posters/{type}/{tmdb_id}.webp?source=${encodeURIComponent(source)}&smart=${enabled}&tags=${encodeURIComponent(tags)}`;
  };

  const buildOutput = () => {
    const source = selectedSource();
    const tagsEnabled = smartTagsEnabled.checked;
    const tags = selectedTags();

    if (importedConfig) {
      const clone = structuredClone(importedConfig);
      const normalized = normalizeAioExport(clone);
      const config = normalized.config;

      if (source === 'tmdb') {
        getMovieArtObject(config).poster = 'tmdb';
        getSeriesArtObject(config).poster = 'tmdb';
      }

      if (tagsEnabled || source === 'smart') {
        config.posterRatingProvider = 'custom';
        config.usePosterProxy = true;
        config.customPosterUrlPattern = posterPattern();
      }

      config.kollectionPosters = {
        version: 1,
        usageMode: usageMode || 'setup',
        posterSource: source,
        smartTags: { enabled: tagsEnabled, tags, fixedPlacement: true },
        renderer: 'https://kollection.tv/api/posters/{type}/{tmdb_id}.webp'
      };

      if (normalized.wrapper) {
        normalized.wrapper.exportedAt = new Date().toISOString();
        return normalized.wrapper;
      }
      return config;
    }

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      type: 'kollection-posters',
      usageMode: usageMode || 'setup',
      config: {
        posterSource: source,
        smartTags: { enabled: tagsEnabled, tags, fixedPlacement: true },
        posterUrlPattern: posterPattern(),
        aiometadata: {
          posterRatingProvider: tagsEnabled || source === 'smart' ? 'custom' : 'none',
          usePosterProxy: Boolean(tagsEnabled || source === 'smart'),
          customPosterUrlPattern: tagsEnabled || source === 'smart' ? posterPattern() : '',
          moviePosterProvider: source === 'tmdb' ? 'tmdb' : 'inherit',
          seriesPosterProvider: source === 'tmdb' ? 'tmdb' : 'inherit'
        }
      }
    };
  };

  const generate = () => {
    const output = buildOutput();
    generatedJson = JSON.stringify(output, null, 2);
    jsonOutput.textContent = generatedJson;
    jsonPanel.hidden = false;
    copyStatus.textContent = '';
    jsonPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  sourceInputs.forEach((input) => input.addEventListener('change', refreshPreview));
  smartTagsEnabled.addEventListener('change', refreshPreview);
  tagInputs.forEach((input) => input.addEventListener('change', refreshPreview));

  configFile.addEventListener('change', async () => {
    const file = configFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      normalizeAioExport(parsed);
      importedConfig = parsed;
      importedFileName = file.name;
      importStatus.textContent = `${file.name} imported`;
      clearImport.hidden = false;
      generateHint.textContent = 'Your existing AIOmetadata JSON will be preserved; only poster-related fields are changed when your selections require it.';
    } catch (error) {
      importedConfig = null;
      importedFileName = '';
      configFile.value = '';
      clearImport.hidden = true;
      importStatus.textContent = error?.message || 'Could not import this JSON file.';
    }
  });

  clearImport.addEventListener('click', () => {
    importedConfig = null;
    importedFileName = '';
    configFile.value = '';
    clearImport.hidden = true;
    importStatus.textContent = 'No config imported';
    generateHint.textContent = usageMode === 'addon'
      ? 'Configure Posters, then generate the poster URL and JSON settings for AIOmetadata or another compatible addon.'
      : 'You can generate a Posters configuration now. Import an AIOmetadata JSON first to preserve a complete existing setup.';
  });

  generateBtn.addEventListener('click', generate);

  copyBtn.addEventListener('click', async () => {
    if (!generatedJson) generate();
    try {
      await navigator.clipboard.writeText(generatedJson);
      copyStatus.textContent = 'JSON copied to clipboard.';
    } catch (_) {
      copyStatus.textContent = 'Clipboard access was blocked. Select the JSON above and copy it manually.';
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!generatedJson) generate();
    const blob = new Blob([generatedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = importedFileName ? importedFileName.replace(/\.json$/i, '') : 'kollection-posters';
    link.href = url;
    link.download = `${baseName}-posters.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  refreshPreview();
})();
