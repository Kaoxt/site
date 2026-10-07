import { handle, issueId, IssueError } from '../../../../_lib/issues.js';
export const onRequestGet = context => handle(context, false, async ({ db }) => {
  const id = issueId(context.params.id), index = String(context.params.image);
  if (!/^[0-2]$/.test(index)) throw new IssueError('Image not found.', 404);
  const database = await db(), comment = new URL(context.request.url).searchParams.get('comment');
  const row = comment
    ? await database.prepare('SELECT c.attachments FROM community_issue_comments c JOIN community_issues i ON i.id = c.issue_id WHERE c.issue_id = ? AND c.id = ?').bind(id, issueId(comment)).first()
    : await database.prepare('SELECT attachments FROM community_issues WHERE id = ?').bind(id).first();
  const image = JSON.parse(row?.attachments || '[]')[Number(index)];
  if (!image) throw new IssueError('Image not found.', 404);
  const [prefix, encoded] = image.split(',');
  return new Response(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), {headers:{'Content-Type':prefix.slice(5).split(';')[0],'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
});
