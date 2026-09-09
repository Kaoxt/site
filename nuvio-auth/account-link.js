(() => {
  'use strict';

  if (window.KollectionAccountLink) return;

  const icon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-row-icon">
      <circle cx="12" cy="8" r="3.25"></circle>
      <path d="M5.5 19c.55-3.65 3.1-5.5 6.5-5.5s5.95 1.85 6.5 5.5"></path>
    </svg>`;

  function syncDesktop() {
    const slot = document.getElementById('nuvioDesktopAccount');
    const popover = slot?.querySelector('.nuvio-desktop-account-popover');
    if (!popover || popover.querySelector('[data-kollection-account-link]')) return;

    const setup = [...popover.querySelectorAll('a')].find((a) => /set up collection/i.test(a.textContent || ''));
    if (!setup) return;

    const link = document.createElement('a');
    link.className = 'nuvio-desktop-menu-row nuvio-account-link-row';
    link.href = '/account';
    link.dataset.kollectionAccountLink = 'true';
    link.innerHTML = `${icon}<span class="nuvio-row-copy"><strong>Account</strong><small>Saved setups & account details</small></span>`;
    setup.before(link);
  }

  function syncMobile() {
    const slot = document.getElementById('nuvioMobileAccount');
    const signedIn = slot?.querySelector('.nuvio-mobile-account, section');
    if (!signedIn || slot.querySelector('[data-kollection-account-link]')) return;
    const bottom = slot.querySelector('.nuvio-mobile-bottom-row');
    if (!bottom) return;

    const link = document.createElement('a');
    link.className = 'nuvio-mobile-account-row';
    link.href = '/account';
    link.dataset.kollectionAccountLink = 'true';
    link.innerHTML = `${icon}<span class="nuvio-mobile-account-copy"><strong>Account</strong><small>Saved setups & account details</small></span>`;
    bottom.before(link);
  }

  function sync() {
    syncDesktop();
    syncMobile();
  }

  function init() {
    sync();
    const nav = document.getElementById('site-nav');
    if (!nav) return;
    const observer = new MutationObserver(sync);
    observer.observe(nav, { childList: true, subtree: true });
    window.addEventListener('kollection:nuvio-signed-in', sync);
    window.addEventListener('kollection:nuvio-profile-changed', sync);
  }

  window.KollectionAccountLink = Object.freeze({ init, sync });
})();
