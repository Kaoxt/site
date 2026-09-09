import { readSession, refreshSessionIfNeeded } from '../../_lib/nuvio-session.js';
import { normalizeName, parseRow, requireDb, sanitizeConfig } from '../../_lib/saved-collections.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

async function accountSession(context) {
  const current = await readSession(context.request, context.env || {});
  if (!current) return { session: null, cookie: null };
  return refreshSessionIfNeeded(current, context.env || {});
}

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});

    const db = requireDb(context.env);
    const result = await db.prepare(
      `SELECT id, name, nuvio_profile_id, nuvio_profile_name, config_json, created_at, updated_at
       FROM kollection_saved_collections
       WHERE user_id = ?1
       ORDER BY updated_at DESC`
    ).bind(auth.session.id).all();

    return json({ collections: (result.results || []).map(parseRow) }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not load saved collections.' }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});

    const input = await context.request.json().catch(() => ({}));
    const { clean, json: configJson } = sanitizeConfig(input.config);
    const id = crypto.randomUUID();
    const name = normalizeName(input.name);
    const profileId = Number.isFinite(Number(input.nuvioProfileId)) ? Number(input.nuvioProfileId) : null;
    const profileName = String(input.nuvioProfileName || '').trim().slice(0, 120);
    const db = requireDb(context.env);

    await db.prepare(
      `INSERT INTO kollection_saved_collections
        (id, user_id, name, nuvio_profile_id, nuvio_profile_name, config_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, auth.session.id, name, profileId, profileName || null, configJson).run();

    return json({
      collection: {
        id,
        name,
        nuvioProfileId: profileId,
        nuvioProfileName: profileName,
        config: clean,
      },
    }, 201, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not save collection.' }, 400);
  }
}
