(() => {
  'use strict';

  if (window.KollectionNavAccount) return;

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  const PROFILE_KEY_PREFIX = 'kollection-nuvio-profile-id:';
  const GITHUB_URL = 'https://github.com/Kaoxt/The-Kollection';
  const COFFEE_URL = 'https://ko-fi.com/kaoxt';
  const SETUP_URL = '/set-up-collection';

  let initialized = false;
  let refreshing = false;
  let currentSession = null;
  let currentProfile = null;
  let currentProfiles = [];
  let avatarCatalogPromise = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
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
      const value = Number(localStorage.getItem(profileStorageKey(userId)));
      return Number.isFinite(value) && value >= 1 ? value : null;
    } catch {
      return null;
    }
  };

  const writeStoredProfileId = (userId, profileId) => {
    try { localStorage.setItem(profileStorageKey(userId), String(profileId)); } catch {}
  };

  const clearStoredProfileId = (userId) => {
    try { localStorage.removeItem(profileStorageKey(userId)); } catch {}
  };

  const githubIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-social-svg github">
      <path d="M12 .7a11.3 11.3 0 0 0-3.57 22c.57.1.77-.25.77-.55v-2.2c-3.14.69-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.58 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16A10.7 10.7 0 0 1 12 6.05c.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.34-2.63 5.29-5.14 5.57.4.35.76 1.04.76 2.1v3.2c0 .3.2.66.78.55A11.3 11.3 0 0 0 12 .7Z"></path>
    </svg>`;

  const coffeeIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-social-svg coffee">
      <path d="M5 8h12v5.5A5.5 5.5 0 0 1 11.5 19H10a5 5 0 0 1-5-5z"></path>
      <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"></path>
      <path d="M8 5.5c.8-.5.8-1.1 0-1.7"></path>
      <path d="M12 5.5c.8-.5.8-1.1 0-1.7"></path>
    </svg>`;

  const setupIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-row-icon">
      <path d="M4 7h10"></path><path d="M18 7h2"></path><circle cx="16" cy="7" r="2"></circle>
      <path d="M4 12h5"></path><path d="M13 12h7"></path><circle cx="11" cy="12" r="2"></circle>
      <path d="M4 17h2"></path><path d="M10 17h10"></path><circle cx="8" cy="17" r="2"></circle>
    </svg>`;

  const loginIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="nuvio-row-icon">
      <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10"></path>
      <path d="M14 8l4 4-4 4"></path><path d="M8.5 12H18"></path>
    </svg>`;

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
      Authorization: anonymous ? `Bearer ${publishableKey}` : `Bearer ${accessToken}`,
    };

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

  const closeMobileMenu = () => {
    const wrap = document.getElementById('menuWrap');
    const button = document.getElementById('menuButton');
    if (!wrap || !button) return;
    wrap.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open navigation menu');
  };

  function slots() {
    return {
      desktop: document.getElementById('nuvioDesktopAccount'),
      mobile: document.getElementById('nuvioMobileAccount'),
    };
  }

  function closeDesktopPopover() {
    const { desktop } = slots();
    desktop?.querySelector('.nuvio-desktop-account-wrap')?.classList.remove('open');
    desktop?.querySelector('.nuvio-desktop-profile-button')?.setAttribute('aria-expanded', 'false');
  }

  async function signIn(statusTarget) {
    if (!window.KollectionNuvioAuth?.continueWithNuvio) {
      window.location.href = SETUP_URL;
      return;
    }

    try {
      if (statusTarget) statusTarget.textContent = 'Opening Nuvio…';
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection',
        onStatus(message) {
          if (statusTarget) statusTarget.textContent = message;
        },
      });
      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-in'));
      await refresh();
    } catch (error) {
      if (statusTarget) statusTarget.textContent = error?.message || 'Could not sign in with Nuvio.';
    }
  }

  async function signOut() {
    const userId = currentSession?.user?.id;
    try { await window.KollectionNuvioAuth?.signOut?.(); } catch {}
    if (userId) clearStoredProfileId(userId);
    currentSession = null;
    currentProfile = null;
    currentProfiles = [];
    closeDesktopPopover();
    window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-out'));
    await refresh();
  }

  async function selectProfile(profileId, keepDesktopOpen = false) {
    const profile = currentProfiles.find((item) => item.id === Number(profileId));
    if (!profile || !currentSession) return;

    currentProfile = profile;
    writeStoredProfileId(currentSession.user?.id, profile.id);

    await renderSignedIn(currentSession, currentProfiles, profile);

    if (keepDesktopOpen) {
      const { desktop } = slots();
      const wrap = desktop?.querySelector('.nuvio-desktop-account-wrap');
      const button = desktop?.querySelector('.nuvio-desktop-profile-button');
      wrap?.classList.add('open');
      button?.setAttribute('aria-expanded', 'true');
    }

    window.dispatchEvent(new CustomEvent('kollection:nuvio-profile-changed', {
      detail: { profileId: profile.id, profile },
    }));
  }

  function socialLink(url, label, icon, compact = false) {
    return `<a class="nuvio-social-link ${compact ? 'compact' : ''}" href="${url}" target="_blank" rel="noopener" aria-label="${esc(label)}">${icon}<span>${esc(label)}</span></a>`;
  }

  async function renderSignedOut() {
    const { desktop, mobile } = slots();

    if (desktop) {
      desktop.innerHTML = `
        <div class="nuvio-desktop-guest-actions">
          ${socialLink(GITHUB_URL, 'GitHub', githubIcon(), true)}
          ${socialLink(COFFEE_URL, 'Buy me a coffee', coffeeIcon(), true)}
          <button class="nuvio-desktop-signin-button" type="button" data-nuvio-signin-desktop>
            <span>Log in</span>
          </button>
        </div>`;
      desktop.querySelector('[data-nuvio-signin-desktop]')?.addEventListener('click', () => signIn());
    }

    if (mobile) {
      mobile.innerHTML = `
        <div class="nuvio-mobile-guest">
          <button class="nuvio-mobile-login-row" type="button" data-nuvio-signin-mobile>
            ${loginIcon()}
            <span>Log in</span>
          </button>
          <span class="nuvio-mobile-login-status" data-nuvio-mobile-status aria-live="polite"></span>
          <div class="nuvio-mobile-bottom-row signed-out">
            <div class="nuvio-mobile-socials">
              ${socialLink(GITHUB_URL, 'GitHub', githubIcon())}
              ${socialLink(COFFEE_URL, 'Buy me a coffee', coffeeIcon())}
            </div>
          </div>
        </div>`;
      const status = mobile.querySelector('[data-nuvio-mobile-status]');
      mobile.querySelector('[data-nuvio-signin-mobile]')?.addEventListener('click', () => signIn(status));
    }
  }

  async function renderSignedIn(session, profiles, activeProfile) {
    const { desktop, mobile } = slots();
    const avatarPairs = await Promise.all(profiles.map(async (profile) => [
      profile.id,
      await resolveAvatar(profile).catch(() => ''),
    ]));
    const avatars = new Map(avatarPairs);
    const activeAvatar = avatars.get(activeProfile.id) || '';

    const desktopProfileRows = profiles.map((profile) => {
      const active = profile.id === activeProfile.id;
      return `
        <button class="nuvio-desktop-profile-option ${active ? 'active' : ''}"
                type="button"
                data-profile-id="${profile.id}"
                aria-current="${active ? 'true' : 'false'}">
          ${avatarMarkup(profile, avatars.get(profile.id) || '', 'option')}
          <span>${esc(profile.name)}</span>
        </button>`;
    }).join('');

    if (desktop) {
      desktop.innerHTML = `
        <div class="nuvio-desktop-account-wrap">
          <button class="nuvio-desktop-profile-button" type="button" aria-haspopup="true" aria-expanded="false">
            ${avatarMarkup(activeProfile, activeAvatar, 'desktop')}
            <span class="nuvio-desktop-profile-name">${esc(activeProfile.name)}</span>
            <svg class="nuvio-profile-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
          </button>

          <div class="nuvio-desktop-account-popover">
            <div class="nuvio-desktop-popover-user">
              ${avatarMarkup(activeProfile, activeAvatar, 'popover')}
              <div>
                <strong>${esc(activeProfile.name)}</strong>
                <small>Active profile</small>
              </div>
            </div>

            <div class="nuvio-desktop-section-label">PROFILES</div>
            <div class="nuvio-desktop-profile-list">${desktopProfileRows}</div>

            <div class="nuvio-desktop-menu-divider"></div>

            <a class="nuvio-desktop-menu-row" href="${SETUP_URL}">
              ${setupIcon()}
              <span class="nuvio-row-copy">
                <strong>Set Up Collection</strong>
                <small>Configure this Nuvio profile</small>
              </span>
            </a>

            ${socialLink(GITHUB_URL, 'GitHub', githubIcon())}
            ${socialLink(COFFEE_URL, 'Buy me a coffee', coffeeIcon())}

            <div class="nuvio-desktop-menu-divider bottom"></div>
            <button class="nuvio-account-signout-button" type="button" data-nuvio-signout-desktop>Sign out</button>
          </div>
        </div>`;

      const wrap = desktop.querySelector('.nuvio-desktop-account-wrap');
      const button = desktop.querySelector('.nuvio-desktop-profile-button');
      button?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = !wrap.classList.contains('open');
        wrap.classList.toggle('open', open);
        button.setAttribute('aria-expanded', String(open));
      });

      desktop.querySelectorAll('[data-profile-id]').forEach((buttonEl) => {
        buttonEl.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await selectProfile(buttonEl.dataset.profileId, true);
        });
      });

      desktop.querySelector('[data-nuvio-signout-desktop]')?.addEventListener('click', signOut);
    }

    if (mobile) {
      const chips = profiles.map((profile) => {
        const active = profile.id === activeProfile.id;
        return `
          <button class="nuvio-mobile-profile-chip ${active ? 'active' : ''}"
                  type="button"
                  data-mobile-profile-id="${profile.id}"
                  aria-current="${active ? 'true' : 'false'}">
            ${avatarMarkup(profile, avatars.get(profile.id) || '', 'chip')}
            <span>${esc(profile.name)}</span>
          </button>`;
      }).join('');

      mobile.innerHTML = `
        <section class="nuvio-mobile-account signed-in" aria-label="Nuvio account">
          <div class="nuvio-mobile-current-profile">
            ${avatarMarkup(activeProfile, activeAvatar, 'mobile')}
            <div>
              <strong>${esc(activeProfile.name)}</strong>
              <small>Active profile</small>
            </div>
          </div>

          ${profiles.length > 1 ? `
            <div class="nuvio-mobile-switch-label">Switch profile</div>
            <div class="nuvio-mobile-profile-chips">${chips}</div>
          ` : ''}

          <div class="nuvio-mobile-bottom-row">
            <div class="nuvio-mobile-socials">
              ${socialLink(GITHUB_URL, 'GitHub', githubIcon())}
              ${socialLink(COFFEE_URL, 'Buy me a coffee', coffeeIcon())}
            </div>
            <button class="nuvio-mobile-signout-button" type="button" data-nuvio-signout-mobile>Sign out</button>
          </div>
        </section>`;

      mobile.querySelectorAll('[data-mobile-profile-id]').forEach((buttonEl) => {
        buttonEl.addEventListener('click', async () => {
          await selectProfile(buttonEl.dataset.mobileProfileId, false);
        });
      });

      mobile.querySelector('[data-nuvio-signout-mobile]')?.addEventListener('click', signOut);
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;

    try {
      const { desktop, mobile } = slots();
      if (!desktop && !mobile) return;

      const session = await window.KollectionNuvioAuth?.getSession?.().catch(() => null);
      currentSession = session?.authenticated ? session : null;

      if (!currentSession) {
        currentProfile = null;
        currentProfiles = [];
        await renderSignedOut();
        return;
      }

      const tokenData = await window.KollectionNuvioAuth?.getAccessToken?.().catch(() => null);
      if (!tokenData?.authenticated || !tokenData?.accessToken) {
        currentSession = null;
        currentProfile = null;
        currentProfiles = [];
        await renderSignedOut();
        return;
      }

      currentProfiles = await getProfiles(tokenData.accessToken).catch(() => []);
      if (!currentProfiles.length) {
        currentProfiles = [{
          id: 1,
          name: 'Nuvio',
          avatarColor: '#1E88E5',
          avatarId: null,
          avatarUrl: null,
        }];
      }

      const storedId = readStoredProfileId(currentSession.user?.id);
      currentProfile = currentProfiles.find((profile) => profile.id === storedId) || currentProfiles[0];
      writeStoredProfileId(currentSession.user?.id, currentProfile.id);

      await renderSignedIn(currentSession, currentProfiles, currentProfile);
    } finally {
      refreshing = false;
    }
  }

  async function init() {
    if (!initialized) {
      initialized = true;

      document.addEventListener('click', (event) => {
        const { desktop } = slots();
        if (desktop && !desktop.contains(event.target)) closeDesktopPopover();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDesktopPopover();
      });

      window.addEventListener('storage', (event) => {
        if (event.key?.startsWith(PROFILE_KEY_PREFIX)) refresh();
      });

      window.addEventListener('kollection:nuvio-signed-in', refresh);
      window.addEventListener('kollection:nuvio-session-changed', refresh);
    }

    await refresh();
  }

  window.KollectionNavAccount = Object.freeze({
    init,
    refresh,
    getSelectedProfile: () => currentProfile,
  });
})();
