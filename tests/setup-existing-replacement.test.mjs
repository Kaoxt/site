import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const setupSource = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');

test('ineligible profiles stay blocked and offer a clear-current-collection action', () => {
  assert.match(setupSource, /This Nuvio profile is using a collection that was not created through The Kollection/);
  assert.match(setupSource, />Clear Current Collection<\/button>/);
  assert.match(setupSource, /if \(next\) next\.disabled = true/);
  assert.match(setupSource, /KollectionCollectionEligibility\.clear\(state\.profileId\)/);
  assert.match(setupSource, /does not delete the profile, add-ons, plugins, or saved Kollection setups/);
});

test('Update Existing replaces collection groups and retires stale AIOMetadata addons', () => {
  assert.match(setupSource, /setupQuery\.get\('update'\) === '1'/);
  assert.match(setupSource, /state\.previewCollections = setupUpdatesExisting\s*\? previewPack/);
  assert.match(setupSource, /state\.finalCollections = setupUpdatesExisting\s*\? finalPack/);
  assert.match(setupSource, /previousAiMetadataAddons/);
  assert.match(setupSource, /removePreviousAiMetadataAddons\(ai\.installs\)/);

  const pushIndex = setupSource.indexOf('await pushCollections(state.finalCollections)');
  const removeIndex = setupSource.indexOf('await removePreviousAiMetadataAddons(ai.installs)');
  assert.ok(pushIndex >= 0 && removeIndex > pushIndex, 'old AIOMetadata is removed only after the updated collection is synced');
});

test('Update Existing targets the profile linked to the selected saved setup', () => {
  assert.match(setupSource, /next\.searchParams\.set\('targetProfile', String\(targetId\)\)/);
  assert.match(setupSource, /const preferredId = requestedProfileId \|\| storedActiveProfileId\(\)/);
});
