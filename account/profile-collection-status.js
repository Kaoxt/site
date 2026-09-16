(() => {
  'use strict';

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  let knownKollectionKeysPromise = null;
  let refreshToken = 0;

  const cfg = () => {
    const c = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(c.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(c.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
      databaseUrl: String(c.kaoxtDatabaseUrl || '/runtime/database.kaoxt.js'),
    };
  };

  const mergeKey = (value) => String(value || '').trim().replace(/-community$/i, '');

  function parseKollectionDatabase(text) {
    const marker = 'window.NUVIO_DATABASE =';
    const index = text.indexOf(marker);
    if (index < 0) return [];
    let json = text.slice(index + marker.length).trim().replace(/;\s*$/, '');
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function knownKollectionKeys() {
    if (!knownKollectionKeysPromise) {
      knownKollectionKeysPromise = (async () => {
        const response = await fetch(cfg().databaseUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not read The Kollection database (HTTP ${response.status}).`);
        const groups = parseKollectionDatabase(await response.text());
        return new Set(groups.map(group => mergeKey(group?.id || group?.title)).filter(Boolean));
      })();
    }
    return knownKollectionKeysPromise;
  }

  async function pullCollections(profileId, accessToken) {
    const { apiBase, publishableKey } = cfg();
    const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_collections`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_profile_id: Number(profileId) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Could not read profile collections (HTTP ${response.status}).`);
    const rows = Array.isArray(data) ? data : [];
    const raw = rows[0]?.collections_json ?? [];
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(raw) ? raw : [];
  }

  function setRowStatus(row, state, text) {
    const copy = row?.querySelector('.account-profile-copy');
    if (!copy) return;
    let status = copy.querySelector('.account-profile-collection-status');
    if (!status) {
      const existingSmall = copy.querySelector('small');
      status = existingSmall || document.createElement('small');
      status.classList.add('account-profile-collection-status');
      if (!existingSmall) copy.appendChild(status);
    }
    status.dataset.state = state;
    status.textContent = text;
  }

  async function classifyRow(row, accessToken, keys, token) {
    const profileId = Number(row?.dataset?.profileId);
    if (!Number.isFinite(profileId) || profileId < 1) return;
    setRowStatus(row, 'checking', 'Checking collection…');
    try {
      const collections = await pullCollections(profileId, accessToken);
      if (token !== refreshToken) return;
      if (!collections.length) {
        setRowStatus(row, 'empty', 'No collection installed');
        return;
      }

      const matches = collections.filter(group => keys.has(mergeKey(group?.id || group?.title)));
      if (!matches.length) {
        setRowStatus(row, 'external', 'Using another collection');
        return;
      }

      if (matches.length < collections.length) {
        setRowStatus(row, 'mixed', 'The Kollection + other collection');
        return;
      }

      setRowStatus(row, 'kollection', 'Using The Kollection');
    } catch {
      if (token !== refreshToken) return;
      setRowStatus(row, 'unknown', 'Collection status unavailable');
    }
  }

  async function refresh() {
    const rows = [...document.querySelectorAll('#accountProfiles .account-profile-row')];
    if (!rows.length) return;
    const token = ++refreshToken;
    rows.forEach(row => setRowStatus(row, 'checking', 'Checking collection…'));

    try {
      const auth = await window.KollectionNuvioAuth?.getAccessToken?.();
      if (!auth?.accessToken || token !== refreshToken) return;
      const keys = await knownKollectionKeys();
      if (token !== refreshToken) return;
      await Promise.allSettled(rows.map(row => classifyRow(row, auth.accessToken, keys, token)));
    } catch {
      if (token !== refreshToken) return;
      rows.forEach(row => setRowStatus(row, 'unknown', 'Collection status unavailable'));
    }
  }

  function init() {
    const root = document.getElementById('accountProfiles');
    if (!root) return;
    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 60);
    };
    new MutationObserver(schedule).observe(root, { childList: true });
    window.addEventListener('kollection:nuvio-profile-changed', refresh);
    window.addEventListener('kollection:profile-collection-cleared', refresh);
    window.addEventListener('kollection:setup-synced', refresh);
    window.addEventListener('kollection:nuvio-signed-in', schedule);
    schedule();
  }

  window.KollectionProfileCollectionStatus = Object.freeze({ refresh });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
