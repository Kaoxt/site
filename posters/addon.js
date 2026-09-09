(() => {
  'use strict';

  const setupButton = document.querySelector('[data-usage="setup"]');
  const addonButton = document.querySelector('[data-usage="addon"]');
  const standalone = document.getElementById('standaloneAddonPanel');
  const aioSection = document.getElementById('aioIntegrationSection');
  const upstreamInput = document.getElementById('postersUpstreamManifest');
  const generateManifestBtn = document.getElementById('generateManifestBtn');
  const manifestOutput = document.getElementById('manifestOutput');
  const copyManifestBtn = document.getElementById('copyManifestBtn');
  const manifestStatus = document.getElementById('manifestStatus');

  if (!standalone || !upstreamInput || !generateManifestBtn || !manifestOutput) return;

  const enc = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
  const ratingSource = () => document.getElementById('ratingSource')?.value || 'average';

  const setMode = (mode) => {
    const standaloneMode = mode === 'setup';
    standalone.hidden = !standaloneMode;
    if (aioSection) aioSection.hidden = standaloneMode;
  };

  setupButton?.addEventListener('click', () => setMode('setup'));
  addonButton?.addEventListener('click', () => setMode('addon'));

  const buildManifestUrl = () => {
    const value = upstreamInput.value.trim();
    let upstream;
    try { upstream = new URL(value); }
    catch (_) { throw new Error('Enter a valid addon manifest URL.'); }
    if (upstream.protocol !== 'https:' || !upstream.pathname.endsWith('/manifest.json')) {
      throw new Error('Use a public HTTPS URL ending in /manifest.json.');
    }
    const tags = selectedTags();
    if (!tags.includes('quality') && !tags.includes('trend')) tags.push('trend');
    const config = {
      v: 1,
      upstream: upstream.toString(),
      source: selectedSource(),
      tags: [...new Set(tags)].sort(),
      ratingSource: ratingSource(),
    };
    const token = enc(JSON.stringify(config));
    return `https://kollection.tv/api/posters-addon/${token}/manifest.json`;
  };

  generateManifestBtn.addEventListener('click', () => {
    try {
      manifestOutput.value = buildManifestUrl();
      manifestOutput.closest('.manifest-result')?.removeAttribute('hidden');
      manifestStatus.textContent = 'Manifest ready. Add this URL to Nuvio or another Stremio-compatible client.';
    } catch (error) {
      manifestStatus.textContent = error.message || 'Could not generate manifest.';
    }
  });

  copyManifestBtn?.addEventListener('click', async () => {
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
