import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import { dynamicAccent, renderPoster, fitTitleImage, titlePlacement, resetLogoCacheForTests } from './server.js';
import { loadTmdbPosterSource, resetPosterSourceMemoryForTests, SOURCE_CACHE_VERSION } from './source-loader.js';
import { sourceCacheOutbound } from './src/source-cache-outbound.js';

const originalFetch = globalThis.fetch;
test('uneven transparent logo padding cannot shift the visible title', async () => {
  const logo = await sharp({create:{width:300,height:80,channels:4,background:'#ffffff'}}).png().toBuffer();
  const padded = await sharp(logo).extend({top:110,bottom:10,left:70,right:10,background:'#00000000'}).png().toBuffer();
  const fitted = await fitTitleImage(logo);
  const fittedPadded = await fitTitleImage(padded);
  assert.equal(fitted.width, fittedPadded.width);
  assert.equal(fitted.height, fittedPadded.height);
  assert.deepEqual(titlePlacement(fitted), titlePlacement(fittedPadded));
  assert.ok(Math.abs(titlePlacement(fitted).left + fitted.width / 2 - 250) <= .5);
  assert.ok(Math.abs(titlePlacement(fitted).top + fitted.height / 2 - 552) <= 1);
  assert.deepEqual(fitted.buffer, fittedPadded.buffer);
});

test('text title and padded logo render centered in the same title zone', async () => {
  const image = await sharp({create:{width:342,height:513,channels:3,background:'#102030'}}).jpeg().toBuffer();
  const logo = await sharp({create:{width:300,height:80,channels:4,background:'#ffffff'}})
    .extend({top:110,bottom:10,left:70,right:10,background:'#00000000'}).png().toBuffer();
  globalThis.fetch = async (url, options = {}) => {
    const kind = options.headers?.['x-tmdb-asset-type'];
    return new Response(kind === 'logo' ? logo : image, { headers: { 'content-type': 'image/png' } });
  };
  const base = await renderPoster({posterPath:'/title-test.jpg',smartLayout:true});
  for (const title of [{logoPath:'/logo.png'}, {title:'A Movie Title'}, {title:'A Much Longer Movie Title That Wraps Onto Multiple Lines'}]) {
    const tagged = await renderPoster({posterPath:'/title-test.jpg',smartLayout:true,...title});
    const before = await sharp(base).raw().toBuffer({resolveWithObject:true});
    const after = await sharp(tagged).raw().toBuffer();
    let minX=500,maxX=0,minY=750,maxY=0;
    for(let y=440;y<675;y++)for(let x=0;x<500;x++) {
      const i=(y*500+x)*before.info.channels;
      if(after[i]>100 && after[i]-before.data[i]>60) {minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
    assert.ok(maxX>minX);
    assert.ok(Math.abs((minX+maxX)/2-250)<3, JSON.stringify(title));
    assert.ok(Math.abs((minY+maxY)/2-552)<3, JSON.stringify(title));
  }
});
test('Worker exports the proxy required for container outbound interception', async () => {
  const entry = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
  assert.match(entry, /export\s*\{\s*ContainerProxy\s*\}\s*from\s*['"]@cloudflare\/containers['"]/);
});

test('source cache failure still produces a poster with visible overlays', async () => {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#346890' } }).jpeg().toBuffer();
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (new URL(url).hostname === 'source-cache.internal') throw new Error('proxy unavailable');
    assert.equal(url, 'https://image.tmdb.org/t/p/w342/fallback.jpg');
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  };
  const plain = await renderPoster({ posterPath: '/fallback.jpg' });
  assert.equal(plain.kollectionSourceCache, 'ORIGIN_FALLBACK');
  const tagged = await renderPoster({ posterPath: '/fallback.jpg', trend: '#3 Today', genre: 'Drama', rating: '8.4' });
  assert.equal(calls.length, 2, 'short memory cache reuses fallback artwork');
  assert.equal((await sharp(tagged).metadata()).format, 'webp');
  for (const region of [{ left: 110, top: 0, width: 280, height: 65 }, { left: 20, top: 650, width: 460, height: 62 }]) {
    const before = await sharp(plain).extract(region).raw().toBuffer();
    const after = await sharp(tagged).extract(region).raw().toBuffer();
    const changed = after.reduce((n, value, i) => n + (Math.abs(value - before[i]) > 15 ? 1 : 0), 0);
    assert.ok(changed > 300, 'fallback artwork must retain visible overlays');
  }
});

test('missing source bucket does not discard successfully fetched artwork', async () => {
  const image = Buffer.from('source bytes');
  globalThis.fetch = async () => new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  const path = '/missing-bucket.jpg';
  const hash = createHash('sha256').update(`${SOURCE_CACHE_VERSION}|${path}`).digest('hex');
  const response = await sourceCacheOutbound(new Request(`http://source-cache.internal/v1/${hash}.bin`, {
    headers: { 'x-tmdb-poster-path': path },
  }), {}, { containerId: 'test', className: 'PosterRenderer' });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPosterSourceMemoryForTests();
  resetLogoCacheForTests();
});

test('concurrent variants share one cold artwork fetch and retry after failures', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response('source bytes', { headers: { 'content-type': 'image/jpeg' } });
  };
  const sources = await Promise.all(Array.from({ length: 8 }, () => loadTmdbPosterSource('/concurrent.jpg')));
  assert.equal(calls, 1);
  assert.ok(sources.every(source => source.input.equals(sources[0].input)));

  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(loadTmdbPosterSource('/retry.jpg'), /offline/);
  globalThis.fetch = async () => new Response('recovered');
  assert.equal((await loadTmdbPosterSource('/retry.jpg')).input.toString(), 'recovered');
});

test('concurrent and later overlays reuse the exact fitted title logo', async () => {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#102030' } }).jpeg().toBuffer();
  const logo = await sharp({ create: { width: 300, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer();
  let logoCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.headers?.['x-tmdb-asset-type'] === 'logo') {
      logoCalls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(logo, { headers: { 'content-type': 'image/png' } });
    }
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  };
  const body = { posterPath: '/shared.jpg', smartLayout: true, logoPath: '/shared-logo.png' };
  const images = await Promise.all(Array.from({ length: 4 }, () => renderPoster(body)));
  assert.equal(logoCalls, 1);
  for (const output of images) assert.deepEqual(output, images[0]);
  await renderPoster({ ...body, genre: 'Drama' });
  assert.equal(logoCalls, 1);
  resetLogoCacheForTests();
  const memoryBacked = await renderPoster(body);
  assert.equal(logoCalls, 1, 'fitted-logo eviction still reuses shared source memory');
  resetLogoCacheForTests();
  resetPosterSourceMemoryForTests();
  const uncached = await renderPoster(body);
  assert.equal(logoCalls, 2);
  assert.ok(memoryBacked.equals(images[0]));
  assert.ok(uncached.equals(images[0]), 'cached and freshly processed logos must produce identical image bytes');
});

test('unavailable title logos are retried instead of caching a missing title', async () => {
  const image = await sharp({ create: { width: 342, height: 513, channels: 3, background: '#102030' } }).jpeg().toBuffer();
  const logo = await sharp({ create: { width: 300, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer();
  let sharedLogoCalls = 0;
  let directLogoCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.headers?.['x-tmdb-asset-type'] === 'logo') {
      sharedLogoCalls++;
      return sharedLogoCalls === 1
        ? new Response('', { status: 503 })
        : new Response(logo, { headers: { 'content-type': 'image/png' } });
    }
    if (String(url).includes('image.tmdb.org/t/p/w500/retry-logo.png')) {
      directLogoCalls++;
      return directLogoCalls === 1
        ? new Response('', { status: 503 })
        : new Response(logo, { headers: { 'content-type': 'image/png' } });
    }
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } });
  };
  const body = { posterPath: '/retry-logo-poster.jpg', smartLayout: true, logoPath: '/retry-logo.png', title: 'Fallback' };
  const fallback = await renderPoster(body);
  const recovered = await renderPoster(body);
  await renderPoster(body);
  assert.equal(sharedLogoCalls, 2);
  assert.equal(directLogoCalls, 1);
  assert.ok(!fallback.equals(recovered));
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

test('larger top tags stay readable and split cleanly when quality is enabled', async () => {
  await fixture();
  const plain = await renderPoster({ posterPath: '/polish.jpg', smartLayout: true });
  const trendOnly = await renderPoster({ posterPath: '/polish.jpg', smartLayout: true, trend: '#5 Today' });
  const split = await renderPoster({ posterPath: '/polish.jpg', smartLayout: true, trend: 'Christopher Nolan Film', quality: '4K · DV', audio: 'Atmos' });

  const changedPixels = async (a, b, region, threshold = 15) => {
    const before = await sharp(a).extract(region).raw().toBuffer();
    const after = await sharp(b).extract(region).raw().toBuffer();
    return after.reduce((n, value, index) => n + (Math.abs(value - before[index]) > threshold ? 1 : 0), 0);
  };

  assert.ok(await changedPixels(plain, trendOnly, { left: 80, top: 0, width: 340, height: 64 }) > 800);
  assert.ok(await changedPixels(plain, trendOnly, { left: 80, top: 70, width: 340, height: 8 }) < 350,
    'larger top tag should still end cleanly below roughly 65px');

  assert.ok(await changedPixels(plain, split, { left: 10, top: 0, width: 275, height: 64 }) > 700,
    'trend tag should occupy the left side when quality is enabled');
  assert.ok(await changedPixels(plain, split, { left: 300, top: 0, width: 190, height: 64 }) > 350,
    'quality tag should occupy the right side');
  assert.ok(await changedPixels(plain, split, { left: 345, top: 70, width: 145, height: 50 }) > 220,
    'larger audio tag should render beneath quality');
  assert.ok(await changedPixels(plain, split, { left: 279, top: 0, width: 12, height: 62 }) < 220,
    'long spotlight label should leave a clean gap before quality');
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
  // Match Cloudflare's real OutboundHandlerContext: no waitUntil method.
  const context = { containerId: 'test', className: 'PosterRenderer' };
  const env = { SOURCE_ART: bucket };

  const first = await sourceCacheOutbound(request(), env, context);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-source-cache'), 'MISS');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), image);
  assert.equal(originFetches, 1);

  const key = `poster-source/${SOURCE_CACHE_VERSION}/${hash}.bin`;
  const record = bucket.objects.get(key);
  record.customMetadata.lastAccessedAt = String(Date.now() - 8 * 24 * 60 * 60 * 1000);
  record.customMetadata.retentionUntil = String(Date.now() + 60 * 60 * 1000);

  globalThis.fetch = async () => { throw new Error('origin should not be used on an R2 hit'); };
  const second = await sourceCacheOutbound(request(), env, context);
  assert.equal(second.headers.get('x-source-cache'), 'R2_HIT');
  await second.arrayBuffer();

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
