import { Container } from '@cloudflare/containers';
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
      'x-kollection-renderer': 'retired',
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!['/render', '/warm', '/health'].includes(url.pathname)) {
      return json({ error: 'Not found.' }, 404);
    }

    // The Kollection renderer is permanently retired in favor of Better Posters.
    // Requests to this legacy hostname must never start a Cloudflare Container
    // instance or accrue Container Memory usage.
    return json({
      error: 'Kollection poster rendering is retired.',
      provider: 'Better Posters',
      rendering: 'none',
    }, 410);
  },

  async scheduled(_controller, env, context) {
    // R2 housekeeping only. This does not start a Container instance.
    context.waitUntil(pruneExpiredSourceArt(env).catch(() => {}));
  },
};
