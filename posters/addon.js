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
    <p class="poster-url-instructions"><strong>How to use:</strong> In AIOmetadata, go to <strong>Art Providers</strong> → scroll to <strong>URL Patterns</strong> → paste this URL into the <strong>Poster URL Pattern</strong> field only. Keep your existing providers for backdrops, title logos, and episode thumbnails.</p>
    <span id="posterPatternStatus" class="manifest-status" role="status" aria-live="polite"></span>`;

  const dividerAfterTags = tagOptions.nextElementSibling;
  if (dividerAfterTags) dividerAfterTags.before(panel);
  else tagOptions.after(panel);

  const output = panel.querySelector('#posterPatternOutput');
  const copyButton = panel.querySelector('#copyPosterPatternBtn');
  const status = panel.querySelector('#posterPatternStatus');

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
  const ratingSource = () => document.getElementById('ratingSource')?.value || 'average';

  function buildPosterPattern() {
    const tags = selectedTags();
    const params = new URLSearchParams({
      v: '21',
      source: selectedSource(),
      tags: [...new Set(tags)].sort().join(','),
      ratingSource: ratingSource(),
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

  document.querySelectorAll('input[name="posterSource"], .tag-option input[type="checkbox"]')
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
