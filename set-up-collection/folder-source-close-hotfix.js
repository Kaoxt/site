(() => {
  'use strict';

  function patchModal() {
    const root = document.getElementById('folderSourceEditorModal');
    if (!root || root.dataset.closeHotfix === '1') return;

    const backdrop = root.querySelector('.folder-source-backdrop');
    if (!backdrop) return;

    // The backdrop was marked with data-source-close, so the editor's
    // delegated click handler treated every click anywhere inside the modal
    // as a close request because closest('[data-source-close]') matched the
    // backdrop ancestor. Keep backdrop clicks working via the explicit
    // event.target === backdrop check, but remove it from delegated matching.
    backdrop.removeAttribute('data-source-close');
    root.dataset.closeHotfix = '1';
  }

  const observer = new MutationObserver(patchModal);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  patchModal();
})();