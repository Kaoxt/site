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
  assert.match(pattern, /v=22/);
  assert.match(pattern, /source=smart/);
  assert.match(pattern, /tags=genre%2Crating%2Ctrend/);
  assert.match(pattern, /ratingSource=average/);
  assert.match(pattern, /trendDetails=studio%2Cdirector%2Ccast%2Crank%2Crelease/);
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

test('Set Up Collection applies poster routing only when the user enables it', async () => {
  const source = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
  assert.match(source, /id="posterOverlaysEnabled"/);
  assert.match(source, /state\.posterOverlaysEnabled && window\.KollectionPosterSettings/);
  assert.match(source, /KollectionPosterSettings\.applyToAioConfig\(config, state\.posterSettings\)/);
});


test('saved collection setups persist the poster overlay selection', async () => {
  const source = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
  assert.match(source, /posterOverlaysEnabled: Boolean\(snapshot\.posterOverlaysEnabled\)/);
  assert.match(source, /kollection:restore-poster-settings/);
  assert.match(source, /posterSettingsJson/);
});
