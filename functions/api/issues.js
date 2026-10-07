import { getDisplayName } from '../_lib/account-preferences.js';
import { CATEGORIES, category, handle, input, IssueError, publicIssue, profileIdentity, imageAttachments, textField } from '../_lib/issues.js';

export const onRequestGet = context => handle(context, false, async ({ session, admin, reply, db }) => {
  const params = new URL(context.request.url).searchParams;
  const status = params.get('status') || 'open';
  if (!['open', 'in_progress', 'closed', 'all'].includes(status)) throw new IssueError('Invalid status.');
  const filters = [], values = [];
  if (status === 'open') filters.push("i.status != 'closed'");
  else if (status !== 'all') { filters.push('i.status = ?'); values.push(status); }
  if (params.get('category')) { filters.push('i.category = ?'); values.push(category(params.get('category'))); }
  if (params.get('mine') === '1') {
    if (!session) throw new IssueError('Sign in to see your reports.', 401);
    filters.push('i.user_id = ?'); values.push(session.id);
  }
  const query = (params.get('q') || '').trim().slice(0, 150);
  if (query) { filters.push('(instr(lower(i.title), lower(?)) > 0 OR instr(lower(i.body), lower(?)) > 0)'); values.push(query, query); }
  const page = Math.max(1, Math.min(10000, parseInt(params.get('page'), 10) || 1));
  const database = await db();
  // One-time cleanup for the owner's original closed test report (#1, "tesred").
  // It is deliberately restricted to the signed-in Kollection admin viewing closed issues.
  if (admin && status === 'closed') {
    const testIssue = await database.prepare("SELECT id FROM community_issues WHERE id = 1 AND title = 'tesred' AND category = 'collection' AND status = 'closed'").first();
    if (testIssue) {
      await database.batch([
        database.prepare('DELETE FROM community_issue_comments WHERE issue_id = 1'),
        database.prepare("DELETE FROM community_issues WHERE id = 1 AND title = 'tesred' AND category = 'collection' AND status = 'closed'"),
      ]);
    }
  }
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const rows = await database.prepare(`SELECT i.id, i.user_id, i.title, i.body, i.category, i.status, i.created_at, i.updated_at, COALESCE(a.url, i.avatar_url) AS avatar_url, i.avatar_color, COALESCE(NULLIF(p.display_name, ''), i.author) AS author, (SELECT COUNT(*) FROM community_issue_comments c WHERE c.issue_id = i.id) AS comment_count FROM community_issues i LEFT JOIN account_preferences p ON p.user_id = i.user_id LEFT JOIN (SELECT user_id, CASE WHEN url != '' THEN url ELSE '/api/avatars/' || id END AS url FROM account_avatars) a ON a.user_id = i.user_id${where} ORDER BY i.id DESC LIMIT 21 OFFSET ?`).bind(...values, (page - 1) * 20).all();
  return reply({ issues: rows.results.slice(0, 20).map(row => publicIssue(row, session)), hasMore: rows.results.length > 20, page, categories: CATEGORIES, authenticated: !!session, isAdmin: admin, displayName: await getDisplayName(context.env, session?.id) });
});

export const onRequestPost = context => handle(context, true, async ({ session, reply, db }) => {
  const data = await input(context.request);
  const title = textField(data.title, 'Title', 5, 160), body = textField(data.body, 'Description', 15, 10000);
  const identity = await profileIdentity(data.profileId, session, context.env), kind = category(data.category);
  const attachments = imageAttachments(data.attachments);
  const database = await db(), now = new Date().toISOString(), since = new Date(Date.now() - 86400000).toISOString();
  // The quota check and insert are one statement so concurrent requests cannot bypass it.
  const result = await database.prepare(`INSERT INTO community_issues (user_id, author, title, body, category, created_at, updated_at, avatar_url, avatar_color, attachments)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM community_issues WHERE user_id = ? AND created_at > ?) < 10`)
    .bind(session.id, identity.author, title, body, kind, now, now, identity.avatar_url, identity.avatar_color, attachments, session.id, since).run();
  if (!result.meta.changes) throw new IssueError('You can submit up to 10 reports per day. Please try again later.', 429);
  return reply({ id: result.meta.last_row_id }, 201);
});
