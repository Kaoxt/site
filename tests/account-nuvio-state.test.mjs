import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSessionCookie } from '../functions/_lib/nuvio-session.js';
import { onRequestGet, onRequestPost } from '../functions/api/account/nuvio-state.js';
const env = { KOLLECTION_SESSION_SECRET: 'test-secret-for-account-state', NUVIO_API_BASE: 'https://nuvio.test', NUVIO_PUBLISHABLE_KEY: 'public-test-key' };
async function request(query, headers = {}) {
  const cookie = await createSessionCookie({ user: { id: 'user-1' }, accessToken: 'private-access-token', expiresIn: 3600 }, env);
  return new Request(`https://kollection.tv/api/account/nuvio-state?${query}`, { headers: { Cookie: cookie.split(';')[0], ...headers } });
}

test('profile verification requires a valid session and cannot perform writes or arbitrary RPCs', async () => {
  assert.equal((await onRequestGet({ request: new Request('https://kollection.tv/api/account/nuvio-state?resource=profiles'), env })).status, 401);
  assert.equal((await onRequestGet({ request: await request('resource=sync_push_collections'), env })).status, 400);
  assert.equal((await onRequestGet({ request: await request('resource=collections&profile=0'), env })).status, 400);
  assert.equal((await onRequestGet({ request: await request('resource=profiles', { Origin: 'https://other.test' }), env })).status, 403);
  assert.equal(onRequestPost().status, 405);
});

test('server reads only the selected profile using the encrypted session token', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json([{ collections_json: [{ id: 'movies' }] }]); };
  try {
    const response = await onRequestGet({ request: await request('resource=collections&profile=3'), env });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(calls[0].url, 'https://nuvio.test/rest/v1/rpc/sync_pull_collections');
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_profile_id: 3 });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer private-access-token');
    const body = await response.text();
    assert.doesNotMatch(body, /private-access-token/);
    assert.deepEqual(JSON.parse(body).data, [{ collections_json: [{ id: 'movies' }] }]);
  } finally { globalThis.fetch = original; }
});

test('upstream connection failures and malformed data produce retryable errors, never empty collections', async () => {
  const original = globalThis.fetch;
  try {
    for (const fetcher of [async () => { throw new Error('NetworkError'); }, async () => Response.json({ error: 'down' }, { status: 503 }), async () => Response.json([{ collections_json: 'broken' }])]) {
      globalThis.fetch = fetcher;
      const response = await onRequestGet({ request: await request('resource=collections&profile=3'), env });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.data, undefined);
      assert.match(body.error, /saved setups are safe/);
    }
  } finally { globalThis.fetch = original; }
});

const client = await readFile(new URL('../nuvio-auth/profile-state.js', import.meta.url), 'utf8');
test('browser checks use same-origin URLs, retry temporary failure, and share concurrent requests', async () => {
  const calls = [];
  const window = {};
  vm.runInNewContext(client, { window, URLSearchParams, AbortSignal, fetch: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ error: 'temporary' }, { status: 502 }) : Response.json({ data: [{ collections_json: [] }] });
  } });
  const results = await Promise.all([window.KollectionProfileState.rpc('sync_pull_collections', { p_profile_id: 3 }), window.KollectionProfileState.rpc('sync_pull_collections', { p_profile_id: 3 })]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/account/nuvio-state?resource=collections&profile=3');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(results[0], results[1]);
  await window.KollectionProfileState.rpc('sync_pull_collections', { p_profile_id: 3 });
  assert.equal(calls.length, 3, 'completed reads are not cached across subsequent checks');
});

test('browser does not retry authentication errors or enable editing without successful verification', async () => {
  let count = 0;
  const window = {};
  vm.runInNewContext(client, { window, URLSearchParams, AbortSignal, fetch: async () => { count++; return Response.json({ error: 'Sign in again.' }, { status: 401 }); } });
  await assert.rejects(window.KollectionProfileState.rpc('sync_pull_profiles'), /Sign in again/);
  assert.equal(count, 1);
});
