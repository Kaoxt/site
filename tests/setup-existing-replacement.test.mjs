import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const setupSource = await readFile(new URL('../set-up-collection/set-up-collection.js', import.meta.url), 'utf8');
const savedSetupSource = await readFile(new URL('../set-up-collection/saved-setup.js', import.meta.url), 'utf8');
const eligibilitySource = await readFile(new URL('../nuvio-auth/collection-eligibility.js', import.meta.url), 'utf8');
const profileActionsSource = await readFile(new URL('../account/profile-actions.js', import.meta.url), 'utf8');

test('ineligible profiles stay blocked and offer a clear-current-collection action', () => {
  assert.match(setupSource, /This Nuvio profile is using a collection that was not created through The Kollection/);
  assert.match(setupSource, />Clear Current Collection<\/button>/);
  assert.match(setupSource, /if \(next\) next\.disabled = true/);
  assert.match(setupSource, /KollectionCollectionEligibility\.clear\(state\.profileId\)/);
  assert.match(setupSource, /does not delete the profile, add-ons, plugins, or saved Kollection setups/);
  assert.match(eligibilitySource, /remaining = await pullCollections\(id, accessToken\)/);
  assert.match(eligibilitySource, /Nuvio still reports \$\{remaining\.length\} collection group/);
  assert.match(profileActionsSource, /result\?\.cleared \|\| result\?\.state !== 'available' \|\| result\?\.existingCount !== 0/);
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


test('new runtime categories are selected automatically during Update Existing', () => {
  assert.match(savedSetupSource, /knownCollectionGroupIds/);
  assert.match(savedSetupSource, /autoSelectNewCollectionGroups: updateExistingSetup/);
  assert.match(savedSetupSource, /version: 4/);
  assert.match(setupSource, /LEGACY_KNOWN_COLLECTION_GROUP_IDS/);
  assert.match(setupSource, /if \(key && !known\.has\(key\)\) selected\.add\(key\)/);
});
