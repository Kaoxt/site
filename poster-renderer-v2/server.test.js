import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import { dynamicAccent, renderPoster } from './server.js';
import { resetPosterSourceMemoryForTests, SOURCE_CACHE_VERSION } from './source-loader.js';
import { sourceCacheOutbound } from './src/source-cache-outbound.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPosterSourceMemoryForTests();
});

async function fixture() {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#346890' } }).jpeg().toBuffer();
  globalThis.fetch = async () => new Response(image, { headers: { 'content-type': 'image/jpeg' } });
}

test('dynamic accent handles raw canvases and responds to artwork color', async () => {
  const options = { raw: { width: 64, height: 64, channels: 3 } };
  const red = await sharp({ create: { ...options.raw, background: '#c02020' } }).raw().toBuffer();
  const blue = await sharp({ create: { ...options.raw, background: '#2040c0' } }).raw().toBuffer();
  const a = await dynamicAccent(red, options), b = await dynamicAccent(blue, options);
  assert.match(a, /^#[0-9a-f]{6}$/);
  assert.match(b, /^#[0-9a-f]{6}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, '#2f2d33');
  assert.notEqual(b, '#2f2d33');
});

test('smart and original outputs keep visible top tags and genre/rating at portrait size', async () => {
  await fixture();
  for (const smartLayout of [true, false]) {
    const body = { posterPath: '/fixture.jpg', smartLayout, overlayColor: 'dynamic' };
    const plain = await renderPoster(body);
    const tagged = await renderPoster({ ...body, trend: '#4 Today', genre: 'Drama', rating: '8.6' });
    const meta = await sharp(tagged).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 500); assert.equal(meta.height, 750);
    for (const region of [{ left: 110, top: 0, width: 280, height: 65 }, { left: 20, top: 650, width: 460, height: 62 }]) {
      const before = await sharp(plain).extract(region).raw().toBuffer();
      const after = await sharp(tagged).extract(region).raw().toBuffer();
      const changed = after.reduce((n, value, index) => n + (Math.abs(value - before[index]) > 15 ? 1 : 0), 0);
      assert.ok(changed > 300, 'overlay must remain visible in its intended region');
    }
  }
});

test('upstream-only artwork does not fetch a title logo and provider errors remain failures', async () => {
  await fixture();
  const fetchImage = globalThis.fetch, calls = [];
  globalThis.fetch = async url => { calls.push(url); return fetchImage(); };
  await renderPoster({ sourceUrl: 'https://art.example/poster.jpg', smartLayout: true, overlayOnly: true, logoPath: '/logo.png', title: 'A title', genre: 'Comedy', rating: '7.5' });
  assert.deepEqual(calls, ['https://art.example/poster.jpg']);
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(renderPoster({ posterPath: '/missing.jpg' }), /503/);
});


class SourceBucket {
  constructor() { this.objects = new Map(); }
  async get(key) {
    const record = this.objects.get(key);
    if (!record) return null;
    return {
      body: new Response(record.body).body,
      arrayBuffer: async () => record.body.slice().buffer,
      customMetadata: { ...record.customMetadata },
      httpMetadata: { ...record.httpMetadata },
      uploaded: record.uploaded,
    };
  }
  async put(key, input, options = {}) {
    const body = new Uint8Array(await new Response(input).arrayBuffer());
    this.objects.set(key, {
      body,
      customMetadata: { ...(options.customMetadata || {}) },
      httpMetadata: { ...(options.httpMetadata || {}) },
      uploaded: new Date(),
    });
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
  async list() {
    return {
      objects: [...this.objects].map(([key, record]) => ({
        key,
        customMetadata: { ...record.customMetadata },
      })),
      truncated: false,
    };
  }
}

test('shared source art persists with a sliding 30-day retention window', async () => {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  const bucket = new SourceBucket();
  let originFetches = 0;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).hostname, 'image.tmdb.org');
    originFetches++;
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  };

  const path = '/sliding-source.jpg';
  const hash = createHash('sha256').update(`${SOURCE_CACHE_VERSION}|${path}`).digest('hex');
  const request = () => new Request(`http://source-cache.internal/v1/${hash}.bin`, {
    headers: { 'x-tmdb-poster-path': path },
  });
  const jobs = [];
  const context = { waitUntil(promise) { jobs.push(Promise.resolve(promise)); } };
  const env = { SOURCE_ART: bucket };

  const first = await sourceCacheOutbound(request(), env, context);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-source-cache'), 'MISS');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), image);
  await Promise.all(jobs.splice(0));
  assert.equal(originFetches, 1);

  const key = `poster-source/${SOURCE_CACHE_VERSION}/${hash}.bin`;
  const record = bucket.objects.get(key);
  record.customMetadata.lastAccessedAt = String(Date.now() - 13 * 60 * 60 * 1000);
  record.customMetadata.retentionUntil = String(Date.now() + 60 * 60 * 1000);

  globalThis.fetch = async () => { throw new Error('origin should not be used on an R2 hit'); };
  const second = await sourceCacheOutbound(request(), env, context);
  assert.equal(second.headers.get('x-source-cache'), 'R2_HIT');
  await second.arrayBuffer();
  await Promise.all(jobs.splice(0));

  const refreshed = bucket.objects.get(key);
  assert.ok(Number(refreshed.customMetadata.retentionUntil) > Date.now() + 29 * 24 * 60 * 60 * 1000);
  assert.equal(originFetches, 1);
});

test('renderer reuses source bytes from its LRU while overlays still render', async () => {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#315f87' } }).jpeg().toBuffer();
  let sharedReads = 0;
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'source-cache.internal') throw new Error('unexpected origin fetch');
    sharedReads++;
    const now = Date.now();
    return new Response(image, {
      headers: {
        'content-type': 'image/jpeg',
        'x-source-cache': 'MISS',
        'x-source-fetched-at': String(now),
        'x-source-last-accessed-at': String(now),
        'x-source-retention-until': String(now + 30 * 24 * 60 * 60 * 1000),
      },
    });
  };

  const first = await renderPoster({ posterPath: '/lru-source.jpg', trend: '#3 Today', genre: 'Drama', rating: '8.4' });
  assert.equal(first.kollectionSourceCache, 'MISS');
  assert.equal(sharedReads, 1);

  globalThis.fetch = async () => { throw new Error('LRU hit should not perform another fetch'); };
  const second = await renderPoster({ posterPath: '/lru-source.jpg', trend: 'New', genre: 'Drama', rating: '8.4', quality: '4K' });
  assert.equal(second.kollectionSourceCache, 'MEMORY_HIT');
  assert.equal(sharedReads, 1);
  const meta = await sharp(second).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 500);
  assert.equal(meta.height, 750);

  const without = await sharp(first).extract({ left: 110, top: 0, width: 280, height: 65 }).raw().toBuffer();
  const withChangedTag = await sharp(second).extract({ left: 110, top: 0, width: 280, height: 65 }).raw().toBuffer();
  const changed = withChangedTag.reduce((n, value, index) => n + (Math.abs(value - without[index]) > 15 ? 1 : 0), 0);
  assert.ok(changed > 150, 'overlay tag region should still change when using cached source art');
});
