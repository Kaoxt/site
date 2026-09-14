(() => {
  'use strict';

  const NUVIO_API = 'https://api.nuvio.tv';
  const NUVIO_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  let busy = false;

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function empty(container, message = 'Create a setup and save it to your account to see it here.') {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'account-empty-state';
    const strong = document.createElement('strong');
    strong.textContent = 'No saved setups yet';
    const span = document.createElement('span');
    span.textContent = message;
    box.append(strong, span);
    container.appendChild(box);
  }

  function config() {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || NUVIO_API).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || NUVIO_KEY),
    };
  }

  function parseCollections(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }
    return [];
  }

  function collectionKey(value) {
    return String(value || '').trim().replace(/-community$/i, '');
  }

  async function pullProfileCollections(profileId) {
    const tokenResult = await window.KollectionNuvioAuth?.getAccessToken?.();
    const accessToken = tokenResult?.accessToken;
    if (!accessToken) throw new Error('Nuvio session unavailable.');
    const { apiBase, publishableKey } = config();
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
    if (!response.ok) throw new Error(`Could not verify Nuvio collections (HTTP ${response.status}).`);
    const rows = Array.isArray(data) ? data : [];
    return rows.length ? parseCollections(rows[0]?.collections_json) : [];
  }

  async function pullProfiles() {
    const tokenResult = await window.KollectionNuvioAuth?.getAccessToken?.();
    const accessToken = tokenResult?.accessToken;
    if (!accessToken) throw new Error('Nuvio session unavailable.');
    const { apiBase, publishableKey } = config();
    const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_profiles`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Could not verify Nuvio profiles (HTTP ${response.status}).`);
    return Array.isArray(data) ? data : (data?.profiles || []);
  }

  const profileIdOf = (profile) => Number(profile?.profile_index ?? profile?.id);
  const profileNameOf = (profile) => String(profile?.name || '').trim();

  async function repairSavedProfileLink(item, profile) {
    if (!item?.id || !profile) return;
    const profileId = profileIdOf(profile);
    if (!Number.isFinite(profileId) || profileId < 1) return;
    try {
      await readJson(await fetch(`/api/account/collections/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nuvioProfileId: profileId,
          nuvioProfileName: profileNameOf(profile) || item.nuvioProfileName || '',
        }),
      }));
      item.nuvioProfileId = profileId;
      if (profileNameOf(profile)) item.nuvioProfileName = profileNameOf(profile);
    } catch (error) {
      console.warn('[The Kollection] Could not repair saved setup profile link.', error);
    }
  }

  function liveIds(collections) {
    return new Set(parseCollections(collections).map(item => collectionKey(item?.id)).filter(Boolean));
  }

  function expectedIds(item) {
    const ids = item?.config?.selectedCollectionGroupIds;
    return Array.isArray(ids) ? ids.map(collectionKey).filter(Boolean) : [];
  }

  async function verifyCompletedSetup(item, cache, profileCache) {
    if (Number(item?.draftStep || 0) < 7) return { state: 'draft' };

    const expected = expectedIds(item);
    const savedProfileId = Number(item?.nuvioProfileId);
    const savedProfileName = String(item?.nuvioProfileName || '').trim();

    const inspect = async (profileId) => {
      if (!Number.isFinite(profileId) || profileId < 1) return null;
      if (!cache.has(profileId)) cache.set(profileId, pullProfileCollections(profileId));
      const collections = await cache.get(profileId);
      const ids = liveIds(collections);
      const matched = expected.filter(id => ids.has(id));

      if (matched.length) {
        return { state: 'valid', matched: matched.length, expected: expected.length, profileId };
      }

      if (window.KollectionCollectionEligibility) {
        const eligibility = await window.KollectionCollectionEligibility.check(profileId, { force: true });
        if (eligibility?.state === 'kollection' && eligibility?.hasKollection) {
          return {
            state: 'valid',
            matched: 0,
            expected: expected.length,
            profileId,
            verifiedByOrigin: true,
          };
        }
      }
      return null;
    };

    if (Number.isFinite(savedProfileId) && savedProfileId >= 1) {
      const direct = await inspect(savedProfileId);
      if (direct) return direct;
    }

    if (!profileCache.value) profileCache.value = pullProfiles();
    const profiles = await profileCache.value;

    const named = savedProfileName
      ? profiles.filter((profile) => profileNameOf(profile).toLowerCase() === savedProfileName.toLowerCase())
      : [];

    for (const profile of named) {
      const id = profileIdOf(profile);
      if (id === savedProfileId) continue;
      const resolved = await inspect(id);
      if (resolved) {
        await repairSavedProfileLink(item, profile);
        return { ...resolved, repairedProfileLink: true };
      }
    }

    if (expected.length) {
      const exactMatches = [];
      for (const profile of profiles) {
        const id = profileIdOf(profile);
        if (!Number.isFinite(id) || id < 1 || id === savedProfileId || named.includes(profile)) continue;
        if (!cache.has(id)) cache.set(id, pullProfileCollections(id));
        const collections = await cache.get(id);
        const ids = liveIds(collections);
        const matched = expected.filter(key => ids.has(key));
        if (matched.length) exactMatches.push({ profile, matched });
      }

      if (exactMatches.length === 1) {
        const candidate = exactMatches[0];
        await repairSavedProfileLink(item, candidate.profile);
        return {
          state: 'valid',
          matched: candidate.matched.length,
          expected: expected.length,
          profileId: profileIdOf(candidate.profile),
          repairedProfileLink: true,
        };
      }
    }

    return {
      state: 'invalid',
      message: 'This saved setup could not be matched to The Kollection currently installed on its Nuvio profile. Editing is disabled.',
    };
  }

  function buildRow(item) {
    const row = document.createElement('article');
    row.className = 'account-saved-row';
    row.dataset.savedId = item.id || '';

    const copy = document.createElement('div');
    const titleRow = document.createElement('div');
    titleRow.className = 'account-saved-title-row';
    const name = document.createElement('strong');
    name.textContent = item.name || 'My Kollection';
    const badge = document.createElement('span');
    badge.className = 'account-origin-badge';
    badge.hidden = true;
    titleRow.append(name, badge);

    const meta = document.createElement('small');
    const pieces = [];
    const complete = Number(item.draftStep || 0) >= 7;
    if (item.nuvioProfileName) pieces.push(item.nuvioProfileName);
    if (item.updatedAt) pieces.push(`${complete ? 'Last synced' : 'Updated'} ${formatDate(item.updatedAt)}`);
    meta.textContent = pieces.join(' · ') || (complete ? 'Setup complete' : 'Saved configuration');

    const originMessage = document.createElement('small');
    originMessage.className = 'account-origin-message';
    originMessage.hidden = true;
    copy.append(titleRow, meta, originMessage);

    const actions = document.createElement('div');
    actions.className = 'account-saved-actions';

    const resume = document.createElement('a');
    resume.className = 'account-secondary-button account-small-button';
    resume.href = `/set-up-collection?saved=${encodeURIComponent(item.id)}${complete ? '&edit=1' : ''}`;
    resume.textContent = complete ? 'Checking…' : 'Resume';
    resume.setAttribute('aria-label', complete ? `Verify ${item.name || 'saved setup'} before editing` : `Resume ${item.name || 'saved setup'}`);
    if (complete) {
      resume.classList.add('account-edit-pending');
      resume.setAttribute('aria-disabled', 'true');
      resume.addEventListener('click', event => {
        if (resume.classList.contains('account-edit-pending') || resume.classList.contains('account-edit-invalid')) event.preventDefault();
      });
    }

    const remove = document.createElement('button');
    remove.className = 'account-secondary-button account-small-button';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete “${item.name || 'My Kollection'}”?`)) return;
      remove.disabled = true;
      try {
        await readJson(await fetch(`/api/account/collections/${encodeURIComponent(item.id)}`, {
          method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
        }));
        await load();
      } catch (error) {
        const status = document.getElementById('accountSavedStatus');
        if (status) status.textContent = error?.message || 'Could not delete saved setup.';
        remove.disabled = false;
      }
    });

    actions.append(resume, remove);
    row.append(copy, actions);
    return { row, resume, badge, originMessage, meta, complete };
  }

  async function render(collections) {
    const container = document.getElementById('accountSavedCollections');
    if (!container) return;
    container.innerHTML = '';
    if (!collections.length) { empty(container); return; }

    const cache = new Map();
    const profileCache = { value: null };
    const pending = [];
    for (const item of collections) {
      const ui = buildRow(item);
      container.appendChild(ui.row);
      if (!ui.complete) continue;
      pending.push((async () => {
        try {
          const result = await verifyCompletedSetup(item, cache, profileCache);
          ui.resume.classList.remove('account-edit-pending');
          ui.resume.removeAttribute('aria-disabled');
          ui.badge.hidden = false;
          if (result.state === 'valid') {
            ui.badge.textContent = item.lastAppliedAt ? 'Active' : 'Verified';
            ui.badge.dataset.state = item.lastAppliedAt ? 'active' : 'valid';
            ui.resume.textContent = 'Edit';
            ui.resume.setAttribute('aria-label', `Edit ${item.name || 'saved setup'}`);
            ui.originMessage.hidden = true;
            if (result.repairedProfileLink && ui.meta) {
              const parts = [];
              if (item.nuvioProfileName) parts.push(item.nuvioProfileName);
              if (item.updatedAt) parts.push(`Last synced ${formatDate(item.updatedAt)}`);
              ui.meta.textContent = parts.join(' · ') || 'Setup complete';
            }
          } else {
            ui.badge.textContent = 'Invalid';
            ui.badge.dataset.state = 'invalid';
            ui.resume.textContent = 'Edit unavailable';
            ui.resume.classList.add('account-edit-invalid');
            ui.resume.setAttribute('aria-disabled', 'true');
            ui.resume.removeAttribute('href');
            ui.originMessage.textContent = result.message || 'This setup is not recognized as The Kollection on the saved Nuvio profile.';
            ui.originMessage.hidden = false;
            ui.row.classList.add('account-saved-invalid');
          }
        } catch (error) {
          ui.resume.classList.remove('account-edit-pending');
          ui.resume.textContent = 'Edit unavailable';
          ui.resume.classList.add('account-edit-invalid');
          ui.resume.removeAttribute('href');
          ui.badge.hidden = false;
          ui.badge.textContent = 'Unable to verify';
          ui.badge.dataset.state = 'unknown';
          ui.originMessage.textContent = error?.message || 'The Kollection could not verify this setup against Nuvio.';
          ui.originMessage.hidden = false;
        }
      })());
    }
    await Promise.allSettled(pending);
  }

  async function load() {
    if (busy) return;
    const container = document.getElementById('accountSavedCollections');
    const status = document.getElementById('accountSavedStatus');
    if (!container) return;
    busy = true;
    if (status) status.textContent = 'Loading saved setups…';
    try {
      const session = await window.KollectionNuvioAuth?.getSession?.();
      if (!session?.authenticated) {
        container.innerHTML = '';
        if (status) status.textContent = '';
        return;
      }
      const data = await readJson(await fetch('/api/account/collections', { credentials: 'same-origin', cache: 'no-store' }));
      const collections = Array.isArray(data.collections) ? data.collections : [];
      await render(collections);
      if (status) status.textContent = collections.length
        ? `${collections.length} saved setup${collections.length === 1 ? '' : 's'}. Completed setups are verified against the linked Nuvio profile before editing.` : '';
    } catch (error) {
      empty(container, 'Saved collection storage needs the Cloudflare D1 database binding before it can be used.');
      if (status) status.textContent = error?.message || 'Could not load saved setups.';
    } finally { busy = false; }
  }

  function init() {
    load();
    window.addEventListener('kollection:nuvio-signed-in', load);
    window.addEventListener('kollection:setup-synced', load);
    window.addEventListener('kollection:nuvio-profile-changed', load);
    window.addEventListener('kollection:nuvio-signed-out', () => {
      const container = document.getElementById('accountSavedCollections');
      const status = document.getElementById('accountSavedStatus');
      if (container) container.innerHTML = '';
      if (status) status.textContent = '';
    });
  }

  window.KollectionSavedCollections = Object.freeze({ load });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
