import {
  authServerReady,
  readSession,
  refreshSessionIfNeeded,
} from '../../_lib/nuvio-session.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, ...extraHeaders },
  });
}

export async function onRequestGet(context) {
  const env = context.env || {};
  if (!authServerReady(env)) {
    return json({ error: 'KOLLECTION_SESSION_SECRET is not configured.' }, 500);
  }

  const current = await readSession(context.request, env);
  if (!current) {
    return json({ authenticated: false, accessToken: null, user: null }, 401);
  }

  const refreshed = await refreshSessionIfNeeded(current, env);
  if (!refreshed.session) {
    return json(
      { authenticated: false, accessToken: null, user: null },
      401,
      refreshed.cookie ? { 'Set-Cookie': refreshed.cookie } : {}
    );
  }

  const s = refreshed.session;
  return json({
    authenticated: true,
    accessToken: s.accessToken,
    user: { id: s.id, email: s.email },
  }, 200, refreshed.cookie ? { 'Set-Cookie': refreshed.cookie } : {});
}

export function onRequestPost() {
  return json({ error: 'GET only.' }, 405);
}
