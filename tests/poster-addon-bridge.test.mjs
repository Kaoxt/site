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
