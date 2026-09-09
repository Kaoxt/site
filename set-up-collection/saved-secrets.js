(() => {
  'use strict';

  let secrets = { mdblistKey: '', tmdbKey: '' };
  let loadedForId = '';
  let saveBusy = false;

  const savedId = () => new URLSearchParams(window.location.search).get('saved') || '';
  const statusText = () => document.getElementById('saveSetupStatus')?.textContent || '';

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function captureInputs() {
    const mdblist = document.getElementById('mdblist');
    const tmdb = document.getElementById('tmdb');
    if (mdblist?.value?.trim()) secrets.mdblistKey = mdblist.value.trim();
    if (tmdb?.value?.trim()) secrets.tmdbKey = tmdb.value.trim();
  }

  function applyInputs() {
    const mdblist = document.getElementById('mdblist');
    const tmdb = document.getElementById('tmdb');

    if (mdblist && secrets.mdblistKey && !mdblist.value) {
      mdblist.value = secrets.mdblistKey;
      mdblist.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (tmdb && secrets.tmdbKey && !tmdb.value) {
      tmdb.value = secrets.tmdbKey;
      tmdb.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function loadSecrets() {
    const id = savedId();
    if (!id || id === loadedForId) return;
    loadedForId = id;

    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      const incoming = data?.collection?.secrets || {};
      secrets = {
        mdblistKey: String(incoming.mdblistKey || ''),
        tmdbKey: String(incoming.tmdbKey || ''),
      };
      applyInputs();
    } catch (error) {
      console.warn('[The Kollection] Could not restore encrypted setup API keys.', error);
    }
  }

  async function patchSecretsAfterSave() {
    if (saveBusy) return;
    saveBusy = true;
    try {
      captureInputs();
      if (!secrets.mdblistKey && !secrets.tmdbKey) return;

      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const id = savedId();
        const message = statusText();
        if (id && /Saved to your account/i.test(message)) {
          await readJson(await fetch(`/api/account/collections/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secrets }),
          }));
          loadedForId = id;
          return;
        }
        if (/Could not save|Sign in with Nuvio/i.test(message)) return;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } catch (error) {
      console.warn('[The Kollection] Saved setup was stored, but encrypted API keys could not be updated.', error);
    } finally {
      saveBusy = false;
    }
  }

  function init() {
    document.addEventListener('input', (event) => {
      if (event.target?.id === 'mdblist' || event.target?.id === 'tmdb') captureInputs();
    }, true);

    document.getElementById('saveSetupBtn')?.addEventListener('click', () => {
      setTimeout(patchSecretsAfterSave, 0);
    });

    const panel = document.getElementById('panelHost');
    if (panel) {
      new MutationObserver(() => {
        applyInputs();
        const id = savedId();
        if (id && id !== loadedForId) loadSecrets();
      }).observe(panel, { childList: true, subtree: true });
    }

    loadSecrets();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
