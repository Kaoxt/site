import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const edit = await readFile(new URL('../set-up-collection/edit-existing-restore.js', import.meta.url), 'utf8');
const saved = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
const categoryOrder = await readFile(new URL('../set-up-collection/category-order.js', import.meta.url), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function driver(step = 2) {
  let clicks = 0;
  const queue = [];
  const fields = {
    '#nextBtn': { disabled: false, isConnected: true, click: () => { clicks++; } },
    '#builtInTab': { classList: { contains: () => true } },
    '#mdblist': { value: 'saved-test-key' }, '#aiHost': { value: 'https://aio.example/' },
    '#profile': { value: '1' },
  };
  const context = vm.createContext({ active: true, originVerified: true, reachedCustomize: false, busy: false,
    attemptedButtons: new WeakSet(), currentStep: () => step, $: selector => fields[selector],
    setTimeout: fn => queue.push(fn), findButtonByText: () => null });
  vm.runInContext(section(edit, '  function clickOnce(', '  function findButtonByText(') +
    section(edit, '  function driveToCustomize(', '  function init('), context);
  return { context, fields, clicks: () => clicks, step: value => { step = value; }, flush: () => { while (queue.length) queue.shift()(); }, drive: () => vm.runInContext('driveToCustomize()', context) };
}

test('saved API keys never automatically submit the AIOMetadata password step', () => {
  const h = driver();
  for (let i = 0; i < 20; i++) { h.drive(); h.flush(); }
  assert.equal(h.clicks(), 0);
  h.fields['#aiConfigPassword'] = { value: 'valid-password' };
  h.fields['#aiConfigPasswordConfirm'] = { value: 'valid-password' };
  for (let i = 0; i < 20; i++) { h.drive(); h.flush(); }
  assert.equal(h.clicks(), 0, 'completed typing still waits for an intentional Continue');
  h.fields['#nextBtn'].click();
  assert.equal(h.clicks(), 1);
});

test('category ordering never submits passwords or changes saved progress', async () => {
  let clicks = 0;
  const callbacks = [];
  const fields = {
    panelHost: {}, mobileStepText: { textContent: 'Step 3 of 8' },
    builtInTab: { classList: { contains: () => true } },
    mdblist: { value: 'saved-test-key' }, aiHost: { value: 'https://aio.example/' },
    nextBtn: { disabled: false, click() { clicks++; } },
  };
  const body = { collection: { draftStep: 7, config: { categoryOrder: ['genres'] } } };
  const window = { location: { href: 'https://kollection.test/set-up-collection?saved=test&edit=1', search: '?saved=test&edit=1' },
    fetch: async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }) };
  const c = vm.createContext({ window, URL, URLSearchParams, Response,
    document: { readyState: 'complete', getElementById: id => fields[id], addEventListener: (_event, fn) => callbacks.push(fn) },
    MutationObserver: class { constructor(fn) { callbacks.push(fn); } observe() {} },
    setTimeout: fn => callbacks.push(fn) });
  vm.runInContext(categoryOrder, c);
  for (let i = 0; i < 5; i++) for (const fn of callbacks.slice()) fn();
  assert.equal(clicks, 0);
  const restored = await (await window.fetch('/api/account/collections/test')).json();
  assert.deepEqual(restored, body, 'saved progress must reach the origin verifier unchanged');
});

test('failed automatic navigation is attempted once, not retried on every mutation', () => {
  const h = driver(1);
  for (let i = 0; i < 20; i++) { h.drive(); h.flush(); }
  assert.equal(h.clicks(), 1);
});

test('queued navigation is cancelled after moving Back or replacing the panel', () => {
  for (const cancel of [h => h.step(0), h => { h.context.active = false; }, h => { h.fields['#nextBtn'].isConnected = false; }]) {
    const h = driver(1);
    h.drive(); cancel(h); h.flush();
    assert.equal(h.clicks(), 0);
  }
});

test('AI restore applies once and later mutations preserve manual host and catalog edits', () => {
  const fields = {
    '#aiCatalogModeOnly': { checked: false, dispatchEvent() {} },
    '#builtInTab': { classList: { contains: () => true } },
    '#aiHost': { value: 'other', options: [{ value: 'https://aio.example/' }], dispatchEvent() {} },
  };
  const c = vm.createContext({ restoring: true, aiRestoreApplied: false, currentStep: () => 2,
    snapshot: { aiSetupMode: 'built-in', aiHostPreference: 'https://aio.example/', aiCatalogModeOnly: true },
    targetStep: 4, $: selector => fields[selector], storedBoolean: Boolean, dispatchChange: el => el.dispatchEvent(),
    showResumeNotice() {}, window: {}, clickOnce() {} });
  vm.runInContext(section(saved, '  function applyVisible(', '  async function loadSaved('), c);
  vm.runInContext('applyVisible()', c);
  assert.equal(fields['#aiHost'].value, 'https://aio.example/');
  assert.equal(fields['#aiCatalogModeOnly'].checked, true);
  fields['#aiHost'].value = '__self_host__';
  fields['#aiCatalogModeOnly'].checked = false;
  for (let i = 0; i < 10; i++) vm.runInContext('applyVisible()', c);
  assert.equal(fields['#aiHost'].value, '__self_host__');
  assert.equal(fields['#aiCatalogModeOnly'].checked, false);
});


test('completed saved Edit opens Customize while explicit routes and Update remain authoritative', () => {
  const start = saved.indexOf('      targetStep = updateExistingSetup');
  const code = saved.slice(start, saved.indexOf('      snapshot = {', start));
  for (const [updateExistingSetup, routedStep, expected] of [[false, 0, 4], [false, 2, 2], [true, 0, 2]]) {
    const c = vm.createContext({ targetStep: 0, updateExistingSetup, routedStep, editExistingSetup: true,
      cloneSavedSetup: false, item: { draftStep: 7 } });
    vm.runInContext(code, c);
    assert.equal(c.targetStep, expected);
  }
});
