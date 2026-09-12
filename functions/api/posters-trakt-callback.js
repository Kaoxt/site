function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([key]) => key));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveKey(secret) {
  const raw = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptJson(value, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv, 0);
  packed.set(encrypted, iv.length);
  return base64url(packed);
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '');
  const state = String(url.searchParams.get('state') || '');
  const error = String(url.searchParams.get('error') || '');
  const cookies = parseCookies(request);
  const expectedState = cookies.kollection_trakt_state || '';
  const returnUrl = `${url.origin}/posters`;

  if (error) return redirect(`${returnUrl}?trakt=error&reason=${encodeURIComponent(error)}`);
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirect(`${returnUrl}?trakt=error&reason=state`);
  }

  const clientId = String(env.TRAKT_CLIENT_ID || '').trim();
  const clientSecret = String(env.TRAKT_CLIENT_SECRET || '').trim();
  const sessionSecret = String(env.POSTERS_TRAKT_SESSION_SECRET || '').trim();
  const redirectUri = String(env.TRAKT_REDIRECT_URI || `${url.origin}/api/posters-trakt-callback`).trim();
  if (!clientId || !clientSecret || !sessionSecret) {
    return redirect(`${returnUrl}?trakt=error&reason=config`);
  }

  try {
    const tokenResponse = await fetch('https://auth.trakt.tv/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error('token_exchange_failed');

    const sealed = await encryptJson({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || '',
      token_type: tokenData.token_type || 'bearer',
      expires_in: Number(tokenData.expires_in || 0) || 0,
      created_at: Number(tokenData.created_at || Math.floor(Date.now() / 1000)),
      scope: tokenData.scope || '',
    }, sessionSecret);

    return redirect(`${returnUrl}?trakt=connected`, {
      'set-cookie': `kollection_trakt=${sealed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`,
    });
  } catch {
    return redirect(`${returnUrl}?trakt=error&reason=exchange`);
  }
}
