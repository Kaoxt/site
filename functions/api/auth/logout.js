import {
  assertSameOrigin,
  clearSessionCookie,
} from '../../_lib/nuvio-session.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, ...extraHeaders },
  });
}

export async function onRequestPost(context) {
  if (!assertSameOrigin(context.request)) {
    return json({ error: 'Cross-origin logout requests are not allowed.' }, 403);
  }

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': clearSessionCookie() }
  );
}

export function onRequestGet() {
  return json({ error: 'POST only.' }, 405);
}
