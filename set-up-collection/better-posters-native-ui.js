(() => {
  'use strict';

  const TREND_DETAILS = [
    'studio','director','cast','inCinema','rank','newMovie','comingSoon','newSeries','returningSeries','limitedSeries',
  ];

  function hiddenTrendInputs(enabled) {
    return TREND_DETAILS.map(value =>
      `<input type="checkbox" value="${value}" data-better-trend-detail ${enabled ? 'checked' : ''} hidden>`
    ).join('');
  }

  function nativeTrendControl(enabled) {
    return `
      <label class="smart-overlay-tag-option smart-overlay-modal-choice smart-overlay-native-trend-option">
        <input type="checkbox" data-better-native-trend ${enabled ? 'checked' : ''}>
        <span>
          <b>Trend Tags</b>
          <small>Use Better Posters' native Trend Tags exactly as Better Posters chooses and styles them.</small>
        </span>
      </label>
      <div data-better-native-trend-inputs hidden>${hiddenTrendInputs(enabled)}</div>`;
  }

  function syncHidden(root, enabled) {
    root.querySelectorAll('[data-better-trend-detail]').forEach(input => {
      input.checked = enabled;
    });
  }

  function transformModal(root) {
    if (!root || root.dataset.nativeBetterPostersUi === '1') return;
    root.dataset.nativeBetterPostersUi = '1';

    const legacyInputs = [...root.querySelectorAll('[data-better-trend-detail]')];
    if (!legacyInputs.length) return;
    const enabled = legacyInputs.some(input => input.checked);

    const setupSection = legacyInputs[0].closest('.smart-overlay-trend-section');
    const savedGroup = legacyInputs[0].closest('.smart-overlay-modal-group');
    const section = setupSection || savedGroup;
    if (!section) return;

    if (setupSection) {
      const head = section.querySelector('.smart-overlay-modal-section-head');
      if (head) {
        head.innerHTML = `
          <span>TREND TAGS</span>
          <strong>Better Posters Trend Tags</strong>
          <small>Better Posters controls the exact tag text, artwork styling, placement, and which tag appears.</small>`;
      }
      const grid = section.querySelector('.smart-overlay-trend-grid');
      if (grid) grid.innerHTML = nativeTrendControl(enabled);
    } else {
      const copy = section.querySelector('.smart-overlay-modal-group-copy');
      if (copy) copy.innerHTML = `<b>Trend Tags</b><span>Use Better Posters' native Trend Tags exactly as supplied by btttr.cc.</span>`;
      const grid = section.querySelector('.smart-overlay-modal-grid');
      if (grid) grid.innerHTML = nativeTrendControl(enabled);
    }

    const toggle = section.querySelector('[data-better-native-trend]');
    toggle?.addEventListener('change', () => syncHidden(section, toggle.checked));

    const intro = root.querySelector('.smart-overlay-modal-copy');
    if (intro) {
      intro.textContent = 'Choose the Better Posters options you want. Poster artwork, Trend Tags, ratings, genres, quality badges, age ratings, wording, and styling are supplied by Better Posters; The Kollection saves the configuration and applies it to AIOMetadata for you.';
    }

    const savedIntro = root.querySelector('.smart-overlay-modal-head p');
    if (savedIntro) {
      savedIntro.textContent = 'Configure the Better Posters options AIOMetadata will use for this saved setup.';
    }
  }

  function updatePageCopy() {
    document.querySelectorAll('.smart-overlay-option').forEach(card => {
      const title = card.querySelector('h3');
      if (title?.textContent.trim() !== 'Better Posters') return;

      const copy = title.parentElement?.querySelector('p');
      const desiredCopy = 'Include your saved Better Posters configuration when this collection is installed to Nuvio.';
      if (copy && copy.textContent !== desiredCopy) {
        copy.textContent = desiredCopy;
      }

      const configureButton = card.querySelector('.smart-overlay-configure-btn, #configureBetterPostersBtn');
      if (configureButton) configureButton.remove();

      const controlRow = card.querySelector('.smart-overlay-control-row');
      if (controlRow) controlRow.classList.add('better-posters-include-only');

      const summary = card.querySelector('#betterPostersSummary');
      if (summary && /Kollection Trends/i.test(summary.textContent || '')) {
        const desiredSummary = (summary.textContent || '').replace(/Better Posters \+ Kollection Trends/i, 'Better Posters');
        if (summary.textContent !== desiredSummary) summary.textContent = desiredSummary;
      }
    });
  }

  const observer = new MutationObserver(records => {
    updatePageCopy();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('#smartOverlayModalRoot, #betterPostersModalRoot')) transformModal(node);
        node.querySelectorAll?.('#smartOverlayModalRoot, #betterPostersModalRoot').forEach(transformModal);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  updatePageCopy();
  document.querySelectorAll('#smartOverlayModalRoot, #betterPostersModalRoot').forEach(transformModal);
})();