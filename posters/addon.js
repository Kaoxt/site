(() => {
  'use strict';

  const setupButton = document.querySelector('[data-usage="setup"]');
  const addonButton = document.querySelector('[data-usage="addon"]');
  const tagOptions = document.getElementById('tagOptions');
  const configRoot = document.querySelector('#postersConfigurator .posters-config');
  if (!tagOptions || !configRoot) return;

  const panel = document.createElement('section');
  panel.id = 'standaloneAddonPanel';
  panel.className = 'standalone-addon-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="section-kicker">AIOMETADATA / OTHER ADDON</span>
    <h2>Use your addon's artwork with Kollection overlays</h2>
    <p>The recommended wrapper keeps the exact poster, backdrop, logo, title, and metadata selected by AIOmetadata. Kollection modifies only the poster pixels by adding your selected overlays.</p>
    <div class="standalone-addon-fields">
      <label>
        <span>Your AIOmetadata manifest URL</span>
        <input id="postersUpstreamManifest" class="manifest-input" type="url" inputmode="url" autocomplete="off" placeholder="https://your-aiometadata-addon/…/manifest.json" />
      </label>
      <div class="manifest-actions">
        <button id="generateOverlayManifestBtn" class="primary-button" type="button">Generate Overlay Manifest</button>
      </div>
      <div id="overlayManifestResult" class="manifest-result" hidden>
        <label>
          <span>Kollection overlay manifest</span>
          <input id="overlayManifestOutput" class="manifest-output" type="text" readonly />
        </label>
        <div class="manifest-actions">
          <button id="copyOverlayManifestBtn" class="secondary-button" type="button">Copy Overlay Manifest</button>
        </div>
      </div>
      <span id="overlayManifestStatus" class="manifest-status" role="status" aria-live="polite"></span>
    </div>
    <div class="manifest-warning">Install the generated Kollection manifest in Nuvio and disable the original AIOmetadata addon to avoid duplicate catalog rows. Keep both URLs private if your AIOmetadata URL contains account settings or API keys.</div>
    <div class="standalone-addon-fields poster-pattern-fallback">
      <label>
        <span>Direct WebP poster pattern (fallback)</span>
        <input id="posterPatternOutput" class="manifest-output" type="text" readonly />
      </label>
      <div class="manifest-actions">
        <button id="copyPosterPatternBtn" class="secondary-button" type="button">Copy Poster Pattern</button>
      </div>
      <small class="manifest-help">The direct pattern identifies artwork by IMDb/TMDB ID. Use the overlay manifest above when you want the exact image selected in AIOmetadata.</small>
      <span id="posterPatternStatus" class="manifest-status" role="status" aria-live="polite"></span>
    </div>`;

  const dividerAfterTags = tagOptions.nextElementSibling;
  if (dividerAfterTags) dividerAfterTags.before(panel);
  else tagOptions.after(panel);

  const upstreamInput = panel.querySelector('#postersUpstreamManifest');
  const generateButton = panel.querySelector('#generateOverlayManifestBtn');
  const manifestResult = panel.querySelector('#overlayManifestResult');
  const manifestOutput = panel.querySelector('#overlayManifestOutput');
  const copyManifestButton = panel.querySelector('#copyOverlayManifestBtn');
  const manifestStatus = panel.querySelector('#overlayManifestStatus');
  const patternOutput = panel.querySelector('#posterPatternOutput');
  const copyPatternButton = panel.querySelector('#copyPosterPatternBtn');
  const patternStatus = panel.querySelector('#posterPatternStatus');

  const enc = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
  const ratingSource = () => document.getElementById('ratingSource')?.value || 'average';

  function normalizedTags() {
    const tags = selectedTags();
    if (!tags.includes('quality') && !tags.includes('trend')) tags.push('trend');
    return [...new Set(tags)].sort();
  }

  function buildPosterPattern() {
    const params = new URLSearchParams({ tags: normalizedTags().join(','), ratingSource: ratingSource() });
    return `https://kollection.tv/poster/{type}/${encodeURIComponent(selectedSource())}/{imdb_id}.webp?${params}`;
  }

  function buildOverlayManifest() {
    let upstream;
    try { upstream = new URL(upstreamInput.value.trim()); }
    catch { throw new Error('Enter your valid AIOmetadata manifest URL first.'); }
    if (upstream.protocol !== 'https:' || !upstream.pathname.endsWith('/manifest.json')) {
      throw new Error('Use a public HTTPS addon URL ending in /manifest.json.');
    }
    const config = {
      v: 2,
      upstream: upstream.toString(),
      source: selectedSource(),
      tags: normalizedTags(),
      ratingSource: ratingSource(),
    };
    return `${location.origin}/api/posters-addon/${enc(JSON.stringify(config))}/manifest.json`;
  }

  function refreshOutputs() {
    patternOutput.value = buildPosterPattern();
    patternStatus.textContent = '';
    if (!manifestResult.hidden && upstreamInput.value.trim()) {
      try { manifestOutput.value = buildOverlayManifest(); }
      catch { manifestResult.hidden = true; manifestOutput.value = ''; }
    }
  }

  function setAddonMode(enabled) {
    panel.hidden = !enabled;
    configRoot.classList.toggle('addon-pattern-mode', enabled);
    if (enabled) refreshOutputs();
  }

  addonButton?.addEventListener('click', () => setAddonMode(true));
  setupButton?.addEventListener('click', () => setAddonMode(false));
  document.getElementById('catalogNextBtn')?.addEventListener('click', () => setAddonMode(false));
  document.getElementById('postersBackBtn')?.addEventListener('click', () => setAddonMode(false));

  document.querySelectorAll('input[name="posterSource"], .tag-option input[type="checkbox"]')
    .forEach((input) => input.addEventListener('change', refreshOutputs));
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'ratingSource') refreshOutputs();
  });

  generateButton?.addEventListener('click', () => {
    manifestStatus.textContent = '';
    try {
      manifestOutput.value = buildOverlayManifest();
      manifestResult.hidden = false;
      manifestStatus.textContent = 'Overlay manifest ready. Install this URL in Nuvio or Stremio.';
    } catch (error) {
      manifestResult.hidden = true;
      manifestOutput.value = '';
      manifestStatus.textContent = error?.message || 'Could not generate the overlay manifest.';
    }
  });

  copyManifestButton?.addEventListener('click', async () => {
    if (!manifestOutput.value) generateButton.click();
    if (!manifestOutput.value) return;
    try {
      await navigator.clipboard.writeText(manifestOutput.value);
      manifestStatus.textContent = 'Overlay manifest copied.';
    } catch {
      manifestOutput.select();
      manifestStatus.textContent = 'Select and copy the overlay manifest manually.';
    }
  });

  copyPatternButton?.addEventListener('click', async () => {
    refreshOutputs();
    try {
      await navigator.clipboard.writeText(patternOutput.value);
      patternStatus.textContent = 'Poster URL pattern copied.';
    } catch {
      patternOutput.select();
      patternStatus.textContent = 'Select and copy the poster pattern manually.';
    }
  });
})();
