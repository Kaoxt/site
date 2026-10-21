(() => {
  'use strict';

  // "Connect with BingeCat": OAuth 2.0 authorization code + PKCE for a public
  // client (no secret). Sign-in runs in a popup that returns through
  // /bingecat-callback.html; without a popup it falls back to a full-page redirect.
  // Tokens in localStorage, the PKCE verifier and state in sessionStorage (next to
  // kollection-setup-wizard:v1). Contract: BingeCat public API v1, "Browser login (PKCE)".

  const CFG = window.KOLLECTION_CONFIG || {};
  const API_BASE = String(CFG.bingecatUrl || 'https://bingecat.com/').replace(/\/+$/, '');
  const CLIENT_ID = String(CFG.bingecatClientId || '');
  const SCOPE = 'profiles:read settings:read catalogs:read';
  const ROUTE = '/set-up-collection/bingecat';
  const CALLBACK = '/bingecat-callback.html';
  const CHANNEL = 'bingecat-connect';
  const PKCE_KEY = 'bingecat-connect:pkce:v1';
  const TOKEN_KEY = 'bingecat-connect:tokens:v1';
  const PROFILE_KEY = 'bingecat-connect:profile:v1';

  const redirectUri = (path = ROUTE) => `${window.location.origin}${path}`;

  function base64url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function readJson(storage, key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  }

  const readTokens = () => {
    const tokens = readJson(localStorage, TOKEN_KEY);
    return tokens?.access_token && tokens?.refresh_token ? tokens : null;
  };
  const clearTokens = () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} };

  function headers(accessToken) {
    return {
      'bingecat-api-key': CLIENT_ID,
      'bingecat-api-version': '1',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };
  }

  async function oauthPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      cache: 'no-store',
      signal: globalThis.AbortSignal?.timeout?.(20000),
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ client_id: CLIENT_ID, redirect_uri: redirectUri(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || `BingeCat returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function tokenRequest(body) {
    const data = await oauthPost('/oauth/token', body);
    if (!data.access_token || !data.refresh_token) throw new Error('BingeCat returned an incomplete connection. Please connect again.');
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + Number(data.expires_in || 0) * 1000,
      scope: data.scope || '',
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    return tokens;
  }

  function savePkce(redirect) {
    const pkce = {
      verifier: base64url(crypto.getRandomValues(new Uint8Array(32))),
      state: base64url(crypto.getRandomValues(new Uint8Array(16))),
      redirectUri: redirect,
      createdAt: Date.now(),
      returnUrl: window.location.pathname + window.location.search,
    };
    sessionStorage.setItem(PKCE_KEY, JSON.stringify(pkce));
    return pkce;
  }

  async function authorizeUrl(pkce, create) {
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce.verifier)));
    const params = {
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: pkce.redirectUri,
      scope: SCOPE,
      state: pkce.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    };
    if (create) params.prompt = 'create';
    return `${API_BASE}/oauth/authorize?${new URLSearchParams(params)}`;
  }

  async function redirectLogin(create) {
    window.location.assign(await authorizeUrl(savePkce(redirectUri()), create));
  }

  // Resolves true once connected, false when the popup closes without a result,
  // null when it fell back to a full-page redirect.
  // Must be called from the click handler: the popup is opened before any await.
  let popupWaiter = null;
  function login({ create = false } = {}) {
    if (create) return redirectLogin(true).then(() => null);
    if (popupWaiter) return Promise.resolve(false);
    const pkce = savePkce(redirectUri(CALLBACK)); // before window.open, so the popup's sessionStorage copy has it
    const width = 480;
    const height = 720;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const popup = window.open('', 'bingecat-connect', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!popup) return redirectLogin(false).then(() => null); // popup blocked
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        // Grace period: the callback posts its result right before it closes the popup.
        if (popup.closed) setTimeout(() => waiter.settle(false), 500);
      }, 500);
      const waiter = {
        popup,
        settle(result) {
          if (popupWaiter !== waiter) return;
          popupWaiter = null;
          clearInterval(timer);
          if (result instanceof Promise) result.then(() => resolve(true), reject);
          else resolve(result);
        },
      };
      popupWaiter = waiter;
      authorizeUrl(pkce, false).then(url => { popup.location.href = url; }, error => {
        popup.close();
        waiter.settle(Promise.reject(error));
      });
    });
  }

  // Exchanges a callback result ({code, state, error}) against this tab's PKCE state.
  async function exchange(result) {
    const saved = readJson(sessionStorage, PKCE_KEY);
    if (!saved || saved.state !== result.state || Date.now() - saved.createdAt > 10 * 60 * 1000) {
      throw new Error('The BingeCat sign-in expired. Please connect again.');
    }
    sessionStorage.removeItem(PKCE_KEY);
    if (result.error) {
      throw new Error(result.error === 'access_denied'
        ? 'BingeCat access was not approved.'
        : `BingeCat sign-in failed (${result.error}).`);
    }
    if (!result.code) throw new Error('BingeCat did not return a sign-in code. Please connect again.');
    await tokenRequest({
      grant_type: 'authorization_code',
      code: result.code,
      code_verifier: saved.verifier,
      redirect_uri: saved.redirectUri || redirectUri(),
    });
  }

  // A result from /bingecat-callback.html (popup via postMessage, or another tab via
  // BroadcastChannel, e.g. the signup tab). Only the tab that started this sign-in
  // (matching state) takes it and acknowledges, so the callback page can close.
  function receive(data, ack) {
    if (data?.type !== 'bingecat-connect:callback' || !data.state) return;
    if (readJson(sessionStorage, PKCE_KEY)?.state !== data.state) return;
    ack({ type: 'bingecat-connect:ack', state: data.state });
    const done = exchange(data);
    if (popupWaiter) {
      try { popupWaiter.popup.close(); } catch {}
      popupWaiter.settle(done);
    } else {
      done.then(() => connect.onConnected?.(), error => connect.onConnected?.(error));
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (popupWaiter && event.source !== popupWaiter.popup) return;
    receive(event.data, reply => event.source?.postMessage(reply, event.origin));
  });
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = event => receive(event.data, reply => channel.postMessage(reply));
  }

  // A full-page redirect lands on /set-up-collection/bingecat?code=…&state=…. Hosting may
  // canonicalize that to /set-up-collection?…, so accept any setup path, then move
  // the URL to the bingecat step (without code/state, so a reload cannot replay it).
  function handleCallback(params) {
    const saved = readJson(sessionStorage, PKCE_KEY);
    const target = new URL(saved?.returnUrl || ROUTE, window.location.origin);
    const validTarget = target.origin === window.location.origin && target.pathname.startsWith('/set-up-collection');
    const clean = validTarget ? target : new URL(ROUTE, window.location.origin);
    for (const key of ['code', 'state', 'error', 'error_description']) clean.searchParams.delete(key);
    clean.searchParams.set('step', 'bingecat');
    window.history.replaceState(null, '', `${ROUTE}${clean.search}`);
    return exchange({ code: params.get('code'), state: params.get('state'), error: params.get('error') });
  }

  let refreshing = null;
  function refresh(failedAccessToken) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const current = readTokens();
      if (!current) throw reconnectError();
      // Another tab already rotated the pair.
      if (current.access_token !== failedAccessToken) return current;
      try {
        return await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
      } catch (error) {
        if (error.status && error.status < 500) clearTokens();
        throw error.status && error.status < 500 ? reconnectError() : error;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function reconnectError() {
    const error = new Error('Your BingeCat connection expired. Connect BingeCat again.');
    error.reconnect = true;
    return error;
  }

  async function api(path, retry = true) {
    const tokens = readTokens();
    if (!tokens) throw reconnectError();
    const response = await fetch(`${API_BASE}${path}`, { headers: headers(tokens.access_token), cache: 'no-store', signal: globalThis.AbortSignal?.timeout?.(20000) });
    if (response.status === 401) {
      if (!retry) { clearTokens(); throw reconnectError(); }
      await refresh(tokens.access_token);
      return api(path, false);
    }
    if (!response.ok) throw new Error(`BingeCat returned HTTP ${response.status}.`);
    return response.json();
  }

  async function logout() {
    const tokens = readTokens();
    clearTokens();
    try { localStorage.removeItem(PROFILE_KEY); } catch {}
    if (!tokens) return;
    // Revocation is grant-wide: it signs this app out on every device.
    try { await oauthPost('/oauth/revoke', { token: tokens.access_token }); } catch {}
  }

  let pending = null;
  const connect = {
    configured: Boolean(CLIENT_ID),
    // The callback exchange; the wizard takes it once to show progress or the error.
    takePending: () => { const p = pending; pending = null; return p; },
    isConnected: () => Boolean(readTokens()),
    login,
    // Called when a sign-in finishes after its popup was already closed (e.g. signup in a new tab).
    onConnected: null,
    logout,
    profiles: async () => (await api('/api/v1/profiles')).profiles || [],
    overview: async (profileId) => {
      const id = encodeURIComponent(profileId);
      const [catalogs, recommendations] = await Promise.all([
        api(`/api/v1/profiles/${id}/catalogs`),
        api(`/api/v1/profiles/${id}/recommendations`),
      ]);
      return { manifest: catalogs.manifest, catalogs: catalogs.catalogs || [], recommendations: recommendations.recommendations || [] };
    },
    getProfileId: () => Number(localStorage.getItem(PROFILE_KEY)) || null,
    setProfileId: (id) => { try { localStorage.setItem(PROFILE_KEY, String(id)); } catch {} },
  };

  const params = new URLSearchParams(window.location.search);
  if (CLIENT_ID && window.location.pathname.startsWith('/set-up-collection')
      && params.has('state') && (params.has('code') || params.has('error'))) {
    pending = handleCallback(params);
    pending.catch(() => {});
  }

  window.BingecatConnect = connect;
})();
