import { requireDb } from './saved-collections.js';
const ready = new WeakMap();
export async function preferencesDb(env) {
  const db = requireDb(env);
  if (!ready.has(db)) ready.set(db, db.prepare(`CREATE TABLE IF NOT EXISTS account_preferences (
    user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`).run().catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
  return db;
}
export async function getDisplayName(env, userId) {
  if (!env?.DB || !userId) return '';
  const db = await preferencesDb(env);
  const row = await db.prepare('SELECT display_name FROM account_preferences WHERE user_id = ?').bind(userId).first();
  return row?.display_name || '';
}
