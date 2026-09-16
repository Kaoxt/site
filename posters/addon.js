(() => {
  'use strict';

  const setupButton = document.querySelector('[data-usage="setup"]');
  const addonButton = document.querySelector('[data-usage="addon"]');
  const tagOptions = document.getElementById('tagOptions');
  const configRoot = document.querySelector('#postersConfigurator .posters-config');
  if (!tagOptions || !configRoot) return;

  const panel = document.createElement('section');
  panel.id = 'standaloneAddonPanel';
  panel.className = 'standalone-addon-panel poster-url-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <span class="section-kicker">YOUR POSTER URL</span>
    <div class="poster-url-row">
      <input id="posterPatternOutput" class="manifest-output" type="text" aria-label="Your Kollection poster URL pattern" readonly />
      <button id="copyPosterPatternBtn" class="poster-url-copy" type="button">Copy</button>
    </div>
    <p class="poster-url-instructions"><strong>How to use in AIOmetadata:</strong> In <strong>Art Providers</strong>, set <strong>Rating Poster Provider</strong> to <strong>Custom Art URLs</strong>, leave <strong>Proxy Rating & Custom Art</strong> off for the fastest direct delivery from Kollection, then paste this URL into <strong>URL Patterns → Poster URL Pattern</strong>. In <strong>Catalogs</strong>, enable <strong>Rating Posters</strong> for every catalog you want overlaid, and enable rating posters for Library if you want library/meta posters too. Keep your existing backdrop, title-logo, and episode-thumbnail providers.</p>
    <span id="posterPatternStatus" class="manifest-status" role="status" aria-live="polite"></span>`;

  const dividerAfterTags = tagOptions.nextElementSibling;
  if (dividerAfterTags) dividerAfterTags.before(panel);
  else tagOptions.after(panel);

  const output = panel.querySelector('#posterPatternOutput');
  const copyButton = panel.querySelector('#copyPosterPatternBtn');
  const status = panel.querySelector('#posterPatternStatus');

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedTags = () => [...document.querySelectorAll('#tagOptions .tag-option > input[type="checkbox"]:checked')].map((input) => input.value);
  const selectedTrendDetails = () => [...document.querySelectorAll('[data-trend-detail]:checked')].map((input) => input.value);
  const ratingSource = () => document.getElementById('ratingSource')?.value || 'average';

  function buildPosterPattern() {
    const tags = selectedTags();
    const params = new URLSearchParams({
      v: '24',
      source: selectedSource(),
      tags: [...new Set(tags)].sort().join(','),
      ratingSource: ratingSource(),
      trendDetails: selectedTrendDetails().join(','),
      cv: '3',
    });
    return `https://kollection.tv/api/posters-v2/{type}/{tmdb_id}.webp?${params}`;
  }

  function refreshPattern() {
    output.value = buildPosterPattern();
    status.textContent = '';
  }

  function setAddonMode(enabled) {
    panel.hidden = !enabled;
    configRoot.classList.toggle('addon-pattern-mode', enabled);
    if (enabled) refreshPattern();
  }

  addonButton?.addEventListener('click', () => setAddonMode(true));
  setupButton?.addEventListener('click', () => setAddonMode(false));
  document.getElementById('catalogNextBtn')?.addEventListener('click', () => setAddonMode(false));
  document.getElementById('postersBackBtn')?.addEventListener('click', () => setAddonMode(false));

  document.querySelectorAll('input[name="posterSource"], .tag-option input[type="checkbox"], [data-trend-detail]')
    .forEach((input) => input.addEventListener('change', refreshPattern));
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'ratingSource') refreshPattern();
  });

  document.addEventListener('kollection:poster-settings-changed', refreshPattern);

  copyButton?.addEventListener('click', async () => {
    refreshPattern();
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = 'Poster URL copied.';
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1600);
    } catch {
      output.select();
      status.textContent = 'Select the URL and copy it manually.';
    }
  });
})();
