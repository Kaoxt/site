import { getAccountAvatar } from '../../_lib/account-avatar.js';
import { getDisplayName } from '../../_lib/account-preferences.js';
import {
  authServerReady,
  isAdminUser,
  readSession,
} from '../../_lib/nuvio-session.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export async function onRequestGet(context) {
  const env = context.env || {};
  if (!authServerReady(env)) {
    return json({ error: 'KOLLECTION_SESSION_SECRET is not configured.' }, 500);
  }

  const session = await readSession(context.request, env);
  if (!session) {
    return json({ authenticated: false, isAdmin: false, user: null });
  }

  const user = { id: session.id, email: session.email, displayName: await getDisplayName(env, session.id), avatarUrl: await getAccountAvatar(env, session.id) };
  return json({
    authenticated: true,
    isAdmin: isAdminUser(user, env),
    user,
    expiresAt: new Date(session.sessionExp * 1000).toISOString(),
  });
}

export function onRequestPost() {
  return json({ error: 'GET only.' }, 405);
}
