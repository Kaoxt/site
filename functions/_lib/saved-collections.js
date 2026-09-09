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
