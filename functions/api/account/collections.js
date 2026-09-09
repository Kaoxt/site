import { assertSameOrigin, readSession, refreshSessionIfNeeded } from '../../_lib/nuvio-session.js';
import { normalizeName, parseRow, requireDb, sanitizeConfig, storageConfig } from '../../_lib/saved-collections.js';
import { encryptSavedSecrets } from '../../_lib/saved-secrets.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
function json(body, status = 200, extraHeaders = {}) { return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } }); }
async function accountSession(context) {
  const current = await readSession(context.request, context.env || {});
  if (!current) return { session: null, cookie: null };
  return refreshSessionIfNeeded(current, context.env || {});
}
const SELECT = `id, name, config_json, draft_step, last_nuvio_profile_id, last_nuvio_profile_name, last_applied_at, created_at, updated_at`;

export async function onRequestGet(context) {
  try {
    const auth = await accountSession(context);
    if (!auth.session) return json({ error: 'Sign in with Nuvio first.' }, 401, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
    const result = await requireDb(context.env).prepare(
      `SELECT ${SELECT} FROM saved_collections WHERE user_id = ?1 ORDER BY updated_at DESC`
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
    const now = new Date().toISOString();
    await requireDb(context.env).prepare(
      `INSERT INTO saved_collections (id, user_id, name, config_json, draft_step, last_nuvio_profile_id, last_nuvio_profile_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
    ).bind(id, auth.session.id, name, configJson, draftStep, profileId, profileName || null, now).run();
    return json({ collection: { id, name, draftStep, nuvioProfileId: profileId, nuvioProfileName: profileName, config: clean, secretsSaved: Boolean(encryptedSecrets), createdAt: now, updatedAt: now } }, 201, auth.cookie ? { 'Set-Cookie': auth.cookie } : {});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not save collection.' }, 400);
  }
}
