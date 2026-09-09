import { readSession, refreshSessionIfNeeded } from '../../../_lib/nuvio-session.js';
import { normalizeName, parseRow, requireDb, sanitizeConfig } from '../../../_lib/saved-collections.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
function json(body, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } }); }
async function accountSession(context) {
  const current = await readSession(context.request, context.env || {});
  if (!current) return { session: null, cookie: null };
  return refreshSessionIfNeeded(current, context.env || {});
}
const SELECT = `id, name, config_json, draft_step, last_nuvio_profile_id, last_nuvio_profile_name, last_applied_at, created_at, updated_at`;
async function ownedRow(db, id, userId) {
  return db.prepare(`SELECT ${SELECT} FROM saved_collections WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first();
}

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const row = await ownedRow(requireDb(context.env), context.params.id, auth.session.id);
    if (!row) return json({ error: 'Saved collection not found.' }, 404);
    return json({ collection: parseRow(row) }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not load saved collection.' }, 500); }
}
export async function onRequestPut(context) { return update(context); }
export async function onRequestPatch(context) { return update(context); }
async function update(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const db = requireDb(context.env);
    const existing = await ownedRow(db, context.params.id, auth.session.id);
    if (!existing) return json({ error: 'Saved collection not found.' }, 404);
    const input = await context.request.json().catch(() => ({}));
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const draftStep = input.draftStep === undefined ? Number(existing.draft_step || 0) : Math.max(0, Math.trunc(Number(input.draftStep) || 0));
    const profileId = input.nuvioProfileId === undefined ? existing.last_nuvio_profile_id : (Number.isFinite(Number(input.nuvioProfileId)) ? Number(input.nuvioProfileId) : null);
    const profileName = input.nuvioProfileName === undefined ? (existing.last_nuvio_profile_name || '') : String(input.nuvioProfileName || '').trim().slice(0, 120);
    const { clean, json: configJson } = input.config === undefined ? { clean: parseRow(existing).config, json: existing.config_json } : sanitizeConfig(input.config);
    const updatedAt = new Date().toISOString();
    await db.prepare(
      `UPDATE saved_collections SET name=?1, config_json=?2, draft_step=?3, last_nuvio_profile_id=?4, last_nuvio_profile_name=?5, updated_at=?6 WHERE id=?7 AND user_id=?8`
    ).bind(name, configJson, draftStep, profileId, profileName || null, updatedAt, context.params.id, auth.session.id).run();
    return json({ collection: { id: context.params.id, name, draftStep, nuvioProfileId: profileId == null ? null : Number(profileId), nuvioProfileName: profileName, lastAppliedAt: existing.last_applied_at || null, config: clean, createdAt: existing.created_at, updatedAt } }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not update saved collection.' }, 400); }
}
export async function onRequestDelete(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const result = await requireDb(context.env).prepare('DELETE FROM saved_collections WHERE id=?1 AND user_id=?2').bind(context.params.id, auth.session.id).run();
    if (!result.meta?.changes) return json({ error: 'Saved collection not found.' }, 404);
    return json({ deleted: true }, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) { console.error(error); return json({ error: error?.message || 'Could not delete saved collection.' }, 500); }
}
