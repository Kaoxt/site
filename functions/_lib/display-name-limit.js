import { preferencesDb } from './account-preferences.js';
const ready = new WeakMap();
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
export async function displayNameLimitDb(env) {
  const db = await preferencesDb(env);
  if (!ready.has(db)) ready.set(db, db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS display_name_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, changed_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS display_name_changes_user ON display_name_changes(user_id, changed_at)'),
    // Preserve the most recent known save for existing accounts.
    db.prepare(`INSERT INTO display_name_changes (user_id, changed_at)
      SELECT p.user_id, p.updated_at FROM account_preferences p
      WHERE p.display_name != '' AND NOT EXISTS (SELECT 1 FROM display_name_changes c WHERE c.user_id = p.user_id)`),
    // Enforce at the database boundary so simultaneous requests cannot exceed the limit.
    db.prepare(`CREATE TRIGGER IF NOT EXISTS display_name_limit_before_update
      BEFORE UPDATE OF display_name ON account_preferences
      WHEN NEW.display_name != OLD.display_name AND
        (SELECT COUNT(*) FROM display_name_changes WHERE user_id = OLD.user_id
          AND julianday(changed_at) > julianday('now', '-60 days')) >= 2
      BEGIN SELECT RAISE(ABORT, 'display_name_change_limit'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS display_name_history_after_update
      AFTER UPDATE OF display_name ON account_preferences WHEN NEW.display_name != OLD.display_name
      BEGIN INSERT INTO display_name_changes (user_id, changed_at) VALUES (NEW.user_id, NEW.updated_at); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS display_name_history_after_insert
      AFTER INSERT ON account_preferences WHEN NEW.display_name != ''
      BEGIN INSERT INTO display_name_changes (user_id, changed_at) VALUES (NEW.user_id, NEW.updated_at); END`),
  ]).catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
  return db;
}
export async function displayNameQuota(db, userId) {
  const row = await db.prepare(`SELECT COUNT(*) AS used, MIN(changed_at) AS oldest
    FROM display_name_changes WHERE user_id = ? AND julianday(changed_at) > julianday('now', '-60 days')`).bind(userId).first();
  const remaining = Math.max(0, 2 - Number(row?.used || 0));
  return { changesRemaining: remaining, changeLimit: 2, windowDays: 60,
    nextChangeAt: remaining === 0 && row?.oldest ? new Date(Date.parse(row.oldest) + WINDOW_MS).toISOString() : null };
}
