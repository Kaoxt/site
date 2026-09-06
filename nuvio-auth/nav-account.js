(() => {
  'use strict';

  if (window.KollectionNavAccount) return;

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const PROFILE_KEY_PREFIX = 'kollection-nuvio-profile-id:';

  let initialized = false;
  let currentSession = null;
  let currentProfile = null;
  let desktopSlot = null;
  let mobileSlot = null;
  let avatarCatalogPromise = null;
  let refreshing = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[ch]));

  const config = () => {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

  const profileStorageKey = (userId) => `${PROFILE_KEY_PREFIX}${String(userId || 'default')}`;

  const readStoredProfileId = (userId) => {
    try {
      const raw = localStorage.getItem(profileStorageKey(userId));
      const id = Number(raw);
      return Number.isFinite(id) && id >= 1 ? id : null;
    } catch {
      return null;
    }
  };

  const writeStoredProfileId = (userId, profileId) => {
    try {
      localStorage.setItem(profileStorageKey(userId), String(profileId));
    } catch {}
  };

  const clearStoredProfileId = (userId) => {
    try {
      localStorage.removeItem(profileStorageKey(userId));
    } catch {}
  };

  const normalizeAvatarUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;

    const { apiBase } = config();
    if (raw.startsWith('/')) return `${apiBase}${raw}`;
    return `${apiBase}/storage/v1/object/public/avatars/${raw.replace(/^\/+/, '')}`;
  };

  async function rpc(name, body, accessToken, anonymous = false) {
    const { apiBase, publishableKey } = config();
    const headers = {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (anonymous) {
      headers.Authorization = `Bearer ${publishableKey}`;
    } else {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const res = await fetch(`${apiBase}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `${name} failed (HTTP ${res.status}).`);
    return data;
  }

  async function getProfiles(accessToken) {
    const data = await rpc('sync_pull_profiles', {}, accessToken);
    const rows = Array.isArray(data) ? data : (data?.profiles || []);

    return rows.map((p) => {
      const id = Number(p.profile_index ?? p.id);
      return {
        id,
        name: String(p.name || `Profile ${p.profile_index ?? p.id}`),
        avatarColor: String(p.avatar_color_hex || p.avatarColorHex || '#1E88E5'),
        avatarId: p.avatar_id ?? p.avatarId ?? null,
        avatarUrl: p.avatar_url ?? p.avatarUrl ?? null,
      };
    }).filter((p) => Number.isFinite(p.id) && p.id >= 1);
  }

  async function getAvatarCatalog() {
    if (!avatarCatalogPromise) {
      avatarCatalogPromise = rpc('get_avatar_catalog', {}, null, true)
        .then((rows) => Array.isArray(rows) ? rows : [])
        .catch(() => []);
    }
    return avatarCatalogPromise;
  }

  async function resolveAvatar(profile) {
    const direct = normalizeAvatarUrl(profile?.avatarUrl);
    if (direct) return direct;

    if (!profile?.avatarId) return '';

    const catalog = await getAvatarCatalog();
    const match = catalog.find((item) => String(item?.id || '') === String(profile.avatarId));
    return normalizeAvatarUrl(match?.storage_path || match?.storagePath || '');
  }

  function fallbackAvatar(profile, sizeClass = '') {
    const name = String(profile?.name || 'Nuvio').trim();
    const initial = (name[0] || 'N').toUpperCase();
    const color = /^#[0-9a-f]{3,8}$/i.test(String(profile?.avatarColor || ''))
      ? profile.avatarColor
      : '#1E88E5';

    return `<span class="nuvio-nav-avatar-fallback ${sizeClass}" style="--nuvio-avatar-color:${esc(color)}">${esc(initial)}</span>`;
  }

  function avatarMarkup(profile, avatarUrl, sizeClass = '') {
    if (!avatarUrl) return fallbackAvatar(profile, sizeClass);
    return `<span class="nuvio-nav-avatar ${sizeClass}"><img src="${esc(avatarUrl)}" alt="" referrerpolicy="no-referrer"></span>`;
  }

  function ensureSlots() {
    const desktopNav = document.querySelector('.desktop-nav');
    const desktopTheme = document.querySelector('.desktop-theme-toggle');
    const community = document.querySelector('.menu-community');

    if (desktopNav && !document.getElementById('nuvioDesktopAccount')) {
      desktopSlot = document.createElement('div');
      desktopSlot.id = 'nuvioDesktopAccount';
      desktopSlot.className = 'nuvio-desktop-account-slot';

      if (desktopTheme && desktopTheme.parentNode === desktopNav) {
        desktopNav.insertBefore(desktopSlot, desktopTheme);
      } else {
        desktopNav.appendChild(desktopSlot);
      }
    } else {
      desktopSlot = document.getElementById('nuvioDesktopAccount');
    }

    if (community && !document.getElementById('nuvioMobileAccount')) {
      mobileSlot = document.createElement('div');
      mobileSlot.id = 'nuvioMobileAccount';
      mobileSlot.className = 'nuvio-mobile-account-slot';
      community.parentNode.insertBefore(mobileSlot, community);
    } else {
      mobileSlot = document.getElementById('nuvioMobileAccount');
    }
  }

  function closeDesktopPopover() {
    desktopSlot?.querySelector('.nuvio-desktop-account-wrap')?.classList.remove('open');
    desktopSlot?.querySelector('.nuvio-desktop-profile-button')?.setAttribute('aria-expanded', 'false');
  }

  async function signIn(statusTarget) {
    if (!window.KollectionNuvioAuth?.continueWithNuvio) {
      window.location.href = '/set-up-collection';
      return;
    }

    const status = statusTarget || null;

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection',
        onStatus(message) {
          if (status) status.textContent = message;
        },
      });

      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-in'));
      await refresh();
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not sign in with Nuvio.';
    }
  }

  async function signOut() {
    const userId = currentSession?.user?.id;

    try {
      await window.KollectionNuvioAuth?.signOut?.();
    } catch {}

    if (userId) clearStoredProfileId(userId);

    currentSession = null;
    currentProfile = null;
    closeDesktopPopover();
    window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-out'));
    await refresh();
  }

  async function renderSignedOut() {
    if (desktopSlot) {
      desktopSlot.innerHTML = `
        <button class="nuvio-desktop-signin-button" type="button" data-nuvio-signin-desktop aria-label="Sign in with Nuvio">
          <span class="nuvio-mini-n">N</span>
          <span>Sign in</span>
        </button>`;
      desktopSlot.querySelector('[data-nuvio-signin-desktop]')?.addEventListener('click', () => signIn());
    }

    if (mobileSlot) {
      mobileSlot.innerHTML = `
        <section class="nuvio-mobile-account signed-out" aria-label="Nuvio account">
          <div class="nuvio-mobile-account-head">
            <span class="nuvio-mobile-account-label">NUVIO ACCOUNT</span>
            <strong>Not signed in</strong>
            <small>Connect your Nuvio account to use Set Up Collection.</small>
          </div>
          <button class="nuvio-mobile-signin-button" type="button" data-nuvio-signin-mobile>Continue with Nuvio</button>
          <span class="nuvio-mobile-login-status" data-nuvio-mobile-status aria-live="polite"></span>
        </section>`;

      const status = mobileSlot.querySelector('[data-nuvio-mobile-status]');
      mobileSlot.querySelector('[data-nuvio-signin-mobile]')?.addEventListener('click', () => signIn(status));
    }
  }

  async function renderSignedIn(session, profile, avatarUrl) {
    const profileName = profile?.name || 'Nuvio profile';
    const email = session?.user?.email || '';

    if (desktopSlot) {
      desktopSlot.innerHTML = `
        <div class="nuvio-desktop-account-wrap">
          <button class="nuvio-desktop-profile-button" type="button" aria-haspopup="true" aria-expanded="false">
            ${avatarMarkup(profile, avatarUrl, 'desktop')}
            <span class="nuvio-desktop-profile-name">${esc(profileName)}</span>
            <svg class="nuvio-profile-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
          </button>
          <div class="nuvio-desktop-account-popover">
            <div class="nuvio-desktop-popover-user">
              ${avatarMarkup(profile, avatarUrl, 'popover')}
              <div>
                <span>Current profile</span>
                <strong>${esc(profileName)}</strong>
                ${email ? `<small>${esc(email)}</small>` : ''}
              </div>
            </div>
            <a class="nuvio-account-setup-link" href="/set-up-collection">Set Up Collection</a>
            <button class="nuvio-account-signout-button" type="button" data-nuvio-signout-desktop>Sign out</button>
          </div>
        </div>`;

      const wrap = desktopSlot.querySelector('.nuvio-desktop-account-wrap');
      const button = desktopSlot.querySelector('.nuvio-desktop-profile-button');

      button?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = !wrap.classList.contains('open');
        wrap.classList.toggle('open', open);
        button.setAttribute('aria-expanded', String(open));
      });

      desktopSlot.querySelector('[data-nuvio-signout-desktop]')?.addEventListener('click', signOut);
    }

    if (mobileSlot) {
      mobileSlot.innerHTML = `
        <section class="nuvio-mobile-account signed-in" aria-label="Nuvio account">
          <div class="nuvio-mobile-profile-row">
            ${avatarMarkup(profile, avatarUrl, 'mobile')}
            <div class="nuvio-mobile-profile-copy">
              <span>Current profile</span>
              <strong>${esc(profileName)}</strong>
              ${email ? `<small>${esc(email)}</small>` : ''}
            </div>
          </div>
          <div class="nuvio-mobile-account-actions">
            <a href="/set-up-collection">Set Up Collection</a>
            <button type="button" data-nuvio-signout-mobile>Sign out</button>
          </div>
        </section>`;

      mobileSlot.querySelector('[data-nuvio-signout-mobile]')?.addEventListener('click', signOut);
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;

    try {
      ensureSlots();

      const session = await window.KollectionNuvioAuth?.getSession?.().catch(() => null);
      currentSession = session?.authenticated ? session : null;

      if (!currentSession) {
        currentProfile = null;
        await renderSignedOut();
        return;
      }

      const tokenData = await window.KollectionNuvioAuth.getAccessToken().catch(() => null);
      if (!tokenData?.authenticated || !tokenData?.accessToken) {
        currentSession = null;
        currentProfile = null;
        await renderSignedOut();
        return;
      }

      const profiles = await getProfiles(tokenData.accessToken).catch(() => []);
      if (!profiles.length) {
        const fallbackProfile = {
          id: 1,
          name: currentSession.user?.email ? 'Nuvio' : 'Profile',
          avatarColor: '#1E88E5',
          avatarId: null,
          avatarUrl: null,
        };
        currentProfile = fallbackProfile;
        await renderSignedIn(currentSession, fallbackProfile, '');
        return;
      }

      const storedId = readStoredProfileId(currentSession.user?.id);
      currentProfile = profiles.find((p) => p.id === storedId) || profiles[0];
      writeStoredProfileId(currentSession.user?.id, currentProfile.id);

      const avatarUrl = await resolveAvatar(currentProfile).catch(() => '');
      await renderSignedIn(currentSession, currentProfile, avatarUrl);
    } finally {
      refreshing = false;
    }
  }

  async function init() {
    ensureSlots();

    if (!initialized) {
      initialized = true;

      document.addEventListener('click', (event) => {
        if (desktopSlot && !desktopSlot.contains(event.target)) closeDesktopPopover();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDesktopPopover();
      });

      window.addEventListener('storage', (event) => {
        if (event.key?.startsWith(PROFILE_KEY_PREFIX)) refresh();
      });

      window.addEventListener('kollection:nuvio-profile-changed', refresh);
      window.addEventListener('kollection:nuvio-signed-in', refresh);
      window.addEventListener('kollection:nuvio-session-changed', refresh);
    }

    await refresh();
  }

  window.KollectionNavAccount = Object.freeze({
    init,
    refresh,
  });
})();
