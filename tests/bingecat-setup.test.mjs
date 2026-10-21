import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = section('  function bingecatCatalogRank(', '  function mergeKey(');
const isSource = section('  function isBingecatSource(', '  function collectionGroupKey(');
const fixture = await readFile(new URL('../runtime/database.kaoxt.js', import.meta.url), 'utf8');
const database = {};
vm.runInNewContext(fixture, { window: database });
const pack = () => structuredClone(database.NUVIO_DATABASE);
const catalogs = [
  ['ai', 'movie'], ['ai', 'series'], ['because_watched', 'movie'], ['because_watched', 'series'],
  ['random_public', 'movie'], ['random_public', 'series'], ['latest', 'movie'], ['latest', 'series'],
].map(([kind, type]) => ({ kind, type, name: 'Custom alias', id: `personal_${kind}_${type}`, position: 10 }));
const sources = p => p.flatMap(g => g.folders || []).flatMap(f => [...f.sources || [], ...f.catalogSources || []]);
const run = (p, cats, addon = 'com.aicat.personal.nuvio') => {
  const context = vm.createContext({ p, cats, addon });
  vm.runInContext(isSource + code + '\nrewriteBingecatInCollections(p, addon, cats);', context);
  return p;
};

test('current production placeholders map by kind and type regardless of labels or API ordering', () => {
  const p = pack();
  const old = sources(p).filter(s => s.catalogId.startsWith('aicat_'));
  assert.equal(old.length, 12);
  const others = structuredClone(sources(p).filter(s => !s.catalogId.startsWith('aicat_')));
  run(p, catalogs.toReversed());
  const mapped = sources(p).filter(s => s.addonId === 'com.aicat.personal.nuvio');
  assert.equal(mapped.length, 12);
  assert.equal(new Set(mapped.map(s => s.catalogId)).size, 6);
  assert.ok(mapped.every(s => !s.catalogId.includes('latest') && s.catalogId.endsWith(s.type)));
  assert.deepEqual(sources(p).filter(s => s.addonId !== 'com.aicat.personal.nuvio'), others);
});

test('disabled kinds, unknown placeholders, and missing metadata are removed instead of retaining creator IDs', () => {
  const p = pack();
  p[0].folders[0].sources.push({ addonId: 'com.aicat.creator.nuvio', catalogId: 'aicat_unknown', type: 'movie' });
  run(p, [...catalogs.filter(c => c.kind !== 'random_public'), { id: 'search', type: 'movie' }]);
  const mapped = sources(p).filter(s => s.addonId.includes('aicat'));
  assert.equal(mapped.length, 8);
  assert.ok(mapped.every(s => s.addonId === 'com.aicat.personal.nuvio' && !s.catalogId.includes('latest')));
});

test('catalog aliases choose the lowest position and generic admin placeholders are supported', () => {
  const p = [{ folders: [{ sources: [{ addonId: 'com.aicat.kollection-placeholder.nuvio', catalogId: 'aicat_placeholder_movie_1', type: 'movie' }], catalogSources: [] }] }];
  run(p, [...catalogs, { kind: 'ai', type: 'movie', id: 'first-position', position: 0 }]);
  assert.equal(p[0].folders[0].sources[0].catalogId, 'first-position');
});

test('skip removes every Bingecat placeholder', () => {
  const p = run(pack(), catalogs, '');
  assert.equal(sources(p).filter(s => s.addonId.includes('aicat')).length, 0);
});

test('refreshing a saved manifest preserves kind metadata only for that same URL and known catalog IDs', async () => {
  const url = 'https://bingecat.com/stremio/personal/manifest.json';
  const state = { bingecatManifestUrl: url, bingecatCatalogs: structuredClone(catalogs) };
  const context = vm.createContext({ state, normalizeUrl: x => x, persistWizardSession() {},
    fetchAddonManifest: async () => ({ id: 'com.aicat.personal.nuvio', catalogs: catalogs.map(({ kind, ...rest }) => rest) }),
  });
  vm.runInContext(section('  async function verifyBingecatManifest(', '  async function prepareReview('), context);
  await vm.runInContext(`verifyBingecatManifest(${JSON.stringify(url)})`, context);
  assert.ok(state.bingecatCatalogs.every(c => c.kind));
  await vm.runInContext(`verifyBingecatManifest('https://bingecat.com/stremio/other/manifest.json')`, context);
  assert.ok(state.bingecatCatalogs.every(c => !c.kind));
});

test('account rendering ignores late responses after leaving the Bingecat step', async () => {
  let resolve;
  const profiles = new Promise(r => { resolve = r; });
  const host = { innerHTML: 'Other step' };
  const context = vm.createContext({ window: { BingecatConnect: { profiles: () => profiles, getProfileId: () => 1, setProfileId() {}, overview: async () => ({ catalogs: [] }) } },
    state: { step: 3 }, host, loading() {},
  });
  vm.runInContext('let bingecatViewVersion = 0;\n' + section('  async function renderBingecatAccount(', '  function renderBingecat()'), context);
  const pending = vm.runInContext('renderBingecatAccount()', context);
  context.state.step = 4;
  resolve([{ id: 1 }]);
  await pending;
  assert.equal(host.innerHTML, 'Other step');
});

test('OAuth helper loads after config and before the builder; callback and scripts parse', async () => {
  const html = await readFile(new URL('../set-up-collection.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/config.js?') < html.indexOf('/bingecat-connect.js?'));
  assert.ok(html.indexOf('/bingecat-connect.js?') < html.indexOf('/set-up-collection.js?'));
  const callback = await readFile(new URL('../bingecat-callback.html', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(callback.match(/<script>([\s\S]+)<\/script>/)[1]));
});

function uiHarness({ saved = false, connected = false, pending = null } = {}) {
  const state = { step: 3, bingecatSkipped: false, bingecatManifestUrl: '', bingecatManifest: null, bingecatCatalogs: [] };
  let nodes = new Map();
  const host = {
    html: '',
    set innerHTML(value) {
      for (const node of nodes.values()) node.isConnected = false;
      this.html = value;
      nodes = new Map([...value.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { isConnected: true, value: '', innerHTML: '' }]));
    },
    get innerHTML() { return this.html; },
  };
  let profileId = 1;
  let callback = pending;
  const errors = [];
  const bc = { configured: true, takePending: () => { const next = callback; callback = null; return next; }, isConnected: () => connected,
    login: async () => { connected = true; return true; }, logout: async () => { connected = false; }, getProfileId: () => profileId, setProfileId: id => { profileId = id; },
    profiles: async () => [{ id: 1, name: 'Main', nuvio: { state: 'not_linked' } }, { id: 2, name: 'Family', nuvio: { state: 'ready' } }],
    overview: async id => ({ catalogs: structuredClone(catalogs), manifest: { id: `com.aicat.profile${id}.nuvio`, url: `https://bingecat.com/stremio/profile${id}/manifest.json` }, recommendations: [{ kind: 'ai', content_type: 'movie', state: 'needs_history', history: { count: 4, required: 10 } }] }),
  };
  const context = vm.createContext({ state, window: { BingecatConnect: bc }, host, setupHasSavedId: saved,
    $: selector => nodes.get(selector.slice(1)) || null,
    esc: v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    loading: text => { host.innerHTML = text; }, panel: (k, t, d, body) => t + body,
    persistWizardSession() {}, loadKaoxtAssets: async () => {}, ensureCollectionSelection() {},
    setStep: step => { state.step = step; }, alert: (text, kind) => { errors.push({ text, kind }); },
    navigator: {},
  });
  vm.runInContext(section('  function adoptBingecatManifest(', '  async function prepareReview(') + section('  function bingecatDisplayCatalogs()', '  async function verifyBingecatManifest(') + section('  // Saved setups only receive', '  function renderCustomize()'), context);
  return { state, host, context, bc, errors, node: id => nodes.get(id), render: () => vm.runInContext('renderBingecat()', context) };
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

for (const saved of [false, true]) {
  test(`${saved ? 'saved' : 'new'} setup can connect, choose a profile, adopt its catalogs, and continue`, async () => {
    const h = uiHarness({ saved });
    h.render();
    assert.ok(h.node('bcConnectBtn'));
    assert.match(h.host.innerHTML, /<details/);
    h.node('bcConnectBtn').onclick();
    await flush();
    assert.ok(h.node('bcProfile'));
    assert.match(h.host.innerHTML, /4\/10/);
    h.node('bcProfile').value = '2';
    h.node('bcProfile').onchange();
    await flush();
    h.node('bcUseBtn').onclick();
    assert.equal(h.state.bingecatAddonId, 'com.aicat.profile2.nuvio');
    assert.ok(h.state.bingecatCatalogs.every(c => c.kind));
    assert.ok(h.node('bcUrl'));
    await h.node('nextBtn').onclick();
    assert.equal(h.state.step, 4);
    assert.ok(!h.errors.some(e => e.kind === 'error'));
  });
}

test('saved manifest remains selected when another Bingecat account is already connected in the browser', () => {
  const h = uiHarness({ saved: true, connected: true });
  h.state.bingecatManifestUrl = 'https://bingecat.com/stremio/saved/manifest.json';
  h.state.bingecatManifest = { id: 'saved-addon' };
  h.state.bingecatCatalogs = structuredClone(catalogs);
  h.render();
  assert.ok(h.node('nextBtn'));
  assert.ok(!h.node('bcProfile'));
  assert.equal(h.state.bingecatManifest.id, 'saved-addon');
});

test('Bingecat snapshot contains only manifest and catalog settings', () => {
  const h = uiHarness();
  h.state.bingecatCatalogs = [{ ...catalogs[0], access_token: 'must-not-save' }];
  const snapshot = vm.runInContext('window.KollectionBingecatSetup.snapshot()', h.context);
  assert.equal(snapshot.bingecatCatalogs[0].kind, 'ai');
  assert.equal(JSON.stringify(snapshot).includes('must-not-save'), false);
});
