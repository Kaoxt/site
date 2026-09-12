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
    <h2>Poster URL pattern</h2>
    <p>Paste this image pattern into your addon's Custom Poster URL Pattern field. Your addon keeps control of movie and show metadata, backdrops, logos, and titles; Kollection replaces only the poster image.</p>
    <div class="standalone-addon-fields">
      <div class="manifest-result">
        <label>
          <span>Kollection WebP poster pattern</span>
          <input id="posterPatternOutput" class="manifest-output" type="text" readonly />
        </label>
        <div class="manifest-actions">
          <button id="copyPosterPatternBtn" class="primary-button" type="button">Copy Poster Pattern</button>
        </div>
      </div>
      <span id="posterPatternStatus" class="manifest-status" role="status" aria-live="polite"></span>
    </div>
    <div class="manifest-warning">In AIOmetadata, choose <strong>Custom</strong> as the poster rating provider, paste this into <strong>Custom Poster URL Pattern</strong>, and leave its backdrop and logo patterns unchanged.</div>`;

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
    if (!tags.includes('quality') && !tags.includes('trend')) tags.push('trend');
    const params = new URLSearchParams({
      tags: [...new Set(tags)].sort().join(','),
      ratingSource: ratingSource(),
    });
    return `https://kollection.tv/poster/{type}/${encodeURIComponent(selectedSource())}/{imdb_id}.webp?${params}`;
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

  copyButton?.addEventListener('click', async () => {
    refreshPattern();
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = 'Poster URL pattern copied. Paste it into AIOmetadata.';
    } catch (_) {
      output.select();
      status.textContent = 'Select and copy the poster pattern manually.';
    }
  });
})();
