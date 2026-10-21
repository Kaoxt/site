import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const helper = await readFile(new URL('../set-up-collection/aio-catalog-export.js', import.meta.url), 'utf8');
const wizard = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const account = await readFile(new URL('../account/saved-collections.js', import.meta.url), 'utf8');
const library = JSON.parse(await readFile(new URL('../runtime/kaoxt-aio-catalogs.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
function context(extra = {}) {
  const c = vm.createContext({ window: {}, ...extra });
  vm.runInContext(helper, c);
  return c;
}
const catalog = (type = 'movie') => ({
  id: 'mdblist.123', name: 'Selected list', type, source: 'mdblist', enabled: false,
  showInHome: false, enableRatingPosters: false, genreSelection: 'standard',
  metadata: { url: 'https://mdblist.com/lists/example/list', countrySlug: 'us' },
});

test('catalog-share export handles the production library without carrying poster or account settings', () => {
  const input = copy(Array.isArray(library) ? library : library.catalogs);
  const before = copy(input);
  const c = context({ input });
  const payload = copy(vm.runInContext('window.KollectionCatalogExport.buildPayload(input)', c));
  assert.deepEqual(Object.keys(payload).sort(), ['catalogs', 'exportedAt', 'version']);
  assert.equal(payload.version, 1);
  assert.ok(Number.isFinite(Date.parse(payload.exportedAt)));
  assert.equal(payload.catalogs.length, new Set(input.map(x => JSON.stringify([x.id, x.type]))).size);
  for (const row of payload.catalogs) {
    assert.ok(['id', 'name', 'type', 'source'].every(key => row[key]));
    assert.equal(row.enabled, true);
    assert.equal(Object.hasOwn(row, 'enableRatingPosters'), false);
  }
  assert.deepEqual(input, before);
});

test('deduplication keeps movie and series routes, filters, and discover definitions', () => {
  const movie = { ...catalog(), apiKeys: { tmdb: 'secret' }, customPosterUrlPattern: 'override',
    metadata: { discover: { source: 'tmdb', params: { with_genres: '28' } }, useUpstreamArt: true } };
  const c = context({ input: [movie, movie, catalog('series')] });
  const payload = copy(vm.runInContext('window.KollectionCatalogExport.buildPayload(input)', c));
  assert.equal(payload.catalogs.length, 2);
  assert.deepEqual(payload.catalogs[0].metadata, { discover: movie.metadata.discover });
  assert.equal(payload.catalogs[0].genreSelection, 'standard');
  assert.doesNotMatch(JSON.stringify(payload), /secret|customPosterUrlPattern|enableRatingPosters|useUpstreamArt/);
  const existing = { ...catalog(), enableRatingPosters: false, personalField: 'keep' };
  const merged = { ...existing, ...payload.catalogs[0] };
  assert.equal(merged.enableRatingPosters, false, 'Merge preserves an existing per-catalog preference');
  assert.equal(merged.personalField, 'keep');
  assert.equal(payload.catalogs[1].enableRatingPosters !== false, true, 'new catalogs inherit global posters');
});

test('wizard exports all selected chunks in one file without preparing a full configuration', () => {
  const downloads = [];
  const state = { aiChunks: [{ catalogs: [catalog()] }, { catalogs: [catalog('series'), catalog()] }] };
  const before = copy(state);
  const c = context({ state, aioExportSlug: () => 'My-setup', downloadJson: (name, data) => downloads.push({ name, data: copy(data) }),
    alert: message => assert.fail(message) });
  vm.runInContext(section(wizard, '  function downloadCurrentAioCatalogs()', '  window.KollectionAioExport ='), c);
  assert.equal(vm.runInContext('downloadCurrentAioCatalogs()', c), true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'AIOMetadata-Catalogs-My-setup.json');
  assert.equal(downloads[0].data.catalogs.length, 2);
  assert.deepEqual(state, before);
});

function savedHarness(collection, files = {}) {
  const downloads = [], requests = [], status = {};
  const button = { textContent: 'Export catalogs only', disabled: false };
  const c = context({ button, status, item: { id: 'saved-one', name: 'My setup' },
    document: { getElementById: () => status },
    downloadJson: (name, data) => downloads.push({ name, data: copy(data) }),
    fetch: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET' });
      assert.equal(options?.method || 'GET', 'GET', 'catalog exports must be read-only');
      if (url === '/api/account/collections/saved-one') return { ok: true, json: async () => ({ collection }) };
      assert.ok(Object.hasOwn(files, url), `Unexpected request: ${url}`);
      return { ok: true, text: async () => files[url], json: async () => files[url] };
    },
  });
  vm.runInContext(section(account, '  async function readJson(', '  function downloadJson(') +
    section(account, '  function exportSlug(', '  function formatDate('), c);
  return { c, downloads, requests, status, button };
}

test('saved export combines snapshots and never downloads saved API keys or full-config settings', async () => {
  const h = savedHarness({ name: 'My setup', secrets: { tmdbKey: 'private-key' }, config: { aiometadataExports: [
    { config: { catalogs: [catalog()], posterRatingProvider: 'custom', customPosterUrlPattern: 'better-posters', search: { enabled: false } } },
    { config: { catalogs: [catalog('series')] } },
  ] } });
  await vm.runInContext('exportSavedAiMetadata(item, button, true)', h.c);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].data.catalogs.length, 2);
  assert.doesNotMatch(JSON.stringify(h.downloads), /private-key|better-posters|posterRatingProvider|search|apiKeys/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Export catalogs only');
  assert.match(h.status.textContent, /Catalogs → Import → Merge/);
});

test('legacy exports use only selected groups and folders, including empty folder selections', async () => {
  const folder = (id, type = 'movie') => ({ id, sources: [{ addonId: 'aio-metadata', catalogId: 'mdblist.123', type }] });
  const h = savedHarness({ config: { selectedCollectionGroupIds: ['selected', 'empty'],
    selectedCollectionFolderIds: { selected: ['keep'], empty: [] } } }, {
    '/runtime/database.kaoxt.js': 'window.NUVIO_DATABASE = ' + JSON.stringify([
      { id: 'selected', folders: [folder('keep'), folder('drop', 'series')] },
      { id: 'empty', folders: [folder('drop', 'series')] },
      { id: 'unselected', folders: [folder('drop', 'series')] },
    ]) + ';',
    '/runtime/kaoxt-aio-catalogs.json': [catalog(), catalog('series')],
  });
  await vm.runInContext('exportSavedAiMetadata(item, button, true)', h.c);
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.downloads[0].data.catalogs.map(x => x.type), ['movie']);
  assert.equal(h.requests.length, 3, 'no base configuration or migration write is needed');
});

test('empty and unavailable custom exports fail clearly without downloading a misleading file', async () => {
  const c = context();
  assert.throws(() => vm.runInContext('window.KollectionCatalogExport.buildPayload([])', c), /No AIOMetadata catalogs/);
  assert.throws(() => vm.runInContext('window.KollectionCatalogExport.buildPayload([{}])', c), /missing/);
  const h = savedHarness({ config: { aiSetupMode: 'custom' } });
  await vm.runInContext('exportSavedAiMetadata(item, button, true)', h.c);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /re-upload/);
});
