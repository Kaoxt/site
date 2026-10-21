import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../set-up-collection/bingecat-selection.js', import.meta.url), 'utf8');
const fixture = await readFile(new URL('../runtime/database.kaoxt.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(helper + '\n' + fixture, { window });
const api = window.KollectionBingecatSelection;
const plain = value => JSON.parse(JSON.stringify(value));
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const url = 'https://bingecat.com/stremio/personal/manifest.json';
const catalogs = ['ai', 'because_watched', 'latest', 'random_public'].flatMap(kind => ['movie', 'series'].map(type => ({
  id: `personal_${kind}_${type}`, kind, type, name: 'Alias', position: 10,
})));
const sources = pack => pack.flatMap(g => g.folders || []).flatMap(f => [...f.sources || [], ...f.catalogSources || []]);
const bcSources = pack => sources(pack).filter(s => s.addonId.startsWith('com.aicat.'));

test('defaults preserve the original six recommendations; aliases and non-recommendation lists are excluded', () => {
  const list = [...catalogs,
    { id: 'first-ai', kind: 'ai', type: 'movie', position: 0 },
    { id: 'search', kind: 'ai', type: 'movie', isSearch: true },
    { id: 'other-list', kind: 'list', type: 'movie' },
  ];
  assert.equal(api.defaults(list).length, 6);
  assert.ok(api.defaults(list).every(k => !k.startsWith('latest')));
  assert.equal(api.catalogs(list).length, 8);
  assert.equal(api.selected(list, { keys: ['ai:movie'] })[0].id, 'first-ai');
});

test('saved choices retain empty selections, discard unavailable keys, and reset for another manifest', () => {
  assert.deepEqual(plain(api.selection(url, catalogs, { manifestUrl: url, keys: [] })).keys, []);
  assert.deepEqual(plain(api.selection(url, catalogs, { manifestUrl: url, keys: ['latest:movie', 'unknown'] })).keys, ['latest:movie']);
  assert.equal(api.selection(url, catalogs, { manifestUrl: 'other', keys: [] }).keys.length, 6);
  assert.deepEqual(plain(api.selection(url, catalogs, { manifestUrl: url, keys: ['ai:movie'] }, [
    { kind: 'ai', content_type: 'movie', enabled: false, state: 'disabled' },
  ])).keys, []);
});

test('pasted manifests use per-catalog keys and preserve the existing three-per-type defaults', () => {
  const list = catalogs.map(({ kind, ...c }) => ({ ...c, name: kind === 'ai' ? 'AI recommendations' : kind === 'because_watched' ? 'Because you watched' : kind === 'latest' ? 'Latest for you' : 'List for you' }));
  const defaults = api.defaults(list);
  assert.equal(defaults.length, 6);
  assert.ok(defaults.every(k => !k.includes('random_public')));
  assert.deepEqual(plain(api.selected(list, { keys: [`catalog:movie:${list[0].id}`] })).map(c => c.id), [list[0].id]);
});

function installHarness(keys) {
  const pack = structuredClone(window.NUVIO_DATABASE);
  const state = {
    bingecatManifestUrl: url, bingecatManifest: { id: 'com.aicat.personal.nuvio' },
    bingecatAddonId: 'com.aicat.personal.nuvio', bingecatCatalogs: structuredClone(catalogs),
    bingecatSelection: { manifestUrl: url, keys }, bingecatSkipped: false,
    collectionPack: pack, aiCustomCatalogLibrary: [], aiCatalogLibrary: [], aiHostPreference: 'https://example.com',
  };
  const installs = [];
  let synced = [];
  const context = vm.createContext({
    window, state, setupUpdatesExisting: true,
    jsonClone: structuredClone, ensureSelectedProfileEligible: async () => true, refreshAddonProfile: async () => {},
    loadKaoxtAssets: async () => {}, ensureCollectionSelection() {}, selectedCollectionPack: () => pack,
    listAddons: async () => [], pullCollections: async () => structuredClone(synced),
    isKollectionAiMetadataAddon: () => false, isKollectionPosterBridgeAddon: () => false,
    collectAioCatalogRefs: () => [], filterAioCatalogs: () => [], chunkAioCatalogs: () => [], normalizeHost: x => x,
    provisionAiMetadata: async () => ({ installs: [] }), prepareDirectAioInstallation: async () => {},
    loading() {}, installAddons: async required => installs.push(...required.map(item => item.url)), verifyInstalledAddons: async () => {}, repointAioSources() {},
    pushCollections: async value => { synced = structuredClone(value); }, stableCollectionJson: JSON.stringify,
    removePreviousAiMetadataAddons: async () => {}, removePreviousPosterBridgeAddons: async () => {},
  });
  vm.runInContext(
    section('  function isBingecatSource(', '  function collectionGroupKey(') +
    section('  function packUsesBingecat(', '  function groupStats(') +
    section('  function bingecatCatalogRank(', '  function mergeKey(') +
    section('  function bingecatDisplayCatalogs()', '  async function verifyBingecatManifest(') +
    section('  async function prepareReview()', '  function formatSetupDate('), context);
  return { context, state, pack, installs, synced: () => synced };
}

for (const keys of [[], ['latest:movie'], ['ai:movie', 'latest:series'], catalogs.map(api.key)]) {
  test(`preview and Nuvio install contain exactly the ${keys.length} selected catalogs`, async () => {
    const h = installHarness(keys);
    const original = structuredClone(h.pack);
    await vm.runInContext('prepareReview()', h.context);
    const preview = plain(h.state.previewCollections);
    await vm.runInContext('installEverything()', h.context);
    assert.deepEqual(plain(h.synced()), preview);
    assert.deepEqual(plain(h.pack), original, 'the original runtime stays unchanged');
    assert.equal(h.installs.length, keys.length ? 1 : 0);
    if (keys.length) assert.equal(h.installs[0], url);
    const selected = api.selected(catalogs, { keys });
    const mapped = bcSources(h.synced());
    assert.equal(mapped.length, selected.length * 2, 'sources and catalogSources are both updated');
    assert.deepEqual([...new Set(mapped.map(s => s.catalogId))].sort(), Array.from(selected, c => c.id).sort());
    const withoutBingecat = pack => plain(pack).map(g => ({ ...g, folders: g.folders.map(f => ({ ...f,
      sources: (f.sources || []).filter(s => !s.addonId.startsWith('com.aicat.')),
      catalogSources: (f.catalogSources || []).filter(s => !s.addonId.startsWith('com.aicat.')),
    })) }));
    assert.deepEqual(withoutBingecat(h.synced()), withoutBingecat(original), 'unrelated catalogs, folders and artwork are retained');
  });
}

test('selection respects separate movie/series folders and retains unrelated sources', () => {
  const movie = { provider: 'addon', addonId: 'com.aicat.creator.nuvio', catalogId: 'aicat_placeholder_movie_1', type: 'movie', custom: 'keep' };
  const unrelated = { addonId: 'other', catalogId: 'other', type: 'movie' };
  const pack = [{ folders: [{ sources: [unrelated, movie], title: 'Movies' }, { sources: [unrelated], title: 'Personal' }] }];
  api.rewrite(pack, 'com.aicat.personal.nuvio', catalogs, { keys: ['latest:movie', 'latest:series'] });
  assert.equal(pack[0].folders[0].sources.length, 2);
  assert.equal(pack[0].folders[0].sources[1].catalogId, 'personal_latest_movie');
  assert.equal(pack[0].folders[0].sources[1].custom, 'keep');
  assert.equal(pack[0].folders[1].sources.length, 1);
});
