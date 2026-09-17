(() => {
  'use strict';

  const Better = globalThis.KollectionBetterPostersSettings;
  if (!Better) return;

  const $ = (id) => document.getElementById(id);
  const pageKey = 'kollection-better-posters-page-v1';
  const previewSamples = [
    { imdb: 'tt1375666', label: 'Inception' },
    { imdb: 'tt0468569', label: 'The Dark Knight' },
    { imdb: 'tt1160419', label: 'Dune' },
  ];

  const els = {
    trend: $('bpTrendTags'),
    quality: $('bpQualityTags'),
    genre: $('bpGenre'),
    rating: $('bpRating'),
    age: $('bpAgeRating'),
    ratingSource: $('bpRatingSource'),
    language: $('bpLanguage'),
    generated: $('bpGeneratedPattern'),
    aio: $('bpAioPattern'),
    custom: $('bpCustomPattern'),
    customStatus: $('bpCustomPatternStatus'),
    copyGenerated: $('bpCopyGenerated'),
    copyAio: $('bpCopyAio'),
    test: $('bpTestUrl'),
    previewStatus: $('bpPreviewStatus'),
    previewPanel: $('bpPreviewPanel'),
    configFile: $('configFile'),
    clearImport: $('clearImport'),
    importStatus: $('importStatus'),
    generateBtn: $('generateBtn'),
    jsonPanel: $('jsonPanel'),
    jsonOutput: $('jsonOutput'),
    copyJson: $('copyBtn'),
    downloadJson: $('downloadBtn'),
    copyStatus: $('copyStatus'),
  };

  let importedConfig = null;
  let importedFileName = '';
  let generatedJson = '';

  function readPageState() {
    try {
      const raw = localStorage.getItem(pageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function currentSettings() {
    return Better.normalize({
      trendTags: els.trend.checked,
      qualityTags: els.quality.checked,
      genre: els.genre.checked,
      rating: els.rating.checked,
      ageRating: els.age.checked,
      ratingSource: els.ratingSource.value,
      language: els.language.value,
    });
  }

  function writeState() {
    const settings = currentSettings();
    try {
      localStorage.setItem(Better.STORAGE_KEY, JSON.stringify(settings));
      localStorage.setItem(pageKey, JSON.stringify({
        customPattern: els.custom.value.trim(),
      }));
    } catch {}
  }

  function validCustomPattern(value) {
    const raw = String(value || '').trim();
    if (!raw) return { valid: true, value: '' };
    try {
      const url = new URL(raw.replace('{imdb_id}', 'tt1375666').replace('{imdbId}', 'tt1375666'));
      const original = new URL(raw.replace('{imdb_id}', 'tt1375666').replace('{imdbId}', 'tt1375666'));
      if (original.protocol !== 'https:') return { valid: false, message: 'Use an HTTPS Better Posters URL.' };
      if (original.hostname !== 'btttr.cc' && !original.hostname.endsWith('.btttr.cc')) {
        return { valid: false, message: 'Custom poster URLs here must come from btttr.cc.' };
      }
      if (!/\{imdb_id\}|\{imdbId\}/.test(raw)) {
        return { valid: false, message: 'Keep the {imdb_id} placeholder in the Better Posters URL.' };
      }
      return { valid: true, value: raw, parsed: url };
    } catch {
      return { valid: false, message: 'That does not look like a valid Better Posters URL.' };
    }
  }

  function activeDirectPattern() {
    const custom = validCustomPattern(els.custom.value);
    if (custom.valid && custom.value) return custom.value;
    return Better.directPattern(currentSettings());
  }

  function previewUrl(pattern, imdb) {
    return pattern.replaceAll('{imdb_id}', imdb).replaceAll('{imdbId}', imdb);
  }

  function refreshPreview(force = false) {
    els.previewPanel.classList.remove('bp-disabled');
    const pattern = activeDirectPattern();
    document.querySelectorAll('[data-bp-preview]').forEach((img, index) => {
      const sample = previewSamples[index];
      if (!sample) return;
      img.alt = `${sample.label} Better Posters preview`;
      const next = previewUrl(pattern, sample.imdb);
      if (force || img.dataset.current !== next) {
        img.dataset.current = next;
        img.src = next;
      }
    });

    const settings = currentSettings();
    const labels = [];
    if (settings.trendTags) labels.push('Trend Tags');
    if (settings.qualityTags) labels.push('Quality');
    if (settings.genre) labels.push('Genre');
    if (settings.rating) labels.push('Rating');
    if (settings.ageRating) labels.push('Age Rating');
    els.previewStatus.textContent = `Live images are served directly by Better Posters. ${labels.length ? labels.join(', ') : 'Base poster only'}.`;
  }

  function updateCustomStatus() {
    const result = validCustomPattern(els.custom.value);
    els.custom.classList.toggle('invalid', !result.valid);
    if (!els.custom.value.trim()) {
      els.customStatus.textContent = 'Leave blank to use the URL generated from the controls above.';
      els.customStatus.dataset.state = 'neutral';
    } else if (result.valid) {
      els.customStatus.textContent = 'Custom Better Posters URL active for direct previews/copying.';
      els.customStatus.dataset.state = 'ok';
    } else {
      els.customStatus.textContent = result.message;
      els.customStatus.dataset.state = 'error';
    }
  }

  function refresh() {
    const settings = currentSettings();
    els.ratingSource.disabled = !els.rating.checked;
    els.generated.textContent = Better.directPattern(settings);
    els.aio.textContent = Better.pattern(settings);
    updateCustomStatus();
    writeState();
    refreshPreview();
  }

  function restore() {
    const saved = Better.readLocal() || Better.normalize({});
    const page = readPageState();
    els.trend.checked = saved.trendTags !== false;
    els.quality.checked = saved.qualityTags === true;
    els.genre.checked = saved.genre !== false;
    els.rating.checked = saved.rating !== false;
    els.age.checked = saved.ageRating === true;
    els.ratingSource.value = Better.RATING_SOURCES.includes(saved.ratingSource) ? saved.ratingSource : 'average';
    els.language.value = Better.LANGUAGES.includes(saved.language) ? saved.language : 'en';
    els.custom.value = typeof page.customPattern === 'string' ? page.customPattern : '';
  }

  async function copyText(value, button) {
    if (!value || value === '—') return;
    const old = button.textContent;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.setTimeout(() => { button.textContent = old; }, 1400);
  }

  function normalizeAioExport(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The selected file is not a JSON configuration object.');
    }
    if (value.config && typeof value.config === 'object' && !Array.isArray(value.config)) {
      return { wrapper: value, config: value.config };
    }
    return { wrapper: null, config: value };
  }

  function buildOutput() {
    const settings = currentSettings();
    const directPattern = activeDirectPattern();

    if (importedConfig) {
      const clone = structuredClone(importedConfig);
      const normalized = normalizeAioExport(clone);
      Better.applyToAioConfig(normalized.config, settings);
      if (normalized.config.kollectionBetterPosters) {
        normalized.config.kollectionBetterPosters.directPosterUrlPattern = directPattern;
        if (els.custom.value.trim()) normalized.config.kollectionBetterPosters.customDirectPattern = els.custom.value.trim();
      }
      if (normalized.wrapper) {
        normalized.wrapper.exportedAt = new Date().toISOString();
        return normalized.wrapper;
      }
      return normalized.config;
    }

    return {
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      type: 'kollection-better-posters',
      betterPosters: {
        enabled: true,
        provider: 'btttr.cc',
        settings,
        directPosterUrlPattern: directPattern,
        aiometadataPosterUrlPattern: Better.pattern(settings),
      },
      aiometadata: {
        posterRatingProvider: 'custom',
        usePosterProxy: false,
        enableRatingPostersForLibrary: true,
        customPosterUrlPattern: Better.pattern(settings),
      },
    };
  }

  function generate() {
    const output = buildOutput();
    generatedJson = JSON.stringify(output, null, 2);
    els.jsonOutput.textContent = generatedJson;
    els.jsonPanel.hidden = false;
    els.copyStatus.textContent = '';
    els.jsonPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  [els.trend, els.quality, els.genre, els.rating, els.age, els.ratingSource, els.language]
    .forEach((control) => control?.addEventListener('change', refresh));

  els.custom?.addEventListener('input', () => {
    updateCustomStatus();
    writeState();
    if (validCustomPattern(els.custom.value).valid) refreshPreview();
  });

  els.copyGenerated?.addEventListener('click', () => copyText(activeDirectPattern(), els.copyGenerated));
  els.copyAio?.addEventListener('click', () => copyText(Better.pattern(currentSettings()), els.copyAio));
  els.test?.addEventListener('click', () => {
    refresh();
    refreshPreview(true);
    els.previewStatus.textContent = 'Test refreshed using live Better Posters images.';
    els.previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  els.configFile?.addEventListener('change', async () => {
    const file = els.configFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      normalizeAioExport(parsed);
      importedConfig = parsed;
      importedFileName = file.name;
      els.importStatus.textContent = `${file.name} imported`;
      els.clearImport.hidden = false;
    } catch (error) {
      importedConfig = null;
      importedFileName = '';
      els.configFile.value = '';
      els.clearImport.hidden = true;
      els.importStatus.textContent = error?.message || 'Could not import this JSON file.';
    }
  });

  els.clearImport?.addEventListener('click', () => {
    importedConfig = null;
    importedFileName = '';
    els.configFile.value = '';
    els.clearImport.hidden = true;
    els.importStatus.textContent = 'No config imported';
  });

  els.generateBtn?.addEventListener('click', generate);
  els.copyJson?.addEventListener('click', async () => {
    if (!generatedJson) generate();
    try {
      await navigator.clipboard.writeText(generatedJson);
      els.copyStatus.textContent = 'JSON copied to clipboard.';
    } catch {
      els.copyStatus.textContent = 'Clipboard access was blocked. Copy the JSON manually.';
    }
  });

  els.downloadJson?.addEventListener('click', () => {
    if (!generatedJson) generate();
    const blob = new Blob([generatedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const base = importedFileName ? importedFileName.replace(/\.json$/i, '') : 'kollection-better-posters';
    link.href = url;
    link.download = `${base}-posters.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  restore();
  refresh();
})();
