import { readSession, refreshSessionIfNeeded } from '../../../_lib/nuvio-session.js';
import { normalizeName, parseRow, requireDb, sanitizeConfig } from '../../../_lib/saved-collections.js';

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

async function ownedRow(db, id, userId) {
  return db.prepare(
    `SELECT id, name, nuvio_profile_id, nuvio_profile_name, config_json, created_at, updated_at
     FROM kollection_saved_collections WHERE id = ?1 AND user_id = ?2`
  ).bind(id, userId).first();
}

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const row = await ownedRow(requireDb(context.env), context.params.id, auth.session.id);
    if (!row) return json({ error: 'Saved collection not found.' }, 404);
    return json({ collection: parseRow(row) }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not load saved collection.' }, 500);
  }
}

export async function onRequestPut(context) {
  return update(context);
}

export async function onRequestPatch(context) {
  return update(context);
}

async function update(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});

    const db = requireDb(context.env);
    const existing = await ownedRow(db, context.params.id, auth.session.id);
    if (!existing) return json({ error: 'Saved collection not found.' }, 404);

    const input = await context.request.json().catch(() => ({}));
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const profileId = input.nuvioProfileId === undefined
      ? existing.nuvio_profile_id
      : (Number.isFinite(Number(input.nuvioProfileId)) ? Number(input.nuvioProfileId) : null);
    const profileName = input.nuvioProfileName === undefined
      ? (existing.nuvio_profile_name || '')
      : String(input.nuvioProfileName || '').trim().slice(0, 120);
    const { clean, json: configJson } = input.config === undefined
      ? { clean: parseRow(existing).config, json: existing.config_json }
      : sanitizeConfig(input.config);

    await db.prepare(
      `UPDATE kollection_saved_collections
       SET name = ?1, nuvio_profile_id = ?2, nuvio_profile_name = ?3, config_json = ?4,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?5 AND user_id = ?6`
    ).bind(name, profileId, profileName || null, configJson, context.params.id, auth.session.id).run();

    return json({
      collection: {
        id: context.params.id,
        name,
        nuvioProfileId: profileId == null ? null : Number(profileId),
        nuvioProfileName: profileName,
        config: clean,
      },
    }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not update saved collection.' }, 400);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const db = requireDb(context.env);
    const result = await db.prepare(
      'DELETE FROM kollection_saved_collections WHERE id = ?1 AND user_id = ?2'
    ).bind(context.params.id, auth.session.id).run();
    if (!result.meta?.changes) return json({ error: 'Saved collection not found.' }, 404);
    return json({ deleted: true }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not delete saved collection.' }, 500);
  }
}
