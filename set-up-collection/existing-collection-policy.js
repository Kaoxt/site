(() => {
  'use strict';

  const DB_URL = '/runtime/database.kaoxt.js';
  const originalFetch = window.fetch.bind(window);
  const state = {
    kollectionKeys: null,
    existingByProfile: new Map(),
    pendingProfileId: null,
    needsChoice: false,
    choice: 'keep',
    originalIds: new Set(),
  };

  function mergeKey(value) {
    return String(value || '').replace(/-community$/i, '');
  }

  function parseProfileId(body) {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      return Number(data?.p_profile_id ?? data?.profile_id ?? 0) || null;
    } catch {
      return null;
    }
  }

  function parseCollectionsFromPull(data) {
    const rows = Array.isArray(data) ? data : [];
    const collections = rows.length ? (rows[0]?.collections_json ?? []) : [];
    return Array.isArray(collections) ? collections : [];
  }

  async function loadKollectionKeys() {
    if (state.kollectionKeys) return state.kollectionKeys;
    try {
      const text = await originalFetch(DB_URL, { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
      const marker = 'window.NUVIO_DATABASE =';
      const index = text.indexOf(marker);
      if (index < 0) throw new Error('Kollection database marker not found');
      let json = text.slice(index + marker.length).trim().replace(/;\s*$/, '');
      const groups = JSON.parse(json);
      state.kollectionKeys = new Set((Array.isArray(groups) ? groups : []).map(group => mergeKey(group?.id)).filter(Boolean));
    } catch (error) {
      console.warn('Could not identify Kollection collection IDs:', error);
      state.kollectionKeys = new Set();
    }
    return state.kollectionKeys;
  }

  async function evaluateProfile(profileId, collections) {
    const keys = await loadKollectionKeys();
    const existing = Array.isArray(collections) ? collections : [];
    const hasKollection = existing.some(group => keys.has(mergeKey(group?.id)));
    state.pendingProfileId = profileId;
    state.needsChoice = existing.length > 0 && !hasKollection;
    state.choice = 'keep';
    state.originalIds = new Set(existing.map(group => mergeKey(group?.id)).filter(Boolean));
    window.dispatchEvent(new CustomEvent('kollection:existing-collection-policy', {
      detail: {
        profileId,
        existingCount: existing.length,
        hasKollection,
        needsChoice: state.needsChoice,
      },
    }));
  }

  function isRpc(url, name) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.pathname.endsWith(`/rest/v1/rpc/${name}`);
    } catch {
      return false;
    }
  }

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (method === 'POST' && isRpc(url, 'sync_push_collections') && state.needsChoice && state.choice === 'replace') {
      try {
        const payload = JSON.parse(init.body || '{}');
        if (Array.isArray(payload.p_collections_json)) {
          payload.p_collections_json = payload.p_collections_json.filter(group => !state.originalIds.has(mergeKey(group?.id)));
          init = { ...init, body: JSON.stringify(payload) };
        }
      } catch (error) {
        console.warn('Could not apply collection replacement choice:', error);
      }
    }

    const response = await originalFetch(input, init);

    if (method === 'POST' && isRpc(url, 'sync_pull_collections') && response.ok) {
      try {
        const profileId = parseProfileId(init?.body);
        const data = await response.clone().json();
        const collections = parseCollectionsFromPull(data);
        if (profileId) state.existingByProfile.set(profileId, collections);
        await evaluateProfile(profileId, collections);
      } catch (error) {
        console.warn('Could not inspect existing Nuvio collections:', error);
      }
    }

    return response;
  };

  function renderChoice() {
    const panel = document.querySelector('#panelHost .panel');
    if (!panel || !state.needsChoice || document.getElementById('existingCollectionPolicyCard')) return;
    const actions = panel.querySelector('.actions');
    if (!actions) return;

    const card = document.createElement('div');
    card.id = 'existingCollectionPolicyCard';
    card.className = 'callout warn';
    card.style.marginTop = '18px';
    card.innerHTML = `
      <strong>This Nuvio profile already has a different collection.</strong>
      <p style="margin:8px 0 12px">Choose what should happen when The Kollection is set up. Keeping the existing collection is the safer option.</p>
      <div class="action-group" style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="ghost" id="keepExistingCollectionBtn" type="button" aria-pressed="true">Keep existing collection</button>
        <button class="ghost" id="replaceExistingCollectionBtn" type="button" aria-pressed="false">Replace existing collection</button>
      </div>
      <small id="existingCollectionPolicyStatus" style="display:block;margin-top:10px">The current collection will stay and The Kollection will be added alongside it.</small>`;

    actions.parentNode.insertBefore(card, actions);

    const keep = card.querySelector('#keepExistingCollectionBtn');
    const replace = card.querySelector('#replaceExistingCollectionBtn');
    const status = card.querySelector('#existingCollectionPolicyStatus');

    const select = choice => {
      state.choice = choice;
      keep.setAttribute('aria-pressed', choice === 'keep' ? 'true' : 'false');
      replace.setAttribute('aria-pressed', choice === 'replace' ? 'true' : 'false');
      keep.classList.toggle('btn', choice === 'keep');
      keep.classList.toggle('ghost', choice !== 'keep');
      replace.classList.toggle('btn', choice === 'replace');
      replace.classList.toggle('ghost', choice !== 'replace');
      status.textContent = choice === 'replace'
        ? 'The profile’s existing collection groups will be removed and replaced by your selected The Kollection sections.'
        : 'The current collection will stay and The Kollection will be added alongside it.';
      window.dispatchEvent(new CustomEvent('kollection:existing-collection-choice', { detail: { choice } }));
    };

    keep.onclick = () => select('keep');
    replace.onclick = () => select('replace');
    select('keep');
  }

  const observer = new MutationObserver(() => {
    if (state.needsChoice) renderChoice();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('kollection:nuvio-profile-changed', event => {
    const profileId = Number(event?.detail?.profileId || 0) || null;
    state.pendingProfileId = profileId;
    state.needsChoice = false;
    state.choice = 'keep';
    state.originalIds = new Set();
  });
})();