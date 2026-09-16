import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from '../functions/api/posters-addon/[[path]].js';

function enc(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

test('collection poster bridge has a unique hidden manifest and rewrites folder posters directly', async () => {
  const config = {
    v: 3,
    upstream: 'https://aio.example/stremio/user-1/manifest.json',
    source: 'smart',
    tags: ['genre', 'rating', 'trend'],
    trendDetails: ['rank'],
    ratingSource: 'average',
    collectionOnly: true,
    preserveSource: false,
  };
  const token = enc(JSON.stringify(config));
  const wrappedCatalogId = 'kp0_' + enc('mdblist.123');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === config.upstream) {
      return Response.json({
        id: 'aiometadata',
        version: '1.0.0',
        name: 'AIOMetadata',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        catalogs: [{ id: 'mdblist.123', type: 'movie', name: 'List', showInHome: true }],
      });
    }
    if (url.includes('/catalog/movie/mdblist.123.json')) {
      return Response.json({
        metas: [{
          id: 'tmdb:27205',
          type: 'movie',
          name: 'Inception',
          poster: 'https://image.tmdb.org/t/p/w500/original.jpg',
        }],
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  try {
    const manifestResponse = await onRequest({
      request: new Request(`https://kollection.tv/api/posters-addon/${token}/manifest.json`),
    });
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.match(manifest.id, /^tv\.kollection\.posters\./);
    assert.notEqual(manifest.id, 'aiometadata');
    assert.equal(manifest.catalogs[0].id, wrappedCatalogId);
    assert.equal(manifest.catalogs[0].showInHome, false);

    const catalogResponse = await onRequest({
      request: new Request(`https://kollection.tv/api/posters-addon/${token}/catalog/movie/${wrappedCatalogId}.json`),
    });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    const poster = catalog.metas[0].poster;
    assert.match(poster, /\/api\/posters-v2\/movie\/tmdb%3A27205\.webp/);
    assert.match(poster, /v=24/);
    assert.match(poster, /cv=4/);
    assert.doesNotMatch(poster, /sourceUrl=/);
    assert.doesNotMatch(poster, /overlayOnly=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('collection bridge applies Better Posters to plain passthrough folder artwork', async () => {
  const config = {
    v: 5,
    upstream: 'https://aio.example/stremio/user-bp/manifest.json',
    collectionOnly: true,
    passthroughPosters: true,
    betterPostersConfigId: 'b160001',
  };
  const token = enc(JSON.stringify(config));
  const wrappedCatalogId = 'kp0_' + enc('mdblist.190242');
  const originalFetch = globalThis.fetch;
  const waited = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === config.upstream) {
      return Response.json({
        id: 'aiometadata',
        version: '1.0.0',
        name: 'AIOMetadata',
        resources: ['catalog', 'meta'],
        types: ['movie'],
        catalogs: [{ id: 'mdblist.190242', type: 'movie', name: 'Trending' }],
      });
    }
    if (url.includes('/catalog/movie/mdblist.190242.json')) {
      return Response.json({
        metas: [{
          id: 'tmdb:12345',
          type: 'movie',
          name: 'Plain Poster',
          poster: 'https://image.tmdb.org/t/p/w500/plain.jpg',
        }],
      });
    }
    if (url.startsWith('https://kollection.tv/bp/')) return new Response(null, { status: 302 });
    throw new Error('Unexpected fetch: ' + url);
  };

  try {
    const response = await onRequest({
      request: new Request(`https://kollection.tv/api/posters-addon/${token}/catalog/movie/${wrappedCatalogId}.json`),
      waitUntil(promise) { waited.push(promise); },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(
      body.metas[0].poster,
      'https://kollection.tv/bp/b160001/movie/tmdb%3A12345.webp'
    );
    await Promise.allSettled(waited);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collection bridge preserves an upstream Better Posters URL already using the active config', async () => {
  const config = {
    v: 5,
    upstream: 'https://aio.example/stremio/user-bp-existing/manifest.json',
    collectionOnly: true,
    passthroughPosters: true,
    betterPostersConfigId: 'b160001',
  };
  const token = enc(JSON.stringify(config));
  const wrappedCatalogId = 'kp0_' + enc('mdblist.190242');
  const existing = 'https://kollection.tv/bp/b160001/movie/tmdb%3A12345.webp';
  const originalFetch = globalThis.fetch;
  const waited = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === config.upstream) {
      return Response.json({
        id: 'aiometadata',
        version: '1.0.0',
        name: 'AIOMetadata',
        resources: ['catalog'],
        types: ['movie'],
        catalogs: [{ id: 'mdblist.190242', type: 'movie', name: 'Trending' }],
      });
    }
    if (url.includes('/catalog/movie/mdblist.190242.json')) {
      return Response.json({ metas: [{ id: 'tmdb:12345', type: 'movie', poster: existing }] });
    }
    if (url === existing) return new Response(null, { status: 302 });
    throw new Error('Unexpected fetch: ' + url);
  };
  try {
    const response = await onRequest({
      request: new Request(`https://kollection.tv/api/posters-addon/${token}/catalog/movie/${wrappedCatalogId}.json`),
      waitUntil(promise) { waited.push(promise); },
    });
    const body = await response.json();
    assert.equal(body.metas[0].poster, existing);
    await Promise.allSettled(waited);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
