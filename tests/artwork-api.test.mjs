import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('one selected backdrop writes and returns exactly one image with its upload time', async (t) => {
  const writes = [];
  const trees = [];
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
  globalThis.caches = { default: { async delete() { return true; } } };
  t.after(() => { globalThis.caches = originalCache; });
  const form = new FormData();
  form.set('category', 'World');
  form.set('folder', 'South Korea');
  form.set('backdrop', new Blob(['webp-test'], { type: 'image/webp' }), 'backdrop.webp');
  const request = new Request('https://kollection.tv/api/admin/upload-image', {
    method: 'POST', headers: { Origin: 'https://kollection.tv' }, body: form,
  });
  const pending = [];
  const res = await onRequestPost({ request, env: { GITHUB_TOKEN: 'test', IMAGES: { async put(...args) { writes.push(args); } } }, waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'images/World/South Korea/backdrop.webp');
  assert.equal(data.files.length, 1);
  assert.equal(writes[0][2].customMetadata['artwork-uploaded-at'], data.files[0].uploaded);
  assert.equal(trees[0].tree.length, 1);
  assert.equal(trees[0].tree[0].path, writes[0][0]);
});

test('artwork listing reads dates and retains metadata-aware pagination', async () => {
  const key = 'images/World/South Korea/backdrop.webp';
  const res = await onRequestGet({
    request: new Request('https://kollection.tv/api/admin/images?cursor=page2'),
    env: { IMAGES: {
      async list(options) {
        assert.deepEqual(options.include, ['customMetadata']);
        assert.equal(options.cursor, 'page2');
        return { objects: [{ key, size: 12, etag: 'abc', uploaded: '2026-09-30T02:58:00Z' }], truncated: true, cursor: 'page3' };
      },
      async get() { return { async json() { return { version: 1, images: { [key]: { size: 12, etag: 'abc', uploaded: '2026-09-15T10:00:00Z' } } }; } }; },
    } },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.images[0].uploaded, '2026-09-15T10:00:00.000Z');
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
