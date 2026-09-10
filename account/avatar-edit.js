(() => {
  'use strict';

  if (window.KollectionAvatarEdit) return;

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const PROFILE_CLIENT_ID_KEY = 'kollection-nuvio-sync-client-id';
  const LAST_SYNC_KEY_PREFIX = 'kollection-nuvio-last-sync:';
  const MAX_PROFILES = 6;
  let editingProfileId = null;

  const cfg = () => {
    const c = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(c.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(c.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

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

  function getSyncClientId() {
    try {
      const stored = localStorage.getItem(PROFILE_CLIENT_ID_KEY);
      if (stored && /^[A-Za-z0-9_-]{16,96}$/.test(stored)) return stored;
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let suffix = '';
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
      const value = `kollection-web-${suffix}`;
      localStorage.setItem(PROFILE_CLIENT_ID_KEY, value);
      return value;
    } catch {
      return `kollection-web-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
    }
  }

  function profilePayload(profile, avatarOverride) {
    const hasOverride = avatarOverride !== undefined;
    const avatarUrl = hasOverride ? avatarOverride : (profile.avatar_url ?? profile.avatarUrl ?? null);
    return {
      profile_index: profileId(profile),
      name: String(profile.name || `Profile ${profileId(profile)}`),
      avatar_color_hex: String(profile.avatar_color_hex || profile.avatarColorHex || '#5666e8'),
      uses_primary_addons: Boolean(profile.uses_primary_addons ?? profile.usesPrimaryAddons ?? false),
      uses_primary_plugins: Boolean(profile.uses_primary_plugins ?? profile.usesPrimaryPlugins ?? false),
      avatar_id: hasOverride ? null : (profile.avatar_id ?? profile.avatarId ?? null),
      avatar_url: avatarUrl || null,
      profile_background_id: profile.profile_background_id ?? profile.profileBackgroundId ?? null,
      profile_background_url: profile.profile_background_url ?? profile.profileBackgroundUrl ?? null,
    };
  }

  function injectStyles() {
    if (document.getElementById('kollection-avatar-edit-styles')) return;
    const style = document.createElement('style');
    style.id = 'kollection-avatar-edit-styles';
    style.textContent = `
      .account-avatar-edit-field { margin-top: 18px; }
      .account-avatar-edit-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: end; }
      .account-avatar-remove { min-height: 48px; padding: 0 16px; border: 1px solid rgba(255,91,107,.34); border-radius: 12px; background: rgba(255,91,107,.035); color: #ff707d; font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; white-space: nowrap; }
      .account-avatar-remove:hover { background: rgba(255,91,107,.08); border-color: rgba(255,91,107,.52); color: #ff8b95; }
      .account-avatar-remove.is-armed { background: rgba(255,91,107,.11); }
      .account-avatar-help { margin: 7px 0 0; color: var(--account-muted); font-size: 12px; line-height: 1.45; }
      @media (max-width: 560px) {
        .account-avatar-edit-row { grid-template-columns: 1fr; }
        .account-avatar-remove { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  async function enhanceEditModal() {
    const modal = document.querySelector('#accountProfileModalRoot.open .account-modal');
    if (!modal || modal.dataset.avatarEditReady === 'true') return;
    const heading = modal.querySelector('.account-modal-head h3');
    if (!heading || !/^Edit\s+/i.test(heading.textContent || '')) return;
    if (!Number.isFinite(editingProfileId)) return;

    modal.dataset.avatarEditReady = 'true';
    const body = modal.querySelector('.account-modal-body');
    const status = modal.querySelector('#accountEditStatus');
    if (!body || !status) return;

    try {
      const { accessToken } = await getAuth();
      const profiles = await getProfiles(accessToken);
      const profile = profiles.find((item) => profileId(item) === editingProfileId);
      if (!profile) return;

      const avatarUrl = String(profile.avatar_url || profile.avatarUrl || '');
      const wrap = document.createElement('div');
      wrap.className = 'account-avatar-edit-field';
      wrap.innerHTML = `
        <div class="account-avatar-edit-row">
          <label class="account-modal-field">
            <span>Profile picture URL</span>
            <input id="accountEditAvatarUrl" type="url" inputmode="url" autocomplete="off" placeholder="Paste image URL" />
          </label>
          <button class="account-avatar-remove" id="accountRemoveAvatar" type="button">Remove</button>
        </div>
        <p class="account-avatar-help">Paste a complete http:// or https:// image URL, or choose Remove to clear the custom profile picture.</p>`;
      const avatarInput = wrap.querySelector('#accountEditAvatarUrl');
      avatarInput.value = avatarUrl;
      status.before(wrap);

      const removeButton = wrap.querySelector('#accountRemoveAvatar');
      removeButton.addEventListener('click', () => {
        avatarInput.value = '';
        avatarInput.dataset.removeAvatar = 'true';
        removeButton.classList.add('is-armed');
        removeButton.textContent = 'Remove selected';
      });
      avatarInput.addEventListener('input', () => {
        delete avatarInput.dataset.removeAvatar;
        removeButton.classList.remove('is-armed');
        removeButton.textContent = 'Remove';
      });
    } catch (error) {
      status.textContent = error?.message || 'Could not load the current profile picture.';
    }
  }

  async function saveEdit(event) {
    const save = event.target.closest('#accountSaveProfile');
    if (!save || !Number.isFinite(editingProfileId)) return;
    const modal = save.closest('.account-modal');
    const avatarInput = modal?.querySelector('#accountEditAvatarUrl');
    if (!avatarInput) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const nameInput = modal.querySelector('#accountEditProfileName');
    const status = modal.querySelector('#accountEditStatus');
    const nextName = String(nameInput?.value || '').trim();
    const nextAvatar = String(avatarInput.value || '').trim();
    const removeAvatar = avatarInput.dataset.removeAvatar === 'true';

    if (!nextName) { status.textContent = 'Enter a profile name.'; return; }
    if (nextAvatar && !/^https?:\/\//i.test(nextAvatar)) {
      status.textContent = 'Enter a complete http:// or https:// image URL.';
      return;
    }

    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      const { accessToken, userId } = await getAuth();
      const profiles = await getProfiles(accessToken);
      const profile = profiles.find((item) => profileId(item) === editingProfileId);
      if (!profile) throw new Error('This Nuvio profile could not be found.');

      await apiFetch(`/rest/v1/profiles?profile_index=eq.${editingProfileId}`, accessToken, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name: nextName }),
      });

      const currentAvatar = String(profile.avatar_url || profile.avatarUrl || '');
      const shouldUpdateAvatar = removeAvatar || nextAvatar !== currentAvatar;
      if (shouldUpdateAvatar) {
        const profilesPayload = profiles.map((item) => {
          const id = profileId(item);
          const payload = profilePayload(item, id === editingProfileId ? (removeAvatar ? '' : nextAvatar) : undefined);
          if (id === editingProfileId) payload.name = nextName;
          return payload;
        });
        await rpc('sync_push_profiles', {
          p_client_max_profiles: MAX_PROFILES,
          p_profiles: profilesPayload,
          p_origin_client_id: getSyncClientId(),
        }, accessToken);
      }

      const now = new Date().toISOString();
      try { localStorage.setItem(`${LAST_SYNC_KEY_PREFIX}${userId || 'default'}`, now); } catch {}
      window.KollectionProfileActions?.closeModal?.();
      window.location.reload();
    } catch (error) {
      status.textContent = error?.message || 'Could not update this profile.';
      save.disabled = false;
    }
  }

  function rememberEditTarget(event) {
    const button = event.target.closest('.account-profile-action');
    if (!button || String(button.textContent || '').trim() !== 'Edit') return;
    const row = button.closest('.account-profile-row');
    const id = Number(row?.dataset.profileId);
    editingProfileId = Number.isFinite(id) ? id : null;
    setTimeout(enhanceEditModal, 0);
  }

  function init() {
    injectStyles();
    document.addEventListener('click', rememberEditTarget, true);
    document.addEventListener('click', saveEdit, true);
    const rootObserver = new MutationObserver(enhanceEditModal);
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.KollectionAvatarEdit = Object.freeze({ init });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();