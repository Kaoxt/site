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

  // These are optional presentation details. A storage outage must not turn a
  // valid encrypted session into an account-loading failure or sign the user out.
  const details = await Promise.allSettled([
    getDisplayName(env, session.id),
    getAccountAvatar(env, session.id),
  ]);
  const [displayName, avatarUrl] = details.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn('Kollection session profile lookup unavailable', {
      field: index === 0 ? 'displayName' : 'avatarUrl',
      ray: context.request.headers.get('cf-ray') || '',
    });
    return '';
  });
  const user = { id: session.id, email: session.email, displayName, avatarUrl };
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
