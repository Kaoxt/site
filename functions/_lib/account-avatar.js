import { preferencesDb } from './account-preferences.js';
const ready = new WeakMap();
export async function avatarDb(env) {
  const db = await preferencesDb(env);
  if (!ready.has(db)) ready.set(db, db.prepare(`CREATE TABLE IF NOT EXISTS account_avatars (
    user_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, url TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`).run().catch(e=>{ready.delete(db);throw e;}));
  await ready.get(db);return db;
}
export async function getAccountAvatar(env, userId) {
  if (!env?.DB || !userId) return '';
  const db = await avatarDb(env);
  const row = await db.prepare('SELECT id, url FROM account_avatars WHERE user_id = ?').bind(userId).first();
  return row ? row.url || `/api/avatars/${row.id}` : '';
}
