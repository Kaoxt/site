(() => {
  'use strict';

  const configurator = document.getElementById('postersConfigurator');
  const tagOptions = document.getElementById('tagOptions');
  if (!configurator || !tagOptions) return;

  const CONNECTIONS_KEY = 'kollection-posters-connections-v1';
  const SETTINGS_KEY = 'kollection-posters-final-v1';

  const finalPanel = document.createElement('section');
  finalPanel.className = 'posters-final-manifest';
  finalPanel.innerHTML = `
    <div class="final-divider"></div>
    <div class="final-block">
      <span class="section-kicker">LANGUAGE</span>
      <select id="postersLanguage" class="final-select" aria-label="Catalog language">
        <option value="en" selected>English</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
        <option value="it">Italian</option>
        <option value="pt">Portuguese</option>
        <option value="ja">Japanese</option>
        <option value="ko">Korean</option>
      </select>
    </div>
    <div class="final-block">
      <span class="section-kicker">LIST SORT</span>
      <div class="sort-options" role="radiogroup" aria-label="List sort order">
        <label class="sort-option"><input type="radio" name="postersListSort" value="shuffle" checked><span><strong>Shuffle</strong><small>Fresh mix every load</small></span></label>
        <label class="sort-option"><input type="radio" name="postersListSort" value="list"><span><strong>List Order</strong><small>Original order from source</small></span></label>
        <label class="sort-option"><input type="radio" name="postersListSort" value="newest"><span><strong>Newest First</strong><small>Most recent releases first</small></span></label>
        <label class="sort-option"><input type="radio" name="postersListSort" value="oldest"><span><strong>Oldest First</strong><small>Classic titles first</small></span></label>
      </div>
    </div>
    <div class="final-divider"></div>
    <div class="manifest-copy-actions">
      <button id="copyPostersManifest" class="manifest-copy-primary" type="button">Copy Manifest URL</button>
      <button id="manifestBackBtn" class="manifest-back" type="button">Back</button>
      <span id="postersManifestStatus" class="manifest-copy-status" role="status" aria-live="polite"></span>
      <small class="manifest-private-note">Keep this URL private. It contains the MDBList key needed to load your selected lists.</small>
    </div>`;

  const dividerAfterTags = tagOptions.nextElementSibling;
  if (dividerAfterTags) dividerAfterTags.before(finalPanel);
  else tagOptions.after(finalPanel);

  const style = document.createElement('style');
  style.textContent = `
    .posters-final-manifest{display:grid;gap:26px;margin-top:8px}
    .final-divider{height:1px;background:rgba(255,255,255,.09)}
    .final-block{display:grid;gap:13px}
    .final-select{width:100%;min-height:48px;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#151618;color:#fff;padding:0 15px;font:inherit;font-size:14px;outline:0}
    .sort-options{display:grid;gap:9px}
    .sort-option{display:flex;align-items:center;gap:13px;min-height:64px;padding:12px 15px;border:1px solid rgba(255,255,255,.11);border-radius:12px;background:#101113;cursor:pointer}
    .sort-option:has(input:checked){border-color:rgba(67,219,122,.34);background:rgba(23,73,39,.22)}
    .sort-option input{appearance:none;width:22px;height:22px;flex:0 0 22px;border:3px solid #34373c;border-radius:50%;display:grid;place-items:center;margin:0}
    .sort-option input:checked{border-color:#43db7a}.sort-option input:checked:after{content:'';width:8px;height:8px;border-radius:50%;background:#43db7a}
    .sort-option span{display:grid;gap:3px}.sort-option strong{font-size:14px;color:#f6f7f8}.sort-option small{font-size:11px;color:#686b73}
    .manifest-copy-actions{display:grid;gap:10px}
    .manifest-copy-primary,.manifest-back{width:100%;min-height:54px;border-radius:12px;font:inherit;font-size:14px;font-weight:850;cursor:pointer}
    .manifest-copy-primary{border:0;background:#fff;color:#101114}.manifest-back{border:1px solid rgba(255,255,255,.15);background:transparent;color:#a8abb3}
    .manifest-copy-status{min-height:18px;text-align:center;color:#7f8390;font-size:12px}.manifest-copy-status.is-success{color:#6ff09a}.manifest-copy-status.is-error{color:#ef9a9a}
    .manifest-private-note{color:#646871;font-size:10px;line-height:1.45;text-align:center}
    .posters-config.manifest-mode>.section-heading:first-child,.posters-config.manifest-mode>.poster-style-grid,.posters-config.manifest-mode>.provider-block{display:none!important}
    .posters-config.manifest-mode>.provider-block+div.divider{display:none!important}
    .posters-config.manifest-mode .import-row,.posters-config.manifest-mode .generate-box,.posters-config.manifest-mode .json-panel{display:none!important}
    .posters-config.manifest-mode .section-heading[data-manifest-hidden="1"],.posters-config.manifest-mode .section-heading[data-manifest-hidden="1"]+*{display:none!important}
  `;
  document.head.appendChild(style);

  const configRoot = configurator.querySelector('.posters-config');
  configRoot?.classList.add('manifest-mode');

  [...configurator.querySelectorAll('.section-heading')].forEach((heading) => {
    if ((heading.textContent || '').toLowerCase().includes('aiometadata json')) heading.dataset.manifestHidden = '1';
  });

  const language = document.getElementById('postersLanguage');
  const status = document.getElementById('postersManifestStatus');
  const copyButton = document.getElementById('copyPostersManifest');
  const bottomBack = document.getElementById('manifestBackBtn');

  function enc(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function readConnections() {
    try { return JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function readFinalSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveFinalSettings() {
    const data = {
      language: language?.value || 'en',
      sort: document.querySelector('input[name="postersListSort"]:checked')?.value || 'shuffle',
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch {}
  }

  function restoreFinalSettings() {
    const saved = readFinalSettings();
    if (language && saved.language && [...language.options].some((o) => o.value === saved.language)) language.value = saved.language;
    const sort = document.querySelector(`input[name="postersListSort"][value="${CSS.escape(saved.sort || 'shuffle')}"]`);
    if (sort) sort.checked = true;
  }

  function getDefaultCatalogs() {
    const ids = ['trending-movies', 'trending-series', 'popular-movies', 'popular-series', 'top-rated', 'coming-soon'];
    return [...document.querySelectorAll('#postersCatalogStep .catalog-card input[type="checkbox"]')]
      .map((input, index) => input.checked ? ids[index] : null)
      .filter(Boolean);
  }

  function getSelectedLists() {
    return (window.KollectionPosterDiscover?.getSelected?.() || [])
      .filter((item) => String(item?.provider || '').toLowerCase() === 'mdblist')
      .map((item) => ({ username: item.username || '', slug: item.slug || '', name: item.name || item.slug || 'MDBList' }))
      .filter((item) => item.username && item.slug);
  }

  function buildManifestUrl() {
    const apiKey = String(readConnections().mdblistApiKey || '').trim();
    if (!apiKey) throw new Error('Add your MDBList API key before copying the manifest URL.');
    const source = document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
    const tags = [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
    const config = {
      v: 1,
      apiKey,
      lists: getSelectedLists(),
      defaults: getDefaultCatalogs(),
      source,
      tags,
      ratingSource: document.getElementById('ratingSource')?.value || 'average',
      language: language?.value || 'en',
      sort: document.querySelector('input[name="postersListSort"]:checked')?.value || 'shuffle',
    };
    if (!config.lists.length && !config.defaults.length) throw new Error('Choose at least one catalog or MDBList list first.');
    return `${location.origin}/api/posters-manifest/${enc(JSON.stringify(config))}/manifest.json`;
  }

  async function copyManifest() {
    status.classList.remove('is-success', 'is-error');
    try {
      saveFinalSettings();
      const url = buildManifestUrl();
      await navigator.clipboard.writeText(url);
      status.textContent = 'Manifest URL copied. Paste it into Nuvio or Stremio.';
      status.classList.add('is-success');
    } catch (error) {
      status.textContent = error?.message || 'Could not copy the manifest URL.';
      status.classList.add('is-error');
    }
  }

  copyButton?.addEventListener('click', copyManifest);
  bottomBack?.addEventListener('click', () => document.getElementById('postersBackBtn')?.click());
  language?.addEventListener('change', saveFinalSettings);
  document.querySelectorAll('input[name="postersListSort"]').forEach((input) => input.addEventListener('change', saveFinalSettings));

  restoreFinalSettings();
})();
