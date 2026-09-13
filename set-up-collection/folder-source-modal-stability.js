(() => {
  'use strict';

  function stabilize(root) {
    if (!root || root.dataset.mobileStable === '2') return;
    root.dataset.mobileStable = '2';

    const backdrop = root.querySelector('.folder-source-backdrop');
    const modal = root.querySelector('.folder-source-modal');
    if (!backdrop || !modal) return;

    // The editor should close only from its explicit X button (or from the
    // editor's own Save/Restore actions). Do not let clicks/taps retargeted by
    // Android/Chrome to the backdrop close the modal.
    const blockBackdropDismiss = event => {
      if (event.target === backdrop) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    backdrop.addEventListener('pointerdown', blockBackdropDismiss, true);
    backdrop.addEventListener('pointerup', blockBackdropDismiss, true);
    backdrop.addEventListener('touchstart', blockBackdropDismiss, { capture: true, passive: false });
    backdrop.addEventListener('touchend', blockBackdropDismiss, { capture: true, passive: false });
    backdrop.addEventListener('click', blockBackdropDismiss, true);

    // Stop every ordinary form interaction from escaping the dialog and
    // reaching the Step 5 folder/card controls underneath it. This includes
    // focus events, which can otherwise cause a re-render while editing a URL.
    const stopInside = event => {
      if (event.target?.closest?.('[data-source-close]')) return;
      event.stopPropagation();
    };

    ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'focusin', 'input', 'change']
      .forEach(type => modal.addEventListener(type, stopInside));

    modal.addEventListener('touchstart', stopInside, { passive: true });
    modal.addEventListener('touchend', stopInside, { passive: true });
  }

  function scan() {
    stabilize(document.getElementById('folderSourceEditorModal'));
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();