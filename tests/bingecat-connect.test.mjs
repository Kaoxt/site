import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/bingecat-connect.js', import.meta.url), 'utf8');
const tokenKey = 'bingecat-connect:tokens:v1';
const pkceKey = 'bingecat-connect:pkce:v1';
const origin = 'https://kollection.tv';
const storage = initial => {
  const map = new Map(Object.entries(initial || {}));
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function harness({ blocked = false, search = '', session, tokens, fetcher } = {}) {
  const listeners = {};
  const requests = [];
  const intervals = new Map();
  const timeouts = [];
  const localStorage = storage(tokens ? { [tokenKey]: JSON.stringify(tokens) } : {});
  const sessionStorage = storage(session);
  const popup = { closed: false, location: {}, close() { this.closed = true; }, postMessage() {} };
  const location = new URL('/set-up-collection/bingecat' + search, origin);
  location.assign = url => { location.assigned = url; };
  const window = {
    KOLLECTION_CONFIG: { bingecatClientId: 'public-client', bingecatUrl: 'https://bingecat.com' },
    location, screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 900,
    open: () => blocked ? null : popup,
    history: { replaceState: (_a, _b, path) => { const next = new URL(path, origin); location.href = next.href; } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.runInNewContext(source, {
    window, localStorage, sessionStorage, URL, URLSearchParams, crypto: webcrypto, TextEncoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id), setTimeout: fn => timeouts.push(fn),
    fetch: async (url, init) => { requests.push({ url, ...init, body: init.body && JSON.parse(init.body) }); return fetcher ? fetcher(url, init) : response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }); },
  });
  return { api: window.BingecatConnect, window, localStorage, sessionStorage, popup, requests, listeners, intervals, timeouts };
}

async function loginResult(h, overrides = {}, eventOverrides = {}) {
  const pkce = JSON.parse(h.sessionStorage.getItem(pkceKey));
  h.listeners.message({ origin, source: h.popup, data: { type: 'bingecat-connect:callback', state: pkce.state, code: 'code-1', ...overrides }, ...eventOverrides });
  await settle();
}

test('popup login uses PKCE and exchanges a matching callback without navigating the builder', async () => {
  const h = harness();
  const waiting = h.api.login();
  // Popup exists immediately, before asynchronous SHA-256 completes.
  assert.equal(h.intervals.size, 1);
  for (let i = 0; !h.popup.location.href && i < 100; i++) await settle();
  const authorize = new URL(h.popup.location.href);
  assert.equal(authorize.origin, 'https://bingecat.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), origin + '/bingecat-callback.html');
  assert.equal(authorize.searchParams.get('scope'), 'profiles:read settings:read catalogs:read');
  const pkce = JSON.parse(h.sessionStorage.getItem(pkceKey));
  assert.equal(authorize.searchParams.get('code_challenge'), Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(pkce.verifier))).toString('base64url'));
  await loginResult(h);
  assert.equal(await waiting, true);
  assert.equal(h.window.location.assigned, undefined);
  assert.equal(h.api.isConnected(), true);
  assert.equal(h.requests[0].body.redirect_uri, origin + '/bingecat-callback.html');
  assert.equal(h.requests[0].body.code_verifier, pkce.verifier);
  assert.equal(h.requests[0].headers['bingecat-api-version'], '1');
  assert.equal(h.sessionStorage.getItem(pkceKey), null);
  assert.equal(h.intervals.size, 0);
});

test('wrong origin, wrong popup, and wrong state cannot consume a pending login', async () => {
  const h = harness();
  const waiting = h.api.login();
  await loginResult(h, {}, { origin: 'https://other.test' });
  await loginResult(h, {}, { source: {} });
  await loginResult(h, { state: 'wrong' });
  assert.equal(h.requests.length, 0);
  assert.ok(h.sessionStorage.getItem(pkceKey));
  await loginResult(h);
  assert.equal(await waiting, true);
});

test('denied consent and a closed popup leave the user disconnected and allow retry', async () => {
  const h = harness();
  const waiting = h.api.login();
  const rejected = assert.rejects(waiting, /not approved/);
  await loginResult(h, { error: 'access_denied', code: null });
  await rejected;
  assert.equal(h.requests.length, 0);
  const retry = h.api.login();
  h.popup.closed = true;
  for (const fn of h.intervals.values()) fn();
  for (const fn of h.timeouts) fn();
  assert.equal(await retry, false);
  assert.equal(h.api.isConnected(), false);
});

test('blocked popup and account creation use the registered full-page redirect', async () => {
  for (const create of [false, true]) {
    const h = harness({ blocked: !create, search: '?saved=draft&update=1&targetProfile=2' });
    assert.equal(await h.api.login({ create }), null);
    const url = new URL(h.window.location.assigned);
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/set-up-collection/bingecat');
    assert.equal(url.searchParams.get('prompt'), create ? 'create' : null);
    assert.ok(JSON.parse(h.sessionStorage.getItem(pkceKey)).returnUrl.includes('saved=draft'));
  }
});

test('canonicalized full-page callback strips OAuth parameters and restores setup context', async () => {
  const pending = { verifier: 'v', state: 'expected', redirectUri: origin + '/bingecat-callback.html', createdAt: Date.now(), returnUrl: '/set-up-collection?saved=draft&targetProfile=2' };
  const h = harness({ search: '?code=code-1&state=expected', session: { [pkceKey]: JSON.stringify(pending) } });
  await h.api.takePending();
  assert.equal(h.api.takePending(), null);
  assert.equal(h.window.location.search, '?saved=draft&targetProfile=2&step=bingecat');
  assert.equal(h.requests[0].body.redirect_uri, pending.redirectUri);
  assert.equal(h.api.isConnected(), true);
});

test('expired callback cannot exchange a code', async () => {
  const h = harness({ search: '?code=code-1&state=old', session: { [pkceKey]: JSON.stringify({ state: 'old', createdAt: Date.now() - 11 * 60 * 1000 }) } });
  await assert.rejects(h.api.takePending(), /expired/);
  assert.equal(h.requests.length, 0);
});

test('concurrent 401s refresh once and retry with the rotated access token', async () => {
  const h = harness({ tokens: { access_token: 'old', refresh_token: 'old-refresh' }, fetcher: async (url, init) => {
    if (url.endsWith('/oauth/token')) { await settle(); return response({ access_token: 'new', refresh_token: 'new-refresh' }); }
    if (init.headers.Authorization === 'Bearer old') return response({}, 401);
    return response({ profiles: [{ id: 7 }] });
  } });
  const results = await Promise.all([h.api.profiles(), h.api.profiles()]);
  assert.equal(results[0][0].id, 7);
  assert.equal(h.requests.filter(r => r.url.endsWith('/oauth/token')).length, 1);
  assert.equal(JSON.parse(h.localStorage.getItem(tokenKey)).refresh_token, 'new-refresh');
});

test('invalid refresh clears tokens; a service outage keeps them available for retry', async () => {
  for (const status of [400, 503]) {
    const h = harness({ tokens: { access_token: 'old', refresh_token: 'old-refresh' }, fetcher: async url => response({ error: 'unavailable' }, url.endsWith('/oauth/token') ? status : 401) });
    await assert.rejects(h.api.profiles());
    assert.equal(h.api.isConnected(), status === 503);
  }
});

test('profile catalog calls use API authorization; disconnect revokes and clears local credentials', async () => {
  const h = harness({ tokens: { access_token: 'access', refresh_token: 'refresh' }, fetcher: async () => response({ catalogs: [], recommendations: [], manifest: { id: 'addon' } }) });
  h.api.setProfileId(7);
  await h.api.overview(7);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(r => r.url.startsWith('https://bingecat.com/api/v1/profiles/7/') && r.headers.Authorization === 'Bearer access'));
  await h.api.logout();
  assert.equal(h.api.isConnected(), false);
  assert.equal(h.api.getProfileId(), null);
  assert.equal(h.requests[2].url, 'https://bingecat.com/oauth/revoke');
});
