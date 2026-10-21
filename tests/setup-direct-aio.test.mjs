import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const accessSource = await readFile(new URL('../set-up-collection/aiometadata-access.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const copy = value => JSON.parse(JSON.stringify(value));
const catalog = (id, type = 'movie') => ({ id, type });
const install = (id, catalogs) => ({ url: `https://aio.example/stremio/${id}/manifest.json`, addonId: 'aio-metadata', name: 'AIOMetadata', catalogs });
const bridge = { url: 'https://kollection.tv/api/posters-addon/legacy/manifest.json', name: 'Kollection Poster Bridge', enabled: true };
const folder = (addonId, catalogId, type = 'movie') => ({ id: 'folder', coverImageUrl: 'custom.webp', sources: [{ provider: 'addon', addonId, catalogId, type, genre: 'None' }], catalogSources: [{ addonId, catalogId, type, genre: 'None' }] });

function guardHarness({ current = [], update = false, shared = [], manifests = {}, existing = [] } = {}) {
  const state = {
    profileId: 3, addonProfileId: shared.length ? 1 : 3,
    profiles: [{ id: 3, usesPrimaryAddons: Boolean(shared.length) }, ...shared.map(item => ({ id: item.id, usesPrimaryAddons: true }))],
    previousAiMetadataAddons: update ? current.filter(item => item.name === 'AIOMetadata') : [],
    previousPosterBridgeAddons: update ? current.filter(item => item.name === 'Kollection Poster Bridge') : [],
    existingCollections: existing,
  };
  const context = vm.createContext({
    state, setupUpdatesExisting: update, URL, normalizeUrl: value => value,
    listAddons: async () => copy(current),
    pullCollections: async id => copy(shared.find(item => item.id === id).collections),
    fetchAddonManifest: async url => {
      if (!manifests[url]) throw new Error('unavailable');
      return copy(manifests[url]);
    },
  });
  vm.runInContext(section('  function storedBoolean(', '  const steps =') +
    section('  function addonUrlKey(', '  async function refreshAddonProfile(') +
    section('  function isKollectionAiMetadataAddon(', '  async function removeStaleAddons(') +
    section('  function collectionAddonIds(', '  function repointAioSources('), context);
  return { state, context, run: installs => { context.ai = { installs }; return vm.runInContext('prepareDirectAioInstallation(ai)', context); } };
}

test('multiple direct AIOMetadata installs accept distinct catalogs and movie/series pairs', async () => {
  const h = guardHarness();
  await h.run([install('a', [catalog('list', 'movie')]), install('b', [catalog('list', 'series')])]);
  await assert.rejects(h.run([install('a', [catalog('list')]), install('b', [catalog('list')])]), /also enabled in another configuration/);
});

test('existing enabled configurations cannot silently take over a required catalog', async () => {
  const old = { ...install('old', []), name: 'My custom metadata name', enabled: true };
  const manifests = { [old.url]: { id: 'aio-metadata', catalogs: [catalog('list')] } };
  await assert.rejects(guardHarness({ current: [old], manifests }).run([install('new', [catalog('list')])]), /only one enabled AIOMetadata/);
  await guardHarness({ current: [{ ...old, enabled: false }], manifests }).run([install('new', [catalog('list')])]);
  await guardHarness({ current: [old], manifests }).run([install('new', [catalog('different')])]);
  await guardHarness({ current: [old], manifests: { [old.url]: { id: 'another-addon', catalogs: [catalog('list')] } } }).run([install('new', [catalog('list')])]);
});

test('updates retire old direct and bridge routes while preserving routes used by another profile', async () => {
  const old = { ...install('old', []), enabled: true };
  const current = [old, bridge];
  const own = guardHarness({ current, update: true });
  await own.run([install('new', [catalog('list')])]);
  assert.equal(own.state.previousAiMetadataAddons.length, 1);
  assert.equal(own.state.previousPosterBridgeAddons.length, 1);

  const shared = [{ id: 1, collections: [{ folders: [folder('tv.kollection.posters.old', 'kp0_old')] }] }];
  const manifests = {
    [old.url]: { id: 'aio-metadata', catalogs: [catalog('list')] },
    [bridge.url]: { id: 'tv.kollection.posters.old', catalogs: [catalog('kp0_old')] },
  };
  const h = guardHarness({ current, update: true, shared, manifests });
  await h.run([install('new', [catalog('list')])]);
  assert.equal(h.state.previousAiMetadataAddons.length, 1);
  assert.equal(h.state.previousPosterBridgeAddons.length, 0, 'another profile still needs the bridge');
});

test('an overlapping AIOMetadata configuration used by a shared profile is kept and reported', async () => {
  const old = { ...install('old', []), enabled: true };
  const h = guardHarness({ current: [old], update: true,
    shared: [{ id: 1, collections: [{ folders: [folder('aio-metadata', 'list')] }] }],
    manifests: { [old.url]: { id: 'aio-metadata', catalogs: [catalog('list')] } },
  });
  await assert.rejects(h.run([install('new', [catalog('list')])]), /profile with its own add-ons/);
});

test('an update recognizes renamed metadata serving the replaced collection', async () => {
  const old = { ...install('old', []), name: 'My Midnight metadata', enabled: true };
  const manifests = { [old.url]: { id: 'aio-metadata', catalogs: [catalog('streaming.amp_movie'),
    { ...catalog('search'), extra: [{ name: 'search', isRequired: true }] }] } };
  const h = guardHarness({ current: [old], update: true, manifests,
    existing: [{ folders: [folder('aio-metadata', 'streaming.amp_movie')] }] });
  await h.run([install('new', [catalog('streaming.amp_movie')])]);
  assert.deepEqual(copy(h.state.previousAiMetadataAddons), [old]);
});

test('renamed metadata with unrelated catalogs is preserved and identified in the conflict', async () => {
  const old = { ...install('old-private-install-token', []), name: 'Personal metadata', enabled: true };
  const h = guardHarness({ current: [old], update: true,
    existing: [{ folders: [folder('aio-metadata', 'streaming.amp_movie')] }],
    manifests: { [old.url]: { id: 'aio-metadata', catalogs: [catalog('streaming.amp_movie'), catalog('personal-list')] } },
  });
  await assert.rejects(h.run([install('new', [catalog('streaming.amp_movie')])]), error => {
    assert.match(error.message, /Personal metadata/);
    assert.match(error.message, /aio\.example/);
    assert.match(error.message, /add-on profile 3/);
    assert.doesNotMatch(error.message, /old-private-install-token/);
    return true;
  });
  assert.equal(h.state.previousAiMetadataAddons.length, 0);
});

test('shared profiles using different catalogs do not falsely protect a retiring installation', async () => {
  const old = { ...install('old', []), enabled: true };
  const h = guardHarness({ current: [old], update: true,
    shared: [{ id: 1, collections: [{ folders: [folder('aio-metadata', 'other-list')] }] }],
    manifests: { [old.url]: { id: 'aio-metadata', catalogs: [catalog('streaming.amp_movie')] } },
  });
  await h.run([install('new', [catalog('streaming.amp_movie')])]);
  assert.equal(h.state.previousAiMetadataAddons.length, 1);
});

test('incomplete collection sources cannot claim ownership of a renamed installation', async () => {
  const old = { ...install('personal', []), name: 'Personal metadata', enabled: true };
  const h = guardHarness({ current: [old], update: true,
    existing: [{ folders: [{ sources: [{ addonId: 'aio-metadata' }] }] }],
    manifests: { [old.url]: { id: 'aio-metadata', catalogs: [catalog('list')] } },
  });
  await assert.rejects(h.run([install('new', [catalog('list')])]), /Personal metadata/);
  assert.equal(h.state.previousAiMetadataAddons.length, 0);
});

test('a shared profile still protects an installation when it uses another catalog from that installation', async () => {
  const old = { ...install('old', []), enabled: true };
  const h = guardHarness({ current: [old], update: true,
    shared: [{ id: 1, collections: [{ folders: [folder('aio-metadata', 'shared-list')] }] }],
    manifests: { [old.url]: { id: 'aio-metadata', catalogs: [catalog('list'), catalog('shared-list')] } },
  });
  await assert.rejects(h.run([install('new', [catalog('list')])]), /still used by Nuvio profile 1/);
});

test('disabled manifest catalogs do not collide, while hidden enabled catalogs still do', async () => {
  const old = { ...install('personal', []), name: 'Personal', enabled: true };
  const manifests = { [old.url]: { id: 'aio-metadata', catalogs: [{ ...catalog('list'), enabled: false }] } };
  await guardHarness({ current: [old], manifests }).run([install('new', [catalog('list')])]);
  manifests[old.url].catalogs[0] = { ...catalog('list'), showInHome: false };
  await assert.rejects(guardHarness({ current: [old], manifests }).run([install('new', [catalog('list')])]), /also enabled/);
});

test('disabled previous installations do not require a live manifest or block shared-profile updates', async () => {
  const old = { ...install('offline', []), enabled: 'false' };
  const h = guardHarness({ current: [old], update: true,
    shared: [{ id: 1, collections: [{ folders: [folder('aio-metadata', 'list')] }] }],
  });
  await h.run([install('new', [catalog('list')])]);
  assert.equal(h.state.previousAiMetadataAddons.length, 0);
});

test('retrying a shared-profile update still retires an old installation after its catalogs change', async () => {
  const old = { ...install('old', []), enabled: true };
  const manifests = { [old.url]: { id: 'aio-metadata', catalogs: [catalog('old-list')] } };
  const h = guardHarness({ current: [old], update: true, manifests,
    shared: [{ id: 1, collections: [{ folders: [folder('aio-metadata', 'old-list')] }] }],
  });
  await h.run([install('new', [catalog('new-list')])]);
  assert.equal(h.state.previousAiMetadataAddons.length, 0);
  manifests[old.url].catalogs = [catalog('new-list')];
  await h.run([install('new', [catalog('new-list')])]);
  assert.equal(h.state.previousAiMetadataAddons.length, 1);
});

function flowHarness({ update = false, failConfirmation = false, posters = false, catalogOnly = false } = {}) {
  const legacyId = 'kp0_' + Buffer.from('mdblist.one_movie').toString('base64url');
  const pack = [{ id: 'group', title: 'My group', folders: [folder(update ? 'tv.kollection.posters.old' : 'aio-metadata', update ? legacyId : 'mdblist.one')] }];
  const events = [], savedConfigs = [], downloads = [];
  const state = {
    profileId: 3, addonProfileId: 3, profiles: [], backup: {}, collectionPack: pack,
    previousAiMetadataAddons: [], previousPosterBridgeAddons: update ? [bridge] : [],
    existingCollections: [], aiNeededCatalogs: [{ id: 'mdblist.one', type: 'movie', displayType: 'movie' }],
    aiBaseConfig: {}, aiCatalogModeOnly: catalogOnly, betterPostersEnabled: posters, betterPostersSettings: {},
    aiCustomConfig: null, aiExportConfigs: [],
  };
  let rows = update ? [bridge] : [], synced = [];
  const context = vm.createContext({
    state, setupUpdatesExisting: update, URL, TextDecoder, Uint8Array, atob,
    window: { KollectionBetterPostersSettings: { normalize: x => x, applyToAioConfig(config) { config.customPosterUrlPattern = 'https://kollection.tv/bp/b1600sf/{type}/{id}.webp'; } } },
    jsonClone: copy, normalizeUrl: x => x, normalizeHost: x => x, loading() {},
    ensureSelectedProfileEligible: async () => true, refreshAddonProfile: async () => {},
    chooseAiHost: async () => 'https://aio.example/',
    chunkAioCatalogs: catalogs => [{ host: 'https://aio.example/', catalogs }],
    saveAioConfig: async (host, config) => { savedConfigs.push(copy(config)); return { userUUID: '12d56b78-1234-4123-a123-123456789abc', installUrl: install('new', []).url }; },
    fetchAddonManifest: async url => {
      assert.equal(url, install('new', []).url, 'new setup never requests a bridge');
      return { id: 'aio-metadata', name: 'AIOMetadata', catalogs: [catalog('mdblist.one_movie')] };
    },
    listAddons: async () => copy(rows),
    installAddons: async required => { events.push('addons'); rows.push(...copy(required)); },
    selectedCollectionPack: () => pack, shouldInstallBingecat: () => false, activeBingecatSelection: () => null,
    rewriteBingecatInCollections() {}, mergeCollections: (existing, next) => next,
    pushCollections: async value => { events.push('collections'); synced = copy(value); },
    pullCollections: async () => failConfirmation ? [] : copy(synced),
    removePreviousAiMetadataAddons: async () => events.push('cleanup-aio'),
    removePreviousPosterBridgeAddons: async next => { assert.deepEqual(copy(next), []); events.push('cleanup-bridge'); rows = rows.filter(item => item.name !== bridge.name); },
    verifyInstalledAddons: async required => { events.push('verify'); assert.ok(required.every(item => rows.some(row => row.url === item.url))); },
    downloadJson: (name, data) => downloads.push({ name, data: copy(data) }), alert: message => { throw new Error(message); },
  });
  context.document = { addEventListener() {} };
  vm.runInContext(accessSource, context);
  vm.runInContext(section('  function storedBoolean(', '  const steps =') +
    section('  function addonUrlKey(', '  async function refreshAddonProfile(') +
    section('  function isKollectionAiMetadataAddon(', '  async function removeStaleAddons(') +
    section('  function stableCollectionJson(', '  async function pushCollections(') +
    section('  function normalizeAioCatalogType(', '  function synthesizeCatalog(') +
    section('  function prepareAiConfig(', '  async function saveAioConfig(') +
    section('  async function provisionAiMetadata()', '  function bingecatCatalogRank(') +
    section('  async function installEverything()', '  function formatSetupDate(') +
    "function isBingecatSource(s) { return String(s?.addonId || '').startsWith('com.aicat.'); }", context);
  return { state, context, events, savedConfigs, downloads, rows: () => rows, synced: () => synced,
    run: code => vm.runInContext(code, context) };
}

for (const update of [false, true]) for (const posters of [false, true]) for (const catalogOnly of [false, true]) {
  test(`${update ? 'legacy migration' : 'fresh setup'} installs and exports matching direct routes with Better Posters ${posters ? 'on' : 'off'} and catalogs only ${catalogOnly ? 'on' : 'off'}`, async () => {
    const h = flowHarness({ update, posters, catalogOnly });
    await h.run('installEverything()');
    assert.equal(h.state.installCompleted, true);
    assert.deepEqual(h.rows().map(item => item.name), ['AIOMetadata']);
    const installed = h.synced()[0].folders[0];
    assert.equal(installed.coverImageUrl, 'custom.webp');
    for (const list of ['sources', 'catalogSources']) {
      assert.equal(installed[list][0].addonId, 'aio-metadata');
      assert.equal(installed[list][0].catalogId, 'mdblist.one_movie');
      assert.equal(installed[list][0].genre, 'None');
    }
    await h.run('downloadCurrentNuvioCollections(); downloadCurrentAioExports();');
    assert.deepEqual(h.downloads[0].data, h.synced(), 'Nuvio imports the exact installed array');
    assert.deepEqual(h.downloads[1].data, h.savedConfigs[0], 'AIOMetadata imports the exact provisioned config');
    assert.equal(Boolean(h.savedConfigs[0].customPosterUrlPattern), posters);
    assert.equal(h.savedConfigs[0].catalogModeOnly, catalogOnly);
    assert.doesNotMatch(JSON.stringify(h.downloads), /posters-addon|tv\.kollection\.posters\.|kp0_/);
  });
}

test('failed collection read-back retains legacy add-ons and does not report completion', async () => {
  const h = flowHarness({ update: true, failConfirmation: true });
  await assert.rejects(h.run('installEverything()'), /not confirmed the replacement collection/);
  assert.deepEqual(h.events, ['addons', 'collections']);
  assert.ok(h.rows().some(item => item.name === bridge.name));
  assert.equal(h.state.installCompleted, false);
});

test('all runtime catalogs route directly across split manifests with bare or suffixed IDs', async () => {
  const runtime = await readFile(new URL('../runtime/database.kaoxt.js', import.meta.url), 'utf8');
  const library = JSON.parse(await readFile(new URL('../runtime/kaoxt-aio-catalogs.json', import.meta.url), 'utf8'));
  for (const suffix of [false, true]) {
    const configs = [];
    const state = { aiBaseConfig: {}, aiCatalogModeOnly: true, betterPostersEnabled: false };
    const context = vm.createContext({
      window: {}, state, CFG: { aiometadataHosts: [{ url: 'https://aio.example/', cap: 250 }] },
      TextDecoder, Uint8Array, atob, jsonClone: copy, normalizeUrl: x => x, normalizeHost: x => x, loading() {},
      chooseAiHost: async () => 'https://aio.example/',
      saveAioConfig: async (host, config) => { configs.push(copy(config)); return { userUUID: `12d56b78-1234-4123-a123-${String(configs.length).padStart(12, '0')}`, installUrl: `https://aio.example/${configs.length}/manifest.json` }; },
      fetchAddonManifest: async url => ({ id: 'aio-metadata', catalogs: configs[Number(new URL(url).pathname.split('/')[1]) - 1].catalogs.map(item => ({
        id: suffix ? `${item.id}_${item.type}` : item.id, type: item.displayType || item.type,
      })) }),
    });
    context.URL = URL;
    context.document = { addEventListener() {} };
    vm.runInContext(accessSource, context);
    vm.runInContext(runtime + section('  function storedBoolean(', '  const steps =') + section('  function normalizeAioCatalogType(', '  async function chooseAiHost(') +
      section('  function chunkAioCatalogs(', '  function aioExportSlug(') +
      section('  async function provisionAiMetadata()', '  function collectionAddonIds(') +
      section('  function repointAioSources(', '  function bingecatCatalogRank(') +
      "function isBingecatSource(s) { return String(s?.addonId || '').startsWith('com.aicat.'); }", context);
    context.library = library.catalogs || library;
    vm.runInContext('state.aiNeededCatalogs = filterAioCatalogs(library, collectAioCatalogRefs(window.NUVIO_DATABASE))', context);
    assert.equal(state.aiNeededCatalogs.length, 482);
    const ai = await vm.runInContext('provisionAiMetadata()', context);
    assert.equal(ai.installs.length, 2);
    assert.ok(configs.every(config => config.catalogModeOnly === true), 'each split installation honors catalogs-only mode');
    context.ai = ai;
    vm.runInContext('repointAioSources(window.NUVIO_DATABASE, ai.catalogRoutes, ai.firstManifestId)', context);
    const owners = new Map();
    for (const item of ai.installs) for (const c of item.catalogs) {
      const key = `${c.id}|${c.type}`;
      assert.equal(owners.has(key), false, 'each catalog belongs to one AIOMetadata configuration');
      owners.set(key, item.url);
    }
    let aioRefs = 0;
    for (const group of context.window.NUVIO_DATABASE) for (const f of group.folders) {
      for (const s of [...f.sources || [], ...f.catalogSources || []]) {
        if (s.addonId !== 'aio-metadata') continue;
        aioRefs++;
        assert.ok(owners.has(`${s.catalogId}|${s.type}`), `${s.catalogId}|${s.type}`);
      }
    }
    assert.ok(aioRefs > state.aiNeededCatalogs.length);
    assert.doesNotMatch(JSON.stringify(context.window.NUVIO_DATABASE), /tv\.kollection\.posters\.|kp0_/);
  }
});
