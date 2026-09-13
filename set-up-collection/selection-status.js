(() => {
  'use strict';

  function updateCategoryRows(root = document) {
    root.querySelectorAll('.collection-category-row').forEach((row) => {
      const checkbox = row.querySelector('.section-checkbox');
      const count = row.querySelector('[data-category-count]');
      if (!checkbox || !count) return;

      const text = String(count.textContent || '').trim();
      const match = text.match(/^(\d+)\s+of\s+(\d+)\s+folders selected(.*)$/i);
      if (!match) return;

      const total = Number(match[2]) || 0;
      const suffix = match[3] || '';

      if (checkbox.checked) {
        if (count.dataset.selectedLabel) {
          count.textContent = count.dataset.selectedLabel;
          delete count.dataset.selectedLabel;
        }
        return;
      }

      if (!count.dataset.selectedLabel) count.dataset.selectedLabel = text;
      count.textContent = `0 of ${total} folders selected${suffix}`;
    });
  }

  function init() {
    const panel = document.getElementById('panelHost');
    if (!panel) return;

    updateCategoryRows(panel);

    panel.addEventListener('change', (event) => {
      if (event.target?.classList?.contains('section-checkbox')) {
        requestAnimationFrame(() => updateCategoryRows(panel));
      }
    }, true);

    new MutationObserver(() => updateCategoryRows(panel)).observe(panel, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
