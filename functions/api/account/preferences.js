import { displayNameLimitDb, displayNameQuota } from '../../_lib/display-name-limit.js';
import { handle, input, IssueError } from '../../_lib/issues.js';
import { getDisplayName } from '../../_lib/account-preferences.js';
export const onRequestGet = context => handle(context, false, async ({ session, reply }) => {
  if (!session) throw new IssueError('Sign in with Nuvio first.', 401);
  const db = await displayNameLimitDb(context.env);
  return reply({ displayName: await getDisplayName(context.env, session.id), ...await displayNameQuota(db, session.id) });
});
export const onRequestPost = context => handle(context, true, async ({ session, reply }) => {
  const data = await input(context.request);
  if (typeof data.displayName !== 'string') throw new IssueError('Enter a display name, or leave it blank to use your Nuvio profile name.');
  const name = data.displayName.trim().replace(/\s+/g, ' ');
  if (name.length > 50 || /[\x00-\x1f\x7f]/.test(name)) throw new IssueError('Display name must be 50 characters or fewer with no control characters.');
  const db = await displayNameLimitDb(context.env);
  try {
    await db.prepare(`INSERT INTO account_preferences (user_id, display_name, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
      WHERE account_preferences.display_name != excluded.display_name`)
      .bind(session.id, name, new Date().toISOString()).run();
  } catch (error) {
    if (!String(error?.message).includes('display_name_change_limit')) throw error;
    const quota = await displayNameQuota(db, session.id);
    return reply({ error: 'You can change your display name twice in any 60-day period.', ...quota }, 429);
  }
  return reply({ displayName: name, ...await displayNameQuota(db, session.id) });
});
