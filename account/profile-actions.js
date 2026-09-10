(() => {
  'use strict';

  if (window.KollectionProfileActions) return;

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const PROFILE_KEY_PREFIX = 'kollection-nuvio-profile-id:';
  const LAST_SYNC_KEY_PREFIX = 'kollection-nuvio-last-sync:';
  let observer = null;
  let modalRoot = null;

  const cfg = () => {
    const c = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(c.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(c.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[ch]));

  async function getAuth() {
    const token = await window.KollectionNuvioAuth?.getAccessToken?.();
    const session = await window.KollectionNuvioAuth?.getSession?.();
    if (!token?.accessToken || !session?.authenticated) throw new Error('Your Nuvio session is no longer available.');
    return { accessToken: token.accessToken, userId: session.user?.id || '' };
  }

  async function apiFetch(path, accessToken, options = {}) {
    const { apiBase, publishableKey } = cfg();
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      cache: 'no-store',
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text || null; }
    if (!response.ok) throw new Error(body?.message || body?.error_description || `Nuvio request failed (HTTP ${response.status}).`);
    return body;
  }

  async function rpc(name, body, accessToken) {
    return apiFetch(`/rest/v1/rpc/${name}`, accessToken, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  async function getProfiles(accessToken) {
    const result = await rpc('sync_pull_profiles', {}, accessToken);
    return Array.isArray(result) ? result : (result?.profiles || []);
  }

  const profileId = (profile) => Number(profile?.profile_index ?? profile?.id);
  const profileName = (profile) => String(profile?.name || `Profile ${profileId(profile)}`);

  function setLastSync(userId) {
    const now = new Date().toISOString();
    try { localStorage.setItem(`${LAST_SYNC_KEY_PREFIX}${userId || 'default'}`, now); } catch {}
  }

  function ensureModalRoot() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement('div');
    modalRoot.id = 'accountProfileModalRoot';
    document.body.appendChild(modalRoot);
    return modalRoot;
  }

  function closeModal() {
    const root = ensureModalRoot();
    root.innerHTML = '';
    root.classList.remove('open');
    document.documentElement.classList.remove('account-modal-open');
  }

  function openModal(content) {
    const root = ensureModalRoot();
    root.innerHTML = `<div class="account-modal-backdrop" data-modal-backdrop><section class="account-modal" role="dialog" aria-modal="true">${content}</section></div>`;
    root.classList.add('open');
    document.documentElement.classList.add('account-modal-open');
    root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
    root.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', closeModal));
    root.querySelector('input, select, button')?.focus?.();
  }

  async function openEdit(profile) {
    const id = profileId(profile);
    const name = profileName(profile);
    openModal(`
      <header class="account-modal-head">
        <h3>Edit ${esc(name)}</h3>
        <button class="account-modal-x" type="button" data-modal-close aria-label="Close">×</button>
      </header>
      <div class="account-modal-body">
        <p class="account-modal-copy">Update this profile name in Nuvio. Avatar changes stay managed by Nuvio.</p>
        <label class="account-modal-field"><span>Profile name</span><input id="accountEditProfileName" maxlength="40" value="${esc(name)}" /></label>
        <p class="account-modal-status" id="accountEditStatus" role="status"></p>
      </div>
      <footer class="account-modal-footer">
        <button class="account-modal-button" type="button" data-modal-close>Cancel</button>
        <button class="account-modal-button primary" type="button" id="accountSaveProfile">Save changes</button>
      </footer>`);

    const save = document.getElementById('accountSaveProfile');
    const input = document.getElementById('accountEditProfileName');
    const status = document.getElementById('accountEditStatus');
    save?.addEventListener('click', async () => {
      const nextName = String(input?.value || '').trim();
      if (!nextName) { status.textContent = 'Enter a profile name.'; return; }
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const { accessToken, userId } = await getAuth();
        await apiFetch(`/rest/v1/profiles?profile_index=eq.${id}`, accessToken, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ name: nextName }),
        });
        setLastSync(userId);
        closeModal();
        window.location.reload();
      } catch (error) {
        status.textContent = error?.message || 'Could not update this profile.';
        save.disabled = false;
      }
    });
  }

  async function readCopySource(accessToken, sourceId, kind) {
    if (kind === 'addons') {
      const rows = await apiFetch(`/rest/v1/addons?select=url,name,enabled,sort_order&profile_id=eq.${sourceId}&order=sort_order`, accessToken);
      return (rows || []).map((x) => ({ url: x.url, name: x.name ?? null, enabled: x.enabled !== false, sort_order: Number(x.sort_order || 0) }));
    }
    if (kind === 'plugins') {
      const rows = await apiFetch(`/rest/v1/plugins?select=url,name,enabled,sort_order,repo_type&profile_id=eq.${sourceId}&order=sort_order`, accessToken);
      return (rows || []).map((x) => ({ url: x.url, name: x.name ?? null, enabled: x.enabled !== false, sort_order: Number(x.sort_order || 0), repo_type: x.repo_type ?? null }));
    }
    const rows = await rpc('sync_pull_collections', { p_profile_id: sourceId }, accessToken);
    const raw = rows?.[0]?.collections_json ?? null;
    if (!raw) return [];
    if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
    return Array.isArray(raw) ? raw : [];
  }

  async function writeCopyTarget(accessToken, targetId, kind, data) {
    if (kind === 'addons') return rpc('sync_push_addons', { p_profile_id: targetId, p_addons: data }, accessToken);
    if (kind === 'plugins') return rpc('sync_push_plugins', { p_profile_id: targetId, p_plugins: data }, accessToken);
    return rpc('sync_push_collections', { p_profile_id: targetId, p_collections_json: data }, accessToken);
  }

  async function openCopySettings(targetProfile) {
    const targetId = profileId(targetProfile);
    const targetName = profileName(targetProfile);
    let profiles = [];
    try {
      const { accessToken } = await getAuth();
      profiles = await getProfiles(accessToken);
    } catch (error) {
      openModal(`<header class="account-modal-head"><h3>Copy settings</h3><button class="account-modal-x" type="button" data-modal-close>×</button></header><div class="account-modal-body"><p class="account-modal-copy">${esc(error?.message || 'Could not load Nuvio profiles.')}</p></div>`);
      return;
    }
    const sources = profiles.filter((p) => profileId(p) !== targetId);
    const activeStored = (() => {
      try {
        const userId = window.__kollectionProfileActionUserId || 'default';
        return Number(localStorage.getItem(`${PROFILE_KEY_PREFIX}${userId}`));
      } catch { return NaN; }
    })();
    const preferred = sources.find((p) => profileId(p) === activeStored) || sources[0];
    const options = sources.map((p) => `<option value="${profileId(p)}" ${p === preferred ? 'selected' : ''}>${esc(profileName(p))}${profileId(p) === 1 ? ' (Primary)' : ''}</option>`).join('');

    openModal(`
      <header class="account-modal-head">
        <h3>Copy settings to ${esc(targetName)}</h3>
        <button class="account-modal-x" type="button" data-modal-close aria-label="Close">×</button>
      </header>
      <div class="account-modal-body">
        <p class="account-modal-copy">This is a one-time copy from the source profile’s latest synced Nuvio data. Future changes stay independent.</p>
        <div class="account-copy-route">
          <label class="account-modal-field"><span>Copy from</span><select id="accountCopySource">${options}</select></label>
          <span class="account-copy-arrow" aria-hidden="true">→</span>
          <label class="account-modal-field"><span>Copy to</span><input value="${esc(targetName)}" disabled /></label>
        </div>
        <fieldset class="account-copy-options">
          <legend>What to copy</legend>
          <label><input type="checkbox" value="addons" checked /><span><strong>Addons</strong><small>Installed addon URLs, order, names, and enabled state.</small></span></label>
          <label><input type="checkbox" value="plugins" checked /><span><strong>Plugins</strong><small>Installed plugins and their synced configuration entries.</small></span></label>
          <label><input type="checkbox" value="collections" checked /><span><strong>Collections</strong><small>Nuvio collection structure and display configuration.</small></span></label>
        </fieldset>
        <div class="account-copy-note">Selected synced data on ${esc(targetName)} will be replaced. Your saved Kollection setups are not deleted or changed.</div>
        <p class="account-modal-status" id="accountCopyStatus" role="status"></p>
      </div>
      <footer class="account-modal-footer">
        <button class="account-modal-button" type="button" data-modal-close>Cancel</button>
        <button class="account-modal-button primary" type="button" id="accountCopyConfirm">Copy selected settings</button>
      </footer>`);

    const confirm = document.getElementById('accountCopyConfirm');
    const status = document.getElementById('accountCopyStatus');
    confirm?.addEventListener('click', async () => {
      const sourceId = Number(document.getElementById('accountCopySource')?.value);
      const kinds = [...document.querySelectorAll('.account-copy-options input[type="checkbox"]:checked')].map((x) => x.value);
      if (!sourceId || !kinds.length) { status.textContent = 'Choose a source profile and at least one item to copy.'; return; }
      confirm.disabled = true;
      status.textContent = 'Copying synced Nuvio data…';
      try {
        const { accessToken, userId } = await getAuth();
        for (const kind of kinds) {
          const data = await readCopySource(accessToken, sourceId, kind);
          await writeCopyTarget(accessToken, targetId, kind, data);
        }
        setLastSync(userId);
        status.textContent = 'Settings copied successfully.';
        setTimeout(closeModal, 650);
      } catch (error) {
        status.textContent = error?.message || 'Could not copy these settings.';
        confirm.disabled = false;
      }
    });
  }

  async function openDelete(profile) {
    const id = profileId(profile);
    const name = profileName(profile);
    if (id === 1) return;
    openModal(`
      <header class="account-modal-head"><h3>Delete ${esc(name)}?</h3><button class="account-modal-x" type="button" data-modal-close aria-label="Close">×</button></header>
      <div class="account-modal-body">
        <p class="account-modal-copy">This removes the profile from your Nuvio account. This action cannot be undone.</p>
        <p class="account-modal-status" id="accountDeleteStatus" role="status"></p>
      </div>
      <footer class="account-modal-footer"><button class="account-modal-button" type="button" data-modal-close>Cancel</button><button class="account-modal-button danger" type="button" id="accountDeleteConfirm">Delete profile</button></footer>`);
    const confirm = document.getElementById('accountDeleteConfirm');
    const status = document.getElementById('accountDeleteStatus');
    confirm?.addEventListener('click', async () => {
      confirm.disabled = true;
      status.textContent = 'Deleting…';
      try {
        const { accessToken, userId } = await getAuth();
        await apiFetch(`/rest/v1/profiles?profile_index=eq.${id}`, accessToken, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        setLastSync(userId);
        closeModal();
        window.location.reload();
      } catch (error) {
        status.textContent = error?.message || 'Could not delete this profile.';
        confirm.disabled = false;
      }
    });
  }

  async function enhanceRow(row) {
    if (!row || row.dataset.profileActionsReady === 'true') return;
    const id = Number(row.dataset.profileId);
    if (!Number.isFinite(id)) return;
    let profile = null;
    try {
      const { accessToken, userId } = await getAuth();
      window.__kollectionProfileActionUserId = userId || 'default';
      const profiles = await getProfiles(accessToken);
      profile = profiles.find((p) => profileId(p) === id);
    } catch { return; }
    if (!profile) return;

    row.querySelector('.account-profile-editor')?.remove();
    row.querySelector('.account-profile-message')?.remove();

    let actions = row.querySelector('.account-profile-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'account-profile-actions';
      const switchButton = row.querySelector('.account-profile-switch');
      if (switchButton) actions.appendChild(switchButton);

      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'account-profile-action'; edit.textContent = 'Edit';
      edit.addEventListener('click', () => openEdit(profile));

      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'account-profile-action'; copy.textContent = 'Copy Settings';
      copy.addEventListener('click', () => openCopySettings(profile));

      actions.append(edit, copy);
      if (id !== 1) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'account-profile-action danger'; del.textContent = 'Delete';
        del.addEventListener('click', () => openDelete(profile));
        actions.appendChild(del);
      }
      row.appendChild(actions);
    }
    row.dataset.profileActionsReady = 'true';
  }

  function enhance() {
    document.querySelectorAll('#accountProfiles .account-profile-row').forEach((row) => enhanceRow(row));
  }

  function init() {
    const profiles = document.getElementById('accountProfiles');
    if (!profiles) return;
    enhance();
    observer = new MutationObserver(enhance);
    observer.observe(profiles, { childList: true, subtree: false });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modalRoot?.classList.contains('open')) closeModal(); });
  }

  window.KollectionProfileActions = Object.freeze({ init, enhance, closeModal });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
