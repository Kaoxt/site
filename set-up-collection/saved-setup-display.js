(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const hasSaved = Boolean(params.get('saved'));
  if (!hasSaved) return;

  const isUpdate = params.get('update') === '1';

  function refresh() {
    const api = window.KollectionSavedSetup;
    const name = String(api?.getName?.() || '').trim();
    if (!name) return false;

    const label = document.getElementById('savedSetupName');
    if (label) {
      label.hidden = false;
      label.textContent = `${isUpdate ? 'Updating' : 'Saved setup'} · ${name}`;
      label.title = name;
    }

    const status = document.getElementById('saveSetupStatus');
    if (status && /loading saved setup/i.test(String(status.textContent || ''))) {
      status.textContent = 'Saved setup loaded.';
      status.dataset.kind = 'success';
      window.setTimeout(() => {
        if (/^Saved setup loaded\.$/i.test(String(status.textContent || ''))) {
          status.textContent = '';
          delete status.dataset.kind;
        }
      }, 1800);
    }

    return true;
  }

  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    if (refresh() || tries > 80) window.clearInterval(timer);
  }, 100);

  window.addEventListener('kollection:setup-renamed', refresh);
  window.addEventListener('kollection:setup-auto-saved', refresh);
})();
