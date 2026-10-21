import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');

function harness(bingecatSnapshot, catalogModeSnapshot) {
  let checks = [];
  const requests = [];
  const listeners = new Map();
  const window = {
    location: { search: '', href: 'https://kollection.tv/set-up-collection' },
    KollectionBingecatSetup: bingecatSnapshot ? { snapshot: bingecatSnapshot } : undefined,
    KollectionAioExport: catalogModeSnapshot ? { getCatalogModeOnly: catalogModeSnapshot } : undefined,
    KollectionNuvioAuth: { getSession: async () => ({ authenticated: true }) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent() {},
  };
  vm.runInNewContext(source, {
    window,
    document: {
      readyState: 'complete',
      querySelector: selector => selector === '.section-checkbox' ? checks[0] || null : null,
      querySelectorAll: selector => selector === '.section-checkbox' ? checks : [],
      addEventListener() {},
    },
    URL, URLSearchParams,
    history: { replaceState() {} },
    setTimeout() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (url, options) => {
      requests.push({ url, method: options.method, ...JSON.parse(options.body) });
      return { ok: true, json: async () => ({ collection: { id: 'saved-1' } }) };
    },
  });
  return { api: window.KollectionSavedSetup, requests, listeners, setChecks: value => { checks = value; } };
}

const options = { name: 'Latest', profileId: 1, profileName: 'Main' };

test('final setup can prepare and save when section checkboxes are absent', async () => {
  const h = harness();
  h.listeners.get('kollection:collection-selection-changed')({ detail: {
    selectedCollectionGroupIds: ['movies', 'series'],
    selectedCollectionFolderIds: { movies: ['popular'] },
  } });
  await h.api.prepareInstall(options);
  await h.api.saveApplied(options);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[1].method, 'PATCH');
  assert.equal(h.requests[1].markApplied, true);
  for (const request of h.requests) {
    assert.deepEqual(request.config.selectedCollectionGroupIds, ['movies', 'series']);
    assert.deepEqual(request.config.selectedCollectionFolderIds, { movies: ['popular'] });
  }
});

test('captures every visible section and preserves choices after leaving the selection step', async () => {
  const h = harness();
  h.setChecks([{ value: 'movies', checked: true }, { value: 'series', checked: false }, { value: 'world', checked: true }]);
  await h.api.prepareInstall(options);
  h.setChecks([]);
  await h.api.saveApplied(options);
  for (const request of h.requests) {
    assert.deepEqual(request.config.knownCollectionGroupIds, ['movies', 'series', 'world']);
    assert.deepEqual(request.config.selectedCollectionGroupIds, ['movies', 'world']);
  }
});

test('captures an intentionally cleared selection', async () => {
  const h = harness();
  h.setChecks([{ value: 'movies', checked: false }]);
  await h.api.prepareInstall(options);
  assert.deepEqual(h.requests[0].config.selectedCollectionGroupIds, []);
  assert.deepEqual(h.requests[0].config.knownCollectionGroupIds, ['movies']);
});


test('saves Bingecat catalog kinds with the selected manifest and clears them when skipped', async () => {
  let bingecat = { bingecatManifestUrl: 'https://bingecat.com/stremio/personal/manifest.json', bingecatSkipped: false,
    bingecatCatalogs: [{ id: 'personal-ai', type: 'movie', kind: 'ai', position: 0 }] };
  const h = harness(() => bingecat);
  await h.api.prepareInstall(options);
  assert.equal(h.requests[0].config.bingecatCatalogs[0].kind, 'ai');
  assert.equal(h.requests[0].config.bingecatManifestUrl, bingecat.bingecatManifestUrl);
  bingecat = { bingecatManifestUrl: '', bingecatSkipped: true, bingecatCatalogs: [] };
  await h.api.saveApplied(options);
  assert.equal(h.requests[1].config.bingecatManifestUrl, '');
  assert.equal(h.requests[1].config.bingecatSkipped, true);
  assert.deepEqual(h.requests[1].config.bingecatCatalogs, []);
});

test('saved setup retains both a selected subset and an explicit empty Bingecat selection', async () => {
  const url = 'https://bingecat.com/stremio/personal/manifest.json';
  const bingecat = { bingecatManifestUrl: url, bingecatSkipped: false,
    bingecatSelection: { manifestUrl: url, keys: ['ai:movie', 'latest:series'] } };
  const h = harness(() => bingecat);
  await h.api.prepareInstall(options);
  bingecat.bingecatSelection.keys = [];
  await h.api.saveApplied(options);
  assert.deepEqual(h.requests[0].config.bingecatSelection, { manifestUrl: url, keys: ['ai:movie', 'latest:series'] });
  assert.deepEqual(h.requests[1].config.bingecatSelection, { manifestUrl: url, keys: [] });
});

test('catalogs-only choice is saved from wizard state even after leaving the AIOMetadata step', async () => {
  let catalogOnly = true;
  const h = harness(undefined, () => catalogOnly);
  await h.api.prepareInstall(options);
  assert.equal(h.requests[0].config.aiCatalogModeOnly, true);
  catalogOnly = false;
  await h.api.saveApplied(options);
  assert.equal(h.requests[1].config.aiCatalogModeOnly, false);
});
