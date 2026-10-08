import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSessionCookie } from '../functions/_lib/nuvio-session.js';
import { mentionedMembers } from '../functions/_lib/forum-mentions.js';
import { onRequestGet as get, onRequestPost as post } from '../functions/api/forum.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json([{ profile_index: 1, name: 'Profile name' }]);
after(() => { globalThis.fetch = realFetch; });

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  let fail = null;
  return {
    failNext(pattern) { fail = pattern; },
    prepare(sql) {
      const build = args => ({
        bind: (...values) => { assert.ok(values.length <= 100, 'D1 bound parameter limit'); return build(values); },
        async run() {
          if (fail && sql.includes(fail)) { fail = null; throw new Error('Injected D1 failure'); }
          const r = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return build([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
function fixture() {
  const env = { DB: database(), KOLLECTION_SESSION_SECRET: 'mention-test-secret', NUVIO_ADMIN_USER_ID: 'admin' };
  const f = {
    env,
    async call(user, data, params = {}, origin = 'https://kollection.tv') {
      const headers = { 'Content-Type': 'application/json', Origin: origin };
      if (user) headers.Cookie = (await createSessionCookie({ user: { id: user, email: `${user}@private.test` }, accessToken: 'secret-access-token', expiresIn: 3600 }, env)).split(';')[0];
      const request = new Request('https://kollection.tv/api/forum?' + new URLSearchParams(params), { headers, method: data ? 'POST' : 'GET', ...(data ? { body: JSON.stringify({ profileId: 1, ...data }) } : {}) });
      const response = await (data ? post : get)({ env, request });
      return { status: response.status, data: await response.json() };
    },
    async member(user, name = user) {
      const result = await f.call(user, { action: 'profile', about: '' });
      assert.equal(result.status, 200);
      await env.DB.prepare('INSERT INTO account_preferences(user_id,display_name,updated_at) VALUES(?,?,?)').bind(user, name, 'now').run();
      return result.data.memberId;
    },
    async inbox(user, params = {}) { return (await f.call(user, null, { view: 'notifications', ...params })).data; },
  };
  return f;
}
const topic = { action: 'topic', categoryId: 1, title: 'A mention discussion', body: 'Ordinary discussion text' };
const tag = (id, name = 'A member') => `@[${name}](member:${id})`;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('mention grammar handles escaped labels, quote/code suppression, backticks in names and the ten-member limit', () => {
  const ids = Array.from({ length: 12 }, (_, i) => uuid(i + 1));
  const body = [tag(ids[0], 'Name \\] and \\[ \\\\ here'), tag(ids[0].toUpperCase()),
    '`' + tag(ids[1]) + '`', '``' + tag(ids[2]) + '` inside``', '> ' + tag(ids[3]),
    '  >> ' + tag(ids[4]), '```js', tag(ids[5]), '```', '~~~~', tag(ids[6]), '~~~~',
    '\\' + tag(ids[7]), '@[not valid](member:admin)', tag(ids[8], 'x'.repeat(161)), tag(ids[9])].join('\n');
  assert.deepEqual(mentionedMembers(body), [ids[0], ids[9]]);
  assert.deepEqual(mentionedMembers('`multiline\n' + tag(ids[1]) + '\ncode`'), []);
  assert.deepEqual(mentionedMembers(tag(ids[0], 'Name ` here') + ' and `code ' + tag(ids[1]) + '` then ' + tag(ids[2])), [ids[0], ids[2]]);
  for (const indent of ['    ', '\t']) assert.deepEqual(mentionedMembers(indent + '```js\n' + tag(ids[0]) + '\n' + indent + '```\n' + tag(ids[1])), [ids[1]]);
  assert.equal(mentionedMembers(ids.slice(0, 10).map(id => tag(id)).join(' ')).length, 10);
  assert.throws(() => mentionedMembers(ids.slice(0, 11).map(id => tag(id)).join(' ')), /up to 10/);
});

test('autocomplete requires auth and returns at most eight effective public identities without banned members', async () => {
  const f = fixture();
  assert.equal((await f.call(null, null, { view: 'mentionMembers' })).status, 401);
  for (let i = 0; i < 11; i++) await f.member('person-' + i, 'Display ' + String(i).padStart(2, '0'));
  const banned = await f.member('banned', 'Display banned');
  await f.call('admin', { action: 'memberModerate', id: banned, banned: true, clearAbout: false });
  const result = await f.call('viewer', null, { view: 'mentionMembers', q: 'DISPLAY' });
  assert.equal(result.data.members.length, 8); assert.equal(result.data.members[0].author, 'Display 00');
  assert.deepEqual(Object.keys(result.data.members[0]).sort(), ['author', 'avatar_color', 'avatar_url', 'member_id']);
  assert.doesNotMatch(JSON.stringify(result), /private\.test|secret-access-token|user_id|person-/);
  assert.equal((await f.call('viewer', null, { view: 'mentionMembers', q: 'banned' })).data.members.length, 0);
  assert.equal((await f.call('viewer', null, { view: 'mentionMembers', q: '%' })).data.members.length, 0);
});

test('post mentions enforce actor identity and skip duplicate, self, unknown and banned recipients', async () => {
  const f = fixture(), alice = await f.member('alice', 'Alice account'), bob = await f.member('bob'), carol = await f.member('carol'), banned = await f.member('banned');
  await f.call('admin', { action: 'memberModerate', id: banned, banned: true, clearAbout: false });
  const created = await f.call('alice', { ...topic, body: [tag(bob, 'Spoofed name'), tag(bob), tag(carol), tag(alice), tag(banned), tag(uuid(9))].join(' '), actor_id: carol, member_id: carol, author: 'Spoofed actor' });
  assert.equal(created.status, 201);
  const inbox = await f.inbox('bob');
  assert.equal(inbox.unreadCount, 1); assert.equal(inbox.notifications.length, 1);
  assert.deepEqual(inbox.notifications[0].actor, { member_id: alice, author: 'Alice account', avatar_url: '', avatar_color: '#6568e8' });
  assert.equal(inbox.notifications[0].topicId, created.data.id); assert.equal(inbox.notifications[0].replyId, null);
  assert.equal(inbox.notifications[0].url, '/discussions#topic/' + created.data.id);
  assert.equal((await f.inbox('carol')).unreadCount, 1); assert.equal((await f.inbox('alice')).unreadCount, 0); assert.equal((await f.inbox('banned')).unreadCount, 0);
  assert.doesNotMatch(JSON.stringify(inbox), /private\.test|secret-access-token|user_id|Spoofed/);
  const reply = await f.call('alice', { action: 'reply', id: created.data.id, body: tag(bob) + ' ' + tag(carol) });
  assert.equal(reply.status, 201);
  for (const recipient of ['bob', 'carol']) {
    const latest = (await f.inbox(recipient)).notifications[0];
    assert.equal(latest.replyId, reply.data.id); assert.equal(latest.topicId, created.data.id);
  }
});

test('inbox and read actions protect recipient ownership, auth, origin and query bounds', async () => {
  const f = fixture(), bob = await f.member('bob'), carol = await f.member('carol');
  await f.call('alice', { ...topic, body: tag(bob) + ' ' + tag(carol) });
  assert.equal((await f.call(null, null, { view: 'notifications' })).status, 401);
  assert.equal((await f.call(null, null, { view: 'notifications', summary: 1 })).status, 401);
  assert.deepEqual(await f.inbox('bob', { summary: 1 }), { unreadCount: 1 });
  assert.deepEqual(await f.inbox('new-account'), { notifications: [], unreadCount: 0, hasMore: false, nextCursor: null });
  const bobId = (await f.inbox('bob')).notifications[0].id, carolId = (await f.inbox('carol')).notifications[0].id;
  assert.equal((await f.call(null, { action: 'notificationsRead', all: true })).status, 401);
  assert.equal((await f.call('bob', { action: 'notificationsRead', all: true }, {}, 'https://evil.test')).status, 403);
  assert.deepEqual((await f.call('bob', { action: 'notificationsRead', ids: [carolId], recipient_id: carol })).data, { unreadCount: 1 });
  assert.equal((await f.inbox('carol')).unreadCount, 1);
  assert.deepEqual((await f.call('bob', { action: 'notificationsRead', ids: [bobId, bobId] })).data, { unreadCount: 0 });
  const firstRead = (await f.inbox('bob')).notifications[0].readAt; assert.ok(firstRead);
  await f.call('bob', { action: 'notificationsRead', all: true });
  assert.equal((await f.inbox('bob')).notifications[0].readAt, firstRead);
  await f.call('carol', { action: 'notificationsRead', all: true }); assert.equal((await f.inbox('carol')).unreadCount, 0);
  assert.equal((await f.call('bob', { action: 'notificationsRead', ids: Array(101).fill(bobId) })).status, 400);
  assert.equal((await f.call('bob', { action: 'notificationsRead', ids: Array.from({ length: 100 }, (_, i) => i + 1) })).status, 200);
});

test('edits add only new notifications, preserve read history and suppress removed tags', async () => {
  const f = fixture(), bob = await f.member('bob'), carol = await f.member('carol');
  const created = await f.call('alice', { ...topic, body: tag(bob) });
  const edit = { action: 'topicEdit', id: created.data.id, title: 'Edited discussion', body: tag(bob) };
  const original = (await f.inbox('bob')).notifications[0];
  await f.call('bob', { action: 'notificationsRead', all: true });
  assert.equal((await f.call('carol', edit)).status, 403);
  await f.call('alice', edit); await f.call('alice', { ...edit, body: tag(bob) + ' ' + tag(carol) });
  assert.equal((await f.inbox('bob')).notifications.length, 1); assert.equal((await f.inbox('bob')).unreadCount, 0); assert.equal((await f.inbox('carol')).unreadCount, 1);
  await f.call('alice', { ...edit, body: 'Removed all tagged members' });
  assert.equal((await f.inbox('bob')).notifications.length, 0); assert.equal((await f.inbox('carol')).unreadCount, 0);
  await f.call('alice', { ...edit, body: tag(bob) });
  assert.equal((await f.inbox('bob')).notifications[0].id, original.id); assert.equal((await f.inbox('bob')).unreadCount, 0);
  const reply = await f.call('alice', { action: 'reply', id: created.data.id, body: 'A plain reply' });
  assert.equal((await f.call('admin', { action: 'replyEdit', id: reply.data.id, body: tag(carol), actor_id: bob })).status, 200);
  const adminMember = (await f.call('admin', null, { view: 'self' })).data.myMemberId;
  const added = (await f.inbox('carol')).notifications[0];
  assert.equal(added.actor.member_id, adminMember); assert.equal(added.replyId, reply.data.id);
});

test('hidden/deleted content and banned actors never leak through inboxes or unread summaries', async () => {
  const f = fixture(), bob = await f.member('bob');
  const tid = (await f.call('alice', { ...topic, body: tag(bob) })).data.id;
  const rid = (await f.call('alice', { action: 'reply', id: tid, body: tag(bob) })).data.id;
  const mod = { action: 'topicModerate', id: tid, categoryId: 1, pinned: false, locked: false, hidden: true };
  await f.call('admin', { action: 'replyModerate', id: rid, hidden: true }); assert.equal((await f.inbox('bob')).unreadCount, 1);
  await f.call('admin', mod);
  assert.deepEqual(await f.inbox('bob'), { notifications: [], unreadCount: 0, hasMore: false, nextCursor: null });
  assert.deepEqual(await f.inbox('bob', { summary: 1 }), { unreadCount: 0 });
  await f.call('admin', { ...mod, hidden: false }); await f.call('admin', { action: 'replyModerate', id: rid, hidden: false });
  assert.equal((await f.inbox('bob')).unreadCount, 2);
  const alice = (await f.call('alice', null, { view: 'self' })).data.myMemberId;
  await f.call('admin', { action: 'memberModerate', id: alice, banned: true, clearAbout: false }); assert.equal((await f.inbox('bob')).notifications.length, 0);
  await f.call('admin', { action: 'memberModerate', id: alice, banned: false, clearAbout: false });
  await f.call('alice', { action: 'replyDelete', id: rid }); assert.equal((await f.inbox('bob')).unreadCount, 1);
  await f.call('alice', { action: 'topicDelete', id: tid }); assert.equal((await f.inbox('bob')).unreadCount, 0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_notifications').first()).n, 0);
});

test('cursor pages are bounded and notification links reach replies beyond the first twenty', async () => {
  const f = fixture(), bob = await f.member('bob'), tid = (await f.call('alice', topic)).data.id;
  let rid;
  for (let i = 0; i < 25; i++) rid = (await f.call('alice', { action: 'reply', id: tid, body: tag(bob) + ' ' + i })).data.id;
  const first = await f.inbox('bob', { limit: 999 });
  assert.equal(first.notifications.length, 20); assert.equal(first.unreadCount, 25); assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, first.notifications.at(-1).id);
  const second = await f.inbox('bob', { cursor: first.nextCursor });
  assert.equal(second.notifications.length, 5); assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.notifications, ...second.notifications].map(n => n.id)).size, 25);
  assert.equal(first.notifications[0].url, `/discussions#topic/${tid}?reply=${rid}`);
  assert.equal((await f.call('bob', null, { view: 'topic', id: tid, reply: rid })).data.replies[0].id, rid);
  assert.equal((await f.call('bob', null, { view: 'notifications', cursor: 'bad' })).status, 404);
});

test('fan-out is capped before posting and quota failures cannot notify using stale insert IDs', async () => {
  const f = fixture(), members = [];
  for (let i = 0; i < 11; i++) members.push(await f.member('recipient-' + i));
  assert.equal((await f.call('alice', { ...topic, body: members.map(id => tag(id)).join(' ') })).status, 400);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_topics').first()).n, 0);
  assert.equal((await f.call('alice', { ...topic, body: members.slice(0, 10).map(id => tag(id)).join(' ') })).status, 201);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_notifications').first()).n, 10);
  for (let i = 1; i < 10; i++) assert.equal((await f.call('alice', topic)).status, 201);
  assert.equal((await f.call('alice', { ...topic, body: tag(members[10]) })).status, 429);
  assert.equal((await f.inbox('recipient-10')).unreadCount, 0);
});

test('notification failures roll back the entire new post, reply or edit batch', async () => {
  const f = fixture(), bob = await f.member('bob'), originalError = console.error;
  console.error = () => {};
  try {
    f.env.DB.failNext('INSERT OR IGNORE INTO forum_notifications');
    assert.equal((await f.call('alice', { ...topic, body: tag(bob) })).status, 503);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_topics').first()).n, 0);
    const tid = (await f.call('alice', topic)).data.id;
    f.env.DB.failNext('INSERT OR IGNORE INTO forum_notifications');
    assert.equal((await f.call('alice', { action: 'reply', id: tid, body: tag(bob) })).status, 503);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM forum_replies').first()).n, 0);
    f.env.DB.failNext('INSERT OR IGNORE INTO forum_notifications');
    assert.equal((await f.call('alice', { action: 'topicEdit', id: tid, title: 'Changed title', body: tag(bob) })).status, 503);
    assert.equal((await f.call(null, null, { view: 'topic', id: tid })).data.topic.body, topic.body);
    assert.equal((await f.inbox('bob')).notifications.length, 0);
  } finally { console.error = originalError; }
});
