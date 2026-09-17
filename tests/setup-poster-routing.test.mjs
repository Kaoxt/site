import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { decodePosterConfig, encodePosterConfig } from '../functions/_lib/poster-config-token.js';
import { decodeBetterPostersConfig, encodeBetterPostersConfig } from '../functions/_lib/better-posters-config-token.js';

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
  assert.match(source, /state\.betterPostersEnabled = nextEnabled/);
  assert.match(source, /state\.betterPostersSettings = nextSettings/);

  const nativeUi = await readFile(new URL('../set-up-collection/better-posters-native-ui.js', import.meta.url), 'utf8');
  assert.match(nativeUi, /data-better-native-trend/);
  assert.match(nativeUi, /Better Posters controls the exact tag text/);
  assert.match(nativeUi, /native Trend Tags exactly as supplied by btttr\.cc/);
});

test('collection folders use unique bridge addon IDs while preserving AIOMetadata poster URLs', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function provisionPosterBridges(ai)');
  const end = source.indexOf('function repointAioSources', start);
  const block = source.slice(start, end);
  assert.match(block, /posterBridgeManifestUrl\(upstream\.url\)/);
  assert.match(source, /betterPostersConfigId/);
  assert.match(source, /v: 5/);
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
  assert.match(source, /\[1, 2, 3, 4, 5\]\.includes\(config\.v\)/);
  assert.match(source, /passthroughPosters: config\.passthroughPosters === true/);
  assert.match(source, /prewarmPassthroughPosters/);
  assert.match(source, /x-kollection-poster-prewarm/);
  assert.match(source, /context\.waitUntil\(prewarmPassthroughPosters/);
  assert.match(source, /rewritePassthroughPayload/);
  assert.match(source, /betterPostersPosterUrl/);
  assert.match(source, /id: `tv\.kollection\.posters\.\$\{token\.slice\(0, 24\)\}`/);
});

test('k1 and k2 tokens both use the reliable TMDB artwork path', () => {
  assert.equal(decodePosterConfig('k1sd0sf')?.artworkProvider, 'tmdb');
  assert.equal(decodePosterConfig('k3sd0sf')?.artworkProvider, 'tmdb');
});

test('Better Posters helper generates the native Better Posters delivery pattern', () => {
  const settings = {
    genre: true,
    rating: true,
    qualityTags: false,
    ageRating: false,
    ratingSource: 'average',
    language: 'en',
    trendTags: true,
  };
  const token = BetterPosters.configId(settings);
  assert.equal(token, encodeBetterPostersConfig(settings));
  assert.equal(BetterPosters.pattern(settings), `https://kollection.tv/bp/${token}/{type}/{id}.webp`);
  assert.deepEqual(decodeBetterPostersConfig(token), BetterPosters.normalize(settings));
});

test('Better Posters AIOMetadata integration records btttr.cc as artwork and Trend provider', () => {
  const config = {
    posterRatingProvider: 'none',
    customPosterUrlPattern: '',
    enableRatingPostersForLibrary: false,
    catalogs: [{ id: 'home', enableRatingPosters: false }],
    kollectionPosters: { enabled: true },
  };
  BetterPosters.applyToAioConfig(config, {
    genre: true,
    rating: true,
    trendTags: true,
  });
  assert.equal(config.posterRatingProvider, 'custom');
  assert.equal(config.usePosterProxy, false);
  assert.equal(config.enableRatingPostersForLibrary, true);
  assert.match(config.customPosterUrlPattern, /^https:\/\/kollection\.tv\/bp\/b1[0-9a-z]+\/\{type\}\/\{id\}\.webp$/);
  assert.ok(config.catalogs.every(catalog => catalog.enableRatingPosters === true));
  assert.equal(config.kollectionPosters, undefined);
  assert.equal(config.kollectionBetterPosters?.version, 3);
  assert.equal(config.kollectionBetterPosters?.provider, 'btttr.cc');
  assert.equal(config.kollectionBetterPosters?.trendProvider, 'btttr.cc');
  assert.equal(config.kollectionBetterPosters?.hybridTrendLayer, undefined);
});

test('Better Posters uses one native Trend Tags switch and collapses legacy subsets', () => {
  const normalized = BetterPosters.normalize({ trendDetails: ['rank', 'inCinema'] });
  assert.equal(normalized.trendTags, true);
  assert.deepEqual(normalized.trendDetails, BetterPosters.TREND_DETAILS);

  const none = BetterPosters.normalize({ trendDetails: [] });
  assert.equal(none.trendTags, false);
  assert.deepEqual(none.trendDetails, []);
});

test('Better Posters delivery route resolves IDs and redirects directly to btttr.cc', async () => {
  const source = await readFile(new URL('../functions/bp/[[path]].js', import.meta.url), 'utf8');
  assert.match(source, /decodeBetterPostersConfig/);
  assert.match(source, /resolveNativeTarget/);
  assert.match(source, /nativeBetterPostersUrl/);
  assert.match(source, /TMDB_API/);
  assert.match(source, /append_to_response=external_ids/);
  assert.match(source, /x-kollection-better-posters-direct/);
  assert.match(source, /image\.tmdb\.org\/t\/p\/w500/);
  assert.doesNotMatch(source, /handlePosterV2/);
  assert.doesNotMatch(source, /overlayOnly/);
});

test('AIOMetadata always receives a concrete Better Posters token route with its reliable id placeholder', () => {
  const settings = BetterPosters.normalize({
    genre: true,
    rating: true,
    qualityTags: false,
    ageRating: false,
    ratingSource: 'average',
    language: 'en',
  });
  assert.equal(BetterPosters.configId(settings), 'b1600sf');
  assert.equal(
    BetterPosters.pattern(settings),
    'https://kollection.tv/bp/b1600sf/{type}/{id}.webp'
  );

  const none = BetterPosters.normalize({
    genre: true,
    rating: true,
    qualityTags: false,
    ageRating: false,
    ratingSource: 'average',
    language: 'en',
    trendTags: false,
  });
  assert.equal(
    BetterPosters.pattern(none),
    `https://kollection.tv/bp/${BetterPosters.configId(none)}/{type}/{id}.webp`
  );
});

test('legacy custom Trend subsets collapse to the same native Trend Tags configuration', () => {
  const subset = BetterPosters.normalize({
    genre: true,
    rating: true,
    trendDetails: ['director', 'studio'],
  });
  const nativeOn = BetterPosters.normalize({
    genre: true,
    rating: true,
    trendTags: true,
  });
  assert.deepEqual(subset.trendDetails, BetterPosters.TREND_DETAILS);
  assert.equal(BetterPosters.configId(subset), BetterPosters.configId(nativeOn));
});
