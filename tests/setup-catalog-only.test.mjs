import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const copy = value => JSON.parse(JSON.stringify(value));
const booleanHelper = section('  function storedBoolean(', '  const steps =');
const prepare = section('  function prepareAiConfig(', '  function aioExportSlug(');

for (const [choice, imported, expected] of [
  [null, undefined, false], [true, false, true], [false, true, false],
  [null, true, true], [null, 'false', false], [null, 'true', true],
]) {
  test(`catalogs-only choice ${choice} with imported value ${imported} produces ${expected}`, () => {
    const base = { catalogs: [], catalogModeOnly: imported, providers: { movie: 'tmdb' } };
    const state = { aiCatalogModeOnly: choice, aiCustomConfig: base, betterPostersEnabled: false };
    const c = vm.createContext({ state, window: {}, jsonClone: copy });
    vm.runInContext(booleanHelper + prepare, c);
    const result = vm.runInContext('prepareAiConfig({}, [{id:"list",type:"movie",enabled:true}], 0)', c);
    assert.equal(result.catalogModeOnly, expected);
    assert.equal(result.catalogs.length, 1);
    assert.deepEqual(copy(result.providers), base.providers);
    assert.equal(base.catalogModeOnly, imported, 'the uploaded file stays unchanged');
    assert.equal(vm.runInContext('currentAiCatalogModeOnly()', c), expected);
  });
}

test('catalogs-only on and off survive wizard refreshes', () => {
  for (const choice of [true, false]) {
    let saved;
    const state = { aiCatalogModeOnly: choice };
    const c = vm.createContext({ state, SETUP_SESSION_KEY: 'test', SETUP_SESSION_MAX_AGE: 10000,
      setupHasSavedId: false, clearTimeout() {},
      sessionStorage: { setItem(key, value) { saved = value; }, getItem: () => saved },
    });
    vm.runInContext('let persistTimer = null;' +
      section('  function persistWizardSession()', '  function selectNewCollectionGroups(') +
      section('  function restoreWizardSession()', '  function syncSetupRoute('), c);
    vm.runInContext('persistWizardSession()', c);
    state.aiCatalogModeOnly = !choice;
    assert.equal(vm.runInContext('restoreWizardSession()', c), true);
    assert.equal(state.aiCatalogModeOnly, choice);
  }
});

test('Update Existing restores explicit and older exported catalog modes', () => {
  for (const [config, expected] of [
    [{ aiCatalogModeOnly: true }, true],
    [{ aiCatalogModeOnly: 'false', aiometadataExports: [{ config: { catalogModeOnly: true } }] }, false],
    [{ aiometadataExports: [{ config: { catalogModeOnly: true } }] }, true],
    [{}, null],
  ]) {
    let restore;
    const state = { profiles: [], step: 0 };
    const c = vm.createContext({ state, window: { addEventListener: (name, fn) => { restore = fn; } },
      jsonClone: copy, mergeKey: value => value, selectNewCollectionGroups() {},
    });
    vm.runInContext(booleanHelper + section("  window.addEventListener('kollection:restore-saved-update-state'", "  window.addEventListener('kollection:existing-collection-policy'"), c);
    restore({ detail: { config: { ...config, bingecatSkipped: true } } });
    assert.equal(state.aiCatalogModeOnly, expected);
  }
});
