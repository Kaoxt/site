import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const saved = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const copy = value => JSON.parse(JSON.stringify(value));
const runtime = JSON.parse(await readFile(new URL('../runtime/kaoxt-aio-catalogs.json', import.meta.url), 'utf8'));
const catalogs = Array.isArray(runtime) ? runtime : runtime.catalogs;
const folder = (...refs) => ({ sources: refs.map(([catalogId, type]) => ({ addonId: 'aio-metadata', catalogId, type })) });

function harness(library = catalogs, custom = []) {
  const state = { aiCatalogLibrary: copy(library), aiCustomCatalogLibrary: copy(custom), aiCatalogShuffleOverrides: {},
    aiExportConfigs: [{ stale: true }], backup: {}, installCompleted: true, betterPostersEnabled: false };
  const window = {};
  const context = vm.createContext({ state, window, TextDecoder, Uint8Array, atob, jsonClone: copy,
    persistWizardSession() {}, isBingecatSource: s => String(s.addonId || '').startsWith('com.aicat.') });
  vm.runInContext(section('  function storedBoolean(', '  const steps =') +
    section('  function normalizeAioCatalogType(', '  function hostDef(') +
    section('  function prepareAiConfig(', '  function aioExportSlug(') +
    section('  function aioCatalogLibraryForSetup(', '  async function prepareReview('), context);
  return { state, context, api: window.KollectionCatalogShuffle };
}

test('every supplied catalog retains its original shuffle default without mutation', () => {
  const h = harness();
  assert.ok(catalogs.some(c => c.randomizePerPage === true));
  assert.ok(catalogs.some(c => !c.randomizePerPage));
  for (const catalog of catalogs) assert.deepEqual(copy(h.api.apply(catalog)), catalog);
  assert.deepEqual(copy(h.state.aiCatalogLibrary), catalogs);
});

test('movie, series and mixed-type manifest routes resolve to their actual config keys', () => {
  const h = harness([
    { id: 'streaming.test', type: 'movie', randomizePerPage: true },
    { id: 'streaming.test', type: 'series', randomizePerPage: false },
    { id: 'mdblist.123', type: 'all', displayType: 'movie', randomizePerPage: true },
  ]);
  const f = folder(['streaming.test_movie', 'movie'], ['streaming.test_series', 'tv'], ['mdblist.123_all', 'movie']);
  f.catalogSources = copy(f.sources);
  assert.deepEqual(copy(h.api.entries(f)).map(x => [x.key, x.enabled]), [
    ['streaming.test|movie', true], ['streaming.test|series', false], ['mdblist.123|all', true],
  ]);
  h.api.set({ 'streaming.test|movie': false, 'streaming.test|series': true });
  assert.deepEqual(copy(h.api.entries(f)).map(x => x.enabled), [false, true, true]);
  assert.equal(h.api.entries(folder(['streaming.test_movie', 'movie']))[0].enabled, false, 'shared references agree');
});

test('custom imported defaults take priority, unsupported sources have no toggle', () => {
  const h = harness([{ id: 'list', type: 'movie', randomizePerPage: true }], [{ id: 'list', type: 'movie', randomizePerPage: false }]);
  assert.equal(h.api.entries(folder(['list', 'movie']))[0].enabled, false);
  assert.deepEqual(copy(h.api.entries({ sources: [{ addonId: 'com.aicat.user', catalogId: 'for-you', type: 'movie' }] })), []);
});

test('explicit false survives saved config, reload and restore defaults', () => {
  const h = harness([{ id: 'list', type: 'movie', randomizePerPage: true }]);
  h.api.set({ 'list|movie': false });
  assert.equal(h.state.backup, null);
  assert.deepEqual(copy(h.state.aiExportConfigs), []);
  const config = JSON.parse(JSON.stringify({ aiCatalogShuffleOverrides: h.api.getOverrides() }));
  const next = harness([{ id: 'list', type: 'movie', randomizePerPage: true }]);
  next.api.restore(config);
  assert.equal(next.api.entries(folder(['list', 'movie']))[0].enabled, false);
  next.api.set({ 'list|movie': null });
  assert.equal(next.api.entries(folder(['list', 'movie']))[0].enabled, true);
  next.api.restore({});
  assert.deepEqual(copy(next.api.getOverrides()), {}, 'legacy saves inherit defaults');
});

test('actual generated exports apply overrides without changing source, sort, or search', () => {
  const library = [{ id: 'list', type: 'movie', randomizePerPage: true, sort: 'rank', order: 'desc' },
    { id: 'list', type: 'series', sort: 'default' }];
  const h = harness(library);
  h.api.set({ 'list|movie': false, 'list|series': true });
  h.context.base = { searchEnabled: true, search: { enabled: true } };
  h.context.library = library;
  const config = vm.runInContext('prepareAiConfig(base, library, 0)', h.context);
  assert.equal(config.catalogs[0].randomizePerPage, false);
  assert.equal(config.catalogs[1].randomizePerPage, true);
  assert.equal(config.catalogs[0].sort, 'rank');
  assert.equal(config.catalogs[0].order, 'desc');
  assert.equal(config.searchEnabled, true);
  assert.equal(library[0].randomizePerPage, true);
  assert.equal(library[1].randomizePerPage, undefined);
  assert.equal(vm.runInContext('prepareAiConfig(base, library, 1)', h.context).searchEnabled, false);
});

test('saved-setup serialization includes false overrides in the real save payload', () => {
  const h = harness();
  h.api.set({ 'list|movie': false });
  const context = vm.createContext({ window: { KollectionCatalogShuffle: h.api }, snapshot: {},
    captureVisible() {}, getInstalledConfigurations: () => [], storedBoolean: Boolean });
  vm.runInContext(saved.slice(saved.indexOf('  function serializableConfig('), saved.indexOf('  function getInstalledConfigurations(')), context);
  assert.deepEqual(copy(vm.runInContext('serializableConfig()', context).aiCatalogShuffleOverrides), { 'list|movie': false });
});
