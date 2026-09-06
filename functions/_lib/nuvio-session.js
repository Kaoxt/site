const COOKIE_NAME = 'kollection_nuvio_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_NUVIO_API_BASE = 'https://api.nuvio.tv';
const DEFAULT_NUVIO_PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const map = new Map();
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return map;
}

function sessionSecret(env) {
  return String(env.KOLLECTION_SESSION_SECRET || '').trim();
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptPayload(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  ));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv, 0);
  packed.set(encrypted, iv.length);
  return b64urlEncode(packed);
}

async function decryptPayload(value, secret) {
  try {
    const packed = b64urlDecode(value);
    if (packed.length < 29) return null;
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const key = await encryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    return null;
  }
}

export function nuvioConfig(env) {
  return {
    apiBase: String(env.NUVIO_API_BASE || DEFAULT_NUVIO_API_BASE).replace(/\/+$/, ''),
    publishableKey: String(env.NUVIO_PUBLISHABLE_KEY || DEFAULT_NUVIO_PUBLISHABLE_KEY).trim(),
  };
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isAdminUser(user, env) {
  if (!user) return false;

  const adminId = String(env.NUVIO_ADMIN_USER_ID || '').trim();
  if (adminId) return String(user.id || '') === adminId;

  const adminEmail = String(env.NUVIO_ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail) return String(user.email || '').trim().toLowerCase() === adminEmail;

  return false;
}

export function authServerReady(env) {
  return Boolean(sessionSecret(env));
}

function tokenExpiration(accessToken, expiresIn) {
  try {
    const parts = String(accessToken || '').split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(decoder.decode(b64urlDecode(parts[1])));
      if (Number(payload?.exp) > 0) return Number(payload.exp);
    }
  } catch {}

  const seconds = Number(expiresIn);
  return Math.floor(Date.now() / 1000) + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600);
}

export async function verifyNuvioAccessToken(accessToken, env) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Missing Nuvio access token.');

  const { apiBase, publishableKey } = nuvioConfig(env);
  const res = await fetch(`${apiBase}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error('Nuvio could not verify this login.');
  }

  return {
    id: String(body.id),
    email: String(body.email || ''),
  };
}

export async function createSessionCookie({
  user,
  accessToken,
  refreshToken = '',
  tokenType = 'bearer',
  expiresIn = null,
}, env) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('KOLLECTION_SESSION_SECRET is not configured.');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 2,
    uid: String(user.id || ''),
    email: String(user.email || ''),
    accessToken: String(accessToken || ''),
    refreshToken: String(refreshToken || ''),
    tokenType: String(tokenType || 'bearer'),
    accessExp: tokenExpiration(accessToken, expiresIn),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const value = await encryptPayload(payload, secret);

  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function readSession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return null;

  const raw = parseCookies(request).get(COOKIE_NAME);
  if (!raw) return null;

  const payload = await decryptPayload(raw, secret);
  const now = Math.floor(Date.now() / 1000);

  if (
    payload?.v !== 2 ||
    !payload?.uid ||
    !payload?.accessToken ||
    !payload?.exp ||
    payload.exp <= now
  ) {
    return null;
  }

  return {
    id: String(payload.uid),
    email: String(payload.email || ''),
    accessToken: String(payload.accessToken || ''),
    refreshToken: String(payload.refreshToken || ''),
    tokenType: String(payload.tokenType || 'bearer'),
    accessExp: Number(payload.accessExp || 0),
    sessionExp: Number(payload.exp),
  };
}

export async function refreshSessionIfNeeded(session, env, force = false) {
  if (!session) return { session: null, cookie: null };

  const now = Math.floor(Date.now() / 1000);
  if (!force && session.accessExp > now + 90) {
    return { session, cookie: null };
  }

  if (!session.refreshToken) {
    if (session.accessExp > now) return { session, cookie: null };
    return { session: null, cookie: clearSessionCookie() };
  }

  const { apiBase, publishableKey } = nuvioConfig(env);
  const res = await fetch(`${apiBase}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    return { session: null, cookie: clearSessionCookie() };
  }

  const user = body.user?.id
    ? { id: String(body.user.id), email: String(body.user.email || session.email || '') }
    : await verifyNuvioAccessToken(body.access_token, env);

  const refreshed = {
    id: user.id,
    email: user.email,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || session.refreshToken,
    tokenType: body.token_type || session.tokenType || 'bearer',
    accessExp: tokenExpiration(body.access_token, body.expires_in),
    sessionExp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const cookie = await createSessionCookie({
    user,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenType: refreshed.tokenType,
    expiresIn: body.expires_in,
  }, env);

  return { session: refreshed, cookie };
}
