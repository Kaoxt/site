import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import { onRequest } from '../functions/api/posters-v2/[[path]].js';
import { acquirePosterLease, cachedPosterJson, singleFlight } from '../functions/_lib/poster-cache.js';
import { acquirePosterRenderSlot } from '../functions/_lib/poster-safety.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const webp = text => new Uint8Array([...Buffer.from('RIFF0000WEBP'), ...Buffer.from(text)]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.writes = 0; }
  prepare(sql) {
    const execute = args => ({
      run: async () => { this.writes++; return { meta: { changes: Number(this.sqlite.prepare(sql).run(...args).changes) } }; },
      first: async () => this.sqlite.prepare(sql).get(...args) || null,
      all: async () => ({ results: this.sqlite.prepare(sql).all(...args) }),
    });
    return { ...execute([]), bind: (...args) => execute(args) };
  }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  used() { return this.sqlite.prepare('SELECT renders FROM poster_usage_daily').get()?.renders || 0; }
}

class Bucket {
  constructor() { this.objects = new Map(); this.reads = []; this.failWrites = false; }
  async put(key, input, options = {}) {
    if (this.failWrites) throw new Error('storage down');
    const body = new Uint8Array(await new Response(input).arrayBuffer());
    this.objects.set(key, { body, ...options, uploaded: new Date() });
  }
  async get(key) {
    this.reads.push(key);
    const record = this.objects.get(key);
    if (!record) return null;
    return {
      body: new Response(record.body).body,
      customMetadata: { ...record.customMetadata },
      uploaded: record.uploaded, httpEtag: '"test-etag"',
      json: async () => JSON.parse(Buffer.from(record.body).toString()),
      writeHttpMetadata(headers) {
        headers.set('content-type', record.httpMetadata?.contentType || 'image/webp');
        if (record.httpMetadata?.cacheControl) headers.set('cache-control', record.httpMetadata.cacheControl);
      },
    };
  }
  posters() { return [...this.objects].filter(([key]) => key.startsWith('poster-cache/')); }
  expirePosters(hours = 24) {
    for (const [, record] of this.posters()) {
      const generatedAt = Date.now() - hours * 3600000;
      record.customMetadata.generatedAt = String(generatedAt);
      record.customMetadata.freshUntil = String(Date.now() - 3600000);
      record.customMetadata.trendDay = new Date(generatedAt).toISOString().slice(0, 10);
    }
  }
}

class EdgeCache {
  constructor() { this.objects = new Map(); }
  async match(request) {
    const record = this.objects.get(request.url);
    return record ? new Response(record.body, { headers: record.headers }) : undefined;
  }
  async put(request, response) {
    this.objects.set(request.url, { body: await response.arrayBuffer(), headers: [...response.headers] });
  }
  clear() { this.objects.clear(); }
}

function harness(overrides = {}) {
  const bucket = new Bucket(), edge = new EdgeCache(), db = new D1();
  const env = { IMAGES: bucket, DB: db, TMDB_API_KEY: 'test-tmdb-secret', MDBLIST_API_KEY: 'test-mdb-secret', POSTERS_RENDERER_AUTH_TOKEN: 'test-render-secret', ...overrides };
  const jobs = [];
  const count = { find: 0, details: 0, trend: 0, ratings: 0, quality: 0, render: 0, fallback: 0 };
  const h = { bucket, edge, db, env, jobs, count, payloads: [], qualityAuth: [], qualityResolution: '2160p', renderStatus: 200, ratingStatus: 200 };
  globalThis.caches = { default: edge };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'api.themoviedb.org') {
      if (url.pathname.includes('/find/')) {
        count.find++;
        return Response.json({ movie_results: [{ id: 27205 }], tv_results: [{ id: 27205 }] });
      }
      if (url.pathname.includes('/trending/')) {
        count.trend++;
        return Response.json({ results: [{ id: 27205 }, { id: 603 }, { id: 550 }] });
      }
      count.details++;
      const id = Number(url.pathname.split('/').at(-1));
      return Response.json({ id, title: 'Test title', name: 'Test series', poster_path: '/poster.jpg', vote_average: 8.1,
        genres: [{ name: 'Drama' }], images: { posters: [], logos: [] }, external_ids: { imdb_id: 'tt1375666' } });
    }
    if (url.hostname === 'api.mdblist.com') {
      count.ratings++;
      await pause(5);
      return h.ratingStatus === 200 ? Response.json({ score_average: 86, score: 85, ratings: [{ source: 'imdb', value: 8.8 }] })
        : new Response('unavailable', { status: h.ratingStatus });
    }
    if (url.hostname === 'aiostreams.example') {
      count.quality++;
      h.qualityAuth.push(options.headers?.authorization || options.headers?.Authorization || '');
      return Response.json({
        success: true,
        data: {
          results: [{ parsedFile: { resolution: h.qualityResolution } }],
          errors: {},
        },
      });
    }
    if (url.hostname === 'poster-renderer.kollection.tv') {
      count.render++;
      const payload = JSON.parse(options.body);
      h.payloads.push(payload);
      if (h.renderHook) await h.renderHook();
      if (h.renderStatus !== 200) return new Response('private provider error', { status: h.renderStatus });
      const body = h.invalidImage ? 'not an image' : webp(JSON.stringify(payload));
      return new Response(body, { headers: { 'content-type': 'image/webp', 'x-kollection-renderer': 'test-renderer' } });
    }
    if (url.hostname === 'image.tmdb.org') {
      count.fallback++;
      return new Response(webp('plain-art'), { headers: { 'content-type': 'image/webp' } });
    }
    throw new Error('Unexpected upstream ' + url.hostname);
  };
  h.context = (id = 'tt1375666', query = '', method = 'GET') => ({
    env,
    request: new Request(`https://kollection.tv/api/posters-v2/movie/${id}.webp?source=smart&tags=genre,rating,trend&ratingSource=average${query}`, { method }),
    waitUntil(promise) { jobs.push(Promise.resolve(promise)); },
  });
  h.request = (id, query, method) => onRequest(h.context(id, query, method));
  h.flush = async () => { while (jobs.length) await Promise.all(jobs.splice(0)); };
  h.seed = async (id = 'tt1375666') => {
    const response = await h.request(id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-kollection-poster-fallback'), null);
    const body = await response.arrayBuffer();
    await h.flush();
    return body;
  };
  return h;
}

test('IMDb-addressed R2 hit needs no credentials, metadata calls, or budget writes', async () => {
  const h = harness(); const expected = await h.seed();
  const counts = { ...h.count }, writes = h.db.writes;
  h.edge.clear(); delete h.env.TMDB_API_KEY; delete h.env.POSTERS_RENDERER_AUTH_TOKEN;
  const response = await h.request();
  assert.equal(response.headers.get('x-kollection-persistent-cache'), 'HIT');
  assert.deepEqual(await response.arrayBuffer(), expected);
  await h.flush();
  assert.deepEqual(h.count, counts); assert.equal(h.db.writes, writes);
});

test('legacy TMDB-keyed image is reused and backfilled under its IMDb ID', async () => {
  const h = harness(); await h.seed('27205'); h.edge.clear();
  for (const [, record] of h.bucket.posters()) {
    delete record.customMetadata.generatedAt; delete record.customMetadata.freshUntil;
  }
  const response = await h.request(); await response.arrayBuffer(); await h.flush();
  assert.equal(h.count.render, 1); assert.equal(h.count.find, 1);
  assert.equal(h.bucket.posters().length, 2);
  h.edge.clear(); await (await h.request()).arrayBuffer(); await h.flush();
  assert.equal(h.count.find, 1);
});

test('stale overlay returns immediately and refreshes behind the response', async () => {
  const h = harness(); const old = await h.seed(); h.bucket.expirePosters(); h.edge.clear();
  const began = deferred(), finish = deferred();
  h.renderHook = async () => { began.resolve(); await finish.promise; };
  const response = await h.request();
  assert.equal(response.headers.get('x-kollection-stale'), '1');
  assert.match(response.headers.get('cache-control'), /max-age=15/);
  assert.deepEqual(await response.arrayBuffer(), old);
  await began.promise; finish.resolve(); await h.flush();
  const fresh = await h.request(); await fresh.arrayBuffer(); await h.flush();
  assert.equal(fresh.headers.get('x-kollection-stale'), '0');
  assert.equal(h.count.render, 2); assert.equal(h.count.fallback, 0);
});

test('a failed refresh preserves the overlay and uses a retry cooldown', async () => {
  const h = harness(); const old = await h.seed(); h.bucket.expirePosters(); h.edge.clear(); h.renderStatus = 503;
  assert.deepEqual(await (await h.request()).arrayBuffer(), old); await h.flush();
  assert.equal(h.count.render, 2);
  assert.deepEqual(await (await h.request()).arrayBuffer(), old); await h.flush();
  assert.equal(h.count.render, 2); assert.equal(h.count.fallback, 0);
  assert.equal(h.bucket.posters().every(([, record]) => Buffer.from(record.body).equals(Buffer.from(old))), true);
});

test('rating outage cannot replace a good overlay with missing ratings', async () => {
  const h = harness(); const old = await h.seed(); h.bucket.expirePosters(); h.edge.clear();
  h.db.sqlite.exec('DELETE FROM poster_rating_cache'); h.ratingStatus = 503;
  assert.deepEqual(await (await h.request()).arrayBuffer(), old); await h.flush();
  assert.equal(h.count.render, 1); assert.equal(h.count.fallback, 0);
  assert.equal(h.db.used(), 1);
});

test('20 identical cold requests share one render, rating lookup, and budget reservation', async () => {
  const h = harness(); h.renderHook = () => pause(30);
  const responses = await Promise.all(Array.from({ length: 20 }, () => h.request()));
  const bodies = await Promise.all(responses.map(response => response.arrayBuffer())); await h.flush();
  assert.equal(h.count.render, 1); assert.equal(h.count.find, 1); assert.equal(h.count.ratings, 1);
  assert.equal(h.db.used(), 1); assert.equal(h.count.fallback, 0);
  assert.ok(bodies.every(body => Buffer.from(body).equals(Buffer.from(bodies[0]))));
});

test('quality tag uses real cached AIOStreams resolution only when enabled', async () => {
  const h = harness({
    POSTERS_AIOSTREAMS_URL: 'https://aiostreams.example',
    POSTERS_AIOSTREAMS_AUTH: 'dXNlcjpwYXNz',
  });

  await (await h.request('27205')).arrayBuffer();
  await h.flush();
  assert.equal(h.count.quality, 0);

  const first = h.context('27205');
  const firstUrl = new URL(first.request.url);
  firstUrl.searchParams.set('tags', 'genre,rating,quality');
  first.request = new Request(firstUrl);
  await (await onRequest(first)).arrayBuffer();
  await h.flush();
  assert.equal(h.count.quality, 1);
  assert.equal(h.payloads.at(-1).quality, '4K');
  assert.equal(h.qualityAuth.at(-1), 'Basic dXNlcjpwYXNz');

  const second = h.context('27205');
  const secondUrl = new URL(second.request.url);
  secondUrl.searchParams.set('tags', 'genre,rating,quality');
  secondUrl.searchParams.set('overlayColor', '#222222');
  second.request = new Request(secondUrl);
  await (await onRequest(second)).arrayBuffer();
  await h.flush();
  assert.equal(h.count.quality, 1);
  assert.equal(h.payloads.at(-1).quality, '4K');
});

test('different overlay variants reuse metadata but keep separate rendered outputs', async () => {
  const h = harness(); await h.seed(); h.edge.clear();
  const before = { ...h.count };
  const context = h.context(); const url = new URL(context.request.url);
  url.searchParams.set('tags', 'genre,rating,trend,age'); context.request = new Request(url);
  await (await onRequest(context)).arrayBuffer(); await h.flush();
  assert.equal(h.count.render, before.render + 1);
  assert.equal(h.count.find, before.find); assert.equal(h.count.details, before.details);
  assert.equal(h.count.trend, before.trend); assert.equal(h.count.ratings, before.ratings);
});

test('concurrent rating-source variants share the record without sharing the wrong score', async () => {
  const h = harness();
  const average = h.context(), imdb = h.context();
  const url = new URL(imdb.request.url); url.searchParams.set('ratingSource', 'imdb'); imdb.request = new Request(url);
  const responses = await Promise.all([onRequest(average), onRequest(imdb)]);
  await Promise.all(responses.map(response => response.arrayBuffer())); await h.flush();
  assert.equal(h.count.render, 2); assert.equal(h.count.ratings, 1);
  assert.deepEqual(h.payloads.map(payload => payload.rating).sort(), ['8.6', '8.8']);
});

test('a catalog burst waits for renderer capacity without dropping overlays', async () => {
  const h = harness({ POSTERS_MAX_CONCURRENT_RENDERS: '1' }); h.renderHook = () => pause(30);
  const responses = await Promise.all(['27205', '603', '550', '155', '278'].map(id => h.request(id)));
  await Promise.all(responses.map(response => response.arrayBuffer())); await h.flush();
  assert.equal(h.count.render, 5); assert.equal(h.count.fallback, 0); assert.equal(h.db.used(), 5);
  assert.ok(responses.every(response => !response.headers.has('x-kollection-poster-fallback')));
});

test('queue timeout does not consume budget, and release is idempotent', async () => {
  const h = harness({ POSTERS_MAX_CONCURRENT_RENDERS: '1' });
  const first = await acquirePosterRenderSlot(h.env, h.context().request);
  const second = await acquirePosterRenderSlot(h.env, h.context().request, { waitMs: 10 });
  assert.equal(second.allowed, false); assert.equal(second.reason, 'render-queue-timeout');
  assert.equal(h.db.used(), 1); first.release(); first.release();
  const third = await acquirePosterRenderSlot(h.env, h.context().request);
  assert.equal(third.allowed, true); third.release(); assert.equal(h.db.used(), 2);
});

test('D1 lease is exclusive, expires, and an old owner cannot release its replacement', async () => {
  const h = harness();
  const first = await acquirePosterLease(h.env, 'same-variant');
  assert.equal(first.acquired, true);
  assert.equal((await acquirePosterLease({ ...h.env }, 'same-variant')).acquired, false);
  h.db.sqlite.exec('UPDATE poster_render_leases SET expires_at = 0');
  const replacement = await acquirePosterLease(h.env, 'same-variant'); assert.equal(replacement.acquired, true);
  await first.release();
  assert.equal((await acquirePosterLease(h.env, 'same-variant')).acquired, false);
  await replacement.release();
  const last = await acquirePosterLease(h.env, 'same-variant'); assert.equal(last.acquired, true); await last.release();
});

test('render budget remains enforced and cold plain-art fallback is never cached', async () => {
  const h = harness({ POSTERS_MAX_DAILY_RENDERS: '1' }); await h.seed('27205');
  const blocked = await h.request('603'); await blocked.arrayBuffer(); await h.flush();
  assert.equal(blocked.headers.get('x-kollection-poster-fallback'), 'hard-stop-budget');
  assert.equal(blocked.headers.get('cache-control'), 'no-store'); assert.equal(blocked.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(h.count.render, 1); assert.equal(h.db.used(), 1);
  assert.ok(!h.bucket.posters().some(([key]) => key.includes('/603/')));
  await (await h.request('27205')).arrayBuffer(); await h.flush(); assert.equal(h.count.render, 1);
});

test('invalid renderer output is not stored as a WebP overlay', async () => {
  const h = harness(); h.invalidImage = true;
  const response = await h.request(); await response.arrayBuffer(); await h.flush();
  assert.equal(response.headers.get('x-kollection-poster-fallback'), 'renderer-invalid-image');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(h.bucket.posters().length, 0);
});

test('HEAD preserves the cached GET body and invalid IDs never reach upstream', async () => {
  const h = harness(); const expected = await h.seed();
  const head = await h.request(undefined, '', 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.deepEqual(await (await h.request()).arrayBuffer(), expected);
  const invalid = await h.request('{imdb_id}'); assert.equal(invalid.status, 400);
  assert.equal(h.count.render, 1); await h.flush();
});

test('explicit empty tags stay disabled instead of restoring defaults', async () => {
  const h = harness();
  const context = h.context();
  const url = new URL(context.request.url);
  url.searchParams.set('tags', '');
  context.request = new Request(url);
  const response = await onRequest(context);
  await response.arrayBuffer();
  await h.flush();

  assert.equal(response.status, 200);
  assert.equal(h.count.trend, 0);
  assert.equal(h.count.ratings, 0);
  assert.equal(h.payloads.at(-1).trend, '');
  assert.equal(h.payloads.at(-1).rating, '');
  assert.equal(h.payloads.at(-1).genre, '');
});

test('metadata storage contains no API keys and survives an edge-cache eviction', async () => {
  const h = harness(); let loads = 0;
  const load = async () => ({ id: ++loads });
  assert.deepEqual(await cachedPosterJson(h.context(), 'test-metadata', 3600, load), { id: 1 }); await h.flush();
  h.edge.clear(); assert.deepEqual(await cachedPosterJson(h.context(), 'test-metadata', 3600, load), { id: 1 }); await h.flush();
  assert.equal(loads, 1);
  for (const [key, value] of h.bucket.objects) assert.ok(!`${key}${Buffer.from(value.body)}`.includes('test-tmdb-secret'));
});

test('metadata expiry and rejected single-flight tasks are retried cleanly', async () => {
  const h = harness(); let loads = 0;
  const loader = async () => ++loads;
  await cachedPosterJson(h.context(), 'expires', 3600, loader); await h.flush(); h.edge.clear();
  for (const [key, value] of h.bucket.objects) {
    if (key.startsWith('poster-data/')) {
      const record = JSON.parse(Buffer.from(value.body)); record.expiresAt = 0;
      value.body = Buffer.from(JSON.stringify(record));
    }
  }
  assert.equal(await cachedPosterJson(h.context(), 'expires', 3600, loader), 2); await h.flush();
  await assert.rejects(singleFlight(h.env, 'failure', () => { throw new Error('expected'); }));
  assert.equal(await singleFlight(h.env, 'failure', () => 42), 42);
});

test('poster responses still succeed when persistence is temporarily unavailable', async () => {
  const h = harness(); h.bucket.failWrites = true;
  const response = await h.request('27205'); await response.arrayBuffer(); await h.flush();
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-kollection-poster-fallback'), null);
  assert.equal(h.count.render, 1);
});

test('legacy stale poster returns before its alias migration and refresh finish', async () => {
  const h = harness(); const old = await h.seed('27205'); h.bucket.expirePosters(); h.edge.clear();
  const began = deferred(), finish = deferred();
  h.renderHook = async () => { began.resolve(); await finish.promise; };
  const response = await h.request();
  assert.equal(response.headers.get('x-kollection-stale'), '1');
  assert.deepEqual(await response.arrayBuffer(), old);
  await began.promise; finish.resolve(); await h.flush();
  h.edge.clear(); const fresh = await h.request(); await fresh.arrayBuffer(); await h.flush();
  assert.equal(fresh.headers.get('x-kollection-stale'), '0');
  assert.equal(h.count.render, 2); assert.equal(h.count.find, 1);
});

test('IMDb and TMDB requests coalesce to one canonical render', async () => {
  const h = harness(); h.renderHook = () => pause(30);
  const responses = await Promise.all([h.request('tt1375666'), h.request('27205')]);
  await Promise.all(responses.map(response => response.arrayBuffer())); await h.flush();
  assert.equal(h.count.render, 1); assert.equal(h.db.used(), 1); assert.equal(h.count.ratings, 1);
});

test('independent Worker scopes wait on the shared lease and receive the finished overlay', async () => {
  const h = harness(); h.renderHook = () => pause(25);
  const other = h.context('27205');
  other.env = { ...h.env, IMAGES: { get: key => h.bucket.get(key), put: (...args) => h.bucket.put(...args) } };
  const responses = await Promise.all([h.request('27205'), onRequest(other)]);
  const bodies = await Promise.all(responses.map(response => response.arrayBuffer())); await h.flush();
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(h.count.render, 1); assert.equal(h.db.used(), 1); assert.equal(h.count.fallback, 0);
});

test('stale trend tags cannot be retained beyond their bounded stale window', async () => {
  const h = harness(); await h.seed('27205'); h.edge.clear(); h.env.POSTERS_RENDERING_ENABLED = '0';
  for (const [, record] of h.bucket.posters()) record.customMetadata.freshUntil = String(Date.now() - 73 * 3600000);
  const response = await h.request('27205'); await response.arrayBuffer(); await h.flush();
  assert.equal(response.headers.get('x-kollection-poster-fallback'), 'rendering-disabled');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('series IDs and localized variants cannot reuse the movie overlay', async () => {
  const h = harness(); await h.seed();
  const context = h.context(); const url = new URL(context.request.url);
  url.pathname = url.pathname.replace('/movie/', '/series/'); url.searchParams.set('language', 'es');
  context.request = new Request(url);
  const response = await onRequest(context); await response.arrayBuffer(); await h.flush();
  assert.equal(h.count.render, 2); assert.equal(h.payloads.at(-1).trend, '#1 Hoy');
  assert.equal(response.headers.get('x-kollection-overlay-language'), 'es');
  assert.ok(h.bucket.posters().some(([key]) => key.includes('/tv/')));
});

test('cancelled capacity wait does not leak slots or reserve budget', async () => {
  const h = harness({ POSTERS_MAX_CONCURRENT_RENDERS: '1' });
  const slot = await acquirePosterRenderSlot(h.env, h.context().request);
  const controller = new AbortController();
  const pending = acquirePosterRenderSlot(h.env, h.context().request, { signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/); assert.equal(h.db.used(), 1); slot.release();
  const next = await acquirePosterRenderSlot(h.env, h.context().request);
  assert.equal(next.allowed, true); next.release();
});
