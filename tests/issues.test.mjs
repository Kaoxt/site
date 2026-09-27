import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSessionCookie } from '../functions/_lib/nuvio-session.js';
import { onRequestGet as list, onRequestPost as create } from '../functions/api/issues.js';
import { onRequestGet as detail, onRequestPost as comment, onRequestPatch as update } from '../functions/api/issues/[id].js';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  return { prepare(sql) { const build = args => ({ bind: (...args) => build(args),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args); },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  }); return build([]); }, async batch(statements) { return Promise.all(statements.map(s => s.run())); } };
}
const env = { KOLLECTION_SESSION_SECRET: 'issues-test-secret', NUVIO_ADMIN_USER_ID: 'admin', DB: database() };
async function ctx(user, method = 'GET', data, id, query = '', origin = 'https://kollection.tv') {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (user) headers.Cookie = (await createSessionCookie({ user: { id: user, email: user + '@private.test' }, accessToken: 'private-token', expiresIn: 3600 }, env)).split(';')[0];
  return { env, params: { id }, request: new Request('https://kollection.tv/api/issues' + (id ? '/' + id : '') + query, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) }) };
}
const report = { author: 'Test member', category: 'collection', title: 'Missing network folder', body: 'The network folder does not appear after installing the collection.' };
test('issue lifecycle enforces sign-in, privacy, admin permissions, filters, and closed discussions', async () => {
  assert.equal((await create(await ctx(null, 'POST', report))).status, 401);
  assert.equal((await create(await ctx('alice', 'POST', report, null, '', 'https://other.test'))).status, 403);
  for (const bad of [{ ...report, title: '' }, { ...report, category: '__proto__' }, { ...report, body: 'x'.repeat(10001) }]) assert.equal((await create(await ctx('alice', 'POST', bad))).status, 400);
  const created = await create(await ctx('alice', 'POST', { ...report, user_id: 'admin', status: 'closed' }));
  assert.equal(created.status, 201); const { id } = await created.json();
  let response = await detail(await ctx(null, 'GET', null, id));
  const text = await response.text(); assert.doesNotMatch(text, /private.test|private-token|user_id/);
  assert.equal(JSON.parse(text).issue.status, 'open');
  assert.equal((await update(await ctx('alice', 'PATCH', { status: 'closed' }, id))).status, 403);
  assert.equal((await comment(await ctx(null, 'POST', { author: 'Someone', body: 'Same problem' }, id))).status, 401);
  assert.equal((await comment(await ctx('bob', 'POST', { author: 'Bob', body: '<script>alert(1)</script>', is_admin: 1 }, id))).status, 201);
  let data = await (await detail(await ctx('alice', 'GET', null, id))).json();
  assert.equal(data.issue.isMine, true); assert.equal(data.comments[0].is_admin, 0);
  assert.equal((await list(await ctx(null, 'GET', null, null, '?mine=1'))).status, 401);
  assert.equal((await (await list(await ctx('bob', 'GET', null, null, '?mine=1'))).json()).issues.length, 0);
  assert.equal((await (await list(await ctx('alice', 'GET', null, null, '?mine=1&category=collection&q=network'))).json()).issues.length, 1);
  assert.equal((await update(await ctx('admin', 'PATCH', { status: 'in_progress' }, id))).status, 200);
  assert.equal((await (await list(await ctx(null, 'GET', null, null, '?status=in_progress'))).json()).issues.length, 1);
  assert.equal((await update(await ctx('admin', 'PATCH', { status: 'closed' }, id))).status, 200);
  assert.equal((await comment(await ctx('bob', 'POST', { author: 'Bob', body: 'Another comment' }, id))).status, 409);
  assert.equal((await comment(await ctx('admin', 'POST', { author: 'Kollection', body: 'Fixed in the latest update.' }, id))).status, 201);
  assert.equal((await (await list(await ctx(null)))).status, 200);
  assert.equal((await (await list(await ctx(null))).json()).issues.length, 0);
  assert.equal((await update(await ctx('admin', 'PATCH', { status: 'open' }, id))).status, 200);
  assert.equal((await detail(await ctx(null, 'GET', null, 9999))).status, 404);
  assert.equal((await update(await ctx('admin', 'PATCH', { status: 'unknown' }, id))).status, 400);
});
test('submission quota is enforced and paginated searches preserve literal wildcard input', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await create(await ctx('quota', 'POST', report))).status, 201);
  assert.equal((await create(await ctx('quota', 'POST', report))).status, 429);
  assert.equal((await (await list(await ctx(null, 'GET', null, null, '?q=%25'))).json()).issues.length, 0);
  for (let i = 0; i < 10; i++) await create(await ctx('other', 'POST', report));
  const first = await (await list(await ctx(null))).json(); assert.equal(first.issues.length, 20); assert.equal(first.hasMore, true);
  const second = await (await list(await ctx(null, 'GET', null, null, '?page=2'))).json(); assert.equal(second.issues.length, 1); assert.equal(second.hasMore, false);
  for (let i = 0; i < 30; i++) assert.equal((await comment(await ctx('quota', 'POST', { author: 'Member', body: 'More information.' }, 1))).status, 201);
  assert.equal((await comment(await ctx('quota', 'POST', { author: 'Member', body: 'More information.' }, 1))).status, 429);
});
