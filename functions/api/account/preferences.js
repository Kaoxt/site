import { handle, input, IssueError } from '../../_lib/issues.js';
import { getDisplayName, preferencesDb } from '../../_lib/account-preferences.js';
export const onRequestGet = context => handle(context, false, async ({ session, reply }) => {
  if (!session) throw new IssueError('Sign in with Nuvio first.', 401);
  return reply({ displayName: await getDisplayName(context.env, session.id) });
});
export const onRequestPost = context => handle(context, true, async ({ session, reply }) => {
  const data = await input(context.request);
  if (typeof data.displayName !== 'string') throw new IssueError('Enter a display name, or leave it blank to use your Nuvio profile name.');
  const name = data.displayName.trim().replace(/\s+/g, ' ');
  if (name.length > 50 || /[\x00-\x1f\x7f]/.test(name)) throw new IssueError('Display name must be 50 characters or fewer with no control characters.');
  const db = await preferencesDb(context.env);
  await db.prepare(`INSERT INTO account_preferences (user_id, display_name, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
    .bind(session.id, name, new Date().toISOString()).run();
  return reply({ displayName: name });
});
