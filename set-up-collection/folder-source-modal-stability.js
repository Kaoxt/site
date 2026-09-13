(() => {
  'use strict';

  function stabilize(root) {
    if (!root || root.dataset.mobileStable === '1') return;
    root.dataset.mobileStable = '1';

    const backdrop = root.querySelector('.folder-source-backdrop');
    const modal = root.querySelector('.folder-source-modal');
    if (!backdrop || !modal) return;

    // Some Android browsers can retarget the click produced when a native
    // <select> chooser closes to the backdrop. The folder editor previously
    // treated that synthetic backdrop click as an instruction to close the
    // entire modal. Ignore backdrop clicks here; the explicit X remains the
    // close control and Save/Restore continue to close through the main editor.
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) {
        event.stopImmediatePropagation();
      }
    }, true);

    // Keep all form interaction inside the dialog from bubbling into the page
    // underneath it. This also prevents Step 5 card handlers from receiving a
    // tap after Android dismisses a native select/input UI.
    modal.addEventListener('click', event => {
      if (event.target.closest('[data-source-close]')) return;
      event.stopPropagation();
    });
    modal.addEventListener('pointerup', event => event.stopPropagation());
    modal.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
  }

  function scan() {
    stabilize(document.getElementById('folderSourceEditorModal'));
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();