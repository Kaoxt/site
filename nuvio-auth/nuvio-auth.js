(() => {
  'use strict';

  if (window.KollectionNuvioAuth) return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function readBody(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function request(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
    });
    const body = await readBody(res);
    if (!res.ok) {
      const message = body?.error || body?.message || (typeof body === 'string' ? body : '') || `HTTP ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function openApprovalWindow() {
    try {
      return window.open(
        'about:blank',
        'kollection-nuvio-login',
        'popup=yes,width=560,height=760,resizable=yes,scrollbars=yes'
      );
    } catch {
      return null;
    }
  }

  async function getSession() {
    return request('/api/auth/session');
  }

  async function getAccessToken() {
    return request('/api/auth/token');
  }

  async function connectTokenResponse(tokenResponse) {
    if (!tokenResponse?.access_token) {
      throw new Error('Nuvio did not return an access token.');
    }

    return request('/api/auth/nuvio-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || null,
        expiresIn: tokenResponse.expires_in || null,
        tokenType: tokenResponse.token_type || 'bearer',
      }),
    });
  }

  async function signOut() {
    return request('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  }

  async function continueWithNuvio(options = {}) {
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    const popup = openApprovalWindow();

    onStatus('Preparing Nuvio sign in…');

    let started;
    try {
      started = await request('/api/auth/nuvio/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: options.deviceName || 'The Kollection',
        }),
      });
    } catch (error) {
      try { popup?.close(); } catch {}
      throw error;
    }

    const approvalUrl = started.verificationUrl;
    if (!approvalUrl) {
      try { popup?.close(); } catch {}
      throw new Error('Nuvio did not return a sign-in URL.');
    }

    if (popup && !popup.closed) {
      try {
        popup.location.replace(approvalUrl);
        popup.focus();
      } catch {
        try { popup.location.href = approvalUrl; } catch {}
      }
    } else {
      const opened = window.open(approvalUrl, '_blank', 'noopener');
      if (!opened) {
        const error = new Error('Your browser blocked the Nuvio sign-in window.');
        error.approvalUrl = approvalUrl;
        throw error;
      }
    }

    onStatus('Approve The Kollection in Nuvio. This page will finish automatically.');

    const intervalMs = Math.max(2000, Number(started.pollIntervalSeconds || 3) * 1000);
    const expiresAtMs = Date.parse(started.expiresAt || '') || (Date.now() + 10 * 60 * 1000);

    while (Date.now() < expiresAtMs) {
      await sleep(intervalMs);

      let result;
      try {
        result = await request('/api/auth/nuvio/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: started.code,
            deviceNonce: started.deviceNonce,
          }),
        });
      } catch (error) {
        if (error.status >= 500) {
          onStatus('Nuvio is still connecting…');
          continue;
        }
        try { popup?.close(); } catch {}
        throw error;
      }

      const status = String(result?.status || '').toLowerCase();

      if (result?.authenticated) {
        try { popup?.close(); } catch {}
        onStatus('Signed in with Nuvio.');
        return result;
      }

      if (status === 'pending') {
        onStatus('Waiting for approval in Nuvio…');
        continue;
      }

      if (['expired', 'used', 'cancelled'].includes(status)) {
        try { popup?.close(); } catch {}
        throw new Error(`Nuvio sign in ${status}. Please try again.`);
      }
    }

    try { popup?.close(); } catch {}
    throw new Error('The Nuvio sign-in request expired. Please try again.');
  }

  window.KollectionNuvioAuth = Object.freeze({
    getSession,
    getAccessToken,
    connectTokenResponse,
    continueWithNuvio,
    signOut,
  });
})();
