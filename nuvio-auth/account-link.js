(() => {
  'use strict';

  if (window.KollectionAccountLink) return;

  const GITHUB_URL = 'https://github.com/Kaoxt/The-Kollection';

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

      #site-nav .nuvio-desktop-popover-user {
        grid-template-columns: auto minmax(0,1fr) auto !important;
      }

      #site-nav .nuvio-desktop-switch-link,
      #site-nav .nuvio-mobile-switch-link {
        min-height: 34px !important;
        padding: 0 12px !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        border-radius: 999px !important;
        background: rgba(255,255,255,.035) !important;
        color: #cfd1d8 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        text-decoration: none !important;
        font-size: 12px !important;
        font-weight: 720 !important;
        line-height: 1 !important;
        white-space: nowrap !important;
        transition: color .16s ease, background .16s ease, border-color .16s ease !important;
      }

      #site-nav .nuvio-desktop-switch-link {
        margin-left: auto !important;
        justify-self: end !important;
      }

      #site-nav .nuvio-desktop-switch-link:hover,
      #site-nav .nuvio-desktop-switch-link:focus-visible,
      #site-nav .nuvio-mobile-switch-link:hover,
      #site-nav .nuvio-mobile-switch-link:focus-visible {
        color: #fff !important;
        background: rgba(99,102,241,.10) !important;
        border-color: rgba(129,140,248,.32) !important;
        outline: none !important;
      }

      /* Use the exact same icon/text column geometry for Account and coffee. */
      #site-nav .nuvio-desktop-account-popover > .nuvio-account-link-row,
      #site-nav .nuvio-desktop-account-popover > .nuvio-social-link {
        padding-left: 10px !important;
        padding-right: 10px !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        gap: 11px !important;
      }

      #site-nav .nuvio-desktop-account-popover > .nuvio-social-link .nuvio-social-svg,
      #site-nav .nuvio-desktop-account-popover > .nuvio-account-link-row .nuvio-row-icon {
        width: 18px !important;
        height: 18px !important;
        flex: 0 0 18px !important;
      }

      #site-nav .nuvio-desktop-account-popover > .nuvio-social-link > span {
        margin-left: 0 !important;
        white-space: nowrap !important;
      }

      #site-nav .nuvio-account-signout-button {
        border: 1px solid rgba(255,255,255,.10) !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.035) !important;
        color: #d7d8dd !important;
      }
      #site-nav .nuvio-account-signout-button:hover,
      #site-nav .nuvio-account-signout-button:focus-visible {
        border-color: rgba(255,255,255,.18) !important;
        background: rgba(255,255,255,.065) !important;
        color: #fff !important;
        outline: none !important;
      }

      #site-nav .nuvio-mobile-current-profile {
        width: 100% !important;
        display: grid !important;
        grid-template-columns: auto minmax(0, 1fr) auto !important;
        align-items: center !important;
        gap: 12px !important;
        margin: 0 !important;
        padding-bottom: 10px !important;
      }

      #site-nav .nuvio-mobile-current-profile > div {
        min-width: 0 !important;
      }

      #site-nav .nuvio-mobile-kollection-account-link {
        width: 100% !important;
        min-height: 50px !important;
        padding: 0 2px 10px !important;
        display: grid !important;
        grid-template-columns: 18px minmax(0,1fr) !important;
        align-items: center !important;
        gap: 12px !important;
        color: #cbccd2 !important;
        text-decoration: none !important;
      }
      #site-nav .nuvio-mobile-kollection-account-link .nuvio-row-copy strong {
        color: #f3f3f5 !important;
        font-size: 14px !important;
      }
      #site-nav .nuvio-mobile-kollection-account-link .nuvio-row-copy small {
        color: #8d8f97 !important;
        font-size: 11px !important;
      }

      body.light #site-nav .nuvio-desktop-switch-link,
      body.light #site-nav .nuvio-mobile-switch-link {
        color: #4b4d55 !important;
        border-color: rgba(0,0,0,.10) !important;
        background: rgba(255,255,255,.72) !important;
      }
      body.light #site-nav .nuvio-account-signout-button {
        color: #4b4d55 !important;
        border-color: rgba(0,0,0,.10) !important;
        background: rgba(255,255,255,.72) !important;
      }

      @media (max-width: 430px) {
        #site-nav .nuvio-mobile-current-profile {
          gap: 10px !important;
        }
        #site-nav .nuvio-mobile-switch-link {
          min-height: 32px !important;
          padding-inline: 10px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function syncDesktop() {
    const slot = document.getElementById('nuvioDesktopAccount');
    if (!slot) return;

    slot.querySelectorAll('a').forEach((link) => {
      if ((link.getAttribute('href') || '').replace(/\/$/, '') === GITHUB_URL) link.remove();
    });

    const popover = slot.querySelector('.nuvio-desktop-account-popover');
    if (!popover) return;

    popover.querySelector('.nuvio-desktop-section-label')?.remove();
    popover.querySelector('.nuvio-desktop-profile-list')?.remove();

    const current = popover.querySelector('.nuvio-desktop-popover-user');
    if (current && !current.querySelector('[data-kollection-profile-switch-link]')) {
      const switchLink = document.createElement('a');
      switchLink.className = 'nuvio-desktop-switch-link';
      switchLink.href = '/account#profiles';
      switchLink.textContent = 'Switch';
      switchLink.dataset.kollectionProfileSwitchLink = 'true';
      switchLink.setAttribute('aria-label', 'Switch Nuvio profile on the Account page');
      current.appendChild(switchLink);
    }

    if (current?.nextElementSibling?.classList.contains('nuvio-desktop-menu-divider')) {
      current.nextElementSibling.remove();
    }

    if (!popover.querySelector('[data-kollection-account-link]')) {
      const setup = [...popover.querySelectorAll('a')].find((a) => /set up collection/i.test(a.textContent || ''));
      if (setup) {
        const link = document.createElement('a');
        link.className = 'nuvio-desktop-menu-row nuvio-account-link-row';
        link.href = '/account';
        link.dataset.kollectionAccountLink = 'true';
        link.innerHTML = `${icon}<span class="nuvio-row-copy"><strong>Account</strong><small>Saved setups & account details</small></span>`;
        setup.before(link);
      }
    }
  }

  function syncMobile() {
    const slot = document.getElementById('nuvioMobileAccount');
    const signedIn = slot?.querySelector('.nuvio-mobile-account, section');
    if (!signedIn) return;

    slot.querySelectorAll('.nuvio-mobile-switch-label, .nuvio-mobile-profile-chips, .nuvio-mobile-profile-head').forEach((node) => {
      if (node.classList.contains('nuvio-mobile-profile-head')) {
        const current = node.querySelector('.nuvio-mobile-current-profile');
        if (current) node.before(current);
      }
      node.remove();
    });

    const current = slot.querySelector('.nuvio-mobile-current-profile');
    if (!current) return;

    let switchLink = current.querySelector('[data-kollection-profile-switch-link]');
    if (!switchLink) {
      switchLink = document.createElement('a');
      switchLink.className = 'nuvio-mobile-switch-link';
      switchLink.href = '/account#profiles';
      switchLink.textContent = 'Switch';
      switchLink.dataset.kollectionProfileSwitchLink = 'true';
      switchLink.setAttribute('aria-label', 'Switch Nuvio profile on the Account page');
      current.appendChild(switchLink);
    }

    slot.querySelector('[data-kollection-mobile-account-link]')?.remove();
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
