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
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  };

  const writeTheme = (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {
      // Storage can be blocked in strict/privacy contexts. The theme still works for the current page.
    }
  };

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

    wrap.querySelectorAll('.menu-dropdown a').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });

    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && wrap.classList.contains('open')) {
        setOpen(false);
        button.focus();
      }
    });
  };

  const ensureStylesheet = (filename) => {
    const href = assetUrl(filename);
    const found = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some((link) => {
        try { return new URL(link.href, window.location.href).href === href; }
        catch (_) { return false; }
      });

    if (found) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  };

  const ensureScript = (filename) => {
    const src = assetUrl(filename);

    const existing = [...document.scripts].find((script) => {
      try { return new URL(script.src, window.location.href).href === src; }
      catch (_) { return false; }
    });

    if (existing) {
      if (existing.dataset.loaded === 'true' || existing.readyState === 'complete') {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        // Scripts placed in normal HTML may already have executed before this listener is attached.
        setTimeout(resolve, 0);
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
  };

  const initNuvioAccount = async () => {
    if (!document.querySelector('.nav')) return;

    ensureStylesheet('nuvio-auth/nav-account.css');

    try {
      if (!window.KollectionNuvioAuth) {
        await ensureScript('nuvio-auth/nuvio-auth.js');
      }

      if (!window.KollectionNavAccount) {
        await ensureScript('nuvio-auth/nav-account.js');
      }

      await window.KollectionNavAccount?.init?.();
    } catch (error) {
      console.warn('[The Kollection] Could not initialize the Nuvio navigation account.', error);
    }
  };

  const init = async () => {
    applyTheme(readTheme(), false); // Dark when there is no saved user choice.

    const navTarget = document.getElementById('site-nav');
    const footerTarget = document.getElementById('site-footer');

    const tasks = [];
    if (navTarget) tasks.push(loadFragment('nav.html', navTarget));
    if (footerTarget) tasks.push(loadFragment('footer.html', footerTarget));
    if (tasks.length) await Promise.allSettled(tasks);

    setActiveNav();
    bindThemeButtons();
    bindMenu();
    applyTheme(readTheme(), false);
    await initNuvioAccount();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
