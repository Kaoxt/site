(() => {
  'use strict';

  const status = () => document.getElementById('saveSetupStatus');

  function updateRestoreStatus() {
    const el = status();
    if (!el) return;

    const text = String(el.textContent || '');
    if (!/Re-enter your MDBList\/API keys/i.test(text)) return;

    const mdblist = document.getElementById('mdblist');
    const tmdb = document.getElementById('tmdb');
    const hasMdblist = Boolean(mdblist?.value?.trim());
    const hasTmdb = Boolean(tmdb?.value?.trim());

    if (!hasMdblist) return;

    el.textContent = hasTmdb
      ? 'Saved setup restored. Your saved MDBList and TMDB keys were restored automatically.'
      : 'Saved setup restored. Your saved MDBList key was restored automatically; TMDB is optional.';
    el.dataset.kind = 'success';
  }

  function init() {
    const el = status();
    if (el) {
      new MutationObserver(updateRestoreStatus).observe(el, { childList: true, subtree: true, characterData: true });
    }

    const panel = document.getElementById('panelHost');
    if (panel) {
      new MutationObserver(() => setTimeout(updateRestoreStatus, 0)).observe(panel, { childList: true, subtree: true });
    }

    document.addEventListener('input', (event) => {
      if (event.target?.id === 'mdblist' || event.target?.id === 'tmdb') updateRestoreStatus();
    }, true);

    setTimeout(updateRestoreStatus, 0);
    setTimeout(updateRestoreStatus, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
