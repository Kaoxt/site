import { assertSameOrigin, readSession, refreshSessionIfNeeded, nuvioConfig } from '../../_lib/nuvio-session.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', Vary: 'Cookie' };
function json(body, status = 200, cookie) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}

export async function onRequestGet({ request, env = {} }) {
  if (!assertSameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  const url = new URL(request.url);
  const resource = url.searchParams.get('resource');
  if (!['profiles', 'collections'].includes(resource)) return json({ error: 'Unknown profile resource.' }, 400);
  const profileId = Number(url.searchParams.get('profile'));
  if (resource === 'collections' && (!Number.isSafeInteger(profileId) || profileId < 1)) return json({ error: 'Choose a valid Nuvio profile.' }, 400);
  let cookie;
  try {
    const current = await readSession(request, env);
    if (!current) return json({ error: 'Sign in with Nuvio to verify your setups.' }, 401);
    const refreshed = await refreshSessionIfNeeded(current, env);
    cookie = refreshed.cookie;
    if (!refreshed.session) return json({ error: 'Your Nuvio session expired. Sign in again to verify your setups.' }, 401, cookie);
    const { apiBase, publishableKey } = nuvioConfig(env);
    const response = await fetch(`${apiBase}/rest/v1/rpc/${resource === 'profiles' ? 'sync_pull_profiles' : 'sync_pull_collections'}`, {
      method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${refreshed.session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(resource === 'profiles' ? {} : { p_profile_id: profileId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const authError = response.status === 401 || response.status === 403;
      return json({ error: authError ? 'Nuvio could not authorize verification. Sign in again and retry.' : 'Nuvio is temporarily unavailable. Your saved setups are safe; refresh to retry verification.' }, authError ? 401 : 502, cookie);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid upstream response');
    if (resource === 'collections') {
      for (const row of data) {
        const collections = typeof row?.collections_json === 'string' ? JSON.parse(row.collections_json) : row?.collections_json;
        if (collections !== null && !Array.isArray(collections)) throw new Error('Invalid collection response');
      }
    }
    return json({ data }, 200, cookie);
  } catch {
    return json({ error: 'Could not reach Nuvio to verify this setup. Your saved setups are safe; refresh to retry.' }, 502, cookie);
  }
}

export function onRequestPost() { return json({ error: 'Read-only endpoint.' }, 405); }
