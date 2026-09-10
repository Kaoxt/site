(() => {
  'use strict';

  const setupButton = document.querySelector('[data-usage="setup"]');
  const addonButton = document.querySelector('[data-usage="addon"]');
  const tagOptions = document.getElementById('tagOptions');
  if (!tagOptions) return;

  const panel = document.createElement('section');
  panel.id = 'standaloneAddonPanel';
  panel.className = 'standalone-addon-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="section-kicker">STANDALONE ADDON</span>
    <h2>Generate a Posters addon for Nuvio</h2>
    <p>Wrap an existing catalog/metadata addon without changing its saved configuration. Posters passes the addon data through and replaces supported movie/show poster URLs with your selected overlays.</p>
    <div class="standalone-addon-fields">
      <label>
        <span>Existing addon manifest URL</span>
        <input id="postersUpstreamManifest" class="manifest-input" type="url" inputmode="url" autocomplete="off" placeholder="https://example.com/manifest.json" />
      </label>
      <div class="manifest-actions">
        <button id="generateManifestBtn" class="primary-button" type="button">Generate Manifest URL</button>
      </div>
      <div class="manifest-result" hidden>
        <label>
          <span>Your Posters manifest URL</span>
          <input id="manifestOutput" class="manifest-output" type="text" readonly />
        </label>
        <div class="manifest-actions">
          <button id="copyManifestBtn" class="secondary-button" type="button">Copy Manifest URL</button>
        </div>
      </div>
      <span id="manifestStatus" class="manifest-status" role="status" aria-live="polite"></span>
    </div>
    <div class="manifest-warning">For testing, disable the original wrapped catalog addon in Nuvio after installing the Posters wrapper so you do not see duplicate catalog rows. Removing Posters later does not alter the original addon configuration. Configuration links are encoded, not encrypted, so do not use a manifest URL you consider secret.</div>`;

  const dividerAfterTags = tagOptions.nextElementSibling;
  if (dividerAfterTags) dividerAfterTags.before(panel);
  else tagOptions.after(panel);

  const upstreamInput = panel.querySelector('#postersUpstreamManifest');
  const generateManifestBtn = panel.querySelector('#generateManifestBtn');
  const manifestOutput = panel.querySelector('#manifestOutput');
  const copyManifestBtn = panel.querySelector('#copyManifestBtn');
  const manifestStatus = panel.querySelector('#manifestStatus');

  const enc = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
  const ratingSource = () => document.getElementById('ratingSource')?.value || 'average';

  setupButton?.addEventListener('click', () => { panel.hidden = false; });
  addonButton?.addEventListener('click', () => { panel.hidden = true; });
  document.getElementById('postersBackBtn')?.addEventListener('click', () => { panel.hidden = true; });

  const buildManifestUrl = () => {
    let upstream;
    try { upstream = new URL(upstreamInput.value.trim()); }
    catch (_) { throw new Error('Enter a valid addon manifest URL.'); }
    if (upstream.protocol !== 'https:' || !upstream.pathname.endsWith('/manifest.json')) {
      throw new Error('Use a public HTTPS URL ending in /manifest.json.');
    }
    const tags = selectedTags();
    if (!tags.includes('quality') && !tags.includes('trend')) tags.push('trend');
    const config = {
      v: 2,
      upstream: upstream.toString(),
      source: selectedSource(),
      tags: [...new Set(tags)].sort(),
      ratingSource: ratingSource(),
    };
    return `https://kollection.tv/api/posters-addon/${enc(JSON.stringify(config))}/manifest.json`;
  };

  generateManifestBtn.addEventListener('click', () => {
    try {
      manifestOutput.value = buildManifestUrl();
      manifestOutput.closest('.manifest-result').hidden = false;
      manifestStatus.textContent = 'Manifest ready. Add this URL in Nuvio Settings → Addons.';
    } catch (error) {
      manifestStatus.textContent = error.message || 'Could not generate manifest.';
    }
  });

  copyManifestBtn.addEventListener('click', async () => {
    if (!manifestOutput.value) generateManifestBtn.click();
    if (!manifestOutput.value) return;
    try {
      await navigator.clipboard.writeText(manifestOutput.value);
      manifestStatus.textContent = 'Manifest URL copied.';
    } catch (_) {
      manifestOutput.select();
      manifestStatus.textContent = 'Select and copy the manifest URL manually.';
    }
  });
})();
