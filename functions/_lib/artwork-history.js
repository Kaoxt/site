// R2's uploaded date is a storage write time, not an artwork upload history.
export const ARTWORK_HISTORY_KEY = '_kollection/artwork-history.json';

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function etag(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

export async function readArtworkHistory(bucket) {
  try {
    const object = await bucket.get(ARTWORK_HISTORY_KEY);
    if (!object) return {};
    const data = await object.json();
    return data?.version === 1 && data.images && typeof data.images === 'object'
      && !Array.isArray(data.images) ? data.images : {};
  } catch (error) {
    // A history failure must not hide the artwork library itself.
    console.warn('Artwork history unavailable:', error?.message || error);
    return {};
  }
}

export function artworkUploadedAt(object, history = {}) {
  // Explicit site uploads retain their own time even when the same bytes are
  // uploaded again and Git has no new content change to record.
  const recorded = isoDate(object.customMetadata?.['artwork-uploaded-at']);
  if (recorded) return recorded;

  const entry = history[object.key];
  const currentEtag = etag(object.etag || object.httpEtag);
  // Never apply an older image's history to a replacement awaiting sync.
  if (entry && currentEtag && etag(entry.etag) === currentEtag
      && Number(entry.size) === Number(object.size)) {
    return isoDate(entry.uploaded);
  }

  // Legacy storage dates were reset by full syncs; do not label them uploads.
  // These files remain in All Artwork and get real dates after history sync.
  return null;
}
