import { Container, getContainer } from '@cloudflare/containers';

export class PosterRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
}

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!authorized(request, env)) {
      return json({ error: 'Unauthorized renderer request.' }, 401);
    }

    if (url.pathname !== '/render' && url.pathname !== '/health') {
      return json({ error: 'Not found.' }, 404);
    }

    const instance = getContainer(env.POSTER_RENDERER, 'primary');
    return instance.fetch(request);
  },
};
