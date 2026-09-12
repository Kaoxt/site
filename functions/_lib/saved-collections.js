const MAX_CONFIG_BYTES = 512 * 1024;
const SECRET_FIELD = '__kollectionEncryptedSecrets';
const SENSITIVE_KEYS = new Set([
  'password', 'accessToken', 'refreshToken', 'token', 'secret', 'apiKey', 'apikey',
  'mdblistKey', 'tmdbKey', 'authorization', 'cookie'
].map((v) => v.toLowerCase()));

export function requireDb(env) {
  if (!env?.DB) throw new Error('Cloudflare D1 binding DB is not configured.');
  return env.DB;
}

let schemaReady = false;

export async function savedCollectionsDb(env) {
  const db = requireDb(env);
  if (schemaReady) return db;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS saved_collections_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      draft_step INTEGER NOT NULL DEFAULT 0,
      last_nuvio_profile_id INTEGER,
      last_nuvio_profile_name TEXT,
      last_applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_saved_collections_v2_user_updated
    ON saved_collections_v2 (user_id, updated_at DESC)
  `).run();

  // Copy any pre-existing saved setups from the original table when possible.
  // The legacy table may have a foreign key tied to the old Kollection account
  // model, so all new writes use the Nuvio-native v2 table instead.
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO saved_collections_v2
        (id, user_id, name, config_json, draft_step, last_nuvio_profile_id,
         last_nuvio_profile_name, last_applied_at, created_at, updated_at)
      SELECT
        id, user_id, name, config_json, draft_step, last_nuvio_profile_id,
        last_nuvio_profile_name, last_applied_at, created_at, updated_at
      FROM saved_collections
    `).run();
  } catch {
    // The original table may not exist on newer installs.
  }

  schemaReady = true;
  return db;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(String(key).toLowerCase()) || key === SECRET_FIELD) continue;
    out[key] = sanitize(child);
  }
  return out;
}

export function sanitizeConfig(value) {
  const clean = sanitize(value && typeof value === 'object' ? value : {});
  const json = JSON.stringify(clean);
  if (new TextEncoder().encode(json).byteLength > MAX_CONFIG_BYTES) {
    throw new Error('Saved collection configuration is too large.');
  }
  return { clean, json };
}

export function storageConfig(clean, encryptedSecrets = '') {
  const value = clean && typeof clean === 'object' ? { ...clean } : {};
  if (encryptedSecrets) value[SECRET_FIELD] = encryptedSecrets;
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > MAX_CONFIG_BYTES) {
    throw new Error('Saved collection configuration is too large.');
  }
  return json;
}

export function encryptedSecretsFromRow(row) {
  try {
    const parsed = JSON.parse(row?.config_json || '{}');
    return String(parsed?.[SECRET_FIELD] || '');
  } catch {
    return '';
  }
}

export function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return name || 'My Kollection';
}

export function parseRow(row) {
  if (!row) return null;
  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch {}
  if (config && typeof config === 'object') delete config[SECRET_FIELD];
  return {
    id: row.id,
    name: row.name,
    draftStep: Number(row.draft_step || 0),
    nuvioProfileId: row.last_nuvio_profile_id == null ? null : Number(row.last_nuvio_profile_id),
    nuvioProfileName: row.last_nuvio_profile_name || '',
    lastAppliedAt: row.last_applied_at || null,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
