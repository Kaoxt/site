import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkUploadedAt, readArtworkHistory, ARTWORK_HISTORY_KEY } from '../functions/_lib/artwork-history.js';

const key = 'images/World/South Korea/backdrop.webp';
const object = { key, etag: 'abc', size: 12, uploaded: new Date('2026-09-30T02:58:00Z') };
const history = { [key]: { etag: 'abc', size: 12, uploaded: '2026-09-15T10:00:00Z' } };

test('restores real source date instead of mass sync date', () => {
  assert.equal(artworkUploadedAt(object, history), '2026-09-15T10:00:00.000Z');
});
test('explicit upload metadata overrides older identical content history', () => {
  assert.equal(artworkUploadedAt({ ...object, customMetadata: { 'artwork-uploaded-at': '2026-09-30T02:57:49Z' } }, history), '2026-09-30T02:57:49.000Z');
});
test('unknown storage dates do not masquerade as new uploads', () => {
  assert.equal(artworkUploadedAt(object), null);
});
test('does not use history from a replaced image', () => {
  assert.equal(artworkUploadedAt({ ...object, etag: 'def' }, history), null);
  assert.equal(artworkUploadedAt({ ...object, size: 13 }, history), null);
});
test('normalizes quoted ETags and supports multipart ETags', () => {
  assert.equal(artworkUploadedAt({ ...object, etag: '"abc"' }, history), '2026-09-15T10:00:00.000Z');
  assert.equal(artworkUploadedAt({ ...object, etag: 'xyz-2' }, { [key]: { ...history[key], etag: 'xyz-2' } }), '2026-09-15T10:00:00.000Z');
});
test('invalid dates cannot break the image library', () => {
  assert.equal(artworkUploadedAt({ ...object, customMetadata: { 'artwork-uploaded-at': 'invalid' } }, history), '2026-09-15T10:00:00.000Z');
  assert.equal(artworkUploadedAt(object, { [key]: { ...history[key], uploaded: 'invalid' } }), null);
});
test('loads versioned history from the dedicated non-image key', async () => {
  assert.deepEqual(await readArtworkHistory({ async get(path) { assert.equal(path, ARTWORK_HISTORY_KEY); return { async json() { return { version: 1, images: history }; } }; } }), history);
});
test('missing, failed or invalid history does not fail artwork listing', async () => {
  assert.deepEqual(await readArtworkHistory({ async get() { return null; } }), {});
  assert.deepEqual(await readArtworkHistory({ async get() { throw new Error('unavailable'); } }), {});
  assert.deepEqual(await readArtworkHistory({ async get() { return { async json() { return { version: 2, images: history }; } }; } }), {});
});
