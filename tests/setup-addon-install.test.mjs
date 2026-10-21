import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const copy = value => JSON.parse(JSON.stringify(value));
const required = [
  { url: 'https://metadata.example/stremio/new/manifest.json', name: 'AIOMetadata' },
  { url: 'https://kollection.tv/api/posters-addon/new/manifest.json', name: 'Kollection Poster Bridge' },
  { url: 'https://bingecat.com/personal/manifest.json', name: 'Bingecat' },
];

function addonHarness(initial = [], options = {}) {
  let rows = copy(initial);
  const writes = [];
  const reads = [];
  const state = { profileId: 3, addonProfileId: 3, backup: {} };
  const context = vm.createContext({
    URL, URLSearchParams, state, CFG: { nuvioApiBase: 'https://api.nuvio.test' },
    setupUpdatesExisting: true, authHeaders: () => ({}), readResponse: response => response.json(),
    getProfileSyncClientId: () => 'kollection-web-test',
    getProfiles: async () => [{ id: 3, name: 'My profile', usesPrimaryAddons: Boolean(options.shared) }],
    fetch: async (url, init) => {
      reads.push({ url, init });
      return new Response(JSON.stringify(options.invalidList ? {} : rows));
    },
    rpc: async (name, payload) => {
      if (name === 'get_sync_owner') return 'sync-owner';
      assert.equal(name, 'sync_push_addons');
      writes.push(copy(payload));
      if (options.rejectWrite) throw new Error('Nuvio sync failed');
      if (!options.dropWrite) rows = copy(payload.p_addons);
    },
  });
  vm.runInContext(section('  function storedBoolean(', '  const steps =') +
    section('  function normalizeUrl(', '  function normalizeHost(') +
    section('  async function getSyncOwner(', '  async function pullCollections('), context);
  return { state, writes, reads, context, rows: () => rows, run: code => vm.runInContext(code, context) };
}

test('fresh setup syncs every required add-on together and preserves unrelated settings', async () => {
  const existing = { url: 'https://personal.example/manifest.json', name: 'My add-on', enabled: false, sort_order: 7 };
  const h = addonHarness([existing]);
  h.context.required = required;
  await h.run('installAddons(required)');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].p_profile_id, 3);
  assert.equal(h.writes[0].p_origin_client_id, 'kollection-web-test');
  assert.deepEqual(h.rows()[0], existing);
  assert.deepEqual(h.rows().slice(1).map(x => [x.name, x.enabled, x.sort_order]), [
    ['AIOMetadata', true, 8], ['Kollection Poster Bridge', true, 9], ['Bingecat', true, 10],
  ]);
  assert.equal(h.reads.length, 2, 'installation must read back the saved rows');
  for (const read of h.reads) {
    assert.equal(read.init.cache, 'no-store');
    assert.equal(new URL(read.url).searchParams.get('user_id'), 'eq.sync-owner');
  }
});

test('an existing disabled add-on is enabled without duplicating its base URL', async () => {
  const h = addonHarness([{ url: 'https://metadata.example/stremio/new/', name: 'My metadata name', enabled: false, sort_order: 4 }]);
  h.context.required = required.slice(0, 1);
  await h.run('installAddons(required)');
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].enabled, true);
  assert.equal(h.rows()[0].name, 'My metadata name');
  assert.equal(h.rows()[0].sort_order, 4);
  assert.notEqual(h.run('addonUrlKey("https://metadata.example/a/manifest.json?config=one")'),
    h.run('addonUrlKey("https://metadata.example/a/manifest.json?config=two")'));
});

test('a successful write response with missing add-ons is not installation success', async () => {
  const h = addonHarness([], { dropWrite: true });
  h.context.required = required;
  await assert.rejects(h.run('installAddons(required)'), /has not confirmed AIOMetadata.*Setup is not complete/);
});

test('disabled read-back and invalid server lists cannot pass verification', async () => {
  const h = addonHarness([{ ...required[0], enabled: false }]);
  h.context.required = required.slice(0, 1);
  await assert.rejects(h.run('verifyInstalledAddons(required)'), /installed and enabled/);
  const invalid = addonHarness([], { invalidList: true });
  await assert.rejects(invalid.run('listAddons()'), /invalid add-on list/);
  assert.equal(invalid.writes.length, 0);
});

test('a rejected sync does not fall back to an unverified database insert', async () => {
  const h = addonHarness([], { rejectWrite: true });
  h.context.required = required;
  await assert.rejects(h.run('installAddons(required)'), /Nuvio sync failed/);
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.rows(), []);
});

test('profile inheritance is refreshed before installing and verified on the effective profile', async () => {
  const h = addonHarness([], { shared: true });
  h.context.required = required;
  await h.run('refreshAddonProfile();');
  assert.equal(h.state.addonProfileId, 1);
  assert.equal(h.state.backup, null);
  await h.run('installAddons(required)');
  assert.equal(h.writes[0].p_profile_id, 1);
  assert.ok(h.reads.every(read => new URL(read.url).searchParams.get('profile_id') === 'eq.1'));
});

test('retiring old metadata uses sync and keeps required and unrelated add-ons', async () => {
  const old = { url: 'https://metadata.example/stremio/old/manifest.json', name: 'AIOMetadata', enabled: true };
  const personal = { url: 'https://personal.example/manifest.json', name: 'Personal', enabled: false };
  const h = addonHarness([old, personal, ...required.map(item => ({ ...item, enabled: true }))]);
  h.context.previous = [old]; h.context.required = required;
  await h.run('removeStaleAddons(previous, required, "AIOMetadata")');
  assert.equal(h.writes.length, 1);
  assert.equal(h.rows().length, 4);
  assert.equal(h.rows()[0].enabled, false);
  await h.run('verifyInstalledAddons(required)');
});

function installationHarness(failAt = '') {
  const events = [];
  const state = { backup: {}, collectionPack: [], aiNeededCatalogs: [{}], previousAiMetadataAddons: [], profileId: 3, installCompleted: false };
  const context = vm.createContext({
    state, setupUpdatesExisting: true, window: {}, jsonClone: copy, loading: () => {},
    ensureSelectedProfileEligible: async () => true, refreshAddonProfile: async () => {},
    provisionAiMetadata: async () => ({ installs: [required[0]], firstManifestId: 'aio-metadata' }),
    provisionPosterBridges: async () => ({ installs: [required[1]], routes: {} }),
    selectedCollectionPack: () => [{ id: 'collection' }], shouldInstallBingecat: () => false, activeBingecatSelection: () => null,
    installAddons: async () => { events.push('addons'); if (failAt === 'install') throw new Error('unconfirmed'); },
    repointAioSources: () => {}, rewriteBingecatInCollections: () => {}, stableCollectionJson: JSON.stringify,
    pushCollections: async () => events.push('collections'), pullCollections: async () => [{ id: 'collection' }],
    removePreviousAiMetadataAddons: async () => events.push('cleanup-aio'),
    removePreviousPosterBridgeAddons: async () => events.push('cleanup-bridge'),
    verifyInstalledAddons: async () => { events.push('verify-final'); if (failAt === 'final') throw new Error('unconfirmed'); },
  });
  vm.runInContext(section('  async function installEverything()', '  function formatSetupDate('), context);
  return { state, events, run: () => vm.runInContext('installEverything()', context) };
}

test('unconfirmed add-ons stop collection changes and completion', async () => {
  const h = installationHarness('install');
  await assert.rejects(h.run(), /unconfirmed/);
  assert.deepEqual(h.events, ['addons']);
  assert.equal(h.state.installCompleted, false);
});

test('completion checks required add-ons again after collections and cleanup', async () => {
  for (const failAt of ['', 'final']) {
    const h = installationHarness(failAt);
    if (failAt) await assert.rejects(h.run(), /unconfirmed/);
    else await h.run();
    assert.deepEqual(h.events, ['addons', 'collections', 'cleanup-aio', 'cleanup-bridge', 'verify-final']);
    assert.equal(h.state.installCompleted, !failAt);
  }
});

function provisionHarness(manifest) {
  const catalog = { id: 'mdblist.123', type: 'movie', name: 'Movies' };
  const state = { aiNeededCatalogs: [catalog], aiBaseConfig: {} };
  const context = vm.createContext({
    state, loading: () => {}, jsonClone: copy, normalizeUrl: x => x, normalizeHost: x => x,
    normalizeAioCatalogType: x => x, aioCatalogRouteKey: (id, type) => `${id}|${type}`,
    chooseAiHost: async () => 'https://metadata.example/',
    chunkAioCatalogs: catalogs => [{ host: 'https://metadata.example/', catalogs }],
    prepareAiConfig: (base, catalogs) => ({ catalogs }), saveAioConfig: async () => ({ installUrl: required[0].url }),
    fetchAddonManifest: async () => { if (manifest instanceof Error) throw manifest; return manifest; },
  });
  vm.runInContext(section('  async function provisionAiMetadata()', '  function encodePosterBridgeValue('), context);
  return { state, run: () => vm.runInContext('provisionAiMetadata()', context) };
}

test('unreadable, empty, or incomplete AIOMetadata manifests cannot create fictional catalog routes', async () => {
  for (const manifest of [new Error('host unavailable'), { id: 'aio-metadata', catalogs: [] }, { id: 'aio-metadata', catalogs: [{ id: 'other', type: 'movie' }] }]) {
    const h = provisionHarness(manifest);
    await assert.rejects(h.run(), /host unavailable|no usable catalogs|did not expose/);
    assert.equal(h.state.aiInstalls, undefined);
  }
  const h = provisionHarness({ id: 'aio-metadata', catalogs: [{ id: 'mdblist.123_movie', type: 'movie' }] });
  const result = await h.run();
  assert.equal(result.installs[0].catalogs[0].id, 'mdblist.123_movie');
});
