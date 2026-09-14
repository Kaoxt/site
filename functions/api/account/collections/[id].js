import { assertSameOrigin, readSession, refreshSessionIfNeeded } from '../../../_lib/nuvio-session.js';
import { encryptedSecretsFromRow, normalizeName, parseRow, savedCollectionsDb, sanitizeConfig, storageConfig } from '../../../_lib/saved-collections.js';
import { decryptSavedSecrets, encryptSavedSecrets, normalizeSavedSecrets } from '../../../_lib/saved-secrets.js';

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
async function ownedRow(db, id, userId) {
  return db.prepare(`SELECT ${SELECT} FROM ${TABLE} WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first();
}
async function duplicateName(db, userId, profileId, name, excludeId) {
  return db.prepare(
    `SELECT id FROM ${TABLE}
     WHERE user_id = ?1
       AND last_nuvio_profile_id IS ?2
       AND lower(name) = lower(?3)
       AND id <> ?4
     LIMIT 1`
  ).bind(userId, profileId, name, excludeId).first();
}
async function profileSetupCount(db, userId, profileId, excludeId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total FROM ${TABLE}
     WHERE user_id = ?1
       AND last_nuvio_profile_id IS ?2
       AND id <> ?3`
  ).bind(userId, profileId, excludeId).first();
  return Number(row?.total || 0);
}

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const row = await ownedRow(await savedCollectionsDb(context.env), context.params.id, auth.session.id);
    if (!row) return json({ error: 'Saved collection not found.' }, 404);
    const collection = parseRow(row);
    collection.secrets = await decryptSavedSecrets(encryptedSecretsFromRow(row), context.env || {});
    return json({ collection }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not load saved collection.' }, 500); }
}
export async function onRequestPut(context) { return update(context); }
export async function onRequestPatch(context) { return update(context); }
async function update(context) {
  try {
    if (!assertSameOrigin(context.request)) return json({ error: 'Invalid request origin.' }, 403);
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const db = await savedCollectionsDb(context.env);
    const existing = await ownedRow(db, context.params.id, auth.session.id);
    if (!existing) return json({ error: 'Saved collection not found.' }, 404);
    const input = await context.request.json().catch(() => ({}));
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const draftStep = input.draftStep === undefined ? Number(existing.draft_step || 0) : Math.max(0, Math.trunc(Number(input.draftStep) || 0));
    const profileId = input.nuvioProfileId === undefined ? existing.last_nuvio_profile_id : (Number.isFinite(Number(input.nuvioProfileId)) ? Number(input.nuvioProfileId) : null);
    const profileName = input.nuvioProfileName === undefined ? (existing.last_nuvio_profile_name || '') : String(input.nuvioProfileName || '').trim().slice(0, 120);
    const clean = input.config === undefined ? parseRow(existing).config : sanitizeConfig(input.config).clean;
    const markApplied = Boolean(input.markApplied) && profileId != null;

    if (await duplicateName(db, auth.session.id, profileId, name, context.params.id)) {
      return json({ error: `A saved setup named “${name}” already exists for this profile. Choose a different name.` }, 409, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    }

    const movingProfiles = Number(profileId) !== Number(existing.last_nuvio_profile_id);
    if (movingProfiles && await profileSetupCount(db, auth.session.id, profileId, context.params.id) >= MAX_SETUPS_PER_PROFILE) {
      return json({ error: `You can save up to ${MAX_SETUPS_PER_PROFILE} setups per Nuvio profile. Delete an existing setup before moving this setup to that profile.` }, 409, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    }

    const existingCipher = encryptedSecretsFromRow(existing);
    let encryptedSecrets = existingCipher;
    if (input.secrets !== undefined) {
      const oldSecrets = await decryptSavedSecrets(existingCipher, context.env || {});
      const incoming = normalizeSavedSecrets(input.secrets);
      encryptedSecrets = await encryptSavedSecrets({ ...oldSecrets, ...incoming }, context.env || {});
    }
    const configJson = storageConfig(clean, encryptedSecrets);
    const updatedAt = new Date().toISOString();
    if (markApplied) {
      await db.prepare(
        `UPDATE ${TABLE} SET last_applied_at = NULL WHERE user_id = ?1 AND last_nuvio_profile_id IS ?2 AND id <> ?3`
      ).bind(auth.session.id, profileId, context.params.id).run();
    }
    const lastAppliedAt = markApplied ? updatedAt : (existing.last_applied_at || null);
    await db.prepare(
      `UPDATE ${TABLE} SET name=?1, config_json=?2, draft_step=?3, last_nuvio_profile_id=?4, last_nuvio_profile_name=?5, last_applied_at=?6, updated_at=?7 WHERE id=?8 AND user_id=?9`
    ).bind(name, configJson, draftStep, profileId, profileName || null, lastAppliedAt, updatedAt, context.params.id, auth.session.id).run();
    return json({ collection: { id: context.params.id, name, draftStep, nuvioProfileId: profileId == null ? null : Number(profileId), nuvioProfileName: profileName, lastAppliedAt, config: clean, secretsSaved: Boolean(encryptedSecrets), createdAt: existing.created_at, updatedAt } }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not update saved collection.' }, 400); }
}
export async function onRequestDelete(context) {
  try {
    if (!assertSameOrigin(context.request)) return json({ error: 'Invalid request origin.' }, 403);
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const db = await savedCollectionsDb(context.env);
    const result = await db.prepare(`DELETE FROM ${TABLE} WHERE id=?1 AND user_id=?2`).bind(context.params.id, auth.session.id).run();
    if (!result.meta?.changes) return json({ error: 'Saved collection not found.' }, 404);
    return json({ deleted: true }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not delete saved collection.' }, 500); }
}
