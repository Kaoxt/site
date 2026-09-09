(() => {
  'use strict';
  function apply() {
    const panel = document.getElementById('panelHost');
    if (!panel) return;
    panel.querySelector('.nuvio-device-card')?.remove();
    panel.querySelector('.nuvio-auth-divider')?.remove();
    const shell = panel.querySelector('.nuvio-auth-shell');
    if (shell) shell.hidden = false;
  }
  const start = () => {
    apply();
    const panel = document.getElementById('panelHost');
    if (!panel) return;
    new MutationObserver(apply).observe(panel, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();