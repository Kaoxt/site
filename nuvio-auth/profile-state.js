(() => {
  'use strict';
  const pending = new Map();
  async function read(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      } catch {
        if (!attempt) continue;
        throw new Error('Could not connect to Kollection to verify your Nuvio profile. Refresh to retry.');
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (!attempt && [502, 503, 504].includes(response.status)) continue;
        throw new Error(body?.error || 'Could not verify your Nuvio profile. Refresh to retry.');
      }
      if (!Array.isArray(body?.data)) throw new Error('Nuvio verification returned an invalid response. Refresh to retry.');
      return body.data;
    }
  }
  function rpc(name, body = {}) {
    const resource = name === 'sync_pull_profiles' ? 'profiles' : name === 'sync_pull_collections' ? 'collections' : '';
    if (!resource) return Promise.reject(new Error('Unsupported profile read.'));
    const params = new URLSearchParams({ resource });
    if (resource === 'collections') params.set('profile', String(body.p_profile_id));
    const url = `/api/account/nuvio-state?${params}`;
    if (!pending.has(url)) {
      pending.set(url, read(url).finally(() => pending.delete(url)));
    }
    return pending.get(url);
  }
  window.KollectionProfileState = Object.freeze({ rpc });
})();
