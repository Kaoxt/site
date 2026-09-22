import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const editor = await readFile(new URL('../set-up-collection/folder-source-editor.js', import.meta.url), 'utf8');
function fn(text, name, next) { return text.slice(text.indexOf(`  function ${name}(`), text.indexOf(`  function ${next}(`)); }
const context = vm.createContext({ TextDecoder, Uint8Array, atob });
vm.runInContext(fn(source, 'normalizeAioCatalogType', 'synthesizeCatalog') + fn(source, 'repointAioSources', 'bingecatCatalogRank') + "function isBingecatSource(s) { return String(s?.addonId || '').startsWith('com.aicat.'); }", context);
const wrapped = 'kp0_' + Buffer.from('mdblist.190242_movie').toString('base64url');

test('installed bridge sources produce AIOMetadata catalogs and route to the new installation', () => {
  context.pack = [{ folders: [{ sources: [{ provider: 'addon', addonId: 'tv.kollection.posters.old', catalogId: wrapped, type: 'movie' }], catalogSources: [{ addonId: 'tv.kollection.posters.old', catalogId: wrapped, type: 'movie' }] }] }];
  const refs = vm.runInContext('collectAioCatalogRefs(pack)', context);
  assert.deepEqual(JSON.parse(JSON.stringify(refs)), [{ manifestId: 'mdblist.190242_movie', type: 'movie' }]);
  context.routes = { 'mdblist.190242_movie|movie': { addonId: 'tv.kollection.posters.new', catalogId: wrapped, type: 'movie' } };
  vm.runInContext('repointAioSources(pack, routes, "aio-metadata")', context);
  for (const list of ['sources', 'catalogSources']) assert.equal(context.pack[0].folders[0][list][0].addonId, 'tv.kollection.posters.new');
});

test('invalid bridge routes stop setup instead of silently dropping required catalogs', () => {
  context.invalid = { addonId: 'tv.kollection.posters.old', catalogId: 'broken' };
  assert.throws(() => vm.runInContext('aioSourceCatalogId(invalid)', context), /saved collection poster source is invalid/);
});

test('folder defaults retain runtime sources while preserving installed artwork', () => {
  const c = vm.createContext({ clone: value => structuredClone(value), keyFor: (g, f) => `${g}::${f}`, artworkFrom: folder => ({ coverImageUrl: folder.coverImageUrl }) });
  vm.runInContext(fn(editor, 'findExistingFolder', 'applyOverrides'), c);
  c.state = { existingCollections: [{ id: 'group', folders: [{ id: 'folder', sources: [{ addonId: 'tv.kollection.posters.old', catalogId: wrapped }], coverImageUrl: 'custom.webp' }] }] };
  c.folder = { id: 'folder', sources: [{ addonId: 'aio-metadata', catalogId: 'mdblist.190242' }], catalogSources: [] };
  const defaults = vm.runInContext('ensureDefaults(state, folder, "group", "folder", x => x.id, x => x.id)', c);
  assert.equal(defaults.sources[0].addonId, 'aio-metadata');
  assert.equal(defaults.sources[0].catalogId, 'mdblist.190242');
  assert.equal(defaults.artwork.coverImageUrl, 'custom.webp');
});

test('zero-install updates stop before any collection or add-on mutations', async () => {
  const start = source.indexOf('  async function installEverything()');
  const end = source.indexOf('  function formatSetupDate(', start);
  let mutations = 0;
  const c = vm.createContext({
    state: { backup: {}, collectionPack: [], aiNeededCatalogs: [], previousAiMetadataAddons: [{ id: 'old' }] },
    ensureSelectedProfileEligible: async () => true,
    provisionAiMetadata: async () => ({ installs: [] }),
    provisionPosterBridges: async () => { mutations++; },
  });
  vm.runInContext(source.slice(start, end), c);
  await assert.rejects(vm.runInContext('installEverything()', c), /No AIOMetadata configuration was created/);
  assert.equal(mutations, 0);
});
