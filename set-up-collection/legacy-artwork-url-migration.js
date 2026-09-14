(() => {
  'use strict';

  const LEGACY_HOST_RE = /^https?:\/\/(?:www\.)?(?:kao-xt|ka-oxt)\.com(?=\/|$)/i;
  const ARTWORK_INPUT_IDS = [
    'folderCoverImage',
    'folderTitleLogo',
    'folderHeroBackdrop',
  ];

  function normalizeString(value) {
    if (typeof value !== 'string' || !value) return value;

    const normalizedHost = value.replace(/https?:\/\/(?:www\.)?(?:kao-xt|ka-oxt)\.com(?:\/images)?(?=\/|$)([^\s"'<>]*)/gi, (match, tail) => {
      const suffix = String(tail || '');
      return `https://kollection.tv/images${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    });

    return normalizedHost
      .replace(/\/images\/Movie%20Collections\//gi, '/images/Franchises/')
      .replace(/\/images\/Movie Collections\//gi, '/images/Franchises/');
  }

  function normalizeDeep(value) {
    if (typeof value === 'string') return normalizeString(value);
    if (Array.isArray(value)) return value.map(normalizeDeep);
    if (!value || typeof value !== 'object') return value;
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = normalizeDeep(item);
    return copy;
  }

  function normalizeArtworkInputs() {
    for (const id of ARTWORK_INPUT_IDS) {
      const input = document.getElementById(id);
      if (!input) continue;
      const normalized = normalizeString(input.value);
      if (normalized === input.value) continue;
      input.value = normalized;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    let nextInit = init;
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (init?.body && typeof init.body === 'string' && ['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const parsed = JSON.parse(init.body);
        nextInit = { ...init, body: JSON.stringify(normalizeDeep(parsed)) };
      } catch {
        const normalizedBody = normalizeString(init.body);
        if (normalizedBody !== init.body) nextInit = { ...init, body: normalizedBody };
      }
    }

    const response = await previousFetch(input, nextInit);

    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
      if (!/^\/api\/account\/collections(?:\/[^/]+)?$/.test(url.pathname) || !response.ok) return response;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return response;

      const text = await response.clone().text();
      const normalized = normalizeString(text);
      if (normalized === text) return response;

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(normalized, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };

  document.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !ARTWORK_INPUT_IDS.includes(input.id)) return;
    const normalized = normalizeString(input.value);
    if (normalized !== input.value) {
      const caret = input.selectionStart;
      input.value = normalized;
      try { input.setSelectionRange(caret, caret); } catch {}
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  document.addEventListener('click', event => {
    if (event.target?.closest?.('#folderSourceSave')) normalizeArtworkInputs();
  }, true);

  const observer = new MutationObserver(() => {
    const modal = document.getElementById('folderSourceEditorModal');
    if (!modal?.classList.contains('open')) return;
    normalizeArtworkInputs();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-hidden'],
  });

  window.KollectionArtworkUrls = Object.freeze({
    normalize: normalizeString,
    normalizeDeep,
    isLegacy: value => typeof value === 'string' && LEGACY_HOST_RE.test(value),
  });
})();
