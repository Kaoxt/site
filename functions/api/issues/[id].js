import { getDisplayName } from '../../_lib/account-preferences.js';
import { handle, input, IssueError, issueId, publicIssue, profileIdentity, imageAttachments, STATUSES, textField } from '../../_lib/issues.js';
export const onRequestGet = context => handle(context, false, async ({ session, admin, reply, db }) => {
  const database = await db(), id = issueId(context.params.id);
  const row = await database.prepare("SELECT i.*, COALESCE(a.url, i.avatar_url) AS avatar_url, COALESCE(NULLIF(p.display_name, ''), i.author) AS author FROM community_issues i LEFT JOIN account_preferences p ON p.user_id = i.user_id LEFT JOIN (SELECT user_id, CASE WHEN url != '' THEN url ELSE '/api/avatars/' || id END AS url FROM account_avatars) a ON a.user_id = i.user_id WHERE i.id = ?").bind(id).first();
  if (!row) throw new IssueError('Issue not found.', 404);
  const params = new URL(context.request.url).searchParams;
  const after = Math.max(0, parseInt(params.get('after'), 10) || 0);
  const comments = await database.prepare("SELECT c.id, c.issue_id, COALESCE(a.url, c.avatar_url) AS avatar_url, c.avatar_color, c.attachments, COALESCE(NULLIF(p.display_name, ''), c.author) AS author, c.body, c.is_admin, c.created_at FROM community_issue_comments c LEFT JOIN account_preferences p ON p.user_id = c.user_id LEFT JOIN (SELECT user_id, CASE WHEN url != '' THEN url ELSE '/api/avatars/' || id END AS url FROM account_avatars) a ON a.user_id = c.user_id WHERE c.issue_id = ? AND c.id > ? ORDER BY c.id LIMIT 51").bind(id, after).all();
  return reply({ issue: publicIssue(row, session), comments: comments.results.slice(0, 50).map(c => publicIssue(c, session)), hasMore: comments.results.length > 50, authenticated: !!session, isAdmin: admin, displayName: await getDisplayName(context.env, session?.id) });
});
export const onRequestPatch = context => handle(context, true, async ({ admin, reply, db }) => {
  if (!admin) throw new IssueError('Only the Kollection admin can change issue status.', 403);
  const id = issueId(context.params.id), data = await input(context.request);
  if (!STATUSES.includes(data.status)) throw new IssueError('Invalid status.');
  const database = await db();
  const result = await database.prepare('UPDATE community_issues SET status = ?, updated_at = ? WHERE id = ?').bind(data.status, new Date().toISOString(), id).run();
  if (!result.meta.changes) throw new IssueError('Issue not found.', 404);
  return reply({ ok: true });
});
export const onRequestPost = context => handle(context, true, async ({ session, admin, reply, db }) => {
  const id = issueId(context.params.id), data = await input(context.request);
  const body = textField(data.body, 'Comment', 2, 5000), identity = await profileIdentity(data.profileId, session, context.env);
  const attachments = imageAttachments(data.attachments);
  const database = await db();
  const row = await database.prepare('SELECT status FROM community_issues WHERE id = ?').bind(id).first();
  if (!row) throw new IssueError('Issue not found.', 404);
  if (row.status === 'closed' && !admin) throw new IssueError('This issue is closed.', 409);
  const now = new Date().toISOString(), since = new Date(Date.now() - 3600000).toISOString();
  const result = await database.prepare(`INSERT INTO community_issue_comments (issue_id, user_id, author, body, is_admin, created_at, avatar_url, avatar_color, attachments)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM community_issue_comments WHERE user_id = ? AND created_at > ?) < 30
    AND EXISTS (SELECT 1 FROM community_issues WHERE id = ? AND (status != 'closed' OR ? = 1))`)
    .bind(id, session.id, identity.author, body, admin ? 1 : 0, now, identity.avatar_url, identity.avatar_color, attachments, session.id, since, id, admin ? 1 : 0).run();
  if (!result.meta.changes) throw new IssueError('Comment could not be added. This issue may be closed, or you have reached the hourly limit.', 429);
  return reply({ ok: true }, 201);
});
