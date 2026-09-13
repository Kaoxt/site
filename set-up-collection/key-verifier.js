(() => {
  'use strict';

  if (window.KollectionKeyVerifier) return;
  window.KollectionKeyVerifier = true;

  const MDBLIST_TEST_ID = '238';

  function injectStyles() {
    if (document.getElementById('kollection-key-verifier-styles')) return;
    const style = document.createElement('style');
    style.id = 'kollection-key-verifier-styles';
    style.textContent = `
      .key-action-group{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-left:auto}
      .key-verify-status{display:none;margin-top:14px;padding:11px 13px;border-radius:13px;border:1px solid var(--line-soft);font-size:11.5px;line-height:1.5}
      .key-verify-status.show{display:block}
      .key-verify-status.checking{color:#dedffa;border-color:rgba(129,140,248,.20);background:rgba(99,102,241,.06)}
      .key-verify-status.success{color:#c2f5df;border-color:rgba(94,224,174,.20);background:rgba(94,224,174,.06)}
      .key-verify-status.error{color:#fecdd3;border-color:rgba(251,113,133,.26);background:rgba(251,113,133,.07)}
      .key-verify-status.mixed{color:#f8e6aa;border-color:rgba(248,205,99,.22);background:rgba(248,205,99,.055)}
      #verifyApiKeysBtn[disabled]{opacity:.55;cursor:wait;transform:none}
      @media(max-width:700px){
        .actions.key-verifier-actions{align-items:stretch;gap:10px}
        .key-action-group{gap:8px}
        .key-action-group .btn,.key-action-group .ghost{padding-inline:14px}
      }
      @media(max-width:520px){
        .actions.key-verifier-actions{flex-wrap:wrap}
        .key-action-group{width:100%;margin-left:0;display:grid;grid-template-columns:1fr 1fr}
        .key-action-group .btn,.key-action-group .ghost{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(el, kind, message) {
    if (!el) return;
    el.className = `key-verify-status show ${kind}`;
    el.textContent = message;
  }

  async function verifyMdblist(key) {
    if (!key) return { ok: false, missing: true, label: 'MDBList' };
    try {
      const response = await fetch(`https://api.mdblist.com/tmdb/movie/${MDBLIST_TEST_ID}?apikey=${encodeURIComponent(key)}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return { ok: true, label: 'MDBList' };
      return { ok: false, label: 'MDBList', status: response.status };
    } catch (error) {
      return { ok: false, label: 'MDBList', network: true };
    }
  }

  async function verifyTmdb(key) {
    if (!key) return { ok: true, skipped: true, label: 'TMDB' };
    try {
      const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return { ok: true, label: 'TMDB' };
      return { ok: false, label: 'TMDB', status: response.status };
    } catch (error) {
      return { ok: false, label: 'TMDB', network: true };
    }
  }

  function describeFailure(result) {
    if (result.missing) return `${result.label} key is missing.`;
    if (result.network) return `${result.label} could not be reached from this browser.`;
    if (result.status === 401 || result.status === 403) return `${result.label} key is invalid.`;
    if (result.status === 429) return `${result.label} rate limit was reached; try again shortly.`;
    return `${result.label} verification failed${result.status ? ` (HTTP ${result.status})` : ''}.`;
  }

  async function runVerification(button, statusEl) {
    const mdblist = document.getElementById('mdblist')?.value.trim() || '';
    const tmdb = document.getElementById('tmdb')?.value.trim() || '';

    if (!mdblist) {
      setStatus(statusEl, 'error', 'Enter your MDBList API key before verifying.');
      document.getElementById('mdblist')?.focus();
      return;
    }

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Verifying…';
    setStatus(statusEl, 'checking', 'Checking your MDBList and TMDB keys…');

    try {
      const [mdb, tmdbResult] = await Promise.all([verifyMdblist(mdblist), verifyTmdb(tmdb)]);
      const failures = [mdb, tmdbResult].filter(result => !result.ok);

      if (!failures.length) {
        const message = tmdbResult.skipped
          ? 'MDBList key is valid. TMDB key was not entered (optional).'
          : 'MDBList and TMDB keys are valid.';
        setStatus(statusEl, 'success', message);
        return;
      }

      const successes = [mdb, tmdbResult].filter(result => result.ok && !result.skipped);
      const message = failures.map(describeFailure).join(' ');
      setStatus(statusEl, successes.length ? 'mixed' : 'error', message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function enhanceAiPanel() {
    const panel = document.getElementById('panelHost');
    if (!panel) return;
    const mdblist = panel.querySelector('#mdblist');
    const tmdb = panel.querySelector('#tmdb');
    const next = panel.querySelector('#nextBtn');
    if (!mdblist || !tmdb || !next || next.textContent.trim() !== 'Continue to Bingecat') return;
    if (panel.querySelector('#verifyApiKeysBtn')) return;

    const actions = next.closest('.actions');
    if (!actions) return;
    actions.classList.add('key-verifier-actions');

    const group = document.createElement('div');
    group.className = 'key-action-group';

    const verify = document.createElement('button');
    verify.type = 'button';
    verify.id = 'verifyApiKeysBtn';
    verify.className = 'ghost';
    verify.textContent = 'Verify keys';

    next.parentNode.insertBefore(group, next);
    group.appendChild(verify);
    group.appendChild(next);

    const statusEl = document.createElement('div');
    statusEl.id = 'keyVerifyStatus';
    statusEl.className = 'key-verify-status';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    actions.parentNode.insertBefore(statusEl, actions);

    verify.addEventListener('click', () => runVerification(verify, statusEl));
    [mdblist, tmdb].forEach(input => {
      input.addEventListener('input', () => {
        statusEl.className = 'key-verify-status';
        statusEl.textContent = '';
      });
    });
  }

  function init() {
    injectStyles();
    enhanceAiPanel();
    const panel = document.getElementById('panelHost');
    if (!panel) return;
    const observer = new MutationObserver(() => enhanceAiPanel());
    observer.observe(panel, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
