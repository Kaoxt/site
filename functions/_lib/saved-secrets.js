const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONTEXT = 'kollection:saved-setup-secrets:v1';

function b64urlEncode(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function keyFor(env) {
  const root = String(env?.KOLLECTION_SESSION_SECRET || '').trim();
  if (!root) throw new Error('KOLLECTION_SESSION_SECRET is not configured.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${CONTEXT}\u0000${root}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function normalizeSavedSecrets(value) {
  const source = value && typeof value === 'object' ? value : {};
  const clean = {};
  for (const key of ['mdblistKey', 'tmdbKey']) {
    const v = String(source[key] || '').trim();
    if (v) clean[key] = v.slice(0, 4096);
  }
  return clean;
}

export async function encryptSavedSecrets(value, env) {
  const clean = normalizeSavedSecrets(value);
  if (!Object.keys(clean).length) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(env);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(clean))));
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return b64urlEncode(packed);
}

export async function decryptSavedSecrets(value, env) {
  if (!value) return {};
  try {
    const packed = b64urlDecode(value);
    if (packed.length < 29) return {};
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const key = await keyFor(env);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return normalizeSavedSecrets(JSON.parse(decoder.decode(plaintext)));
  } catch {
    return {};
  }
}
