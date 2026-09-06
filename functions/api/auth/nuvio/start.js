import {
  assertSameOrigin,
  authServerReady,
  nuvioConfig,
} from '../../../_lib/nuvio-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

    const input = await context.request.json().catch(() => ({}));
    const { apiBase, publishableKey } = nuvioConfig(env);
    const deviceNonce = randomNonce();
    const deviceName = String(input?.deviceName || 'The Kollection').slice(0, 80);

    try {
      const result = await rpc(apiBase, publishableKey, 'start_device_login_session', {
        p_device_nonce: deviceNonce,
        p_redirect_base_url: 'https://nuvio.tv/link',
        p_device_type: 'web',
        p_device_name: deviceName,
      });

      if (
        result?.device_code &&
        result?.verification_uri_complete
      ) {
        return json({
          code: result.device_code,
          userCode: result.user_code || result.device_code,
          verificationUrl: result.verification_uri_complete,
          verificationUri: result.verification_uri || 'https://nuvio.tv/link',
          expiresAt: result.expires_at,
          pollIntervalSeconds: Math.max(2, Number(result.poll_interval_seconds || 3)),
          deviceNonce,
          legacy: false,
        });
      }
    } catch (newFlowError) {
      console.warn('Nuvio device login unavailable, trying legacy TV login:', newFlowError?.message || newFlowError);
    }

    const legacy = await rpc(apiBase, publishableKey, 'start_tv_login_session', {
      p_device_nonce: deviceNonce,
      p_redirect_base_url: 'https://nuvio.tv/tv-login',
      p_device_name: deviceName,
    });

    if (!legacy?.code || !legacy?.web_url) {
      return json({ error: 'Nuvio did not return a usable sign-in request.' }, 502);
    }

    return json({
      code: legacy.code,
      userCode: legacy.code,
      verificationUrl: legacy.web_url,
      verificationUri: 'https://nuvio.tv/tv-login',
      expiresAt: legacy.expires_at,
      pollIntervalSeconds: Math.max(2, Number(legacy.poll_interval_seconds || 3)),
      deviceNonce,
      legacy: true,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not start Nuvio sign in.' }, 502);
  }
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
