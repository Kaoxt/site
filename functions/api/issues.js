import { CATEGORIES, category, handle, input, IssueError, publicIssue, profileAuthor, textField } from '../_lib/issues.js';

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
  const database = await db(), where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const rows = await database.prepare(`SELECT i.*, (SELECT COUNT(*) FROM community_issue_comments c WHERE c.issue_id = i.id) AS comment_count FROM community_issues i${where} ORDER BY i.id DESC LIMIT 21 OFFSET ?`).bind(...values, (page - 1) * 20).all();
  return reply({ issues: rows.results.slice(0, 20).map(row => publicIssue(row, session)), hasMore: rows.results.length > 20, page, categories: CATEGORIES, authenticated: !!session, isAdmin: admin });
});

export const onRequestPost = context => handle(context, true, async ({ session, reply, db }) => {
  const data = await input(context.request);
  const title = textField(data.title, 'Title', 5, 160), body = textField(data.body, 'Description', 15, 10000);
  const author = await profileAuthor(data.profileId, session, context.env), kind = category(data.category);
  const database = await db(), now = new Date().toISOString(), since = new Date(Date.now() - 86400000).toISOString();
  // The quota check and insert are one statement so concurrent requests cannot bypass it.
  const result = await database.prepare(`INSERT INTO community_issues (user_id, author, title, body, category, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM community_issues WHERE user_id = ? AND created_at > ?) < 10`)
    .bind(session.id, author, title, body, kind, now, now, session.id, since).run();
  if (!result.meta.changes) throw new IssueError('You can submit up to 10 reports per day. Please try again later.', 429);
  return reply({ id: result.meta.last_row_id }, 201);
});
