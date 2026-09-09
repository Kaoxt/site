(() => {
  'use strict';

  const DEFAULT_API_BASE = 'https://api.nuvio.tv';
  const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';

  const els = {};

  const config = () => {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || DEFAULT_PUBLISHABLE_KEY),
    };
  };

  const setState = (state) => {
    els.loading.hidden = state !== 'loading';
    els.signedOut.hidden = state !== 'signedOut';
    els.signedIn.hidden = state !== 'signedIn';
  };

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
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
    if (!response.ok) {
      throw new Error(data?.message || `${name} failed (HTTP ${response.status}).`);
    }
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

  async function loadProfiles() {
    els.profiles.innerHTML = '';
    els.profilesStatus.textContent = 'Loading Nuvio profiles…';

    try {
      const token = await window.KollectionNuvioAuth.getAccessToken();
      const result = await rpc('sync_pull_profiles', {}, token.accessToken);
      const rows = Array.isArray(result) ? result : (result?.profiles || []);

      if (!rows.length) {
        els.profilesStatus.textContent = 'No Nuvio profiles were returned for this account.';
        return;
      }

      for (const profile of rows) {
        const name = String(profile.name || `Profile ${profile.profile_index ?? profile.id ?? ''}`).trim() || 'Nuvio profile';
        const avatarColor = /^#[0-9a-f]{3,8}$/i.test(String(profile.avatar_color_hex || ''))
          ? profile.avatar_color_hex
          : '#5666e8';
        const avatarUrl = normalizeAvatarUrl(profile.avatar_url || profile.avatarUrl || '');

        const row = document.createElement('div');
        row.className = 'account-profile-row';

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

        const copy = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = name;
        const small = document.createElement('small');
        small.textContent = 'Available for Set Up Collection';
        copy.append(strong, small);

        row.append(avatar, copy);
        els.profiles.appendChild(row);
      }

      els.profilesStatus.textContent = `${rows.length} profile${rows.length === 1 ? '' : 's'} available.`;
    } catch (error) {
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

      els.email.textContent = session.user?.email || 'Nuvio account';
      els.expires.textContent = formatDate(session.expiresAt);
      setState('signedIn');
      await loadProfiles();
    } catch (error) {
      setState('signedOut');
      els.signInStatus.textContent = error?.message || 'Could not read your Kollection session.';
    }
  }

  async function signIn() {
    els.signIn.disabled = true;
    els.signInStatus.textContent = 'Preparing Nuvio sign in…';

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection',
        onStatus(message) {
          els.signInStatus.textContent = message;
        },
      });
      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-in'));
      await refreshAccount();
    } catch (error) {
      els.signInStatus.textContent = error?.message || 'Could not sign in with Nuvio.';
    } finally {
      els.signIn.disabled = false;
    }
  }

  async function signOut() {
    els.signOut.disabled = true;
    try {
      await window.KollectionNuvioAuth.signOut();
      window.dispatchEvent(new CustomEvent('kollection:nuvio-signed-out'));
      els.profiles.innerHTML = '';
      els.profilesStatus.textContent = '';
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
    els.signIn = document.getElementById('accountSignIn');
    els.signInStatus = document.getElementById('accountSignInStatus');
    els.signOut = document.getElementById('accountSignOut');
    els.email = document.getElementById('accountEmail');
    els.expires = document.getElementById('accountExpires');
    els.profiles = document.getElementById('accountProfiles');
    els.profilesStatus = document.getElementById('accountProfilesStatus');

    els.signIn?.addEventListener('click', signIn);
    els.signOut?.addEventListener('click', signOut);

    refreshAccount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
