import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../account/saved-collections.js', import.meta.url), 'utf8');
const verify = source.slice(source.indexOf('  async function verifyCompletedSetup('), source.indexOf('  function buildRow('));
function context(pull) {
  return vm.createContext({ window: {}, expectedIds: () => ['old-group'], pullProfileCollections: pull, liveIds: rows => new Set(rows.map(x => x.id)), pullProfiles: async () => [{ id: 3, name: 'test555' }], profileIdOf: p => p.id, profileNameOf: p => p.name });
}
test('unmatched installed collection leaves a saved configuration reusable', async () => {
  const c = context(async () => []);
  vm.runInContext(verify, c);
  const result = await vm.runInContext('verifyCompletedSetup({draftStep:7,nuvioProfileId:3,nuvioProfileName:"test555"}, new Map(), {}, null)', c);
  assert.equal(result.state, 'saved');
});
test('verification outages are still errors rather than being treated as uninstalled', async () => {
  const c = context(async () => { throw new Error('Nuvio unavailable'); });
  vm.runInContext(verify, c);
  await assert.rejects(vm.runInContext('verifyCompletedSetup({draftStep:7,nuvioProfileId:3}, new Map(), {}, null)', c), /Nuvio unavailable/);
});
test('saved row offers profile selection without edit/update or red invalid styling', async () => {
  const classes = new Set();
  const attrs = {};
  const el = () => ({ classList: { add: x => classes.add(x), remove: x => classes.delete(x) }, setAttribute: (k,v) => attrs[k]=v, removeAttribute: k => delete attrs[k] });
  const ui = { complete: true, row: el(), resume: el(), badge: { dataset: {} }, originMessage: el() };
  const c = vm.createContext({ document: { getElementById: () => ({ innerHTML: '', appendChild() {} }) }, buildRow: () => ui, verifyCompletedSetup: async () => ({ state: 'saved', message: 'Choose a profile.' }) });
  vm.runInContext(source.slice(source.indexOf('  async function render('), source.indexOf('  async function load()')), c);
  await vm.runInContext('render([{id:"saved&one",name:"Old setup"}])', c);
  const url = new URL(ui.resume.href, 'https://kollection.tv');
  assert.equal(url.pathname, '/set-up-collection/nuvio');
  assert.equal(url.searchParams.get('saved'), 'saved&one');
  assert.equal(url.searchParams.get('clone'), '1');
  assert.equal(url.searchParams.get('step'), 'nuvio');
  assert.equal(url.searchParams.has('update'), false);
  assert.equal(url.searchParams.has('edit'), false);
  assert.equal(ui.badge.textContent, 'Saved');
  assert.equal(ui.resume.textContent, 'Use setup');
  assert.equal(classes.has('account-saved-invalid'), false);
  assert.equal(attrs['aria-disabled'], undefined);
});
