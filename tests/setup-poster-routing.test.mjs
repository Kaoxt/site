import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { decodePosterConfig, encodePosterConfig } from '../functions/_lib/poster-config-token.js';

await import('../posters/config-token.js');
await import('../set-up-collection/poster-settings.js');
await import('../set-up-collection/better-posters-settings.js');
const Posters = globalThis.KollectionPosterSettings;
const BetterPosters = globalThis.KollectionBetterPostersSettings;

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
  }), 'k3sd0sf');
  assert.equal(pattern, 'https://kollection.tv/p/k3sd0sf/{language_short}/{type}/{id}.webp');
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
  assert.match(config.customPosterUrlPattern, /^https:\/\/kollection\.tv\/p\/k3[0-9a-z]+\/\{language_short\}\/\{type\}\/\{id\}\.webp$/);
  assert.ok(config.catalogs.every(catalog => catalog.enableRatingPosters === true));
  assert.equal(config.catalogs.find(catalog => catalog.id === 'folder-only').showInHome, false);
});

test('Set Up Collection offers Better Posters instead of Kollection Smart Overlay Posters', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  assert.match(source, /betterPostersEnabled: false/);
  assert.match(source, /id="betterPostersEnabled"/);
  assert.match(source, /Use Better Posters with this collection/);
  assert.match(source, /Off by default/);
  assert.match(source, /state\.betterPostersEnabled && window\.KollectionBetterPostersSettings/);
  assert.match(source, /KollectionBetterPostersSettings\.applyToAioConfig\(config, state\.betterPostersSettings\)/);
  assert.doesNotMatch(source, /Enable Smart Overlay Posters for this collection/);
});


test('saved collection setups persist Better Posters preferences', async () => {
  const source = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
  assert.match(source, /betterPostersEnabled: Boolean\(snapshot\.betterPostersEnabled\)/);
  assert.match(source, /kollection:restore-better-posters-settings/);
  assert.match(source, /betterPostersSettingsJson/);
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


test('existing saved setups use a Configure modal for Better Posters', async () => {
  const source = await readFile(new URL('../set-up-collection/folder-editor.js', import.meta.url), 'utf8');
  assert.match(source, /editingSavedSetup\(\)/);
  assert.match(source, /id="configureBetterPostersBtn"/);
  assert.match(source, /betterPostersModalRoot/);
  assert.match(source, /role="dialog"/);
  assert.match(source, />Configure<\/button>/);
  assert.match(source, />Save changes<\/button>/);
  assert.match(source, /id="betterPostersEnabled"/);
  assert.match(source, /id="betterPostersSettingsJson"/);
  for (const option of ['trendTags', 'qualityTags', 'genre', 'rating', 'ageRating']) {
    assert.ok(source.includes("['" + option + "',"), 'missing Better Posters option ' + option);
  }
  assert.match(source, /Trend Tags are one switch/);
  assert.match(source, /state\.betterPostersEnabled = nextEnabled/);
  assert.match(source, /state\.betterPostersSettings = nextSettings/);
});

test('collection folders use unique bridge addon IDs while preserving AIOMetadata poster URLs', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function provisionPosterBridges(ai)');
  const end = source.indexOf('function repointAioSources', start);
  const block = source.slice(start, end);
  assert.match(block, /posterBridgeManifestUrl\(upstream\.url\)/);
  assert.match(block, /fetchAddonManifest\(url\)/);
  assert.match(block, /bridgeByInstallUrl/);
  assert.match(block, /posterBridgeCatalogId\(upstreamRoute\.catalogId\)/);
  assert.match(block, /state\.posterBridgeInstalls = installs/);
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
  assert.equal(token, 'k3sd0sf');
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


test('token poster route is importable and wired to the v2 engine', async () => {
  const route = await import('../functions/p/[[path]].js');
  assert.equal(typeof route.onRequest, 'function');
  const source = await readFile(new URL('../functions/p/[[path]].js', import.meta.url), 'utf8');
  assert.match(source, /decodePosterConfig/);
  assert.match(source, /handlePosterV2/);
  assert.match(source, /caches\.default\.match/);
  assert.match(source, /caches\.default\.put/);
});


test('poster bridge passthrough mode preserves upstream overlay poster URLs', async () => {
  const source = await readFile(new URL('../functions/api/posters-addon/[[path]].js', import.meta.url), 'utf8');
  assert.match(source, /\[1, 2, 3, 4\]\.includes\(config\.v\)/);
  assert.match(source, /passthroughPosters: config\.passthroughPosters === true/);
  assert.match(source, /config\.passthroughPosters \? payload : rewritePayload\(payload, config, type\)/);
  assert.match(source, /id: `tv\.kollection\.posters\.\$\{token\.slice\(0, 24\)\}`/);
});


test('k1 and k2 tokens both use the reliable TMDB artwork path', () => {
  assert.equal(decodePosterConfig('k1sd0sf')?.artworkProvider, 'tmdb');
  assert.equal(decodePosterConfig('k3sd0sf')?.artworkProvider, 'tmdb');
});


test('Better Posters helper generates the official btttr.cc AIOMetadata pattern', () => {
  assert.equal(
    BetterPosters.pattern({ trendTags: true, genre: true, rating: true, qualityTags: false, ageRating: false, ratingSource: 'average', language: 'en' }),
    'https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg'
  );
  assert.equal(
    BetterPosters.pattern({ trendTags: false, genre: false, rating: true, qualityTags: true, ageRating: true, ratingSource: 'imdb', language: 'fr' }),
    'https://btttr.cc/poster-rqa/imdb/poster-default/{imdb_id}.jpg?tag=none&lang=fr&rs=IM'
  );
});

test('Better Posters AIOMetadata integration enables the custom poster pattern without the Kollection renderer', () => {
  const config = {
    posterRatingProvider: 'none',
    customPosterUrlPattern: '',
    enableRatingPostersForLibrary: false,
    catalogs: [{ id: 'home', enableRatingPosters: false }],
    kollectionPosters: { enabled: true },
  };
  BetterPosters.applyToAioConfig(config, { trendTags: true, genre: true, rating: true });
  assert.equal(config.posterRatingProvider, 'custom');
  assert.equal(config.usePosterProxy, false);
  assert.equal(config.enableRatingPostersForLibrary, true);
  assert.match(config.customPosterUrlPattern, /^https:\/\/btttr\.cc\//);
  assert.ok(config.catalogs.every(catalog => catalog.enableRatingPosters === true));
  assert.equal(config.kollectionPosters, undefined);
  assert.equal(config.kollectionBetterPosters?.provider, 'btttr.cc');
});

test('Better Posters Trend Tags are exposed as one native on/off option', () => {
  const source = BetterPosters.pattern({ trendTags: false });
  assert.match(source, /[?&]tag=none(?:&|$)/);
  assert.equal(BetterPosters.normalize({ trendTags: true }).trendTags, true);
});
