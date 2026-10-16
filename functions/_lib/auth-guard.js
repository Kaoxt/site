import { assertSameOrigin } from './nuvio-session.js';

const schemas = new WeakMap();
export class AuthRequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Bound bytes while reading: Content-Length is not trustworthy or always present.
export async function authInput(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AuthRequestError('Send JSON.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthRequestError('Missing request body.', 400);
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new AuthRequestError('Request is too large.', 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new AuthRequestError('Invalid JSON.', 400); }
}

export async function guardAuthRequest(context, scope, limit, seconds) {
  if (!assertSameOrigin(context.request)) return Response.json({error:'Invalid request origin.'},{status:403});
  const db = context.env?.DB;
  // This is Cloudflare's client-IP header, not a caller-supplied forwarded chain.
  const ip = context.request.headers.get('CF-Connecting-IP');
  if (!db || !ip) return Response.json({error:'Sign in is temporarily unavailable.'},{status:503});
  try {
    if (!schemas.has(db)) schemas.set(db, db.batch([db.prepare(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
      key TEXT NOT NULL, scope TEXT NOT NULL, window_start INTEGER NOT NULL,
      count INTEGER NOT NULL, PRIMARY KEY(key,scope))`), db.prepare('CREATE INDEX IF NOT EXISTS auth_rate_limits_window ON auth_rate_limits(window_start)')]).catch(e=>{schemas.delete(db);throw e;}));
    await schemas.get(db);
    const now = Math.floor(Date.now()/1000), start = Math.floor(now/seconds)*seconds;
    // Rotate the hash daily; avoid storing raw client addresses.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${context.env.KOLLECTION_SESSION_SECRET || ''}:${Math.floor(now/86400)}:${ip}`));
    const key = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
    const result = await db.prepare(`INSERT INTO auth_rate_limits(key,scope,window_start,count) VALUES(?,?,?,1)
      ON CONFLICT(key,scope) DO UPDATE SET window_start=excluded.window_start,
      count=CASE WHEN auth_rate_limits.window_start=excluded.window_start THEN auth_rate_limits.count+1 ELSE 1 END
      WHERE auth_rate_limits.window_start!=excluded.window_start OR auth_rate_limits.count<?`).bind(key,scope,start,limit).run();
    if (!result.meta.changes) return Response.json({error:'Too many sign-in requests. Please wait and try again.'},
      {status:429,headers:{'Retry-After':String(start+seconds-now),'Cache-Control':'no-store'}});
    // Indexed cleanup keeps historical address hashes from accumulating.
    await db.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').bind(now-86400).run();
  } catch {
    return Response.json({error:'Sign in is temporarily unavailable.'},{status:503});
  }
  return null;
}
