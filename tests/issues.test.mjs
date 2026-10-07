import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const realFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json([{ profile_index: 1, name: 'Selected profile' }, { profile_index: 2, name: 'Other profile' }]);
after(() => { globalThis.fetch = realFetch; });
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
  return { env, params: { id }, request: new Request('https://kollection.tv/api/issues' + (id ? '/' + id : '') + query, { method, headers, ...(data ? { body: JSON.stringify({ profileId: 1, ...data }) } : {}) }) };
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
  assert.equal(JSON.parse(text).issue.author, 'Selected profile');
  assert.equal((await create(await ctx('alice', 'POST', { ...report, profileId: 99 }))).status, 400);
  assert.equal((await create(await ctx('alice', 'POST', { ...report, profileId: null }))).status, 400);
  assert.equal((await update(await ctx('alice', 'PATCH', { status: 'closed' }, id))).status, 403);
  assert.equal((await comment(await ctx(null, 'POST', { author: 'Someone', body: 'Same problem' }, id))).status, 401);
  assert.equal((await comment(await ctx('bob', 'POST', { author: 'Bob', body: '<script>alert(1)</script>', is_admin: 1 }, id))).status, 201);
  let data = await (await detail(await ctx('alice', 'GET', null, id))).json();
  assert.equal(data.issue.isMine, true); assert.equal(data.comments[0].is_admin, 0); assert.equal(data.comments[0].author, 'Selected profile');
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

test('forms explain every missing or short field and accept valid submissions', async () => {
  const window = {};
  vm.runInNewContext(await readFile(new URL('../issues/form-validation.js', import.meta.url), 'utf8'), { window });
  const validate = window.KollectionIssueForm.validate;
  const problems = validate({ category: '', title: 'issue', body: 'Rkeke' }, 'report-form');
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /choose a category/);
  assert.match(problems[1].message, /at least 15 characters \(currently 5\)/);
  assert.equal(validate({}, 'report-form').length, 3);
  assert.equal(validate(report, 'report-form').length, 0);
  assert.equal(validate({ body: '  ' }, 'comment-form').length, 1);
  assert.equal(validate({ body: 'More details' }, 'comment-form').length, 0);
});
test('profile author is resolved from the selected account profile, never a supplied display name', async () => {
  const { profileAuthor } = await import('../functions/_lib/issues.js');
  assert.equal(await profileAuthor(2, { accessToken: 'test' }, env), 'Other profile');
  await assert.rejects(profileAuthor(999, { accessToken: 'test' }, env), /no longer available/);
});

test('display names are account-scoped, authenticated, persistent, and override profile names across issues', async () => {
  const { onRequestGet: preferences, onRequestPost: save } = await import('../functions/api/account/preferences.js');
  const { profileAuthor } = await import('../functions/_lib/issues.js');
  assert.equal((await preferences(await ctx(null))).status, 401);
  assert.equal((await save(await ctx(null, 'POST', { displayName: 'Name' }))).status, 401);
  assert.equal((await save(await ctx('alice', 'POST', { displayName: 'Name' }, null, '', 'https://other.test'))).status, 403);
  assert.equal((await save(await ctx('alice', 'POST', { displayName: 'x'.repeat(51) }))).status, 400);
  assert.equal((await save(await ctx('alice', 'POST', { displayName: ' Site  Name ', user_id: 'bob' }))).status, 200);
  assert.equal((await (await preferences(await ctx('alice'))).json()).displayName, 'Site Name');
  assert.equal((await (await preferences(await ctx('bob'))).json()).displayName, '');
  assert.equal(await profileAuthor(2, { id: 'alice' }, env), 'Site Name');
  assert.equal(await profileAuthor(null, { id: 'alice' }, env), 'Site Name');
  assert.equal((await (await detail(await ctx(null, 'GET', null, 1))).json()).issue.author, 'Site Name');
  assert.equal((await (await list(await ctx('alice'))).json()).displayName, 'Site Name');
  assert.equal((await save(await ctx('bob', 'POST', { displayName: 'Comment Name' }))).status, 200);
  assert.equal((await (await detail(await ctx(null, 'GET', null, 1))).json()).comments[0].author, 'Comment Name');
  const { onRequestGet: session } = await import('../functions/api/auth/session.js');
  assert.equal((await (await session(await ctx('alice'))).json()).user.displayName, 'Site Name');
  assert.equal((await save(await ctx('alice', 'POST', { displayName: '' }))).status, 200);
  assert.equal(await profileAuthor(2, { id: 'alice', accessToken: 'test' }, env), 'Other profile');
});

test('initial display name is free, then a third later change is blocked while identical saves are ignored', async () => {
  const { onRequestGet: preferences, onRequestPost: save } = await import('../functions/api/account/preferences.js');
  const user = 'limited-names';
  const change = name => ctx(user, 'POST', { displayName: name }).then(save);
  assert.equal((await (await change('First name')).json()).changesRemaining, 2);
  assert.equal((await (await change(' First   name ')).json()).changesRemaining, 2);
  assert.equal((await (await change('')).json()).changesRemaining, 1);
  assert.equal((await (await change('Third name')).json()).changesRemaining, 0);
  const blocked = await change('Fourth name'); assert.equal(blocked.status, 429);
  const blockedBody = await blocked.json(); assert.ok(Date.parse(blockedBody.nextChangeAt) > Date.now());
  assert.equal((await (await preferences(await ctx(user))).json()).displayName, 'Third name');
  assert.equal((await change('Third name')).status, 200, 'unchanged values do not consume changes or fail');
  await env.DB.prepare(`UPDATE display_name_changes SET changed_at = ? WHERE id = (
    SELECT id FROM display_name_changes WHERE user_id = ? ORDER BY id LIMIT 1 OFFSET 1
  )`).bind(new Date(Date.now() - 61 * 86400000).toISOString(), user).run();
  assert.equal((await (await preferences(await ctx(user))).json()).changesRemaining, 1);
  assert.equal((await change('Now allowed')).status, 200);
  assert.equal((await change('Blocked again')).status, 429);
  const concurrent = await Promise.all(['One', 'Two', 'Three', 'Four'].map(async displayName => save(await ctx('concurrent-names', 'POST', { displayName }))));
  assert.equal(concurrent.filter(r => r.status === 200).length, 3);
  assert.equal(concurrent.filter(r => r.status === 429).length, 1);
});

test('existing accounts receive the same free initial display name allowance', async () => {
  const { preferencesDb } = await import('../functions/_lib/account-preferences.js');
  const { displayNameLimitDb, displayNameQuota } = await import('../functions/_lib/display-name-limit.js');
  const freshEnv = { DB: database() }, db = await preferencesDb(freshEnv);
  await db.prepare('INSERT INTO account_preferences (user_id, display_name, updated_at) VALUES (?, ?, ?)').bind('existing', 'Existing name', new Date().toISOString()).run();
  await displayNameLimitDb(freshEnv);
  assert.equal((await displayNameQuota(db, 'existing')).changesRemaining, 2);
  await displayNameLimitDb(freshEnv);
  assert.equal((await displayNameQuota(db, 'existing')).changesRemaining, 2);
});
test('reports and comments preserve image attachments and serve only matching image records', async () => {
  const { onRequestGet: image } = await import('../functions/api/issues/[id]/images/[image].js');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let response = await create(await ctx('images', 'POST', { ...report, attachments: [png] }));
  assert.equal(response.status, 201);const { id } = await response.json();
  const result = await (await detail(await ctx(null, 'GET', null, id))).json();
  assert.deepEqual(result.issue.attachments, [`/api/issues/${id}/images/0`]);
  assert.ok(!JSON.stringify(result).includes('base64'));
  let context = await ctx(null, 'GET', null, id);context.params.image = '0';
  response = await image(context);assert.equal(response.status, 200);assert.equal(response.headers.get('content-type'), 'image/png');assert.equal(new Uint8Array(await response.arrayBuffer())[0],137);
  context.params.image='3';assert.equal((await image(context)).status,404);
  assert.equal((await create(await ctx('images','POST',{...report,attachments:[png,png,png,png]}))).status,400);
  assert.equal((await create(await ctx('images','POST',{...report,attachments:['data:image/svg+xml;base64,PHN2Zz4=']}))).status,400);
  assert.equal((await create(await ctx('images','POST',{...report,attachments:['data:image/png;base64,YmFk']}))).status,400);
  assert.equal((await comment(await ctx('images','POST',{body:'Here is the error',attachments:[png]},id))).status,201);
  const updated=await (await detail(await ctx(null,'GET',null,id))).json();
  const commentId=updated.comments[0].id;
  context=await ctx(null,'GET',null,id,`?comment=${commentId}`);context.params.image='0';assert.equal((await image(context)).status,200);
  context=await ctx(null,'GET',null,1,`?comment=${commentId}`);context.params.image='0';assert.equal((await image(context)).status,404);
});

test('avatar identity is resolved from Nuvio profile and catalog, not submitted by the client', async () => {
  const {profileIdentity}=await import('../functions/_lib/issues.js');const previous=globalThis.fetch;
  globalThis.fetch=async url=>Response.json(url.endsWith('get_avatar_catalog')?[{id:'fox',storage_path:'fox.png'}]:[{profile_index:1,name:'Fox',avatar_id:'fox',avatar_color_hex:'#123456'}]);
  try {
    const identity=await profileIdentity(1,{id:'avatar-member',accessToken:'test'},env);
    assert.equal(identity.author,'Fox');assert.match(identity.avatar_url,/\/storage\/v1\/object\/public\/avatars\/fox.png$/);assert.equal(identity.avatar_color,'#123456');
    const created=await create(await ctx('avatar-member','POST',{...report,avatar_url:'https://evil.test/pretend.png'}));const {id}=await created.json();
    const result=await (await detail(await ctx(null,'GET',null,id))).json();assert.equal(result.issue.avatar_url,identity.avatar_url);
  } finally {globalThis.fetch=previous;}
});

test('account avatar overrides existing reports, comments and session across profiles', async()=>{
  const {onRequestPost:save,onRequestGet:read}=await import('../functions/api/account/avatar.js');
  const {onRequestGet:session}=await import('../functions/api/auth/session.js');
  assert.equal((await save(await ctx(null,'POST',{url:'https://example.com/a.jpg'}))).status,401);
  assert.equal((await save(await ctx('alice','POST',{url:'javascript:alert(1)'}))).status,400);
  assert.equal((await save(await ctx('alice','POST',{url:'http://example.com/a.jpg'}))).status,400);
  assert.equal((await save(await ctx('alice','POST',{url:'https://example.com/a.jpg'},null,'','https://other.test'))).status,403);
  assert.equal((await save(await ctx('alice','POST',{url:'https://example.com/a.jpg'}))).status,200);
  assert.equal((await (await read(await ctx('alice'))).json()).avatarUrl,'https://example.com/a.jpg');
  assert.equal((await (await session(await ctx('alice'))).json()).user.avatarUrl,'https://example.com/a.jpg');
  assert.equal((await (await detail(await ctx(null,'GET',null,1))).json()).issue.avatar_url,'https://example.com/a.jpg');
  const response=await create(await ctx('alice','POST',{...report,profileId:2}));const {id}=await response.json();
  assert.equal((await (await detail(await ctx(null,'GET',null,id))).json()).issue.avatar_url,'https://example.com/a.jpg');
  assert.equal((await (await read(await ctx('bob'))).json()).avatarUrl,'');
  await save(await ctx('alice','POST',{remove:true}));
  assert.equal((await (await read(await ctx('alice'))).json()).avatarUrl,'');
});
test('avatar uploads have one stored image per account and a working public image endpoint',async()=>{
  const {onRequestPost:save}=await import('../functions/api/account/avatar.js');
  const {onRequestGet:image}=await import('../functions/api/avatars/[id].js');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let response=await save(await ctx('avatar-upload','POST',{image:png}));assert.equal(response.status,200);
  const {avatarUrl}=await response.json(),id=avatarUrl.split('/').pop();
  const context=await ctx(null);context.params.id=id;response=await image(context);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  await env.DB.prepare("UPDATE account_avatars SET updated_at = '2000-01-01' WHERE user_id = ?").bind('avatar-upload').run();
  await save(await ctx('avatar-upload','POST',{image:png}));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_avatars WHERE user_id = ?').bind('avatar-upload').first()).n,1);
  assert.equal((await image(context)).status,404);
});
