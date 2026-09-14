(() => {
  'use strict';

  let savedId = '';
  let lastSyncedAt = '';
  let loadedDraftStep = 0;
  let wasComplete = false;
  let completionSyncStarted = false;
  let handlingSaveSuccess = false;
  let secrets = { mdblistKey: '', tmdbKey: '' };

  const $ = (selector, root = document) => root.querySelector(selector);
  const saveButton = () => $('#saveSetupBtn');
  const status = () => $('#saveSetupStatus');

  function idFromUrl() {
    return new URLSearchParams(window.location.search).get('saved') || '';
  }

  function currentStep() {
    const text = $('#mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Math.max(0, Number(match[1]) - 1) : 0;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function captureSecrets() {
    const mdblist = $('#mdblist');
    const tmdb = $('#tmdb');
    if (mdblist?.value?.trim()) secrets.mdblistKey = mdblist.value.trim();
    if (tmdb?.value?.trim()) secrets.tmdbKey = tmdb.value.trim();
  }

  function applySecrets() {
    const mdblist = $('#mdblist');
    const tmdb = $('#tmdb');

    if (mdblist && secrets.mdblistKey && !mdblist.value) {
      mdblist.value = secrets.mdblistKey;
      mdblist.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (tmdb && secrets.tmdbKey && !tmdb.value) {
      tmdb.value = secrets.tmdbKey;
      tmdb.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function updateButton() {
    const button = saveButton();
    if (!button) return;
    const id = idFromUrl();
    if (id) {
      savedId = id;
      button.textContent = 'Sync';
      button.setAttribute('aria-label', 'Sync saved setup');
    } else {
      button.textContent = 'Save setup';
      button.setAttribute('aria-label', 'Save setup');
    }
  }

  function renderLastSynced(force = false) {
    const el = status();
    if (!el || !lastSyncedAt) return;
    const current = String(el.textContent || '').trim();
    if (!force && current && !/^Last synced/i.test(current)) return;
    const formatted = formatDateTime(lastSyncedAt);
    if (!formatted) return;
    el.textContent = `Last synced ${formatted}`;
    el.dataset.kind = 'success';
    el.dataset.syncStamp = 'true';
  }

  async function loadSavedMeta() {
    const id = idFromUrl();
    updateButton();
    if (!id) return;
    savedId = id;

    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      const item = data?.collection || {};
      lastSyncedAt = item.updatedAt || lastSyncedAt;
      loadedDraftStep = Math.max(0, Number(item.draftStep) || 0);
      wasComplete = loadedDraftStep >= 7;
      const incoming = item.secrets || {};
      secrets.mdblistKey = String(incoming.mdblistKey || secrets.mdblistKey || '');
      secrets.tmdbKey = String(incoming.tmdbKey || secrets.tmdbKey || '');
      applySecrets();
      renderLastSynced();
    } catch (error) {
      console.warn('[The Kollection] Could not load saved setup sync metadata.', error);
    }
  }

  async function patchSecrets() {
    const id = idFromUrl();
    if (!id) return;
    captureSecrets();
    if (!secrets.mdblistKey && !secrets.tmdbKey) return;

    try {
      await readJson(await fetch(`/api/account/collections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets }),
      }));
    } catch (error) {
      console.warn('[The Kollection] Could not sync encrypted API keys.', error);
    }
  }

  async function afterSuccessfulSave() {
    if (handlingSaveSuccess) return;
    handlingSaveSuccess = true;
    try {
      updateButton();
      savedId = idFromUrl();
      await patchSecrets();

      if (savedId) {
        const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(savedId)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        }));
        const item = data?.collection || {};
        lastSyncedAt = item.updatedAt || new Date().toISOString();
        loadedDraftStep = Math.max(0, Number(item.draftStep) || 0);
        wasComplete = loadedDraftStep >= 7;
      } else {
        lastSyncedAt = new Date().toISOString();
      }

      // saved-setup.js clears its success message after 3.5 seconds. Restore a
      // persistent last-sync stamp immediately after that message expires.
      setTimeout(() => renderLastSynced(true), 3650);
      window.dispatchEvent(new CustomEvent('kollection:setup-synced', {
        detail: { id: savedId, syncedAt: lastSyncedAt, draftStep: loadedDraftStep },
      }));
    } catch (error) {
      console.warn('[The Kollection] Could not refresh sync timestamp.', error);
    } finally {
      handlingSaveSuccess = false;
    }
  }

  function maybeFinalizeCompletedSetup() {
    if (completionSyncStarted || wasComplete || !idFromUrl()) return;
    if (currentStep() !== 7) return;
    const button = saveButton();
    if (!button || button.disabled) return;

    completionSyncStarted = true;
    setTimeout(() => {
      const currentButton = saveButton();
      if (!currentButton || currentButton.disabled || currentStep() !== 7) {
        completionSyncStarted = false;
        return;
      }
      // This uses the normal saved-setup save path, so the final category/folder
      // choices, host settings, profile and encrypted keys are all captured.
      currentButton.click();
    }, 250);
  }

  function handleStatusChange() {
    const text = String(status()?.textContent || '').trim();
    updateButton();

    if (/Saved to your account\./i.test(text)) {
      afterSuccessfulSave();
      return;
    }

    if (!text && lastSyncedAt) renderLastSynced(true);
  }

  function init() {
    updateButton();
    loadSavedMeta();

    document.addEventListener('input', (event) => {
      if (event.target?.id === 'mdblist' || event.target?.id === 'tmdb') captureSecrets();
    }, true);

    saveButton()?.addEventListener('click', captureSecrets, true);

    const statusEl = status();
    if (statusEl) {
      new MutationObserver(handleStatusChange).observe(statusEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    const panel = $('#panelHost');
    if (panel) {
      new MutationObserver(() => {
        updateButton();
        applySecrets();
        setTimeout(maybeFinalizeCompletedSetup, 60);
      }).observe(panel, { childList: true, subtree: true });
    }

    window.addEventListener('popstate', () => {
      updateButton();
      loadSavedMeta();
    });

    window.addEventListener('kollection:setup-auto-saved', event => {
      const detail = event?.detail || {};
      savedId = String(detail.id || idFromUrl() || savedId || '');
      lastSyncedAt = String(detail.syncedAt || new Date().toISOString());
      loadedDraftStep = Math.max(0, Number(detail.draftStep) || 7);
      wasComplete = loadedDraftStep >= 7;
      renderLastSynced(true);
    });

    // history.replaceState is used when the first Save creates an ID, so the
    // status observer is the reliable signal to refresh the button at that point.
    setTimeout(() => {
      updateButton();
      applySecrets();
      maybeFinalizeCompletedSetup();
    }, 200);
  }

  window.KollectionSetupSync = Object.freeze({
    getSecrets() {
      captureSecrets();
      return { ...secrets };
    },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
