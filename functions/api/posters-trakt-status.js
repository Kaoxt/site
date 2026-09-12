function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([key]) => key));
}

function base64url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clientId = String(env.TRAKT_CLIENT_ID || '').trim();
  const clientSecret = String(env.TRAKT_CLIENT_SECRET || '').trim();
  const sessionSecret = String(env.POSTERS_TRAKT_SESSION_SECRET || '').trim();
  const redirectUri = String(env.TRAKT_REDIRECT_URI || `${url.origin}/api/posters-trakt-callback`).trim();
  const configured = Boolean(clientId && clientSecret && sessionSecret && redirectUri);
  const cookies = parseCookies(request);
  const connected = Boolean(cookies.kollection_trakt);

  if (!configured) {
    return json({ configured: false, connected, missing: [
      !clientId ? 'TRAKT_CLIENT_ID' : '',
      !clientSecret ? 'TRAKT_CLIENT_SECRET' : '',
      !sessionSecret ? 'POSTERS_TRAKT_SESSION_SECRET' : '',
    ].filter(Boolean) });
  }

  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const authorize = new URL('https://trakt.tv/oauth/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);

  return json({ configured: true, connected, authorizeUrl: authorize.toString() }, 200, {
    'set-cookie': `kollection_trakt_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}
