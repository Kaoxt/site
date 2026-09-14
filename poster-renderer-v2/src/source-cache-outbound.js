const SOURCE_PREFIX = 'poster-source/tmdb-source-art-v1/';
const MAX_BYTES = 8 * 1024 * 1024;

function objectKey(request) {
  const match = new URL(request.url).pathname.match(/^\/v1\/([0-9a-f]{64})\.bin$/);
  return match ? `${SOURCE_PREFIX}${match[1]}.bin` : '';
}

function contentType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') ? type : 'application/octet-stream';
}

export async function sourceCacheOutbound(request, env) {
  const key = objectKey(request);
  if (!key) return new Response(null, { status: 404 });

  if (request.method === 'GET') {
    const object = await env.SOURCE_ART.get(key);
    if (!object) return new Response(null, { status: 404 });
    const metadata = object.customMetadata || {};
    if (Number(metadata.retentionUntil || 0) <= Date.now()) {
      await env.SOURCE_ART.delete(key);
      return new Response(null, { status: 404 });
    }
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
        'x-source-fetched-at': metadata.fetchedAt || '',
        'x-source-last-accessed-at': metadata.lastAccessedAt || '',
        'x-source-retention-until': metadata.retentionUntil || '',
      },
    });
  }

  if (request.method === 'PUT') {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
    const accessedAt = Number(request.headers.get('x-source-accessed-at') || Date.now());
    const fetchedAt = Number(request.headers.get('x-source-fetched-at') || accessedAt);
    const retentionUntil = Number(request.headers.get('x-source-retention-until') || accessedAt);
    await env.SOURCE_ART.put(key, bytes, {
      httpMetadata: { contentType: contentType(request.headers.get('x-source-content-type')) },
      customMetadata: {
        fetchedAt: String(fetchedAt),
        lastAccessedAt: String(accessedAt),
        retentionUntil: String(retentionUntil),
      },
    });
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 405 });
}

export async function pruneExpiredSourceArt(env, now = Date.now(), maxPages = 10) {
  let cursor;
  let pages = 0;
  do {
    const page = await env.SOURCE_ART.list({
      prefix: SOURCE_PREFIX,
      cursor,
      limit: 1000,
      include: ['customMetadata'],
    });
    const expired = (page.objects || [])
      .filter(object => Number(object.customMetadata?.retentionUntil || 0) <= now)
      .map(object => object.key);
    if (expired.length) await env.SOURCE_ART.delete(expired);
    cursor = page.truncated ? page.cursor : undefined;
    pages++;
  } while (cursor && pages < maxPages);
}
