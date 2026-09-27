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
  if (raw.length > 20000) throw new IssueError('Report is too large.', 413);
  try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data; }
  catch { throw new IssueError('Invalid JSON.'); }
}
const schemas = new WeakMap();
export async function issuesDb(env) {
  const db = requireDb(env);
  await preferencesDb(env);
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
  return db;
}
export function publicIssue(row, session) {
  const { user_id, ...safe } = row;
  return { ...safe, isMine: user_id === session?.id };
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
