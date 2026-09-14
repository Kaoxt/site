import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import { dynamicAccent, renderPoster } from './server.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

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
  await assert.rejects(renderPoster({ posterPath: '/missing.jpg' }), /Source image fetch failed: 503/);
});
