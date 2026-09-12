import {
  authServerReady,
  isAdminUser,
  readSession,
} from '../../_lib/nuvio-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function publicUrl(origin, key, version = '') {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${origin}/${encoded}${suffix}`;
}

function metadataFor(object, origin) {
  const key = String(object.key || '');
  const parts = key.split('/').filter(Boolean);

  // images / Category / ... / Folder / filename
  const filename = parts.at(-1) || '';
  const category = parts[1] || '';
  const folderParts = parts.slice(2, -1);
  const folder = folderParts.at(-1) || category || '';

  return {
    key,
    path: key.replace(/^images\//, ''),
    url: publicUrl(origin, key, object.httpEtag || object.etag || ''),
    filename,
    category,
    folder,
    size: Number(object.size || 0),
    uploaded: object.uploaded ? new Date(object.uploaded).toISOString() : null,
    etag: object.httpEtag || object.etag || null,
  };
}

export async function onRequestGet(context) {
  try {
    const env = context.env || {};

    if (!authServerReady(env)) {
      return response({
        error: 'Administrator authentication is not configured on this Pages project.',
      }, 500);
    }

    if (!env.IMAGES) {
      return response({
        error: 'The Cloudflare R2 binding named IMAGES is not configured.',
      }, 500);
    }

    const session = await readSession(context.request, env);

    if (!session) {
      return response({ error: 'Sign in with Nuvio to view the image library.' }, 401);
    }

    if (!isAdminUser(session, env)) {
      return response({ error: 'This Nuvio account is not authorized to view the image library.' }, 403);
    }

    const url = new URL(context.request.url);
    const cursor = url.searchParams.get('cursor') || undefined;

    const listing = await env.IMAGES.list({
      prefix: 'images/',
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const images = (listing.objects || [])
      .filter((object) => /\.(?:webp|png|jpe?g|gif|avif)$/i.test(object.key || ''))
      .map((object) => metadataFor(object, url.origin));

    return response({
      images,
      cursor: listing.truncated ? (listing.cursor || null) : null,
      truncated: Boolean(listing.truncated),
    });
  } catch (error) {
    console.error('Image library error:', error);
    return response({
      error: 'The image library could not be loaded from R2.',
    }, 500);
  }
}
