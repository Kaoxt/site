import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('set-up-collection/set-up-collection.js', root), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('every local script loaded by the setup page parses before deployment', async () => {
  const html = await readFile(new URL('set-up-collection.html', root), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="(\/[^"?]+)[^"]*"/g)];
  assert.ok(scripts.length > 20);
  for (const [, path] of scripts) {
    const code = await readFile(new URL(path.slice(1), root), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: path }), path);
  }
});

function selectionHarness(pack) {
  const state = { collectionPack: pack, selectedCollectionGroupIds: ['chosen'] };
  const context = vm.createContext({ state, mergeKey: x => x, collectionGroupKey: g => g.id });
  vm.runInContext(`let pendingNewGroupSelection = null; const LEGACY_KNOWN_COLLECTION_GROUP_IDS = ['chosen', 'off'];\n${section('  function selectNewCollectionGroups(', '  function restoreWizardSession(')}`, context);
  return { state, run: code => vm.runInContext(code, context) };
}

for (const early of [true, false]) {
  test(`saved category restore preserves deselections when assets arrive ${early ? 'first' : 'last'}`, () => {
    const pack = [{ id: 'chosen' }, { id: 'off' }, { id: 'new' }];
    const h = selectionHarness(early ? pack : null);
    h.run(`selectNewCollectionGroups(['chosen', 'off'])`);
    h.state.collectionPack = pack;
    h.run('applyPendingNewGroups()');
    assert.deepEqual(Array.from(h.state.selectedCollectionGroupIds), ['chosen', 'new']);
    h.state.selectedCollectionGroupIds = ['chosen'];
    h.run('applyPendingNewGroups()');
    assert.deepEqual(h.state.selectedCollectionGroupIds, ['chosen'], 'a user can deselect the new category afterward');
  });
}

test('concurrent asset loads share requests and a failed load can be retried', async () => {
  const calls = [];
  let fail = true;
  const state = { collectionPack: null, aiBaseConfig: null, aiCatalogLibrary: [] };
  const context = vm.createContext({
    state, window: {}, CFG: { kaoxtDatabaseUrl: 'db', kaoxtAioCatalogsUrl: 'catalogs', kaoxtAioBaseConfigUrl: 'base' },
    fetchText: async url => { calls.push(url); if (fail) throw new Error('offline'); return '[]'; },
    fetchJson: async url => { calls.push(url); return url === 'catalogs' ? [{ id: 'one' }] : {}; },
    parseKaoxtDatabase: JSON.parse, applyPendingNewGroups() {},
  });
  vm.runInContext(`let assetsPromise = null; ${section('  async function loadKaoxtAssets()', '  function isBingecatSource(')}`, context);
  const results = await vm.runInContext('Promise.allSettled([loadKaoxtAssets(), loadKaoxtAssets()])', context);
  assert.ok(results.every(r => r.status === 'rejected'));
  assert.equal(calls.length, 3);
  fail = false;
  await vm.runInContext('Promise.all([loadKaoxtAssets(), loadKaoxtAssets()])', context);
  assert.equal(calls.length, 6);
  await vm.runInContext('loadKaoxtAssets()', context);
  assert.equal(calls.length, 6);
});

test('typing coalesces session writes and a navigation flush cancels pending work', () => {
  const timers = new Map(); let next = 0; let writes = 0;
  const context = vm.createContext({ state: {}, SETUP_SESSION_KEY: 'test', sessionStorage: { setItem() { writes++; } },
    setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(`let persistTimer = null; ${section('  function persistWizardSession()', '  function selectNewCollectionGroups(')}`, context);
  vm.runInContext('for (let i = 0; i < 20; i++) scheduleWizardSession()', context);
  assert.equal(timers.size, 1); assert.equal(writes, 0);
  vm.runInContext('persistWizardSession()', context);
  assert.equal(timers.size, 0); assert.equal(writes, 1);
});
