(() => {
  'use strict';

  const THEME_KEY = 'kollection-theme';
  const DARK_COLOR = '#050608';
  const LIGHT_COLOR = '#f4f5f7';
  const NAV_VERSION = '20261008-mentions1';
  const FRAGMENT_TTL = 5 * 60 * 1000;

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
    // Only public, versioned markup is cached here. Account data stays in the auth client.
    const key = `kollection:fragment:${assetUrl(filename)}`;
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(key)); } catch (_) {}
    if (cached?.html && cached.expiresAt > Date.now()) {
      target.innerHTML = cached.html;
      return true;
    }
    try {
      const url = new URL(assetUrl(filename));
      let response = await fetch(url.href);
      // Plain local static servers may not provide Cloudflare's extensionless routes.
      if (response.status === 404 && !url.pathname.endsWith('.html')) {
        url.pathname += '.html';
        response = await fetch(url.href);
      }
      if (!response.ok) throw new Error(`${filename}: ${response.status}`);
      const html = await response.text();
      target.innerHTML = html;
      try { sessionStorage.setItem(key, JSON.stringify({ html, expiresAt: Date.now() + FRAGMENT_TTL })); } catch (_) {}
      return true;
    } catch (error) {
      if (cached?.html) {
        target.innerHTML = cached.html;
        return true;
      }
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
  const scriptLoads = new Map();
  const loadScriptOnce = (filename, globalCheck) => {
    if (typeof globalCheck === 'function' && globalCheck()) return Promise.resolve(true);
    const src = assetUrl(filename);
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    const task = new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.src === src);
      const script = existing || document.createElement('script');
      const cleanup = () => {
        clearTimeout(timeout);
        script.removeEventListener('load', done);
        script.removeEventListener('error', failed);
      };
      const done = () => {
        cleanup();
        script.dataset.kollectionLoaded = 'true';
        if (!globalCheck || globalCheck()) resolve(true);
        else reject(new Error(`${filename} loaded without its expected global.`));
      };
      const failed = () => {
        cleanup();
        reject(new Error(`Could not load ${filename}.`));
      };
      const timeout = setTimeout(failed, 15000);
      if (existing?.dataset.kollectionLoaded === 'true') { done(); return; }
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', failed, { once: true });
      if (!existing) {
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }
    });
    scriptLoads.set(src, task);
    task.catch(() => scriptLoads.delete(src));
    return task;
  };

  const loadNavigationAssets = () => {
    ensureStylesheet(`nuvio-auth/nav-account.css?v=${NAV_VERSION}`);
    ensureStylesheet('nuvio-auth/admin-nav.css?v=20260909-2');
    // These helpers only define their APIs at load time, so their downloads can overlap.
    return Object.fromEntries([
      ['nuvio-auth', 'KollectionNuvioAuth'],
      ['nav-notifications', 'KollectionNavNotifications'],
      ['nav-account', 'KollectionNavAccount'],
      ['nav-login-redirect', 'KollectionNavLoginRedirect'],
      ['account-link', 'KollectionAccountLink'],
      ['admin-nav', 'KollectionAdminNav'],
    ].map(([file, global]) => [global, loadScriptOnce(`nuvio-auth/${file}.js?v=${NAV_VERSION}`, () => Boolean(window[global])).catch((error) => {
      console.warn(`[The Kollection] ${global} could not load.`, error);
      return false;
    })]));
  };
  const prepareNuvioNavigation = (assets) => {
    ['KollectionNavLoginRedirect', 'KollectionAccountLink', 'KollectionAdminNav', 'KollectionNavAccount'].forEach((name) => {
      const dependencies = [assets[name]];
      if (name === 'KollectionAdminNav' || name === 'KollectionNavAccount') dependencies.push(assets.KollectionNuvioAuth);
      Promise.all(dependencies).then((loaded) => {
        if (loaded.every(Boolean)) return window[name]?.init?.();
      }).catch((error) => {
        console.warn(`[The Kollection] ${name} could not initialize.`, error);
      });
    });
  };

  const resolvePage = () => {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (/^\/set-up-collection(?:\/|$)/i.test(path)) return 'set-up-collection.html';
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
  const bindNavigationFeedback = () => {
    let resetTimer;
    const reset = () => {
      clearTimeout(resetTimer);
      document.documentElement.classList.remove('kollection-navigating');
      document.querySelectorAll('[data-navigation-pending]').forEach((link) => {
        link.removeAttribute('data-navigation-pending');
        link.removeAttribute('aria-busy');
      });
    };
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('#site-nav a[href], #site-footer a[href]');
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol)) return;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      reset();
      link.setAttribute('data-navigation-pending', 'true');
      link.setAttribute('aria-busy', 'true');
      document.documentElement.classList.add('kollection-navigating');
      // Native navigation keeps downloads, history, modifier keys and unsaved-form prompts intact.
      resetTimer = setTimeout(reset, 10000);
    });
    window.addEventListener('pageshow', reset);
    window.addEventListener('pagehide', reset);
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
    ensureStylesheet(`secondary-pages.css?v=${NAV_VERSION}`);
    ensureStylesheet(`nav-interaction.css?v=${NAV_VERSION}`);
    applyTheme(readTheme(), false);
    const navTarget = document.getElementById('site-nav');
    const footerTarget = document.getElementById('site-footer');
    const navigation = navTarget ? loadFragment(`nav?v=${NAV_VERSION}`, navTarget) : Promise.resolve();
    const navigationAssets = navTarget ? loadNavigationAssets() : null;
    // Footer and account requests must never hold the primary links or menu button.
    if (footerTarget) loadFragment(`footer?v=${NAV_VERSION}`, footerTarget);
    await navigation;
    setActiveNav();
    bindThemeButtons();
    bindMenu();
    bindNavigationFeedback();
    bindResponsiveNav();
    syncResponsiveNav();
    applyTheme(readTheme(), false);
    if (navigationAssets) prepareNuvioNavigation(navigationAssets);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
