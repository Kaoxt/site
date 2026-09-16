import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../nuvio-auth/collection-eligibility.js', import.meta.url), 'utf8');

function harness(pulledCollections) {
  const calls = [];
  const events = [];
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const window = {
    KOLLECTION_CONFIG: { nuvioApiBase: 'https://api.example.test', nuvioPublishableKey: 'test-key' },
    dispatchEvent(event) { events.push(event); },
  };
  const context = vm.createContext({
    window,
    CustomEvent,
    setTimeout,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/sync_push_collections')) return { ok: true, json: async () => null };
      if (url.endsWith('/sync_pull_collections')) {
        return {
          ok: true,
          json: async () => [{ collections_json: pulledCollections }],
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  vm.runInContext(source, context);
  return { api: window.KollectionCollectionEligibility, calls, events };
}

test('clear confirms Nuvio stored an empty collection before reporting success', async () => {
  const h = harness([]);
  const result = await h.api.clear(4, { accessToken: 'token', verifyAttempts: 1, verifyDelayMs: 0 });
  assert.equal(result.cleared, true);
  assert.equal(result.state, 'available');
  assert.equal(result.existingCount, 0);
  const push = h.calls.find((call) => call.url.endsWith('/sync_push_collections'));
  assert.deepEqual(JSON.parse(push.options.body), { p_profile_id: 4, p_collections_json: [] });
  assert.ok(h.events.some((event) => event.type === 'kollection:profile-collection-cleared'));
});

test('clear does not report success while Nuvio still returns the old collection', async () => {
  const h = harness([{ id: 'old-collection' }]);
  await assert.rejects(
    h.api.clear(4, { accessToken: 'token', verifyAttempts: 1, verifyDelayMs: 0 }),
    /Nuvio still reports 1 collection group/,
  );
  assert.equal(h.events.some((event) => event.type === 'kollection:profile-collection-cleared'), false);
});
