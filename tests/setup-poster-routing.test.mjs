import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

await import('../set-up-collection/poster-settings.js');
const Posters = globalThis.KollectionPosterSettings;

test('Kollection poster pattern is valid for AIOMetadata placeholders', () => {
  const pattern = Posters.pattern({
    source: 'smart',
    tags: ['rating', 'trend', 'genre'],
    ratingSource: 'average',
  });
  assert.match(pattern, /^https:\/\/kollection\.tv\/api\/posters-v2\/\{type\}\/\{tmdb_id\}\.webp\?/);
  assert.match(pattern, /v=24/);
  assert.match(pattern, /source=smart/);
  assert.match(pattern, /tags=genre%2Crating%2Ctrend/);
  assert.match(pattern, /ratingSource=average/);
  assert.match(pattern, /trendDetails=studio%2Cdirector%2Ccast%2CinCinema%2Crank%2CnewMovie%2CcomingSoon%2CnewSeries%2CreturningSeries%2ClimitedSeries/);
  assert.match(pattern, /language=\{language_short\}/);
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
  assert.equal(config.usePosterProxy, true);
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
