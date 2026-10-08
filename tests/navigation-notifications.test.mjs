import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../nuvio-auth/nav-notifications.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatchEvent(event) {
    event.target ||= this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return !event.defaultPrevented;
  }
}

function matches(node, selector) {
  const parts = selector.trim().split(/\s+/);
  const simple = (element, part) => {
    if (part.startsWith('#')) return element.id === part.slice(1);
    if (part.startsWith('[')) {
      const [, key, value] = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part) || [];
      return key && (value === undefined ? element.getAttribute(key) !== null : element.getAttribute(key) === value);
    }
    const [tag, ...classes] = part.split('.');
    return (!tag || element.tagName === tag.toUpperCase()) && classes.every((name) => element.classList.contains(name));
  };
  if (!simple(node, parts.pop())) return false;
  let parent = node.parentNode;
  while (parts.length) {
    const part = parts.pop();
    while (parent && !simple(parent, part)) parent = parent.parentNode;
    if (!parent) return false;
    parent = parent.parentNode;
  }
  return true;
}

class Element extends Events {
  constructor(tag, document) {
    super();
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.className = ''; this.id = '';
    this.dataset = {}; this.attributes = new Map(); this.hidden = false; this.disabled = false;
    this.style = { setProperty() {} }; this._text = ''; this.open = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      remove: (name) => { this.className = this.className.split(/\s+/).filter((value) => value !== name).join(' '); },
    };
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_) { throw new Error('The notification UI must create user text as text nodes.'); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) {
    if (key.startsWith('data-')) {
      const name = key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, name) ? this.dataset[name] : null;
    }
    return this.attributes.get(key) ?? null;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => { for (const child of node.children) { if (matches(child, selector)) result.push(child); visit(child); } };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (matches(node, selector)) return node; return null; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.querySelector('button')?.focus(); }
  close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
}

function harness() {
  let now = Date.parse('2026-10-08T12:00:00Z'), nextTimer = 0;
  const timers = new Map(), calls = [], navigations = [];
  const document = new Events();
  document.visibilityState = 'visible';
  document.createElement = (tag) => new Element(tag, document);
  document.createTextNode = (text) => { const node = document.createElement('#text'); node.textContent = text; return node; };
  document.body = document.createElement('body');
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  document.querySelector = (selector) => document.body.querySelector(selector);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const add = (tag, id, className, parent = document.body) => {
    const node = document.createElement(tag); node.id = id; node.className = className; parent.append(node); return node;
  };
  const desktop = add('div', 'nuvioDesktopAccount', '');
  const wrap = add('div', '', 'nuvio-desktop-account-wrap open', desktop);
  add('button', '', 'nuvio-desktop-profile-button', wrap);
  const mobile = add('div', 'nuvioMobileAccount', '');
  const menuWrap = add('div', 'menuWrap', 'open');
  add('button', 'menuButton', '', menuWrap);
  for (const parent of [desktop, mobile]) {
    const badge = add('span', '', 'nuvio-notification-badge', parent);
    badge.dataset.nuvioNotificationCount = ''; badge.hidden = true;
    const button = add('button', '', '', parent);
    button.dataset.nuvioNotifications = ''; button.hidden = true;
  }
  const window = new Events();
  window.location = { origin: 'https://kollection.test', assign: (url) => navigations.push(url) };
  let ready = 0;
  window.addEventListener('kollection:notifications-ready', () => { ready++; });
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  vm.runInNewContext(source, {
    window, document, URL, AbortController, Date: ClockDate,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, options) => new Promise((resolve) => {
      calls.push({ url, options, reply: (data, status = 200) => resolve(Response.json(data, { status })) });
    }),
  });
  return {
    window, document, calls, timers, navigations, ready,
    controller: window.KollectionNavNotifications,
    advance: (ms) => { now += ms; },
    fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); now += timer.delay; timer.callback(); },
    badges: () => document.querySelectorAll('[data-nuvio-notification-count]'),
    button: (text) => document.getElementById('nuvioNotificationDialog').querySelectorAll('button').find((button) => button.textContent === text),
    clickLink(link) { document.querySelector('.nuvio-notification-list').dispatchEvent({ type: 'click', target: link, button: 0 }); },
  };
}

const session = (id) => ({ authenticated: true, user: { id } });
const note = (id, overrides = {}) => ({
  id, actor: { member_id: 'member-other', author: 'Sam', avatar_color: '#556677' },
  topicId: 12, replyId: 8, topicTitle: 'Release discussion', createdAt: '2026-10-08 11:00:00', readAt: null,
  url: '/discussions#topic/12?reply=8', ...overrides,
});
async function signedIn(h, count = 2) {
  const pending = h.controller.setSession(session('test-user-a'));
  h.calls.at(-1).reply({ unreadCount: count });
  await pending;
}
async function openList(h, notifications, extra = {}) {
  const pending = h.controller.open(h.document.querySelector('[data-nuvio-notifications]'));
  h.calls.at(-1).reply({ notifications, unreadCount: 2, hasMore: false, nextCursor: null, ...extra });
  await pending;
}

test('anonymous pages never fetch notifications, and background tabs start only when visible', async () => {
  const h = harness();
  assert.equal(h.ready, 1);
  await h.controller.setSession(null);
  await h.controller.open();
  h.window.dispatchEvent({ type: 'focus' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
  h.document.visibilityState = 'hidden';
  await h.controller.setSession(session('test-user-a'));
  assert.equal(h.calls.length, 0);
  h.document.visibilityState = 'visible';
  h.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/forum?view=notifications&summary=1');
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.cache, 'no-store');
  assert.equal(h.calls[0].options.headers?.Authorization, undefined);
  h.calls[0].reply({ unreadCount: 3 });
  await tick();
  assert.equal(h.badges().length, 3, 'mobile menu also receives a count badge');
  assert.ok(h.badges().every((badge) => !badge.hidden && badge.textContent === '3'));
  assert.equal(h.document.getElementById('menuButton').getAttribute('aria-describedby'), 'nuvioMenuNotificationStatus');
  assert.equal(h.document.getElementById('nuvioMenuNotificationStatus').textContent, '3 unread notifications');
  assert.equal([...h.timers.values()][0].delay, 120000);
});

test('summary requests coalesce, focus is throttled, and polling stops when hidden or signed out', async () => {
  const h = harness();
  const pending = h.controller.setSession(session('test-user-a'));
  assert.equal(h.controller.refresh(), pending);
  assert.equal(h.controller.refresh(), pending);
  assert.equal(h.calls.length, 1);
  h.calls[0].reply({ unreadCount: 2 });
  await pending;
  h.window.dispatchEvent({ type: 'focus' });
  assert.equal(h.calls.length, 1);
  h.fireTimer();
  assert.equal(h.calls.length, 2);
  h.document.visibilityState = 'hidden';
  h.document.dispatchEvent({ type: 'visibilitychange' });
  h.calls[1].reply({ unreadCount: 4 });
  await tick();
  assert.equal(h.timers.size, 0);
  h.window.dispatchEvent({ type: 'kollection:nuvio-signed-out' });
  h.document.visibilityState = 'visible';
  h.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(h.calls.length, 2);
  assert.ok(h.badges().every((badge) => badge.hidden));
  assert.equal(h.document.getElementById('menuButton').getAttribute('aria-describedby'), null);
  assert.equal(h.document.getElementById('nuvioMenuNotificationStatus').textContent, '');
});

test('switching accounts aborts and discards old counts and private notification lists', async () => {
  const h = harness();
  const old = h.controller.setSession(session('test-user-a'));
  const current = h.controller.setSession(session('test-user-b'));
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.calls[1].reply({ unreadCount: 1 });
  await current;
  h.calls[0].reply({ unreadCount: 99 });
  await old;
  assert.ok(h.badges().every((badge) => badge.textContent === '1'));
  const oldList = h.controller.open();
  const next = h.controller.setSession(session('test-user-c'));
  assert.equal(h.document.getElementById('nuvioNotificationDialog').open, false);
  h.calls[3].reply({ unreadCount: 0 });
  await next;
  h.calls[2].reply({ notifications: [note(5, { topicTitle: 'Private old account title' })], unreadCount: 99 });
  await oldList;
  assert.doesNotMatch(h.document.body.textContent, /Private old account title/);
  assert.equal(h.document.querySelectorAll('.nuvio-notification-item').length, 0);
  assert.ok(h.badges().every((badge) => badge.hidden));
});

test('notifications render actor, topic and time, page without duplicates, and mark all read', async () => {
  const h = harness();
  await signedIn(h);
  await openList(h, [note(20)], { hasMore: true, nextCursor: 20 });
  assert.match(h.document.querySelector('.nuvio-notification-list').textContent, /Sam tagged youRelease discussion1h ago/);
  h.button('Load more').dispatchEvent({ type: 'click' });
  assert.equal(h.calls.at(-1).url, '/api/forum?view=notifications&cursor=20');
  h.calls.at(-1).reply({ notifications: [note(20), note(19, { replyId: null, url: '/discussions#topic/12' })], unreadCount: 2, hasMore: false });
  await tick();
  assert.equal(h.document.querySelectorAll('.nuvio-notification-item').length, 2);
  assert.equal(h.button('Load more').hidden, true);
  h.button('Mark all read').dispatchEvent({ type: 'click' });
  const mutation = h.calls.at(-1);
  assert.equal(mutation.options.method, 'POST');
  assert.deepEqual(JSON.parse(mutation.options.body), { action: 'notificationsRead', all: true });
  mutation.reply({ unreadCount: 0 });
  await tick();
  assert.equal(h.document.querySelectorAll('.unread').length, 0);
  assert.ok(h.badges().every((badge) => badge.hidden));
  assert.equal(h.button('Mark all read').disabled, true);
});

test('opening a mention closes the dialog and navigates immediately while read status saves with keepalive', async () => {
  const h = harness();
  await signedIn(h);
  await openList(h, [note(20)]);
  h.clickLink(h.document.querySelector('.nuvio-notification-link'));
  const mutation = h.calls.at(-1);
  assert.equal(mutation.options.keepalive, true);
  assert.deepEqual(JSON.parse(mutation.options.body), { action: 'notificationsRead', ids: [20] });
  assert.deepEqual(h.navigations, ['/discussions#topic/12?reply=8']);
  assert.equal(h.document.getElementById('nuvioNotificationDialog').open, false);
  mutation.reply({ error: 'Temporary failure' }, 503);
  await tick();
  assert.equal(h.navigations.length, 1, 'mark-read failure never blocks or repeats navigation');
});

test('opening an already-read notification still closes the dialog for same-page navigation', async () => {
  const h = harness();
  await signedIn(h, 0);
  await openList(h, [note(20, { readAt: '2026-10-08T11:30:00Z' })], { unreadCount: 0 });
  const before = h.calls.length;
  h.clickLink(h.document.querySelector('.nuvio-notification-link'));
  assert.equal(h.calls.length, before);
  assert.equal(h.document.getElementById('nuvioNotificationDialog').open, false);
  assert.deepEqual(h.navigations, ['/discussions#topic/12?reply=8']);
});

test('only exact same-origin forum URLs are linked and user text cannot become HTML', async () => {
  const h = harness();
  await signedIn(h);
  const bad = [
    'https://other.test/discussions#topic/12?reply=8', 'javascript:alert(1)',
    '/account#topic/12?reply=8', '/discussions?extra=1#topic/12?reply=8',
    '/discussions#topic/12?reply=8&extra=1', '/discussions#topic/13?reply=8',
  ].map((url, index) => note(index + 1, { url }));
  await openList(h, [note(20, {
    actor: { author: '<img src=x onerror=alert(1)>', avatar_url: 'javascript:alert(1)' },
    topicTitle: '<script>private text</script>',
  }), ...bad, note(90, { topicId: '9007199254740999', url: '/discussions#topic/9007199254740999?reply=8' })]);
  assert.equal(h.document.querySelectorAll('.nuvio-notification-link').length, 1);
  assert.equal(h.document.querySelectorAll('script').length, 0);
  assert.equal(h.document.querySelectorAll('img').length, 0);
  assert.match(h.document.querySelector('.nuvio-notification-list').textContent, /<script>private text<\/script>/);
});

test('an open list refreshes on return, while errors stay quiet and unauthorized responses clear private data', async () => {
  const h = harness();
  await signedIn(h);
  await openList(h, [note(20)]);
  h.advance(12000);
  h.window.dispatchEvent({ type: 'focus' });
  assert.equal(h.calls.at(-1).url, '/api/forum?view=notifications');
  const before = h.calls.length;
  h.window.dispatchEvent({ type: 'focus' });
  assert.equal(h.calls.length, before);
  h.calls.at(-1).reply({ error: 'Unavailable' }, 503);
  await tick();
  assert.match(h.document.querySelector('.nuvio-notification-status').textContent, /couldn’t load/);
  assert.equal(h.document.querySelectorAll('.nuvio-notification-item').length, 1);
  h.button('Try again').dispatchEvent({ type: 'click' });
  h.calls.at(-1).reply({ error: 'Sign in' }, 401);
  await tick();
  assert.equal(h.document.getElementById('nuvioNotificationDialog').open, false);
  assert.equal(h.document.querySelectorAll('.nuvio-notification-item').length, 0);
  assert.equal(h.timers.size, 0);
  assert.ok(h.badges().every((badge) => badge.hidden));
});

test('a delayed read receipt cannot clear the next account’s unread count', async () => {
  const h = harness();
  await signedIn(h);
  await openList(h, [note(20)]);
  h.clickLink(h.document.querySelector('.nuvio-notification-link'));
  const receipt = h.calls.at(-1);
  const current = h.controller.setSession(session('test-user-b'));
  h.calls.at(-1).reply({ unreadCount: 7 });
  await current;
  receipt.reply({ unreadCount: 0 });
  await tick();
  assert.ok(h.badges().every((badge) => badge.textContent === '7' && !badge.hidden));
});

test('out-of-order read receipts reconcile the count once both saves finish', async () => {
  const h = harness();
  await signedIn(h);
  await openList(h, [note(20), note(19)]);
  const list = h.document.querySelector('.nuvio-notification-list');
  for (const link of list.querySelectorAll('.nuvio-notification-link')) {
    list.dispatchEvent({ type: 'click', target: link, button: 0, ctrlKey: true });
  }
  assert.equal(h.calls.length, 4);
  h.calls[3].reply({ unreadCount: 1 });
  await tick();
  assert.equal(h.button('Load more').disabled, true);
  assert.equal(h.calls.length, 4);
  h.calls[2].reply({ unreadCount: 0 });
  await tick();
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls[4].url, '/api/forum?view=notifications&summary=1');
  h.calls[4].reply({ unreadCount: 0 });
  await tick();
  assert.ok(h.badges().every((badge) => badge.hidden));
  assert.equal(h.document.querySelectorAll('.unread').length, 0);
});

test('desktop and mobile account rerenders restore their badges without fetching again', async () => {
  const h = harness();
  await signedIn(h, 4);
  for (const id of ['nuvioDesktopAccount', 'nuvioMobileAccount']) {
    const slot = h.document.getElementById(id);
    slot.querySelector('[data-nuvio-notification-count]').remove();
    const badge = h.document.createElement('span');
    badge.dataset.nuvioNotificationCount = ''; badge.hidden = true;
    slot.append(badge);
  }
  await h.controller.setSession(session('test-user-a'));
  assert.equal(h.calls.length, 1);
  assert.equal(h.badges().length, 3);
  assert.ok(h.badges().every((badge) => !badge.hidden && badge.textContent === '4'));
});
