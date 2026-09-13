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
    return rows.length ? (rows[0]?.collections_json || []) : [];
  }

  function liveIds(collections) {
    return new Set((collections || []).map(item => String(item?.id || '').trim()).filter(Boolean));
  }

  function expectedIds(item) {
    const ids = item?.config?.selectedCollectionGroupIds;
    return Array.isArray(ids) ? ids.map(value => String(value || '').trim()).filter(Boolean) : [];
  }

  async function verifyCompletedSetup(item, cache) {
    if (Number(item?.draftStep || 0) < 7) return { state: 'draft' };
    const profileId = Number(item?.nuvioProfileId);
    const expected = expectedIds(item);
    if (!Number.isFinite(profileId) || profileId < 1 || !expected.length) {
      return { state: 'invalid', message: 'This saved setup cannot be matched to a Kollection installed on its Nuvio profile.' };
    }
    if (!cache.has(profileId)) cache.set(profileId, pullProfileCollections(profileId));
    const collections = await cache.get(profileId);
    const ids = liveIds(collections);
    const matched = expected.filter(id => ids.has(id));
    if (!matched.length) {
      return {
        state: 'invalid',
        message: 'This Nuvio profile does not contain a collection created by kollection.tv. Editing is disabled.',
      };
    }
    return { state: 'valid', matched: matched.length, expected: expected.length };
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
          method: 'DELETE',
          credentials: 'same-origin',
          cache: 'no-store',
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
    return { row, resume, badge, originMessage, complete };
  }

  async function render(collections) {
    const container = document.getElementById('accountSavedCollections');
    if (!container) return;
    container.innerHTML = '';

    if (!collections.length) {
      empty(container);
      return;
    }

    const cache = new Map();
    const pending = [];
    for (const item of collections) {
      const ui = buildRow(item);
      container.appendChild(ui.row);
      if (!ui.complete) continue;
      pending.push((async () => {
        try {
          const result = await verifyCompletedSetup(item, cache);
          ui.resume.classList.remove('account-edit-pending');
          ui.resume.removeAttribute('aria-disabled');
          ui.badge.hidden = false;
          if (result.state === 'valid') {
            ui.badge.textContent = 'Verified';
            ui.badge.dataset.state = 'valid';
            ui.resume.textContent = 'Edit';
            ui.resume.setAttribute('aria-label', `Edit ${item.name || 'saved setup'}`);
            ui.originMessage.hidden = true;
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

      const data = await readJson(await fetch('/api/account/collections', {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      const collections = Array.isArray(data.collections) ? data.collections : [];
      await render(collections);
      if (status) status.textContent = collections.length
        ? `${collections.length} saved setup${collections.length === 1 ? '' : 's'}. Completed setups are verified against the linked Nuvio profile before editing.`
        : '';
    } catch (error) {
      empty(container, 'Saved collection storage needs the Cloudflare D1 database binding before it can be used.');
      if (status) status.textContent = error?.message || 'Could not load saved setups.';
    } finally {
      busy = false;
    }
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
