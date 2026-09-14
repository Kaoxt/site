import { assertSameOrigin, readSession, refreshSessionIfNeeded } from '../../_lib/nuvio-session.js';
import { normalizeName, parseRow, savedCollectionsDb, sanitizeConfig, storageConfig } from '../../_lib/saved-collections.js';
import { encryptSavedSecrets } from '../../_lib/saved-secrets.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const MAX_SETUPS_PER_PROFILE = 10;
function json(body, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } }); }
async function accountSession(context) {
  const current = await readSession(context.request, context.env || {});
  if (!current) return { session: null, cookie: null };
  return refreshSessionIfNeeded(current, context.env || {});
}
const SELECT = `id, name, config_json, draft_step, last_nuvio_profile_id, last_nuvio_profile_name, last_applied_at, created_at, updated_at`;
const TABLE = 'saved_collections_v2';

async function duplicateName(db, userId, profileId, name) {
  return db.prepare(
    `SELECT id FROM ${TABLE}
     WHERE user_id = ?1
       AND last_nuvio_profile_id IS ?2
       AND lower(name) = lower(?3)
     LIMIT 1`
  ).bind(userId, profileId, name).first();
}

async function profileSetupCount(db, userId, profileId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total FROM ${TABLE}
     WHERE user_id = ?1 AND last_nuvio_profile_id IS ?2`
  ).bind(userId, profileId).first();
  return Number(row?.total || 0);
}

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const db = await savedCollectionsDb(context.env);
    const result = await db.prepare(
      `SELECT ${SELECT} FROM ${TABLE} WHERE user_id = ?1 ORDER BY updated_at DESC`
    ).bind(auth.session.id).all();
    return json({ collections: (result.results || []).map(parseRow) }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not load saved collections.' }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    if (!assertSameOrigin(context.request)) return json({ error: 'Invalid request origin.' }, 403);
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const input = await context.request.json().catch(() => ({}));
    const { clean } = sanitizeConfig(input.config);
    const encryptedSecrets = await encryptSavedSecrets(input.secrets, context.env || {});
    const configJson = storageConfig(clean, encryptedSecrets);
    const id = crypto.randomUUID();
    const name = normalizeName(input.name);
    const draftStep = Math.max(0, Math.trunc(Number(input.draftStep) || 0));
    const profileId = Number.isFinite(Number(input.nuvioProfileId)) ? Number(input.nuvioProfileId) : null;
    const profileName = String(input.nuvioProfileName || '').trim().slice(0, 120);
    const markApplied = Boolean(input.markApplied) && profileId != null;
    const now = new Date().toISOString();
    const db = await savedCollectionsDb(context.env);

    if (await duplicateName(db, auth.session.id, profileId, name)) {
      return json({ error: `A saved setup named “${name}” already exists for this profile. Choose a different name.` }, 409, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    }

    if (await profileSetupCount(db, auth.session.id, profileId) >= MAX_SETUPS_PER_PROFILE) {
      return json({ error: `You can save up to ${MAX_SETUPS_PER_PROFILE} setups per Nuvio profile. Delete an existing setup before creating another.` }, 409, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    }

    if (markApplied) {
      await db.prepare(
        `UPDATE ${TABLE} SET last_applied_at = NULL WHERE user_id = ?1 AND last_nuvio_profile_id IS ?2`
      ).bind(auth.session.id, profileId).run();
    }

    await db.prepare(
      `INSERT INTO ${TABLE} (id, user_id, name, config_json, draft_step, last_nuvio_profile_id, last_nuvio_profile_name, last_applied_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`
    ).bind(id, auth.session.id, name, configJson, draftStep, profileId, profileName || null, markApplied ? now : null, now).run();
    return json({ collection: { id, name, draftStep, nuvioProfileId: profileId, nuvioProfileName: profileName, lastAppliedAt: markApplied ? now : null, config: clean, secretsSaved: Boolean(encryptedSecrets), createdAt: now, updatedAt: now } }, 201, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not save collection.' }, 400);
  }
}
