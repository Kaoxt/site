import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSessionCookie } from '../functions/_lib/nuvio-session.js';
import { onRequestGet } from '../functions/api/auth/session.js';
import { onRequest as authMiddleware } from '../functions/api/auth/_middleware.js';

const env = { KOLLECTION_SESSION_SECRET: 'resilience-test-only', NUVIO_ADMIN_USER_ID: 'owner' };
async function sessionRequest(id = 'member') {
  const cookie = await createSessionCookie({ user: { id, email: 'member@example.test' }, accessToken: 'private-token' }, env);
  return new Request('https://kollection.tv/api/auth/session', { headers: { Cookie: cookie.split(';')[0] } });
}
function profileDb(fail = '') {
  return { prepare(sql) {
    const check = () => { if (fail === 'all' || sql.includes(fail) && fail) throw new Error('private database detail'); };
    return {
      async run() { check(); },
      bind() { return { async first() {
        check();
        return sql.includes('display_name') ? { display_name: 'Display name' } : { id: 'avatar-1', url: '/avatar.webp' };
      } }; },
    };
  } };
}

test('optional profile storage failure keeps a verified account signed in without exposing tokens', async () => {
  const response = await onRequestGet({ request: await sessionRequest(), env: { ...env, DB: profileDb('all') } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.isAdmin, false);
  assert.equal(body.user.id, 'member');
  assert.equal(body.user.displayName, '');
  assert.equal(body.user.avatarUrl, '');
  assert.doesNotMatch(JSON.stringify(body), /private-token|private database/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
});

test('optional lookups fail independently and recover on the next session check', async () => {
  let failAvatar = true;
  const db = profileDb();
  const prepare = db.prepare;
  db.prepare = (sql) => failAvatar && sql.startsWith('SELECT id, url') ? profileDb('all').prepare(sql) : prepare(sql);
  const context = { request: await sessionRequest('owner'), env: { ...env, DB: db } };
  const partial = await (await onRequestGet(context)).json();
  assert.equal(partial.user.displayName, 'Display name');
  assert.equal(partial.user.avatarUrl, '');
  assert.equal(partial.isAdmin, true);
  failAvatar = false;
  const recovered = await (await onRequestGet(context)).json();
  assert.equal(recovered.user.avatarUrl, '/avatar.webp');
});

test('missing or invalid session never gains access when storage is unavailable', async () => {
  for (const cookie of ['', 'kollection_nuvio_session=invalid']) {
    const response = await onRequestGet({ request: new Request('https://kollection.tv/api/auth/session', { headers: { Cookie: cookie } }), env: { ...env, DB: profileDb('all') } });
    assert.deepEqual(await response.json(), { authenticated: false, isAdmin: false, user: null });
  }
});

test('unexpected auth failures return safe uncached JSON and do not erase the session', async () => {
  const response = await authMiddleware({ request: new Request('https://kollection.tv/api/auth/token'), next: async () => { throw new Error('private-token database detail'); } });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  assert.match(body.error, /try again/i);
  assert.doesNotMatch(JSON.stringify(body), /private-token|database detail/);
});

test('auth middleware preserves normal status, retry headers, and cookies', async () => {
  const response = await authMiddleware({ request: new Request('https://kollection.tv/api/auth/token'), next: async () => Response.json({ error: 'Please wait.' }, { status: 429, headers: { 'Retry-After': '30', 'Set-Cookie': 'test=refreshed; HttpOnly' } }) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(response.headers.get('set-cookie'), 'test=refreshed; HttpOnly');
});

const clientSource = await readFile(new URL('../nuvio-auth/nuvio-auth.js', import.meta.url), 'utf8');
function client(fetch) {
  const window = { addEventListener() {} };
  vm.runInNewContext(clientSource, { window, fetch, setTimeout });
  return window.KollectionNuvioAuth;
}

test('Cloudflare HTML, plaintext failures, and invalid success responses never become visible error text', async () => {
  for (const [body, status] of [
    ['<!DOCTYPE html><html>Worker threw exception; private diagnostics</html>', 500],
    ['private diagnostics', 502],
    ['<html>gateway page</html>', 200],
    ['', 200],
    ['null', 200],
    ['[]', 200],
    ['{"error":"<html>private diagnostics</html>"}', 400],
  ]) {
    const auth = client(async () => new Response(body, { status }));
    await assert.rejects(auth.getSession(), error => {
      assert.match(error.message, /try again/i);
      assert.doesNotMatch(error.message, /<!DOCTYPE|<html>|private diagnostics|HTTP 200/);
      return true;
    });
  }
});

test('network errors are readable and Try again can perform a fresh session check', async () => {
  let attempts = 0;
  const auth = client(async () => { if (++attempts === 1) throw new TypeError('Failed to fetch'); return Response.json({ authenticated: true, user: { id: 'member' } }); });
  await assert.rejects(auth.getSession(), /connection.*try again/i);
  assert.equal((await auth.getSession()).authenticated, true);
  assert.equal(attempts, 2);
});

test('meaningful JSON auth errors retain their status and failed writes are not replayed', async () => {
  let attempts = 0;
  const auth = client(async () => { attempts++; return Response.json({ error: 'Too many sign-in attempts. Please wait.' }, { status: 429 }); });
  await assert.rejects(auth.connectTokenResponse({ access_token: 'test-token' }), error => error.status === 429 && error.message === 'Too many sign-in attempts. Please wait.');
  assert.equal(attempts, 1);
});
