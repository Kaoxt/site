import { guardAuthRequest } from '../../_lib/auth-guard.js';
const policies = {
  '/api/auth/nuvio-connect': ['connect', 30, 600],
  '/api/auth/nuvio/start': ['start', 10, 600],
  '/api/auth/nuvio/poll': ['poll', 120, 60],
};
export async function onRequest(context) {
  const policy = policies[new URL(context.request.url).pathname.replace(/\/$/, '')];
  let response;
  try {
    if (policy && context.request.method === 'POST') response = await guardAuthRequest(context, ...policy);
    response ||= await context.next();
  } catch {
    // Never expose a Cloudflare HTML error page or erase a valid cookie because
    // an authentication dependency failed temporarily.
    console.error('Kollection auth request unavailable', {
      path: new URL(context.request.url).pathname,
      ray: context.request.headers.get('cf-ray') || '',
    });
    response = Response.json({
      error: 'Your account is temporarily unavailable. Please try again in a moment.',
      code: 'AUTH_UNAVAILABLE',
    }, { status: 503 });
  }
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  return secured;
}
