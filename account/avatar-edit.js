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

  function normalizeAvatarUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const { apiBase } = cfg();
    if (raw.startsWith('/')) return `${apiBase}${raw}`;
    return `${apiBase}/storage/v1/object/public/avatars/${raw.replace(/^\/+/, '')}`;
  }

  async function resolveCurrentAvatar(profile, accessToken) {
    const direct = normalizeAvatarUrl(profile?.avatar_url || profile?.avatarUrl || '');
    if (direct) return direct;
    const avatarId = profile?.avatar_id ?? profile?.avatarId ?? null;
    if (!avatarId) return '';
    try {
      const rows = await rpc('get_avatar_catalog', {}, accessToken);
      const match = (Array.isArray(rows) ? rows : []).find((item) => String(item?.id || '') === String(avatarId));
      return normalizeAvatarUrl(match?.storage_path || match?.storagePath || '');
    } catch {
      return '';
    }
  }

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

  async function pushAvatar(profiles, targetId, nextAvatar, nextName, accessToken) {
    const payload = profiles.map((item) => {
      const id = profileId(item);
      const next = profilePayload(item, id === targetId ? nextAvatar : undefined);
      if (id === targetId && nextName) next.name = nextName;
      return next;
    });
    await rpc('sync_push_profiles', {
      p_client_max_profiles: MAX_PROFILES,
      p_profiles: payload,
      p_origin_client_id: getSyncClientId(),
    }, accessToken);
  }

  function injectStyles() {
    if (document.getElementById('kollection-avatar-edit-styles')) return;
    const style = document.createElement('style');
    style.id = 'kollection-avatar-edit-styles';
    style.textContent = `
      .account-avatar-preview-wrap { display:flex; align-items:center; gap:14px; margin:0 0 22px; }
      .account-avatar-preview { width:68px; height:68px; flex:0 0 68px; border-radius:50%; overflow:hidden; display:grid; place-items:center; border:1px solid var(--account-border); background:#26272c; color:#fff; font-size:24px; font-weight:800; }
      .account-avatar-preview img { width:100%; height:100%; display:block; object-fit:cover; }
      .account-avatar-preview-copy { min-width:0; display:grid; gap:3px; }
      .account-avatar-preview-copy strong { color:var(--account-text); font-size:15px; }
      .account-avatar-preview-copy small { color:var(--account-muted); font-size:12px; }
      .account-avatar-edit-field { margin-top:18px; }
      .account-avatar-edit-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:end; }
      .account-avatar-edit-row .account-modal-field { grid-column:1 / -1; }
      .account-avatar-update,
      .account-avatar-remove { width:100%; min-height:48px; padding:0 16px; border-radius:12px; font:inherit; font-size:13px; font-weight:750; cursor:pointer; white-space:nowrap; }
      .account-avatar-update { border:1px solid var(--account-border); background:rgba(255,255,255,.035); color:var(--account-text); }
      .account-avatar-update:hover { background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.18); }
      .account-avatar-remove { border:1px solid rgba(255,91,107,.34); background:rgba(255,91,107,.035); color:#ff707d; }
      .account-avatar-remove:hover { background:rgba(255,91,107,.08); border-color:rgba(255,91,107,.52); color:#ff8b95; }
      .account-avatar-update:disabled,
      .account-avatar-remove:disabled { opacity:.55; cursor:default; }
      .account-avatar-help { margin:7px 0 0; color:var(--account-muted); font-size:12px; line-height:1.45; }
      @media (max-width:560px) {
        .account-avatar-preview { width:60px; height:60px; flex-basis:60px; }
        .account-avatar-edit-row { grid-template-columns:1fr; }
        .account-avatar-edit-row .account-modal-field { grid-column:1; }
      }
    `;
    document.head.appendChild(style);
  }

  function setPreview(preview, url, name) {
    preview.replaceChildren();
    if (url) {
      const img = document.createElement('img');
      img.src = normalizeAvatarUrl(url);
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        preview.textContent = (String(name || 'N')[0] || 'N').toUpperCase();
      }, { once: true });
      preview.appendChild(img);
    } else {
      preview.textContent = (String(name || 'N')[0] || 'N').toUpperCase();
    }
  }

  async function enhanceEditModal() {
    const modal = document.querySelector('#accountProfileModalRoot.open .account-modal');
    if (!modal || modal.dataset.avatarEditReady === 'true') return;
    const heading = modal.querySelector('.account-modal-head h3');
    if (!heading || !/^Edit\s+/i.test(heading.textContent || '')) return;
    if (!Number.isFinite(editingProfileId)) return;

    modal.dataset.avatarEditReady = 'true';
    heading.textContent = 'Edit Profile';

    const body = modal.querySelector('.account-modal-body');
    const status = modal.querySelector('#accountEditStatus');
    const intro = modal.querySelector('.account-modal-copy');
    if (!body || !status) return;
    if (intro) intro.textContent = 'Update this Nuvio profile name or profile picture.';

    try {
      const { accessToken, userId } = await getAuth();
      const profiles = await getProfiles(accessToken);
      const profile = profiles.find((item) => profileId(item) === editingProfileId);
      if (!profile) return;

      const name = String(profile.name || `Profile ${editingProfileId}`);
      const avatarUrl = String(profile.avatar_url || profile.avatarUrl || '');
      const resolvedAvatar = await resolveCurrentAvatar(profile, accessToken);

      const previewWrap = document.createElement('div');
      previewWrap.className = 'account-avatar-preview-wrap';
      previewWrap.innerHTML = `
        <div class="account-avatar-preview" id="accountAvatarPreview" aria-hidden="true"></div>
        <div class="account-avatar-preview-copy"><strong>${name.replace(/[&<>"']/g, '')}</strong><small>Current profile picture</small></div>`;
      body.insertBefore(previewWrap, body.firstElementChild?.nextSibling || body.firstChild);
      const preview = previewWrap.querySelector('#accountAvatarPreview');
      setPreview(preview, resolvedAvatar, name);

      const wrap = document.createElement('div');
      wrap.className = 'account-avatar-edit-field';
      wrap.innerHTML = `
        <div class="account-avatar-edit-row">
          <label class="account-modal-field">
            <span>Profile picture URL</span>
            <input id="accountEditAvatarUrl" type="url" inputmode="url" autocomplete="off" placeholder="Paste image URL" />
          </label>
          <button class="account-avatar-update" id="accountUpdateAvatar" type="button">Update image</button>
          <button class="account-avatar-remove" id="accountRemoveAvatar" type="button">Remove</button>
        </div>
        <p class="account-avatar-help">Paste a complete http:// or https:// image URL to update the profile picture, or choose Remove to clear it.</p>`;
      const avatarInput = wrap.querySelector('#accountEditAvatarUrl');
      avatarInput.value = avatarUrl;
      status.before(wrap);

      const updateButton = wrap.querySelector('#accountUpdateAvatar');
      const removeButton = wrap.querySelector('#accountRemoveAvatar');
      const saveButton = modal.querySelector('#accountSaveProfile');
      const nameInput = modal.querySelector('#accountEditProfileName');

      updateButton.addEventListener('click', async () => {
        const nextAvatar = String(avatarInput.value || '').trim();
        if (!/^https?:\/\//i.test(nextAvatar)) {
          status.textContent = 'Enter a complete http:// or https:// image URL.';
          return;
        }
        updateButton.disabled = true;
        removeButton.disabled = true;
        status.textContent = 'Updating profile picture…';
        try {
          const currentName = String(nameInput?.value || name).trim() || name;
          await pushAvatar(profiles, editingProfileId, nextAvatar, currentName, accessToken);
          profile.avatar_url = nextAvatar;
          profile.avatarUrl = nextAvatar;
          profile.avatar_id = null;
          profile.avatarId = null;
          setPreview(preview, nextAvatar, currentName);
          avatarInput.dataset.savedAvatar = nextAvatar;
          const now = new Date().toISOString();
          try { localStorage.setItem(`${LAST_SYNC_KEY_PREFIX}${userId || 'default'}`, now); } catch {}
          status.textContent = 'Profile picture updated.';
          try { await window.KollectionNavAccount?.refresh?.(); } catch {}
        } catch (error) {
          status.textContent = error?.message || 'Could not update the profile picture.';
        } finally {
          updateButton.disabled = false;
          removeButton.disabled = false;
        }
      });

      removeButton.addEventListener('click', async () => {
        removeButton.disabled = true;
        updateButton.disabled = true;
        status.textContent = 'Removing profile picture…';
        try {
          const currentName = String(nameInput?.value || name).trim() || name;
          await pushAvatar(profiles, editingProfileId, '', currentName, accessToken);
          profile.avatar_url = null;
          profile.avatarUrl = null;
          profile.avatar_id = null;
          profile.avatarId = null;
          avatarInput.value = '';
          avatarInput.dataset.savedAvatar = '';
          setPreview(preview, '', currentName);
          const now = new Date().toISOString();
          try { localStorage.setItem(`${LAST_SYNC_KEY_PREFIX}${userId || 'default'}`, now); } catch {}
          status.textContent = 'Profile picture removed.';
          try { await window.KollectionNavAccount?.refresh?.(); } catch {}
        } catch (error) {
          status.textContent = error?.message || 'Could not remove the profile picture.';
        } finally {
          removeButton.disabled = false;
          updateButton.disabled = false;
        }
      });

      avatarInput.addEventListener('input', () => {
        const candidate = String(avatarInput.value || '').trim();
        if (/^https?:\/\//i.test(candidate)) setPreview(preview, candidate, nameInput?.value || name);
        else if (!candidate) setPreview(preview, resolvedAvatar, nameInput?.value || name);
      });

      if (saveButton) saveButton.textContent = 'Save changes';
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
    if (!nextName) { status.textContent = 'Enter a profile name.'; return; }

    save.disabled = true;
    status.textContent = 'Saving profile…';
    try {
      const { accessToken, userId } = await getAuth();
      await apiFetch(`/rest/v1/profiles?profile_index=eq.${editingProfileId}`, accessToken, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name: nextName }),
      });
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