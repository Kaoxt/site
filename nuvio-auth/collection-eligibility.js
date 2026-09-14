(() => {
  'use strict';

  if (window.KollectionCollectionEligibility) return;

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const DB_URL = '/runtime/database.kaoxt.js';
  let kollectionKeysPromise = null;
  const cache = new Map();

  const config = () => {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

  const mergeKey = (value) => String(value || '').trim().replace(/-community$/i, '');

  function parseCollections(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async function auth() {
    const token = await window.KollectionNuvioAuth?.getAccessToken?.();
    if (!token?.accessToken) throw new Error('Your Nuvio session is no longer available.');
    return token.accessToken;
  }

  async function rpc(name, body, accessToken) {
    const { apiBase, publishableKey } = config();
    const response = await fetch(`${apiBase}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `${name} failed (HTTP ${response.status}).`);
    }
    return data;
  }

  async function loadKollectionKeys() {
    if (kollectionKeysPromise) return kollectionKeysPromise;
    kollectionKeysPromise = (async () => {
      const response = await fetch(DB_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load The Kollection collection database (HTTP ${response.status}).`);
      const text = await response.text();
      const marker = 'window.NUVIO_DATABASE =';
      const index = text.indexOf(marker);
      if (index < 0) throw new Error('The Kollection collection database could not be recognized.');
      const json = text.slice(index + marker.length).trim().replace(/;\s*$/, '');
      const groups = JSON.parse(json);
      if (!Array.isArray(groups)) throw new Error('The Kollection collection database is invalid.');
      return new Set(groups.map((group) => mergeKey(group?.id)).filter(Boolean));
    })().catch((error) => {
      kollectionKeysPromise = null;
      throw error;
    });
    return kollectionKeysPromise;
  }

  async function pullCollections(profileId, accessToken) {
    const result = await rpc('sync_pull_collections', { p_profile_id: Number(profileId) }, accessToken);
    const rows = Array.isArray(result) ? result : [];
    return rows.length ? parseCollections(rows[0]?.collections_json) : [];
  }

  async function check(profileId, options = {}) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) throw new Error('Choose a valid Nuvio profile.');

    if (!options.force && cache.has(id)) return cache.get(id);

    const accessToken = options.accessToken || await auth();
    const collections = await pullCollections(id, accessToken);

    if (!collections.length) {
      const result = {
        profileId: id,
        state: 'available',
        eligible: true,
        existingCount: 0,
        kollectionCount: 0,
        externalCount: 0,
        hasKollection: false,
        collections,
      };
      cache.set(id, result);
      return result;
    }

    let keys;
    try {
      keys = await loadKollectionKeys();
    } catch (error) {
      const result = {
        profileId: id,
        state: 'unknown',
        eligible: false,
        existingCount: collections.length,
        kollectionCount: 0,
        externalCount: collections.length,
        hasKollection: false,
        collections,
        message: error?.message || 'The Kollection could not verify this profile.',
      };
      cache.set(id, result);
      return result;
    }

    let kollectionCount = 0;
    let externalCount = 0;
    for (const group of collections) {
      const key = mergeKey(group?.id);
      if (key && keys.has(key)) kollectionCount += 1;
      else externalCount += 1;
    }

    const eligible = externalCount === 0;
    const result = {
      profileId: id,
      state: eligible ? 'kollection' : 'blocked',
      eligible,
      existingCount: collections.length,
      kollectionCount,
      externalCount,
      hasKollection: kollectionCount > 0,
      collections,
      message: eligible
        ? 'This profile already contains a collection created by The Kollection setup.'
        : 'This profile already contains a collection that was not created by The Kollection setup.',
    };
    cache.set(id, result);
    return result;
  }

  async function clear(profileId, options = {}) {
    const id = Number(profileId);
    if (!Number.isFinite(id) || id < 1) throw new Error('Choose a valid Nuvio profile.');
    const accessToken = options.accessToken || await auth();
    await rpc('sync_push_collections', {
      p_profile_id: id,
      p_collections_json: [],
    }, accessToken);
    cache.delete(id);
    const result = await check(id, { accessToken, force: true });
    window.dispatchEvent(new CustomEvent('kollection:profile-collection-cleared', {
      detail: { profileId: id, eligibility: result },
    }));
    window.dispatchEvent(new CustomEvent('kollection:profile-eligibility-changed', {
      detail: { profileId: id, eligibility: result },
    }));
    return result;
  }

  function invalidate(profileId) {
    if (profileId == null) cache.clear();
    else cache.delete(Number(profileId));
  }

  window.KollectionCollectionEligibility = Object.freeze({
    check,
    clear,
    invalidate,
    mergeKey,
  });
})();
