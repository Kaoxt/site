(() => {
  'use strict';

  const THEME_KEY = 'kollection-theme';
  const DARK_COLOR = '#050608';
  const LIGHT_COLOR = '#f4f5f7';

  const currentScript = document.currentScript || [...document.scripts].find((script) => /(?:^|\/)components\.js(?:\?|$)/.test(script.src));
  const baseUrl = currentScript && currentScript.src
    ? new URL('.', currentScript.src)
    : new URL('.', window.location.href);
  const assetUrl = (name) => new URL(name, baseUrl).href;

  const readTheme = () => {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (_) { return 'dark'; }
  };
  const writeTheme = (theme) => { try { localStorage.setItem(THEME_KEY, theme); } catch (_) {} };
  const ensureThemeMeta = () => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    return meta;
  };
  const updateThemeButtons = (theme) => {
    const isLight = theme === 'light';
    const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    document.querySelectorAll('.theme-toggle').forEach((button) => {
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(isLight));
    });
  };
  const applyTheme = (theme, persist = false) => {
    const normalized = theme === 'light' ? 'light' : 'dark';
    const isLight = normalized === 'light';
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized;
    if (document.body) {
      document.body.classList.toggle('light', isLight);
      document.body.classList.toggle('dark', !isLight);
    }
    ensureThemeMeta().setAttribute('content', isLight ? LIGHT_COLOR : DARK_COLOR);
    updateThemeButtons(normalized);
    if (persist) writeTheme(normalized);
  };
  const loadFragment = async (filename, target) => {
    if (!target) return false;
    try {
      const response = await fetch(assetUrl(filename), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${filename}: ${response.status}`);
      target.innerHTML = await response.text();
      return true;
    } catch (error) {
      console.warn(`[The Kollection] Could not load ${filename}.`, error);
      return false;
    }
  };
  const ensureStylesheet = (filename) => {
    const href = assetUrl(filename);
    const exists = [...document.styleSheets].some((sheet) => {
      try { return sheet.href === href; } catch { return false; }
    }) || [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href);
    if (exists) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  };
  const loadScriptOnce = (filename, globalCheck) => new Promise((resolve, reject) => {
    if (typeof globalCheck === 'function' && globalCheck()) { resolve(true); return; }
    const src = assetUrl(filename);
    const existing = [...document.scripts].find((script) => script.src === src);
    if (existing) {
      const done = () => {
        if (!globalCheck || globalCheck()) resolve(true);
        else reject(new Error(`${filename} loaded without its expected global.`));
      };
      if (existing.dataset.kollectionLoaded === 'true') { done(); return; }
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${filename}.`)), { once: true });
      setTimeout(() => { if (typeof globalCheck === 'function' && globalCheck()) resolve(true); }, 0);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.addEventListener('load', () => {
      script.dataset.kollectionLoaded = 'true';
      if (!globalCheck || globalCheck()) resolve(true);
      else reject(new Error(`${filename} loaded without its expected global.`));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${filename}.`)), { once: true });
    document.head.appendChild(script);
  });

  const prepareNuvioNavigation = async () => {
    ensureStylesheet('nuvio-auth/nav-account.css');
    ensureStylesheet('nuvio-auth/admin-nav.css?v=20260907-1');

    if (!window.KollectionNuvioAuth) {
      await loadScriptOnce('nuvio-auth/nuvio-auth.js', () => Boolean(window.KollectionNuvioAuth));
    }
    if (!window.KollectionNavAccount) {
      await loadScriptOnce('nuvio-auth/nav-account.js', () => Boolean(window.KollectionNavAccount));
    }
    if (!window.KollectionNavLoginRedirect) {
      await loadScriptOnce('nuvio-auth/nav-login-redirect.js?v=20260908-1', () => Boolean(window.KollectionNavLoginRedirect));
    }
    window.KollectionNavLoginRedirect?.init?.();

    try { await window.KollectionNavAccount?.init?.(); }
    catch (error) { console.warn('[The Kollection] Nuvio navigation could not initialize.', error); }

    if (!window.KollectionAccountLink) {
      await loadScriptOnce('nuvio-auth/account-link.js?v=20260909-5', () => Boolean(window.KollectionAccountLink));
    }
    window.KollectionAccountLink?.init?.();

    if (!window.KollectionAdminNav) {
      await loadScriptOnce('nuvio-auth/admin-nav.js?v=20260907-1', () => Boolean(window.KollectionAdminNav));
    }
    window.KollectionAdminNav?.init?.().catch?.((error) => {
      console.warn('[The Kollection] Admin navigation shortcut could not initialize.', error);
    });
  };

  const resolvePage = () => {
    const path = window.location.pathname.replace(/\/+$/, '');
    const last = (path.split('/').pop() || '').toLowerCase();
    if (!last || last === 'index.html') return 'index.html';
    if (last === 'news' || last === 'news.html') return 'news.html';
    return last.endsWith('.html') ? last : `${last}.html`;
  };
  const setActiveNav = () => {
    const current = resolvePage();
    document.querySelectorAll('[data-page]').forEach((link) => {
      const active = (link.getAttribute('data-page') || '').toLowerCase() === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };
  const bindThemeButtons = () => {
    updateThemeButtons(document.body?.classList.contains('light') ? 'light' : 'dark');
    document.querySelectorAll('.theme-toggle').forEach((button) => {
      if (button.dataset.themeBound === 'true') return;
      button.dataset.themeBound = 'true';
      button.addEventListener('click', () => {
        const next = document.body.classList.contains('light') ? 'dark' : 'light';
        applyTheme(next, true);
      });
    });
  };
  const bindMenu = () => {
    const wrap = document.getElementById('menuWrap');
    const button = document.getElementById('menuButton');
    if (!wrap || !button || button.dataset.menuBound === 'true') return;
    button.dataset.menuBound = 'true';
    const setOpen = (open) => {
      wrap.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    };
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(!wrap.classList.contains('open'));
    });
    wrap.addEventListener('click', (event) => { if (event.target.closest('.menu-dropdown a')) setOpen(false); });
    document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && wrap.classList.contains('open')) {
        setOpen(false);
        button.focus();
      }
    });
  };
  const COMPACT_NAV_QUERY = '(max-width: 900px)';
  let compactNavMedia = null;
  const clearResponsiveInlineDisplays = () => {
    [
      document.querySelector('#site-nav .desktop-nav'),
      document.querySelector('#site-nav .nav-actions'),
      document.querySelector('#site-nav .menu-wrap'),
      document.querySelector('#site-nav .desktop-theme-toggle'),
      document.querySelector('#site-nav .mobile-theme-toggle'),
    ].forEach((element) => element?.style.removeProperty('display'));
  };
  const syncResponsiveNav = () => {
    if (!compactNavMedia) compactNavMedia = window.matchMedia(COMPACT_NAV_QUERY);
    document.documentElement.classList.toggle('force-compact-nav', compactNavMedia.matches);
    document.documentElement.classList.remove('force-large-compact-nav');
    clearResponsiveInlineDisplays();
  };
  const bindResponsiveNav = () => {
    if (window.__kollectionResponsiveNavBound) return;
    window.__kollectionResponsiveNavBound = true;
    compactNavMedia = window.matchMedia(COMPACT_NAV_QUERY);
    if (compactNavMedia.addEventListener) compactNavMedia.addEventListener('change', syncResponsiveNav);
    else compactNavMedia.addListener?.(syncResponsiveNav);
    window.addEventListener('orientationchange', syncResponsiveNav, { passive: true });
  };
  const init = async () => {
    ensureStylesheet('secondary-pages.css?v=20260909-2');
    applyTheme(readTheme(), false);
    const navTarget = document.getElementById('site-nav');
    const footerTarget = document.getElementById('site-footer');
    const tasks = [];
    if (navTarget) tasks.push(loadFragment('nav.html?v=20260907-6', navTarget));
    if (footerTarget) tasks.push(loadFragment('footer.html?v=20260909-1', footerTarget));
    if (tasks.length) await Promise.allSettled(tasks);
    setActiveNav();
    bindThemeButtons();
    bindMenu();
    bindResponsiveNav();
    syncResponsiveNav();
    applyTheme(readTheme(), false);
    prepareNuvioNavigation().catch((error) => {
      console.warn('[The Kollection] Nuvio account navigation unavailable.', error);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();