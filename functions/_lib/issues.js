import { avatarDb } from './account-avatar.js';
import { getDisplayName, preferencesDb } from './account-preferences.js';
import { assertSameOrigin, nuvioConfig, isAdminUser, readSession, refreshSessionIfNeeded } from './nuvio-session.js';
import { requireDb } from './saved-collections.js';

export const CATEGORIES = {
  collection: 'Kollection in Nuvio', setup: 'Setup & updates', artwork: 'Artwork & posters',
  account: 'Account & profiles', website: 'Website', other: 'Other',
};
export const STATUSES = ['open', 'in_progress', 'closed'];
export class IssueError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function textField(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new IssueError(`${label} must be between ${min} and ${max} characters.`);
  }
  return value.trim();
}
export function category(value) {
  if (!Object.hasOwn(CATEGORIES, value)) throw new IssueError('Choose a valid category.');
  return value;
}
export async function input(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new IssueError('Send JSON.', 415);
  const raw = await request.text();
  if (raw.length > 1700000) throw new IssueError('Report is too large.', 413);
  try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data; }
  catch { throw new IssueError('Invalid JSON.'); }
}
const schemas = new WeakMap();
export async function issuesDb(env) {
  const db = requireDb(env);
  await preferencesDb(env);
  await avatarDb(env);
  if (!schemas.has(db)) schemas.set(db, db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS community_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, author TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS community_issue_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, user_id TEXT NOT NULL,
      author TEXT NOT NULL, body TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS community_issues_status ON community_issues(status, id DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS community_issues_user ON community_issues(user_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS community_comments_issue ON community_issue_comments(issue_id, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS community_comments_user ON community_issue_comments(user_id, created_at)'),
  ]).catch(error => { schemas.delete(db); throw error; }));
  await schemas.get(db);
  await issueMediaSchema(db);
  return db;
}
export function publicIssue(row, session) {
  const { user_id, attachments, ...safe } = row;
  return { ...safe, attachments: attachmentLinks(attachments, row.issue_id || row.id, row.issue_id ? row.id : null), isMine: user_id === session?.id };
}
export function issueId(value) {
  if (!/^[1-9]\d{0,14}$/.test(String(value))) throw new IssueError('Issue not found.', 404);
  return Number(value);
}
export async function handle(context, write, run) {
  let cookie;
  const reply = (body, status = 200) => Response.json(body, { status, headers: {
    'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}),
  } });
  try {
    if (write && !assertSameOrigin(context.request)) throw new IssueError('Invalid request origin.', 403);
    const auth = await refreshSessionIfNeeded(await readSession(context.request, context.env), context.env);
    cookie = auth.cookie;
    if (write && !auth.session) throw new IssueError('Sign in with Nuvio to continue.', 401);
    const admin = isAdminUser(auth.session, context.env);
    return await run({ session: auth.session, admin, reply, db: () => issuesDb(context.env) });
  } catch (error) {
    if (!(error instanceof IssueError)) console.error('Issues request failed:', error);
    return reply({ error: error instanceof IssueError ? error.message : 'Could not load or save this report. Please try again.' }, error.status || 503);
  }
}

export async function profileAuthor(profileId, session, env) {
  const displayName = await getDisplayName(env, session.id);
  if (displayName) return displayName;
  if (!Number.isSafeInteger(profileId) || profileId < 1) throw new IssueError('Select a Nuvio profile before posting.');
  const { apiBase, publishableKey } = nuvioConfig(env);
  let response;
  try {
    response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_profiles`, {
      method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new IssueError('Could not verify your Nuvio profile. Please try again.', 502); }
  if (!response.ok) throw new IssueError('Could not verify your Nuvio profile. Sign in again or retry.', 502);
  const data = await response.json();
  const profiles = Array.isArray(data) ? data : data?.profiles;
  const profile = Array.isArray(profiles) && profiles.find(p => Number(p.profile_index ?? p.id) === profileId);
  if (!profile) throw new IssueError('Your selected Nuvio profile is no longer available. Choose a profile in Account and retry.');
  return String(profile.name || `Profile ${profileId}`).trim().slice(0, 120) || `Profile ${profileId}`;
}

const mediaSchemas = new WeakMap();
async function issueMediaSchema(db) {
  if (!mediaSchemas.has(db)) mediaSchemas.set(db, (async () => {
    for (const table of ['community_issues', 'community_issue_comments']) {
      const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).results;
      for (const column of ['avatar_url', 'avatar_color', 'attachments']) {
        if (!columns.some(c => c.name === column)) {
          try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`).run(); }
          catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
        }
      }
    }
  })().catch(error => { mediaSchemas.delete(db); throw error; }));
  await mediaSchemas.get(db);
}
export function imageAttachments(value, maxBytes = 400000) {
  if (value == null) return '';
  if (!Array.isArray(value) || value.length > 3) throw new IssueError('Attach up to 3 images.');
  return JSON.stringify(value.map(image => {
    if (typeof image !== 'string' || image.length > Math.ceil(maxBytes / 3) * 4 + 32) throw new IssueError(`Each image must be no larger than ${maxBytes / 1000} KB after compression.`);
    const match = image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new IssueError('Use JPG, PNG, or WebP images.');
    let bytes; try { bytes = atob(match[2]); } catch { throw new IssueError('Invalid image data.'); }
    const valid = match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : bytes.startsWith('RIFF') && bytes.slice(8,12) === 'WEBP';
    if (!valid || bytes.length > maxBytes) throw new IssueError('Invalid or oversized image.');
    return image;
  }));
}
export function attachmentLinks(raw, issue, comment = null) {
  let images; try { images = JSON.parse(raw || '[]'); } catch { images = []; }
  return images.map((_, index) => `/api/issues/${issue}/images/${index}${comment ? '?comment=' + comment : ''}`);
}
function avatarUrl(value, apiBase) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('/') || /^https:\/\//i.test(raw) ? raw : '/storage/v1/object/public/avatars/' + raw, apiBase);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export async function profileIdentity(profileId, session, env) {
  const author = await profileAuthor(profileId, session, env);
  const fallback = { author, avatar_url: '', avatar_color: '#6568e8' };
  if (!Number.isSafeInteger(profileId) || profileId < 1) return fallback;
  const { apiBase, publishableKey } = nuvioConfig(env);
  try {
    const call = async (name, token) => {
      const response = await fetch(`${apiBase}/rest/v1/rpc/${name}`, {method:'POST', headers:{apikey:publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Profile unavailable');
      return response.json();
    };
    const data = await call('sync_pull_profiles', session.accessToken);
    const p = (Array.isArray(data) ? data : data?.profiles || []).find(p => Number(p.profile_index ?? p.id) === profileId);
    if (!p) return fallback;
    let url = avatarUrl(p.avatar_url || p.avatarUrl, apiBase);
    const avatarId = p.avatar_id ?? p.avatarId;
    if (!url && avatarId) {
      const catalog = await call('get_avatar_catalog', publishableKey);
      const item = (Array.isArray(catalog) ? catalog : []).find(a => String(a.id) === String(avatarId));
      url = avatarUrl(item?.storage_path || item?.storagePath, apiBase);
    }
    const color = p.avatar_color_hex || p.avatarColorHex;
    return { author, avatar_url: url, avatar_color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback.avatar_color };
  } catch { return fallback; }
}
