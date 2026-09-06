import {
  assertSameOrigin,
  authServerReady,
  createSessionCookie,
  isAdminUser,
  nuvioConfig,
  verifyNuvioAccessToken,
} from '../../../_lib/nuvio-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

async function rpc(apiBase, publishableKey, name, body) {
  const res = await fetch(`${apiBase}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.message || data?.hint || data?.details || `HTTP ${res.status}`;
    throw new Error(`${name} failed: ${detail}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

export async function onRequestPost(context) {
  try {
    const env = context.env || {};
    if (!authServerReady(env)) {
      return json({ error: 'KOLLECTION_SESSION_SECRET is not configured.' }, 500);
    }
    if (!assertSameOrigin(context.request)) {
      return json({ error: 'Cross-origin login requests are not allowed.' }, 403);
    }

    const input = await context.request.json().catch(() => null);
    const code = String(input?.code || '').trim();
    const deviceNonce = String(input?.deviceNonce || '').trim();

    if (!code || !deviceNonce) {
      return json({ error: 'Missing Nuvio login code or device nonce.' }, 400);
    }

    const { apiBase, publishableKey } = nuvioConfig(env);
    const poll = await rpc(apiBase, publishableKey, 'poll_tv_login_session', {
      p_code: code,
      p_device_nonce: deviceNonce,
    });

    const status = String(poll?.status || 'pending').toLowerCase();

    if (status !== 'approved') {
      return json({
        authenticated: false,
        status,
        expiresAt: poll?.expires_at || null,
        pollIntervalSeconds: Math.max(2, Number(poll?.poll_interval_seconds || 3)),
      });
    }

    const exchangeRes = await fetch(`${apiBase}/functions/v1/tv-logins-exchange`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        code,
        device_nonce: deviceNonce,
      }),
    });

    const tokenResponse = await exchangeRes.json().catch(() => null);
    if (!exchangeRes.ok || !tokenResponse?.access_token) {
      const detail =
        tokenResponse?.error_description ||
        tokenResponse?.message ||
        tokenResponse?.error ||
        `HTTP ${exchangeRes.status}`;
      throw new Error(`Nuvio token exchange failed: ${detail}`);
    }

    const user = tokenResponse.user?.id
      ? {
          id: String(tokenResponse.user.id),
          email: String(tokenResponse.user.email || ''),
        }
      : await verifyNuvioAccessToken(tokenResponse.access_token, env);

    const cookie = await createSessionCookie({
      user,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || '',
      tokenType: tokenResponse.token_type || 'bearer',
      expiresIn: tokenResponse.expires_in || null,
    }, env);

    return json({
      authenticated: true,
      status: 'approved',
      isAdmin: isAdminUser(user, env),
      user,
    }, 200, { 'Set-Cookie': cookie });
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not finish Nuvio sign in.' }, 502);
  }
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
