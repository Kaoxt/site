const MAX_CONFIG_BYTES = 512 * 1024;
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
    if (SENSITIVE_KEYS.has(String(key).toLowerCase())) continue;
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

export function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return name || 'My Kollection';
}

export function parseRow(row) {
  if (!row) return null;
  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch {}
  return {
    id: row.id,
    name: row.name,
    nuvioProfileId: row.nuvio_profile_id == null ? null : Number(row.nuvio_profile_id),
    nuvioProfileName: row.nuvio_profile_name || '',
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
