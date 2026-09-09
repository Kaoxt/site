(() => {
  'use strict';

  function enforceDeviceOnly() {
    document.querySelectorAll('.nuvio-auth-divider, .nuvio-auth-shell').forEach((node) => node.remove());
  }

  function init() {
    enforceDeviceOnly();
    const host = document.getElementById('panelHost');
    if (!host) return;
    const observer = new MutationObserver(enforceDeviceOnly);
    observer.observe(host, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
