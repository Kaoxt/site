import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { decodePosterConfig, encodePosterConfig } from '../functions/_lib/poster-config-token.js';

await import('../posters/config-token.js');
await import('../set-up-collection/poster-settings.js');
const Posters = globalThis.KollectionPosterSettings;

test('Kollection poster pattern is valid for AIOMetadata placeholders', () => {
  const pattern = Posters.pattern({
    source: 'smart',
    tags: ['rating', 'trend', 'genre'],
    ratingSource: 'average',
  });
  assert.equal(Posters.configId({
    source: 'smart',
    tags: ['rating', 'trend', 'genre'],
    ratingSource: 'average',
  }), 'k1sd0sf');
  assert.equal(pattern, 'https://kollection.tv/p/k1sd0sf/{language_short}/{type}/{id}.webp');
});

test('AIOMetadata poster routing is enabled for every catalog and library meta', () => {
  const config = {
    posterRatingProvider: 'none',
    customPosterUrlPattern: '',
    enableRatingPostersForLibrary: false,
    catalogs: [
      { id: 'home', showInHome: true, enableRatingPosters: false },
      { id: 'folder-only', showInHome: false, enableRatingPosters: false },
      { id: 'another-folder', showInHome: false },
    ],
  };

  Posters.applyToAioConfig(config, {
    source: 'smart',
    tags: ['trend', 'genre', 'rating'],
    ratingSource: 'average',
  });

  assert.equal(config.posterRatingProvider, 'custom');
  assert.equal(config.usePosterProxy, false);
  assert.equal(config.enableRatingPostersForLibrary, true);
  assert.ok(config.customPosterUrlPattern.includes('kollection.tv/api/posters-v2'));
  assert.ok(config.catalogs.every(catalog => catalog.enableRatingPosters === true));
  assert.equal(config.catalogs.find(catalog => catalog.id === 'folder-only').showInHome, false);
});

test('Set Up Collection offers Smart Overlay Posters as an explicit opt-in', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  assert.match(source, /posterOverlaysEnabled: false/);
  assert.match(source, /id="posterOverlaysEnabled"/);
  assert.match(source, /Enable Smart Overlay Posters for this collection/);
  assert.match(source, /Off by default/);
  assert.match(source, /state\.posterOverlaysEnabled && window\.KollectionPosterSettings/);
  assert.match(source, /KollectionPosterSettings\.applyToAioConfig\(config, state\.posterSettings\)/);
  assert.match(source, /Smart Overlay Posters · \$\{state\.posterOverlaysEnabled \? 'Enabled' : 'Off'\}/);
});


test('saved collection setups persist the poster overlay selection', async () => {
  const source = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
  assert.match(source, /posterOverlaysEnabled: Boolean\(snapshot\.posterOverlaysEnabled\)/);
  assert.match(source, /kollection:restore-poster-settings/);
  assert.match(source, /posterSettingsJson/);
});


test('legacy grouped release preference expands into the new lifecycle choices', () => {
  const normalized = Posters.normalize({
    source: 'smart',
    tags: ['trend'],
    trendDetails: ['rank', 'release'],
  });
  assert.deepEqual(normalized.trendDetails, [
    'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'
  ]);
});


test('existing setup uses a Configure modal for Smart Overlay Poster options', async () => {
  const source = await readFile(new URL('../set-up-collection/folder-editor.js', import.meta.url), 'utf8');
  assert.match(source, /editingSavedSetup\(\)/);
  assert.match(source, /id="configureSmartOverlayBtn"/);
  assert.match(source, /root\.id = 'smartOverlayModalRoot'/);
  assert.match(source, /role="dialog"/);
  assert.match(source, />Configure<\/button>/);
  assert.match(source, />Save changes<\/button>/);
  assert.doesNotMatch(source, />Existing setup<\/span>/);
  assert.match(source, /id="posterOverlaysEnabled"/);
  assert.match(source, /id="posterSettingsJson"/);
  for (const tag of ['trend', 'quality', 'genre', 'rating', 'age']) {
    assert.ok(source.includes("['" + tag + "',"), 'missing overlay option ' + tag);
  }
  for (const detail of ['inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries']) {
    assert.ok(source.includes("['" + detail + "',"), 'missing Trend Tag detail ' + detail);
  }
  assert.match(source, /state\.posterOverlaysEnabled = nextEnabled/);
  assert.match(source, /state\.posterSettings = nextSettings/);
  assert.match(source, /kollection:poster-settings-changed/);
});


test('collection folders route directly through the exact AIOMetadata manifest catalog', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function provisionPosterBridges(ai)');
  const end = source.indexOf('function repointAioSources', start);
  const block = source.slice(start, end);
  assert.match(block, /state\.posterBridgeInstalls = \[\]/);
  assert.match(block, /ai\.catalogRoutes/);
  assert.doesNotMatch(block, /fetchAddonManifest\(bridgeUrl\)/);
  assert.match(source, /aioCatalogRouteKey\(source\.catalogId, source\.type\)/);
  assert.match(source, /source\.provider = 'addon'/);
  assert.match(source, /manifestCatalogs = manifest\.catalogs/);
  assert.match(source, /routeMatch\(catalog, manifestCatalogs\)/);
});

test('catalog provisioning keeps movie and series routes distinct', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  assert.match(source, /function aioCatalogRouteKey\(id, type\)/);
  assert.match(source, /normalizeAioCatalogType/);
  assert.match(source, /collectAioCatalogRefs/);
  assert.match(source, /catalog\.displayType/);
  assert.match(source, /catalogRoutes\[key\] = route/);
});


test('Smart Poster config token is deterministic, compact, and reversible', () => {
  const input = {
    source: 'smart',
    tags: ['rating', 'genre', 'trend'],
    ratingSource: 'average',
    trendDetails: ['studio', 'director', 'cast', 'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'],
  };
  const token = encodePosterConfig(input);
  assert.equal(token, 'k1sd0sf');
  assert.deepEqual(decodePosterConfig(token), {
    source: 'smart',
    tags: ['trend', 'genre', 'rating'],
    ratingSource: 'average',
    trendDetails: ['studio', 'director', 'cast', 'inCinema', 'rank', 'newMovie', 'comingSoon', 'newSeries', 'returningSeries', 'limitedSeries'],
    artworkProvider: 'tmdb',
  });
  assert.equal(globalThis.KollectionPosterConfigToken.encode(input), token);
});

test('different poster preferences receive different shared config IDs', () => {
  const base = { source: 'smart', tags: ['trend', 'genre', 'rating'], ratingSource: 'average' };
  const withoutGenre = { ...base, tags: ['trend', 'rating'] };
  const imdb = { ...base, ratingSource: 'imdb' };
  assert.notEqual(encodePosterConfig(base), encodePosterConfig(withoutGenre));
  assert.notEqual(encodePosterConfig(base), encodePosterConfig(imdb));
});
