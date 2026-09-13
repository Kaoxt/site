(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);

  function requestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
    } catch {
      return null;
    }
  }

  function isBingecatManifestRequest(input) {
    const url = requestUrl(input);
    if (!url) return false;
    if (/bingecat/i.test(url.hostname) && /manifest\.json/i.test(url.pathname)) return true;
    if (url.pathname === '/api/manifest' && /bingecat/i.test(url.searchParams.get('url') || '')) return true;
    return false;
  }

  window.fetch = function(input, init = {}) {
    if (!isBingecatManifestRequest(input) || init.signal) return previousFetch(input, init);
    return previousFetch(input, {
      ...init,
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
  };

  function ensureMidnightDefault() {
    const select = document.getElementById('aiHost');
    if (!select || select.value) return;
    const managed = Array.from(select.options).find(option => option.value && option.value !== '__self_host__' && !option.disabled);
    if (!managed) return;
    select.value = managed.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#changeBtn');
    if (!button) return;
    setTimeout(() => {
      const input = document.getElementById('bcUrl');
      if (input) input.value = '';
    }, 0);
  }, true);

  function init() {
    const panel = document.getElementById('panelHost');
    if (!panel) return;
    ensureMidnightDefault();
    new MutationObserver(() => ensureMidnightDefault()).observe(panel, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
