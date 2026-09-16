import { Container, getContainer } from '@cloudflare/containers';
export { ContainerProxy } from '@cloudflare/containers';
import { pruneExpiredSourceArt, sourceCacheOutbound } from './source-cache-outbound.js';

export class PosterRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = '30m';
}

PosterRenderer.outboundByHost = {
  'source-cache.internal': sourceCacheOutbound,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function authorized(request, env) {
  const expected = String(env.RENDERER_AUTH_TOKEN || '');
  const provided = String(request.headers.get('x-kollection-render-key') || '');
  return Boolean(expected && provided && expected === provided);
}

function renderShard(request) {
  const requested = Number(request.headers.get('x-kollection-render-shard'));
  if (Number.isInteger(requested) && requested >= 0) return requested & 3;
  // Each distinct container name maps to a separate Cloudflare container
  // instance. CF-Ray is unique per request and cheap to hash, so unpinned
  // bursts are spread across the configured renderer instances.
  const key = request.headers.get('cf-ray') || crypto.randomUUID();
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash & 3;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!authorized(request, env)) {
      return json({ error: 'Unauthorized renderer request.' }, 401);
    }

    if (!['/render', '/warm', '/health'].includes(url.pathname)) {
      return json({ error: 'Not found.' }, 404);
    }

    const shard = url.pathname === '/health' ? 0 : renderShard(request);
    const instance = getContainer(env.POSTER_RENDERER, `primary-v27-${shard}`);
    return instance.fetch(request);
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(pruneExpiredSourceArt(env).catch(() => {}));
  },
};
