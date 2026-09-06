import {
  assertSameOrigin,
  authServerReady,
  createSessionCookie,
  isAdminUser,
  verifyNuvioAccessToken,
} from '../../_lib/nuvio-session.js';

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

export async function onRequestPost(context) {
  try {
    const env = context.env || {};
    if (!authServerReady(env)) {
      return json({ error: 'KOLLECTION_SESSION_SECRET is not configured.' }, 500);
    }
    if (!assertSameOrigin(context.request)) {
      return json({ error: 'Cross-origin login requests are not allowed.' }, 403);
    }

    const body = await context.request.json().catch(() => null);
    const accessToken = String(body?.accessToken || '').trim();
    const user = await verifyNuvioAccessToken(accessToken, env);

    const cookie = await createSessionCookie({
      user,
      accessToken,
      refreshToken: body?.refreshToken || '',
      tokenType: body?.tokenType || 'bearer',
      expiresIn: body?.expiresIn || null,
    }, env);

    return json({
      authenticated: true,
      isAdmin: isAdminUser(user, env),
      user,
    }, 200, { 'Set-Cookie': cookie });
  } catch (error) {
    return json({ error: error?.message || 'Could not create Kollection session.' }, 401);
  }
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
