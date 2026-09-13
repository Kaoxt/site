(() => {
  'use strict';

  function updateCategoryRows(root = document) {
    root.querySelectorAll('.collection-category-row').forEach((row) => {
      const checkbox = row.querySelector('.section-checkbox');
      const count = row.querySelector('[data-category-count]');
      if (!checkbox || !count) return;

      const current = String(count.textContent || '').trim();
      const match = current.match(/^(\d+)\s+of\s+(\d+)\s+folders selected(.*)$/i);
      if (!match) return;

      const total = Number(match[2]) || 0;
      const suffix = match[3] || '';

      if (checkbox.checked) {
        const selectedLabel = count.dataset.selectedLabel || '';
        if (selectedLabel && current !== selectedLabel) {
          count.textContent = selectedLabel;
        }
        if (selectedLabel) delete count.dataset.selectedLabel;
        return;
      }

      // Preserve the real selected-folder count once, then only change the text
      // when necessary. Writing the same textContent on every MutationObserver
      // callback creates a self-triggering mutation loop in Firefox Android.
      if (!count.dataset.selectedLabel && !/^0\s+of\s+/i.test(current)) {
        count.dataset.selectedLabel = current;
      }

      const desired = `0 of ${total} folders selected${suffix}`;
      if (current !== desired) count.textContent = desired;
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

    // Child-list observation is enough to catch Step 5 rerenders. The callback is
    // idempotent so its own label correction cannot keep Firefox's main thread busy.
    new MutationObserver(() => updateCategoryRows(panel)).observe(panel, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
