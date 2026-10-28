import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { onRequestPost } from '../functions/api/aio-manifest.js';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
const origin = 'https://aiometadatafortheweebs.midnightignite.me';
const install = `${origin}/stremio/private-uuid/private-token/manifest.json`;
const manifest = { id: 'aio-metadata', catalogs: [{ id: 'movies', type: 'movie' }], resources: ['meta', 'catalog'] };
const json = (body = manifest, status = 200) => Response.json(body, { status });

function client(fetch, timeout = 8000) {
  const calls = [];
  const context = vm.createContext({ URL, AbortController, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 8000 ? timeout : 0),
    normalizeUrl: url => url.replace(/^stremio:/, 'https:'),
    fetch: async (...args) => { calls.push(args); return fetch(...args); },
  });
  vm.runInContext(section('  function manifestReadError(', '  function parseKaoxtDatabase('), context);
  return { calls, read: (url = install, bingecat = false) => {
    context.url = url; context.bingecat = bingecat;
    return vm.runInContext('fetchAddonManifest(url, bingecat)', context);
  } };
}

test('healthy manifests use only the direct request', async () => {
  const h = client(async () => json());
  assert.equal((await h.read()).id, manifest.id);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1].cache, 'no-store');
});

test('Midnight browser failures recover via POST without credentials or URL query logging', async () => {
  const h = client(async url => { if (url === install) throw new TypeError('Failed to fetch'); return json(); });
  assert.equal((await h.read()).id, manifest.id);
  assert.equal(h.calls.length, 2);
  const [url, opts] = h.calls[1];
  assert.equal(url, '/api/aio-manifest');
  assert.equal(opts.method, 'POST');
  assert.equal(JSON.parse(opts.body).url, install);
  assert.equal(opts.headers.Authorization, undefined);
});

test('an upstream 404 remains a missing-configuration error and is not retried', async () => {
  const h = client(async url => { if (url === install) throw new TypeError('blocked'); return json({ error: 'http', upstreamStatus: 404 }, 502); });
  await assert.rejects(h.read(), e => e.manifestFailure === 'http' && e.status === 404 && !e.message.includes('private'));
  assert.equal(h.calls.length, 2);
});

test('an old deployment without the proxy preserves a direct missing configuration', async () => {
  const h = client(async () => json({}, 404));
  await assert.rejects(h.read(), e => e.manifestFailure === 'http' && e.status === 404);
  assert.equal(h.calls.length, 2);
});

test('temporary direct failures retry once and custom hosts are never sent to the proxy', async () => {
  let n = 0;
  const h = client(async () => ++n === 1 ? json({}, 503) : json());
  assert.equal((await h.read('https://self.example/stremio/private/manifest.json')).id, manifest.id);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(([url]) => url.startsWith('https://self.example/')));
  const permanent = client(async () => json({}, 503));
  await assert.rejects(permanent.read('https://self.example/manifest.json'), e => e.status === 503);
  assert.equal(permanent.calls.length, 2);
});

test('a server HTTP failure survives a final browser CORS failure', async () => {
  const h = client(async url => { if (url === install) throw new TypeError('blocked'); return json({ error: 'http', upstreamStatus: 503 }, 502); });
  await assert.rejects(h.read(), e => e.status === 503);
  assert.equal(h.calls.length, 3);
});

test('timeouts cover stalled response bodies as well as headers', async () => {
  const h = client(async (url, { signal }) => ({ ok: true,
    json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  }), 10);
  await assert.rejects(h.read('https://self.example/manifest.json'), e => e.manifestFailure === 'timeout');
  assert.equal(h.calls.length, 2);
});

test('HTML and malformed manifests recover only with a valid fallback', async () => {
  for (const bad of ['<html>gateway error</html>', JSON.stringify({ error: 'missing user' }), JSON.stringify({ id: 'aio-metadata', resources: 'meta' })]) {
    const h = client(async url => url === install ? new Response(bad) : json());
    assert.equal((await h.read()).id, manifest.id);
    const fail = client(async () => new Response(bad));
    await assert.rejects(fail.read('https://self.example/manifest.json'), e => e.manifestFailure === 'invalid');
  }
});

test('Bingecat retains its existing dedicated fallback', async () => {
  const h = client(async url => { if (url.startsWith('https:')) throw new TypeError('blocked'); return json(); });
  await h.read('https://bingecat.com/personal/manifest.json', true);
  assert.match(h.calls[1][0], /^\/api\/manifest\?url=/);
});

function request(url = install, headers = {}) {
  return new Request('https://kollection.tv/api/aio-manifest', {
    method: 'POST', headers: { Origin: 'https://kollection.tv', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ url }),
  });
}

test('proxy rejects other hosts, credentials, ports, non-manifest paths and encoded traversal before fetching', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return json(); });
  for (const url of ['http://127.0.0.1/manifest.json', 'https://self.example/manifest.json',
    `https://user:pass@${new URL(origin).host}/manifest.json`, `${origin}:8443/manifest.json`,
    `${origin}.evil.test/manifest.json`, `${origin}/api/config`, `${origin}/stremio/%252e%252e/manifest.json`,
    `${origin}/stremio/token%2f..%2fapi/manifest.json`, `${origin}/manifest.json#token`]) {
    assert.equal((await onRequestPost({ request: request(url) })).status, 400, url);
  }
  assert.equal(calls, 0);
});

test('proxy requires same-origin JSON input and caps input size', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return json(); });
  assert.equal((await onRequestPost({ request: request(install, { Origin: 'https://evil.test' }) })).status, 403);
  assert.equal((await onRequestPost({ request: request(install, { 'Content-Type': 'text/plain' }) })).status, 415);
  assert.equal((await onRequestPost({ request: request(install + '?' + 'x'.repeat(17000)) })).status, 400);
  assert.equal(calls, 0);
});

test('proxy accepts a valid manifest, sends no user credentials and disables caching', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, install); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    return json();
  });
  const response = await onRequestPost({ request: request() });
  assert.deepEqual(await response.json(), manifest);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('proxy checks every redirect and does not fetch a redirected private host', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/manifest.json' } }); });
  const result = await onRequestPost({ request: request() });
  assert.equal(result.status, 502); assert.equal(calls, 1);
  assert.equal((await result.json()).error, 'redirect');
});

test('proxy permits same-host manifest redirects but bounds redirect loops', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response(null, { status: 302, headers: { Location: '/stremio/other/manifest.json' } }) : json());
  assert.equal((await onRequestPost({ request: request() })).status, 200);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 302, headers: { Location: install } }); });
  assert.equal((await onRequestPost({ request: request() })).status, 502);
  assert.equal(calls, 3);
});

test('proxy failures expose only safe codes and status, never host HTML or the personal URL', async t => {
  for (const status of [401, 403, 404, 410, 429, 503]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(`private-token ${install}`, { status }));
    const response = await onRequestPost({ request: request() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'http', upstreamStatus: status });
  }
});

test('proxy rejects invalid and oversized streamed manifests without trusting Content-Length', async t => {
  for (const body of ['<html>private-token</html>', JSON.stringify({ error: 'private-token' }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'Content-Length': '1' } }));
    const response = await onRequestPost({ request: request() });
    assert.equal(response.status, 502); assert.equal((await response.json()).error, 'invalid');
  }
});

test('proxy has a total timeout including reading the upstream body', async t => {
  const realTimeout = setTimeout;
  t.mock.method(globalThis, 'setTimeout', fn => realTimeout(fn, 10));
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); },
  })));
  const result = await onRequestPost({ request: request() });
  assert.equal(result.status, 502); assert.equal((await result.json()).error, 'timeout');
});
