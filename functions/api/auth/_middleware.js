import { guardAuthRequest } from '../../_lib/auth-guard.js';
const policies = {
  '/api/auth/nuvio-connect': ['connect', 30, 600],
  '/api/auth/nuvio/start': ['start', 10, 600],
  '/api/auth/nuvio/poll': ['poll', 120, 60],
};
export async function onRequest(context) {
  const policy = policies[new URL(context.request.url).pathname.replace(/\/$/, '')];
  let response;
  if (policy && context.request.method === 'POST') response = await guardAuthRequest(context, ...policy);
  response ||= await context.next();
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  return secured;
}
