import { readSession } from '../_lib/nuvio-session.js';
import { getPosterUsageStatus } from '../_lib/poster-safety.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env);
  const adminEmail = String(env.NUVIO_ADMIN_EMAIL || '').trim().toLowerCase();
  const sessionEmail = String(session?.email || '').trim().toLowerCase();

  if (!session || !adminEmail || sessionEmail !== adminEmail) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const status = await getPosterUsageStatus(env);
  return json({
    ...status,
    defaults: {
      behavior: 'Cache hits bypass render budgets. New renders stop at the configured limits.',
      budgetFallback: 'Original TMDB artwork is returned when the global render budget or concurrency guard blocks a render.',
      clientLimit: 'Per-client hourly overages receive HTTP 429.',
    },
  });
}
