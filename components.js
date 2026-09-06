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
    } catch (_) {}
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

  /*
    Firefox Android tablet fix:
    "Desktop site" can expose a desktop-sized CSS viewport even while the
    physical device is portrait. Use the visual viewport + touch capability
    and then force the compact nav with inline !important styles.
  */
  const getViewport = () => {
    const vv = window.visualViewport;
    return {
      width: vv?.width || window.innerWidth || document.documentElement.clientWidth,
      height: vv?.height || window.innerHeight || document.documentElement.clientHeight
    };
  };

  const isTouchDevice = () =>
    (navigator.maxTouchPoints || 0) > 0 ||
    window.matchMedia?.('(pointer: coarse)').matches === true;

  const isPortraitDevice = () => {
    const type = screen.orientation?.type || '';
    if (type.startsWith('portrait')) return true;

    const { width, height } = getViewport();
    if (height > width) return true;

    // Final fallback for browsers that virtualize the layout viewport.
    return (screen.height || 0) > (screen.width || 0);
  };

  const setImportantDisplay = (element, value) => {
    if (!element) return;
    if (value == null) element.style.removeProperty('display');
    else element.style.setProperty('display', value, 'important');
  };

  const syncResponsiveNav = () => {
    const { width } = getViewport();
    const compact = width <= 899 || (isTouchDevice() && isPortraitDevice());

    /*
      Use one compact-nav state for every browser. Firefox and Chrome report
      tablet screen/viewport dimensions differently, so browser-specific
      "large compact" detection caused the navigation to render at two sizes.
    */
    document.documentElement.classList.toggle('force-compact-nav', compact);
    document.documentElement.classList.remove('force-large-compact-nav');

    const desktopNav = document.querySelector('#site-nav .desktop-nav');
    const navActions = document.querySelector('#site-nav .nav-actions');
    const menuWrap = document.querySelector('#site-nav .menu-wrap');
    const desktopTheme = document.querySelector('#site-nav .desktop-theme-toggle');
    const mobileTheme = document.querySelector('#site-nav .mobile-theme-toggle');

    if (compact) {
      setImportantDisplay(desktopNav, 'none');
      setImportantDisplay(navActions, 'flex');
      setImportantDisplay(menuWrap, 'grid');
      setImportantDisplay(desktopTheme, 'none');
      setImportantDisplay(mobileTheme, 'inline-grid');
    } else {
      // Remove the inline override and let shared.css control desktop layout.
      [desktopNav, navActions, menuWrap, desktopTheme, mobileTheme].forEach((el) => {
        if (el) el.style.removeProperty('display');
      });
    }
  };

  const bindResponsiveNav = () => {
    if (window.__kollectionResponsiveNavBound) return;
    window.__kollectionResponsiveNavBound = true;

    window.addEventListener('resize', syncResponsiveNav, { passive: true });
    window.addEventListener('orientationchange', syncResponsiveNav, { passive: true });
    window.visualViewport?.addEventListener('resize', syncResponsiveNav, { passive: true });
    screen.orientation?.addEventListener?.('change', syncResponsiveNav);
  };

  const init = async () => {
    applyTheme(readTheme(), false);

    const navTarget = document.getElementById('site-nav');
    const footerTarget = document.getElementById('site-footer');

    const tasks = [];
    if (navTarget) tasks.push(loadFragment('nav.html', navTarget));
    if (footerTarget) tasks.push(loadFragment('footer.html', footerTarget));
    if (tasks.length) await Promise.allSettled(tasks);

    setActiveNav();
    bindThemeButtons();
    bindMenu();
    bindResponsiveNav();
    syncResponsiveNav();
    applyTheme(readTheme(), false);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
