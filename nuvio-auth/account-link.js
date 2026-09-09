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
      #site-nav .nuvio-mobile-account-row {
        width: 100% !important;
        min-height: 58px !important;
        margin: 0 0 8px !important;
        padding: 8px 10px !important;
        border: 0 !important;
        border-radius: 12px !important;
        color: #d7d8dd !important;
        background: transparent !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 12px !important;
        text-decoration: none !important;
        text-align: left !important;
        box-sizing: border-box !important;
        transition: background .16s ease, color .16s ease !important;
      }
      #site-nav .nuvio-mobile-account-row:hover {
        color: #fff !important;
        background: rgba(255,255,255,.06) !important;
      }
      #site-nav .nuvio-mobile-account-row .nuvio-row-icon {
        width: 20px !important;
        height: 20px !important;
        flex: 0 0 20px !important;
        color: #dfe0e5 !important;
        margin: 0 !important;
      }
      #site-nav .nuvio-mobile-account-copy {
        min-width: 0 !important;
        margin: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-start !important;
        justify-content: center !important;
        gap: 2px !important;
        flex: 0 1 auto !important;
      }
      #site-nav .nuvio-mobile-account-copy strong {
        color: inherit !important;
        font-size: 15px !important;
        font-weight: 720 !important;
        line-height: 1.15 !important;
      }
      #site-nav .nuvio-mobile-account-copy small {
        color: #858790 !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        line-height: 1.25 !important;
      }
      #site-nav .nuvio-mobile-account-row:focus-visible {
        outline: 2px solid #a5b4fc !important;
        outline-offset: 2px !important;
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

    const chips = slot.querySelector('.nuvio-mobile-profile-chips');
    if (chips) chips.insertAdjacentElement('afterend', link);
    else bottom.before(link);
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
