import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');

function harness() {
  let checks = [];
  const requests = [];
  const listeners = new Map();
  const window = {
    location: { search: '', href: 'https://kollection.tv/set-up-collection' },
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
