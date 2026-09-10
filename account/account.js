(() => {
  'use strict';

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const PROFILE_CLIENT_ID_KEY = 'kollection-nuvio-sync-client-id';
  const PROFILE_KEY_PREFIX = 'kollection-nuvio-profile-id:';
  const LAST_SYNC_KEY_PREFIX = 'kollection-nuvio-last-sync:';
  const MAX_PROFILES = 6;
  const els = {};
  let currentProfiles = [];
  let currentUserId = '';
  let selectedProfileId = null;
  let currentAccessToken = '';

  const config = () => {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

  const setState = (state) => {
    els.loading.hidden = true;
    els.signedOut.hidden = state !== 'signedOut';
    els.signedIn.hidden = state !== 'signedIn';
  };

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
  };

  const profileStorageKey = () => `${PROFILE_KEY_PREFIX}${String(currentUserId || 'default')}`;
  const lastSyncStorageKey = () => `${LAST_SYNC_KEY_PREFIX}${String(currentUserId || 'default')}`;

  const readSelectedProfileId = () => {
    try {
      const value = Number(localStorage.getItem(profileStorageKey()));
      return Number.isFinite(value) && value >= 1 ? value : null;
    } catch {
      return null;
    }
  };

  const writeSelectedProfileId = (profileId) => {
    try { localStorage.setItem(profileStorageKey(), String(profileId)); } catch {}
  };

  const readLastSync = () => {
    try { return localStorage.getItem(lastSyncStorageKey()) || ''; }
    catch { return ''; }
  };

  const writeLastSync = (value) => {
    try { localStorage.setItem(lastSyncStorageKey(), String(value)); } catch {}
  };

  const setLastSync = (value) => {
    if (!els.lastSync) return;
    els.lastSync.textContent = `Last sync · ${value ? formatDate(value) : '—'}`;
  };

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
    if (!response.ok) throw new Error(data?.message || `${name} failed (HTTP ${response.status}).`);
    return data;
  }

  const normalizeAvatarUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const { apiBase } = config();
    if (raw.startsWith('/')) return `${apiBase}${raw}`;
    return `${apiBase}/storage/v1/object/public/avatars/${raw.replace(/^\/+/, '')}`;
  };

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

  const profileIndex = (profile) => Number(profile.profile_index ?? profile.id);

  function profilePayload(profile, overrideAvatarUrl = undefined) {
    const useOverride = overrideAvatarUrl !== undefined;
    const avatarUrl = useOverride ? overrideAvatarUrl : (profile.avatar_url ?? profile.avatarUrl ?? null);
    return {
      profile_index: profileIndex(profile),
      name: String(profile.name || `Profile ${profileIndex(profile)}`),
      avatar_color_hex: String(profile.avatar_color_hex || profile.avatarColorHex || '#5666e8'),
      uses_primary_addons: Boolean(profile.uses_primary_addons ?? profile.usesPrimaryAddons ?? false),
      uses_primary_plugins: Boolean(profile.uses_primary_plugins ?? profile.usesPrimaryPlugins ?? false),
      avatar_id: useOverride && avatarUrl ? null : (profile.avatar_id ?? profile.avatarId ?? null),
      avatar_url: avatarUrl || null,
      profile_background_id: profile.profile_background_id ?? profile.profileBackgroundId ?? null,
      profile_background_url: profile.profile_background_url ?? profile.profileBackgroundUrl ?? null,
    };
  }

  async function pushAvatarUrl(targetProfile, avatarUrl, accessToken) {
    const targetId = profileIndex(targetProfile);
    const profiles = currentProfiles.map((profile) =>
      profilePayload(profile, profileIndex(profile) === targetId ? avatarUrl : undefined)
    );
    await rpc('sync_push_profiles', {
      p_client_max_profiles: MAX_PROFILES,
      p_profiles: profiles,
      p_origin_client_id: getSyncClientId(),
    }, accessToken);
  }

  function makeAvatar(profile, name) {
    const avatarColor = /^#[0-9a-f]{3,8}$/i.test(String(profile.avatar_color_hex || profile.avatarColorHex || ''))
      ? (profile.avatar_color_hex || profile.avatarColorHex)
      : '#5666e8';
    const avatarUrl = normalizeAvatarUrl(profile.avatar_url || profile.avatarUrl || '');
    const avatar = document.createElement('div');
    avatar.className = 'account-profile-avatar';
    avatar.style.setProperty('--profile-color', avatarColor);
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        avatar.textContent = (name[0] || 'N').toUpperCase();
      }, { once: true });
      avatar.appendChild(img);
    } else {
      avatar.textContent = (name[0] || 'N').toUpperCase();
    }
    return avatar;
  }

  function renderActiveProfile(profile) {
    if (!els.activeProfile || !profile) return;
    const name = String(profile.name || `Profile ${profileIndex(profile)}`).trim() || 'Nuvio profile';
    els.activeProfile.replaceChildren();
    const avatar = makeAvatar(profile, name);
    avatar.classList.add('account-active-avatar');
    const label = document.createElement('span');
    label.textContent = name;
    els.activeProfile.append(avatar, label);
  }

  function syncSelectionUi() {
    const rows = [...els.profiles.querySelectorAll('.account-profile-row')];
    for (const row of rows) {
      const id = Number(row.dataset.profileId);
      const active = id === selectedProfileId;
      row.classList.toggle('active-profile', active);
      const button = row.querySelector('.account-profile-switch');
      if (button) {
        button.textContent = active ? 'Active' : 'Switch';
        button.disabled = active;
        button.setAttribute('aria-pressed', String(active));
      }
    }
    const activeProfile = currentProfiles.find((profile) => profileIndex(profile) === selectedProfileId) || currentProfiles[0];
    if (activeProfile) renderActiveProfile(activeProfile);
  }

  async function selectProfile(profileId) {
    const profile = currentProfiles.find((item) => profileIndex(item) === Number(profileId));
    if (!profile) return;
    selectedProfileId = profileIndex(profile);
    writeSelectedProfileId(selectedProfileId);
    syncSelectionUi();

    window.dispatchEvent(new CustomEvent('kollection:nuvio-profile-changed', {
      detail: { profileId: selectedProfileId, profile },
    }));

    try { await window.KollectionNavAccount?.refresh?.(); } catch {}
  }

  function renderProfile(profile, accessToken) {
    const id = profileIndex(profile);
    const name = String(profile.name || `Profile ${id || ''}`).trim() || 'Nuvio profile';
    const row = document.createElement('div');
    row.className = 'account-profile-row';
    row.dataset.profileId = String(id);

    let avatar = makeAvatar(profile, name);
    const copy = document.createElement('div');
    copy.className = 'account-profile-copy';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = 'Available for Set Up Collection';
    copy.append(strong, small);

    const switchButton = document.createElement('button');
    switchButton.type = 'button';
    switchButton.className = 'account-profile-switch';
    switchButton.textContent = 'Switch';
    switchButton.addEventListener('click', () => selectProfile(id));

    const editor = document.createElement('div');
    editor.className = 'account-profile-editor';
    const input = document.createElement('input');
    input.className = 'account-profile-url';
    input.type = 'url';
    input.inputMode = 'url';
    input.autocomplete = 'off';
    input.placeholder = 'Paste image URL';
    input.value = String(profile.avatar_url || profile.avatarUrl || '');
    input.setAttribute('aria-label', `New image URL for ${name}`);

    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'account-profile-update';
    updateButton.textContent = 'Update icon';

    const message = document.createElement('div');
    message.className = 'account-profile-message';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    updateButton.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) {
        message.textContent = 'Enter a complete http:// or https:// image URL.';
        return;
      }
      updateButton.disabled = true;
      input.disabled = true;
      message.textContent = 'Updating Nuvio profile icon…';
      try {
        await pushAvatarUrl(profile, url, accessToken);
        profile.avatar_url = url;
        profile.avatarUrl = url;
        profile.avatar_id = null;
        profile.avatarId = null;
        const replacement = makeAvatar(profile, name);
        avatar.replaceWith(replacement);
        avatar = replacement;
        if (id === selectedProfileId) renderActiveProfile(profile);
        message.textContent = 'Profile icon updated in Nuvio.';
        const now = new Date().toISOString();
        writeLastSync(now);
        setLastSync(now);
        window.dispatchEvent(new CustomEvent('kollection:nuvio-profile-changed', { detail: { profileId: id, profile } }));
        try { await window.KollectionNavAccount?.refresh?.(); } catch {}
      } catch (error) {
        message.textContent = error?.message || 'Could not update this Nuvio profile icon.';
      } finally {
        updateButton.disabled = false;
        input.disabled = false;
      }
    });

    editor.append(input, updateButton);
    row.append(avatar, copy, switchButton, editor, message);
    return row;
  }

  async function loadProfiles() {
    els.profiles.innerHTML = '';
    els.profilesStatus.textContent = 'Loading Nuvio profiles…';
    try {
      const token = await window.KollectionNuvioAuth.getAccessToken();
      currentAccessToken = token.accessToken;
      const result = await rpc('sync_pull_profiles', {}, currentAccessToken);
      currentProfiles = Array.isArray(result) ? result : (result?.profiles || []);
      if (!currentProfiles.length) {
        els.activeProfile.textContent = '—';
        els.profilesStatus.textContent = 'No Nuvio profiles were returned for this account.';
        return;
      }

      const validIds = currentProfiles.map(profileIndex).filter((id) => Number.isFinite(id) && id >= 1);
      const storedId = readSelectedProfileId();
      selectedProfileId = validIds.includes(storedId) ? storedId : validIds[0];
      if (selectedProfileId) writeSelectedProfileId(selectedProfileId);

      for (const profile of currentProfiles) {
        els.profiles.appendChild(renderProfile(profile, currentAccessToken));
      }
      syncSelectionUi();

      const now = new Date().toISOString();
      writeLastSync(now);
      setLastSync(now);
      els.profilesStatus.textContent = `${currentProfiles.length} profile${currentProfiles.length === 1 ? '' : 's'} available.`;
    } catch (error) {
      currentProfiles = [];
      selectedProfileId = null;
      els.activeProfile.textContent = '—';
      setLastSync(readLastSync());
      els.profilesStatus.textContent = error?.message || 'Could not load Nuvio profiles.';
    }
  }

  async function refreshAccount() {
    setState('loading');
    try {
      const session = await window.KollectionNuvioAuth.getSession();
      if (!session?.authenticated) {
        setState('signedOut');
        return;
      }
      currentUserId = session.user?.id || '';
      els.email.textContent = session.user?.email || 'Nuvio account';
      if (els.expires) els.expires.textContent = formatDate(session.expiresAt);
      setLastSync(readLastSync());
      setState('signedIn');
      await loadProfiles();
    } catch (error) {
      setState('signedOut');
      els.signInStatus.textContent = error?.message || 'Could not read your Kollection session.';
    }
  }

  async function authenticateWithNuvio(email, password) {
    const { apiBase, publishableKey } = config();
    const response = await fetch(`${apiBase}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.access_token) {
      throw new Error(body?.msg || body?.message || body?.error_description || 'Nuvio could not sign you in with that email and password.');
    }
    return body;
  }

  async function signIn(event) {
    event?.preventDefault?.();
    const email = String(els.loginEmail?.value || '').trim();
    const password = String(els.loginPassword?.value || '');
    if (!email || !password) {
      els.signInStatus.textContent = 'Enter your Nuvio email and password.';
      return;
    }
    els.signIn.disabled = true;
    els.loginEmail.disabled = true;
    els.loginPassword.disabled = true;
    els.signInStatus.textContent = 'Signing in with Nuvio…';
    try {
      const tokenResponse = await authenticateWithNuvio(email, password);
      await window.KollectionNuvioAuth.connectTokenResponse(tokenResponse);
      els.loginPassword.value = '';
      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-in'));
      await refreshAccount();
    } catch (error) {
      els.signInStatus.textContent = error?.message || 'Could not sign in with Nuvio.';
    } finally {
      els.signIn.disabled = false;
      els.loginEmail.disabled = false;
      els.loginPassword.disabled = false;
    }
  }

  async function signOut() {
    els.signOut.disabled = true;
    try {
      await window.KollectionNuvioAuth.signOut();
      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-out'));
      currentProfiles = [];
      currentUserId = '';
      selectedProfileId = null;
      currentAccessToken = '';
      els.profiles.innerHTML = '';
      els.profilesStatus.textContent = '';
      els.activeProfile.textContent = '—';
      setState('signedOut');
    } catch (error) {
      els.profilesStatus.textContent = error?.message || 'Could not log out.';
    } finally {
      els.signOut.disabled = false;
    }
  }

  function init() {
    els.loading = document.getElementById('accountLoading');
    els.signedOut = document.getElementById('accountSignedOut');
    els.signedIn = document.getElementById('accountSignedIn');
    els.loginForm = document.getElementById('accountLoginForm');
    els.loginEmail = document.getElementById('accountLoginEmail');
    els.loginPassword = document.getElementById('accountLoginPassword');
    els.signIn = document.getElementById('accountSignIn');
    els.signInStatus = document.getElementById('accountSignInStatus');
    els.signOut = document.getElementById('accountSignOut');
    els.email = document.getElementById('accountEmail');
    els.expires = document.getElementById('accountExpires');
    els.activeProfile = document.getElementById('accountActiveProfile');
    els.lastSync = document.getElementById('accountLastSync');
    els.profiles = document.getElementById('accountProfiles');
    els.profilesStatus = document.getElementById('accountProfilesStatus');

    els.loginForm?.addEventListener('submit', signIn);
    els.signOut?.addEventListener('click', signOut);
    refreshAccount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
