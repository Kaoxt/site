import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { onRequest as serveImage } from '../functions/images/[[path]].js';

async function loadEndpoint(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import \{[\s\S]*?\} from '\.\.\/\.\.\/_lib\/nuvio-session.js';/, `
    const authServerReady = () => true;
    const isAdminUser = (_session, env) => !env.notAdmin;
    const readSession = async (_request, env) => env.signedOut ? null : {};
    const assertSameOrigin = request => request.headers.get('Origin') === new URL(request.url).origin;
  `);
  source = source.replace("'../../_lib/artwork-history.js'", JSON.stringify(new URL('../functions/_lib/artwork-history.js', import.meta.url).href));
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const { onRequestPost } = await loadEndpoint('../functions/api/admin/upload-image.js');
const { onRequestGet } = await loadEndpoint('../functions/api/admin/images.js');

test('single-file uploads return the same clean URL and replace only that image', async (t) => {
  const key = 'images/World/South Korea/backdrop.webp';
  const expectedUrl = 'https://kollection.tv/images/World/South%20Korea/backdrop.webp';
  const unrelated = 'images/World/South Korea/cover.webp';
  const objects = new Map([[unrelated, Buffer.from('existing-cover')]]);
  const writes = [];
  const trees = [];
  const deleted = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'parent' } });
    if (url.endsWith('/git/commits/parent')) return Response.json({ tree: { sha: 'base' } });
    if (url.endsWith('/git/blobs')) return Response.json({ sha: 'blob' });
    if (url.endsWith('/git/trees')) { trees.push(JSON.parse(options.body)); return Response.json({ sha: 'tree' }); }
    if (url.endsWith('/git/commits')) return Response.json({ sha: 'commit' });
    if (url.endsWith('/git/refs/heads/main')) return Response.json({});
    throw new Error('Unexpected fetch ' + url);
  });
  const originalCache = globalThis.caches;
  globalThis.caches = { default: { async delete(request) { deleted.push(request.url); return true; } } };
  t.after(() => { globalThis.caches = originalCache; });

  const env = { GITHUB_TOKEN: 'test', IMAGES: {
    async put(path, bytes, options) {
      writes.push([path, bytes, options]);
      objects.set(path, Buffer.from(bytes));
    },
  } };
  for (const [index, body] of ['first-webp', 'replacement-webp'].entries()) {
    const form = new FormData();
    form.set('category', 'World');
    form.set('folder', 'South Korea');
    form.set('backdrop', new Blob([body], { type: 'image/webp' }), 'backdrop.webp');
    const request = new Request('https://kollection.tv/api/admin/upload-image', {
      method: 'POST', headers: { Origin: 'https://kollection.tv' }, body: form,
    });
    const pending = [];
    const res = await onRequestPost({ request, env, waitUntil(p) { pending.push(p); } });
    await Promise.all(pending);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(writes.length, index + 1);
    assert.equal(writes[index][0], key);
    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].url, expectedUrl);
    assert.equal(new URL(data.files[0].url).search, '');
    assert.equal(writes[index][2].customMetadata['artwork-uploaded-at'], data.files[0].uploaded);
    assert.equal(trees[index].base_tree, 'base');
    assert.equal(trees[index].tree.length, 1);
    assert.equal(trees[index].tree[0].path, key);
    assert.equal(objects.size, 2, 'replacement must not create numbered copies');
    assert.equal(objects.get(key).toString(), body);
    assert.equal(objects.get(unrelated).toString(), 'existing-cover');
    assert.equal(deleted[index], expectedUrl);
  }
});

test('artwork listing returns clean URLs with correct encoding, dates and pagination', async () => {
  const cases = [
    ['images/World/Brazil/backdrop.webp', 'https://kollection.tv/images/World/Brazil/backdrop.webp'],
    ['images/World/South Korea/backdrop.webp', 'https://kollection.tv/images/World/South%20Korea/backdrop.webp'],
    ['images/World/Türkiye/cover.webp', 'https://kollection.tv/images/World/T%C3%BCrkiye/cover.webp'],
  ];
  const history = Object.fromEntries(cases.map(([key]) => [key, { size: 12, etag: 'abc', uploaded: '2026-09-15T10:00:00Z' }]));
  const res = await onRequestGet({
    request: new Request('https://kollection.tv/api/admin/images?cursor=page2'),
    env: { IMAGES: {
      async list(options) {
        assert.deepEqual(options.include, ['customMetadata']);
        assert.equal(options.cursor, 'page2');
        return {
          objects: cases.map(([key]) => ({ key, size: 12, etag: 'abc', httpEtag: '"abc"', uploaded: '2026-09-30T02:58:00Z' })),
          truncated: true,
          cursor: 'page3',
        };
      },
      async get() { return { async json() { return { version: 1, images: history }; } }; },
    } },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.images.length, cases.length);
  for (const [index, [, expectedUrl]] of cases.entries()) {
    assert.equal(data.images[index].url, expectedUrl);
    assert.equal(new URL(data.images[index].url).search, '');
    assert.equal(data.images[index].uploaded, '2026-09-15T10:00:00.000Z');
    assert.equal(data.images[index].etag, '"abc"', 'ETags remain internal metadata, not public URL suffixes');
  }
  assert.equal(data.cursor, 'page3');
});

test('signed-out and non-admin users cannot access image history', async () => {
  for (const [flag, status] of [['signedOut', 401], ['notAdmin', 403]]) {
    const res = await onRequestGet({ request: new Request('https://kollection.tv/api/admin/images'), env: { [flag]: true, IMAGES: { async list() { throw new Error('Must not read R2'); } } } });
    assert.equal(res.status, status);
  }
});

test('cross-origin uploads remain blocked before any storage access', async () => {
  const res = await onRequestPost({
    request: new Request('https://kollection.tv/api/admin/upload-image', { method: 'POST', headers: { Origin: 'https://other.example' } }),
    env: { GITHUB_TOKEN: 'test', assertSameOrigin: true, IMAGES: { async put() { throw new Error('Must not write R2'); } } },
  });
  assert.equal(res.status, 403);
});

test('the unchanged public URL serves replacement bytes instead of the old edge copy', async (t) => {
  const url = 'https://kollection.tv/images/World/Brazil/backdrop.webp';
  const key = 'images/World/Brazil/backdrop.webp';
  let currentBody = 'old-backdrop';
  let downloads = 0;
  const cachedObjects = new Map();
  const originalCache = globalThis.caches;
  globalThis.caches = { default: {
    async match(request) { return cachedObjects.get(request.url)?.clone(); },
    async put(request, response) { cachedObjects.set(request.url, response.clone()); },
  } };
  t.after(() => { globalThis.caches = originalCache; });

  function object() {
    const etag = createHash('md5').update(currentBody).digest('hex');
    return {
      etag,
      httpEtag: `"${etag}"`,
      body: currentBody,
      writeHttpMetadata(headers) { headers.set('Content-Type', 'image/webp'); },
    };
  }
  const env = { IMAGES: {
    async head(path) { assert.equal(path, key); return object(); },
    async get(path) { assert.equal(path, key); downloads += 1; return object(); },
  } };
  async function load(target = url, method = 'GET') {
    const pending = [];
    const request = new Request(target, { method });
    const response = await serveImage({ request, env, waitUntil(p) { pending.push(p); } });
    await Promise.all(pending);
    assert.equal(request.url, target, 'internal caching must not alter the public request URL');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Location'), null);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
    return response;
  }

  const first = await load();
  const originalEtag = first.headers.get('etag');
  assert.equal(await first.text(), 'old-backdrop');
  const firstHit = await load();
  assert.equal(firstHit.headers.get('X-Kollection-Cache'), 'HIT');
  assert.equal(await firstHit.text(), 'old-backdrop');
  assert.equal(downloads, 1);

  currentBody = 'new-backdrop';
  const replacement = await load();
  assert.equal(await replacement.text(), 'new-backdrop');
  assert.notEqual(replacement.headers.get('etag'), originalEtag);
  const replacementHit = await load();
  assert.equal(replacementHit.headers.get('X-Kollection-Cache'), 'HIT');
  assert.equal(await replacementHit.text(), 'new-backdrop');
  assert.equal(downloads, 2, 'unchanged requests should still benefit from edge caching');
  assert.equal(cachedObjects.size, 2, 'old cache entry can remain without being served');

  const head = await load(url, 'HEAD');
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('etag'), replacement.headers.get('etag'));
  const legacy = await load(`${url}?v=%22old-version%22`);
  assert.equal(await legacy.text(), 'new-backdrop', 'previously shared versioned links must keep working');
});
