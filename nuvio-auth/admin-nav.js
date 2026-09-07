(() => {
  'use strict';

  if (window.KollectionAdminNav) return;

  let initialized = false;
  let observer = null;
  let scheduled = false;

  const ADMIN_URL = '/admin.html';

  function adminLink(className) {
    const link = document.createElement('a');
    link.href = ADMIN_URL;
    link.className = className;
    link.dataset.kollectionAdminLink = 'true';
    link.textContent = 'Admin';
    return link;
  }

  function restoreNonAdminLayout() {
    document.querySelectorAll('[data-kollection-admin-link]').forEach((link) => link.remove());

    document.querySelectorAll('.nuvio-account-bottom-actions').forEach((wrap) => {
      const signOut = wrap.querySelector('[data-nuvio-signout-desktop]');
      if (signOut && wrap.parentNode) {
        wrap.parentNode.insertBefore(signOut, wrap);
      }
      wrap.remove();
    });

    document.querySelectorAll('.nuvio-mobile-account-actions').forEach((wrap) => {
      const signOut = wrap.querySelector('[data-nuvio-signout-mobile]');
      if (signOut && wrap.parentNode) {
        wrap.parentNode.insertBefore(signOut, wrap);
      }
      wrap.remove();
    });
  }

  function enhanceDesktop() {
    const signOut = document.querySelector('#nuvioDesktopAccount [data-nuvio-signout-desktop]');
    if (!signOut) return;

    let actions = signOut.closest('.nuvio-account-bottom-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'nuvio-account-bottom-actions';
      signOut.parentNode.insertBefore(actions, signOut);
      actions.appendChild(signOut);
    }

    if (!actions.querySelector('[data-kollection-admin-link]')) {
      actions.insertBefore(
        adminLink('nuvio-account-admin-link'),
        signOut
      );
    }
  }

  function enhanceMobile() {
    const signOut = document.querySelector('#nuvioMobileAccount [data-nuvio-signout-mobile]');
    if (!signOut) return;

    let actions = signOut.closest('.nuvio-mobile-account-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'nuvio-mobile-account-actions';
      signOut.parentNode.insertBefore(actions, signOut);
      actions.appendChild(signOut);
    }

    if (!actions.querySelector('[data-kollection-admin-link]')) {
      actions.insertBefore(
        adminLink('nuvio-mobile-admin-link'),
        signOut
      );
    }
  }

  async function apply() {
    scheduled = false;

    const session = await window.KollectionNuvioAuth?.getSession?.().catch(() => null);
    const isAdmin = Boolean(session?.authenticated && session?.isAdmin);

    if (!isAdmin) {
      restoreNonAdminLayout();
      return;
    }

    enhanceDesktop();
    enhanceMobile();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      apply().catch((error) => {
        scheduled = false;
        console.warn('[The Kollection] Could not update the Admin account shortcut.', error);
      });
    });
  }

  async function init() {
    if (!initialized) {
      initialized = true;

      const nav = document.getElementById('site-nav');
      if (nav) {
        observer = new MutationObserver(scheduleApply);
        observer.observe(nav, { childList: true, subtree: true });
      }

      window.addEventListener('kollection:nuvio-signed-in', scheduleApply);
      window.addEventListener('kollection:nuvio-signed-out', scheduleApply);
      window.addEventListener('kollection:nuvio-session-changed', scheduleApply);
      window.addEventListener('kollection:nuvio-profile-changed', scheduleApply);
    }

    await apply();
  }

  window.KollectionAdminNav = Object.freeze({
    init,
    refresh: apply,
  });
})();
