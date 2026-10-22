import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const eligibility = await readFile(new URL('../nuvio-auth/collection-eligibility.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const copy = value => JSON.parse(JSON.stringify(value));
const catalog = { id: 'flixpatrol.netflix.us.movie', type: 'movie' };
const old = { name: 'My external metadata', url: 'https://aio.example/stremio/original/manifest.json', enabled: true, sort_order: 0 };
const other = { name: 'Stream provider', url: 'https://stream.example/manifest.json', enabled: true, sort_order: 1 };
const next = { name: 'AIOMetadata', url: 'https://aio.example/stremio/new/manifest.json', addonId: 'aio-metadata', catalogs: [catalog] };
const group = { id: 'netflix', folders: [{ sources: [{ provider: 'addon', addonId: 'aio-metadata', catalogId: catalog.id, type: 'movie' }] }] };

function harness({ shared = false, catalogOnly = false, failConfirmation = false, disabled = false, unrelatedCollection = false } = {}) {
  let rows = [{ ...old, enabled: !disabled }, copy(other)], collections = [copy(group)], writes = 0;
  const events = [], manifests = {
    [old.url]: { id: 'aio-metadata', catalogs: [catalog], resources: ['catalog', { name: 'meta', types: ['movie', 'series'] }] },
    [other.url]: { id: 'stream-provider', catalogs: [], resources: ['stream'] },
  };
  const state = {
    userId: 'account-a', profileId: 1, addonProfileId: 1,
    profiles: [{ id: 1 }, ...(shared ? [{ id: 2, name: 'Shared', usesPrimaryAddons: true }] : [])],
    collectionPack: [copy(group)], existingCollections: unrelatedCollection ? [{ ...copy(group), id: 'personal' }] : [],
    aiNeededCatalogs: [copy(catalog)], aiCatalogModeOnly: catalogOnly,
    previousAiMetadataAddons: [], previousPosterBridgeAddons: [], backup: { addons: copy(rows) },
  };
  if (unrelatedCollection) collections = copy(state.existingCollections);
  const context = vm.createContext({
    state, window: { dispatchEvent() {} }, URL, setupUpdatesExisting: false,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout, sessionStorage: { removeItem() {} },
    normalizeUrl: url => url.replace(/^stremio:/, 'https:'), jsonClone: copy, loading() {},
    currentAiCatalogModeOnly: () => catalogOnly,
    ensureSelectedProfileEligible: async () => true, refreshAddonProfile: async () => {},
    listAddons: async () => copy(rows),
    pushAddons: async value => { rows = copy(value); events.push(rows.some(item => item.url === old.url) ? 'install' : 'retire'); },
    fetchAddonManifest: async url => { if (!manifests[url]) throw new Error('unavailable'); return copy(manifests[url]); },
    pullCollections: async id => id === 2 ? [] : (failConfirmation && writes ? [] : copy(collections)),
    pushCollections: async value => { writes++; collections = copy(value); events.push('collections'); },
    provisionAiMetadata: async () => {
      events.push('provision');
      return { installs: [copy(next)], firstManifestId: 'aio-metadata', catalogRoutes: {
        [catalog.id + '|movie']: { addonId: 'aio-metadata', catalogId: catalog.id, type: 'movie' },
      } };
    },
    selectedCollectionPack: () => [copy(group)], shouldInstallBingecat: () => false,
    activeBingecatSelection: () => null, rewriteBingecatInCollections() {},
    isBingecatSource: () => false,
    fetch: async (url, options) => {
      if (url.endsWith('/sync_push_collections')) {
        collections = JSON.parse(options.body).p_collections_json; events.push('clear');
        return { ok: true, json: async () => null };
      }
      if (url.endsWith('/sync_pull_collections')) return { ok: true, json: async () => [{ collections_json: copy(collections) }] };
      throw new Error('Unexpected eligibility request');
    },
  });
  vm.runInContext(eligibility, context);
  vm.runInContext(
    section('  function storedBoolean(', '  const steps =') +
    section('  function addonUrlKey(', '  async function refreshAddonProfile(') +
    section('  async function verifyInstalledAddons(', '  async function pullCollections(') +
    section('  function stableCollectionJson(', '  async function pushCollections(') +
    section('  function normalizeAioCatalogType(', '  function synthesizeCatalog(') +
    section('  function collectionAddonIds(', '  function bingecatCatalogRank(') +
    section('  function mergeKey(', '  function bingecatDisplayCatalogs(') +
    section('  async function installEverything()', '  function formatSetupDate('), context);
  const run = code => vm.runInContext(code, context);
  return { state, context, manifests, events, run, rows: () => rows, collections: () => collections,
    clear: () => run('window.KollectionCollectionEligibility.clear(1, {accessToken:"fixture",verifyAttempts:1})'),
    review: () => run('prepareAioMigrationReview(state.backup.addons)'),
    approve: () => { for (const item of state.aioMigrationReview.candidates) item.approved = true; },
  };
}

test('clear followed by first fresh install replaces an approved outside configuration only after the collection sync', async () => {
  const h = harness();
  await h.clear();
  assert.equal(h.collections().length, 0);
  assert.ok(h.rows().some(item => item.url === old.url), 'clear keeps the original add-on');
  await h.review();
  assert.equal(h.state.aioMigrationReview.candidates.length, 1);
  assert.equal(h.state.aioMigrationReview.candidates[0].approved, false);
  h.approve();
  await h.run('installEverything()');
  assert.deepEqual(h.events, ['clear', 'provision', 'install', 'collections', 'retire']);
  assert.deepEqual(h.rows().map(item => item.url), [other.url, next.url]);
  assert.deepEqual(h.rows()[0], other, 'unrelated add-on settings are unchanged');
  assert.equal(h.collections()[0].folders[0].sources[0].catalogId, catalog.id);
  assert.equal(h.state.backup.addons[0].url, old.url, 'backup retains the old install link');
  assert.equal(h.state.installCompleted, true);
});

test('missing consent stops before provisioning or any Nuvio writes, including after a reload', async () => {
  const h = harness();
  await h.clear(); h.events.length = 0;
  await assert.rejects(h.run('installEverything()'), error => error.reviewRequired && /Select the existing/.test(error.message));
  assert.deepEqual(h.events, []);
  h.approve(); h.state.aioMigrationReview = null;
  await assert.rejects(h.run('installEverything()'), /Select the existing/);
  assert.deepEqual(h.events, []);
});

test('replacement consent never transfers to another account or profile', async () => {
  for (const field of ['userId', 'profileId', 'addonProfileId']) {
    const h = harness(); await h.review(); h.approve();
    h.state[field] = field === 'userId' ? 'account-b' : 3;
    assert.equal(h.run('approvedAioMigration(state.backup.addons[0])'), null);
    await h.review();
    assert.equal(h.state.aioMigrationReview.candidates[0].approved, false);
  }
});

test('changed manifests revoke consent and disabled catalogs and installations do not trigger migration', async () => {
  const h = harness(); await h.review(); h.approve();
  h.manifests[old.url].catalogs.push({ id: 'personal', type: 'series' });
  await h.review();
  assert.equal(h.state.aioMigrationReview.candidates[0].approved, false);
  assert.equal(h.state.aioMigrationReview.candidates[0].catalogCount, 2);
  h.manifests[old.url].catalogs[0] = { ...catalog, enabled: 'false' };
  await h.review(); assert.equal(h.state.aioMigrationReview.candidates.length, 0);
  const disabled = harness({ disabled: true }); await disabled.review();
  assert.equal(disabled.state.aioMigrationReview.candidates.length, 0);
});

test('manifest identity and movie/series routes distinguish unrelated add-ons despite display names', async () => {
  const h = harness(); h.state.backup.addons[1].name = 'AIOMetadata';
  h.manifests[other.url].catalogs = [catalog];
  h.manifests[old.url].catalogs = [{ ...catalog, type: 'series' }];
  await h.review(); assert.equal(h.state.aioMigrationReview.candidates.length, 0);
  h.manifests[old.url].catalogs = [{ ...catalog, id: catalog.id + '_movie' }];
  await h.review(); assert.equal(h.state.aioMigrationReview.candidates.length, 1);
});

test('shared profiles are protected even with no collection, and unrelated collection groups are protected', async () => {
  const shared = harness({ shared: true }); await shared.review(); shared.approve();
  await assert.rejects(shared.run('installEverything()'), /shared with another profile/);
  assert.deepEqual(shared.events, []);
  const personal = harness({ unrelatedCollection: true }); await personal.review(); personal.approve();
  await assert.rejects(personal.run('installEverything()'), /other collection groups/);
  assert.deepEqual(personal.events, []);
});

test('catalogs-only replacement requires a remaining enabled metadata provider', async () => {
  const h = harness({ catalogOnly: true }); await h.review(); h.approve();
  await assert.rejects(h.run('installEverything()'), /only verified metadata provider/);
  assert.deepEqual(h.events, []);
  h.manifests[other.url].resources.push('meta');
  await h.review(); h.approve();
  await h.run('installEverything()');
  assert.ok(h.rows().some(item => item.url === other.url));
});

test('failed collection confirmation leaves the original AIOMetadata installed', async () => {
  const h = harness({ failConfirmation: true }); await h.clear(); await h.review(); h.approve();
  await assert.rejects(h.run('installEverything()'), /not confirmed the replacement collection/);
  assert.ok(h.rows().some(item => item.url === old.url));
  assert.equal(h.events.includes('retire'), false);
  assert.equal(h.state.installCompleted, false);
});

test('a manifest or sharing change after Review cannot bypass the final duplicate guard', async () => {
  for (const change of ['manifest', 'sharing']) {
    const h = harness(); await h.review(); h.approve();
    if (change === 'manifest') h.manifests[old.url].catalogs.push({ id: 'new-personal', type: 'movie' });
    else h.state.profiles.push({ id: 2, usesPrimaryAddons: true });
    h.context.ai = { installs: [next] };
    await assert.rejects(h.run('prepareDirectAioInstallation(ai)'), error => error.reviewRequired);
    assert.deepEqual(h.events, []);
  }
});

test('an approved renamed installation becoming unavailable cannot bypass the final duplicate guard', async () => {
  const h = harness(); await h.review(); h.approve();
  delete h.manifests[old.url]; h.context.ai = { installs: [next] };
  await assert.rejects(h.run('prepareDirectAioInstallation(ai)'), /Could not verify the existing/);
  assert.deepEqual(h.events, []);
});
