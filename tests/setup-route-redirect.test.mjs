import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const names = source.match(/const SETUP_ROUTE_NAMES = (\[[^;]+\]);/)[0];
const routing = source.slice(source.indexOf('  function routeStepFromLocation()'), source.indexOf('  function persistWizardSession()'));
function route(url) {
  const context = vm.createContext({ window: { location: new URL(url, 'https://kollection.tv') }, URL, URLSearchParams });
  vm.runInContext(`${names}\nconst SETUP_ROUTE_BASE = '/set-up-collection';\n${routing}`, context);
  return { step: () => vm.runInContext('routeStepFromLocation()', context), url: step => vm.runInContext(`setupRouteUrl(${step}).toString()`, context) };
}

test('saved Update opens at step 5 after hosting redirects to setup root', () => {
  assert.equal(route('/set-up-collection?saved=latest&update=1').step(), 4);
  assert.equal(route('/set-up-collection?saved=latest&update=1&step=customize').step(), 4);
  assert.equal(route('/set-up-collection.html?saved=latest&update=1').step(), 4);
});

test('each explicit step survives canonicalization, including backward navigation', () => {
  for (let step = 0; step < 8; step++) {
    const next = new URL(route('/set-up-collection?saved=latest&update=1&targetProfile=2').url(step));
    assert.equal(route(next.toString()).step(), step);
    next.pathname = '/set-up-collection';
    assert.equal(route(next.toString()).step(), step);
    assert.equal(next.searchParams.get('saved'), 'latest');
    assert.equal(next.searchParams.get('targetProfile'), '2');
  }
});

test('fresh setups start at step 1 and explicit paths remain authoritative', () => {
  assert.equal(route('/set-up-collection').step(), 0);
  assert.equal(route('/set-up-collection?saved=draft').step(), 0);
  assert.equal(route('/set-up-collection/aiometadata?saved=latest&update=1&step=customize').step(), 2);
  assert.equal(route('/set-up-collection?step=unknown').step(), 0);
});
