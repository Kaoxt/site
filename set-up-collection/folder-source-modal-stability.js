(() => {
  'use strict';

  function stabilize(root) {
    if (!root || root.dataset.mobileStable === '3') return;
    root.dataset.mobileStable = '3';

    const backdrop = root.querySelector('.folder-source-backdrop');
    const modal = root.querySelector('.folder-source-modal');
    if (!backdrop || !modal) return;

    // Critical fix: the backdrop itself used data-source-close, which meant the
    // editor's delegated close handler matched that ancestor for every click
    // anywhere inside the modal. Remove that marker so only the explicit close
    // button matches delegated close handling. A direct backdrop click is still
    // handled separately by the editor code.
    backdrop.removeAttribute('data-source-close');

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

    const stopInside = event => {
      if (event.target?.closest?.('.folder-source-close[data-source-close]')) return;
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