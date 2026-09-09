(() => {
  'use strict';

  if (window.KollectionAccountLink) return;

  const icon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-row-icon">
      <circle cx="12" cy="8" r="3.25"></circle>
      <path d="M5.5 19c.55-3.65 3.1-5.5 6.5-5.5s5.95 1.85 6.5 5.5"></path>
    </svg>`;

  function ensureStyles() {
    if (document.getElementById('kollection-account-link-styles')) return;
    const style = document.createElement('style');
    style.id = 'kollection-account-link-styles';
    style.textContent = `
      .nuvio-account-link-row { min-height: 50px !important; }
      .nuvio-account-link-row .nuvio-row-copy strong {
        font-size: 15px !important;
        font-weight: 720 !important;
        line-height: 1.15 !important;
      }
      .nuvio-account-link-row .nuvio-row-copy small {
        margin-top: 2px !important;
        font-size: 11px !important;
        line-height: 1.25 !important;
      }
      .nuvio-mobile-account-row {
        width: 100%;
        min-height: 58px;
        margin: 2px 0 8px;
        padding: 8px 10px;
        border: 0;
        border-radius: 12px;
        color: #d7d8dd;
        background: transparent;
        display: flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
        text-align: left;
        box-sizing: border-box;
        transition: background .16s ease, color .16s ease;
      }
      .nuvio-mobile-account-row:hover {
        color: #fff;
        background: rgba(255,255,255,.06);
      }
      .nuvio-mobile-account-row .nuvio-row-icon {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
        color: #dfe0e5;
      }
      .nuvio-mobile-account-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .nuvio-mobile-account-copy strong {
        color: inherit;
        font-size: 15px;
        font-weight: 720;
        line-height: 1.15;
      }
      .nuvio-mobile-account-copy small {
        color: #858790;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.25;
      }
      .nuvio-mobile-account-row:focus-visible {
        outline: 2px solid #a5b4fc;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

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
    ensureStyles();
    syncDesktop();
    syncMobile();
  }

  function init() {
    ensureStyles();
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
