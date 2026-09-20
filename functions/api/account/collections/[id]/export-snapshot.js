import { assertSameOrigin, readSession, refreshSessionIfNeeded } from '../../../../_lib/nuvio-session.js';
import { encryptedSecretsFromRow, parseRow, savedCollectionsDb, sanitizeConfig, storageConfig } from '../../../../_lib/saved-collections.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const TABLE = 'saved_collections_v2';

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

async function saveExportSnapshot(context) {
  try {
    if (!assertSameOrigin(context.request)) return json({ error: 'Invalid request origin.' }, 403);

    const auth = await accountSession(context);
    if (!auth.session) {
      return json(
        { error: 'Sign in with Nuvio first.' },
        401,
        auth.cookie ? { 'Set-Cookie': auth.cookie } : {}
      );
    }

    const input = await context.request.json().catch(() => ({}));
    if (!Array.isArray(input.aiometadataExports) || !input.aiometadataExports.length) {
      return json({ error: 'AIOMetadata export snapshot is required.' }, 400);
    }

    const db = await savedCollectionsDb(context.env);
    const row = await db.prepare(
      `SELECT id, config_json FROM ${TABLE} WHERE id = ?1 AND user_id = ?2`
    ).bind(context.params.id, auth.session.id).first();

    if (!row) return json({ error: 'Saved collection not found.' }, 404);

    const currentConfig = parseRow(row)?.config || {};
    const { clean } = sanitizeConfig({
      ...currentConfig,
      version: Math.max(6, Number(currentConfig.version) || 0),
      aiometadataExports: input.aiometadataExports,
    });
    const configJson = storageConfig(clean, encryptedSecretsFromRow(row));

    await db.prepare(
      `UPDATE ${TABLE} SET config_json = ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(configJson, context.params.id, auth.session.id).run();

    return json(
      { saved: true },
      200,
      auth.cookie ? { 'Set-Cookie': auth.cookie } : {}
    );
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Could not save AIOMetadata export snapshot.' }, 400);
  }
}

export async function onRequestPost(context) {
  return saveExportSnapshot(context);
}

export async function onRequestPatch(context) {
  return saveExportSnapshot(context);
}
