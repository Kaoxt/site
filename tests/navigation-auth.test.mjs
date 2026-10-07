import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const [authSource, adminSource, navSource] = await Promise.all([
  '../nuvio-auth/nuvio-auth.js', '../nuvio-auth/admin-nav.js', '../nuvio-auth/nav-account.js',
].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function loadAuth(fetch) {
  const window = eventTarget();
  vm.runInNewContext(authSource, { window, fetch, setTimeout });
  return window;
}

test('concurrent session and token reads share requests, but subsequent checks stay fresh', async () => {
  const requests = [];
  const window = loadAuth((url, options) => {
    const response = deferred();
    requests.push({ url, options, ...response });
    return response.promise;
  });
  const auth = window.KollectionNuvioAuth;
  const session = auth.getSession();
  const token = auth.getAccessToken();
  assert.equal(auth.getSession(), session);
  assert.equal(auth.getAccessToken(), token);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.cache, 'no-store');
    request.resolve(Response.json({ authenticated: true }));
  }
  await Promise.all([session, token]);
  const next = auth.getSession();
  assert.equal(requests.length, 3);
  requests[2].resolve(Response.json({ authenticated: false }));
  assert.equal((await next).authenticated, false);
});

test('failed auth reads can retry, and logout invalidates old session and token responses', async () => {
  const requests = [];
  const window = loadAuth((url) => {
    const response = deferred();
    requests.push({ url, ...response });
    return response.promise;
  });
  const auth = window.KollectionNuvioAuth;
  const failed = auth.getSession();
  const failure = assert.rejects(failed, /Unavailable/);
  requests[0].resolve(Response.json({ error: 'Unavailable' }, { status: 503 }));
  await failure;
  const oldSession = assert.rejects(auth.getSession(), { code: 'SESSION_CHANGED' });
  const oldToken = assert.rejects(auth.getAccessToken(), { code: 'SESSION_CHANGED' });
  const logout = auth.signOut();
  assert.equal(requests[3].url, '/api/auth/logout');
  requests[3].resolve(Response.json({ ok: true }));
  await logout;
  requests[1].resolve(Response.json({ authenticated: true }));
  requests[2].resolve(Response.json({ authenticated: true, accessToken: 'old-token' }));
  await Promise.all([oldSession, oldToken]);
  const current = auth.getSession();
  requests[4].resolve(Response.json({ authenticated: false }));
  assert.equal((await current).authenticated, false);
});

test('account identity events invalidate pending auth reads without retaining credential results', async () => {
  for (const type of ['kollection:nuvio-signed-in', 'kollection:nuvio-signed-out', 'kollection:nuvio-session-changed', 'kollection:display-name-changed', 'kollection:avatar-changed']) {
    const replies = [];
    const window = loadAuth(() => {
      const reply = deferred();
      replies.push(reply);
      return reply.promise;
    });
    const old = assert.rejects(window.KollectionNuvioAuth.getSession(), { code: 'SESSION_CHANGED' });
    window.dispatchEvent({ type });
    const fresh = window.KollectionNuvioAuth.getSession();
    assert.equal(replies.length, 2);
    replies[0].resolve(Response.json({ authenticated: true, user: { id: 'old' } }));
    replies[1].resolve(Response.json({ authenticated: true, user: { id: 'current' } }));
    await old;
    assert.equal((await fresh).user.id, 'current');
  }
});

test('navigation DOM changes reuse the admin session and stale admin responses cannot undo logout', async () => {
  const window = eventTarget();
  let reads = 0, administratorPaints = 0, observer;
  let reply = Promise.resolve({ authenticated: true, isAdmin: true });
  window.KollectionNuvioAuth = { getSession: () => { reads++; return reply; } };
  const document = {
    getElementById: () => ({}),
    querySelector: () => { administratorPaints++; return null; },
    querySelectorAll: () => [],
  };
  vm.runInNewContext(adminSource, {
    window, document, queueMicrotask,
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
  });
  await window.KollectionAdminNav.init();
  assert.equal(reads, 1);
  assert.ok(administratorPaints > 0);
  for (let i = 0; i < 10; i++) observer();
  await tick();
  assert.equal(reads, 1, 'adding links or avatars must not trigger another session request');
  const pending = deferred();
  reply = pending.promise;
  const refresh = window.KollectionAdminNav.refresh();
  window.dispatchEvent({ type: 'kollection:nuvio-signed-out' });
  const before = administratorPaints;
  pending.resolve({ authenticated: true, isAdmin: true });
  await refresh;
  observer();
  await tick();
  assert.equal(administratorPaints, before, 'a pre-logout response must not restore admin controls');
});

function element() {
  const attributes = new Map(), classes = new Set();
  return {
    ...eventTarget(), dataset: {}, textContent: '', className: '', isConnected: true,
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: (key) => attributes.get(key),
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function accountSlot(mobile = false) {
  let html = '', selectors = new Map(), avatars = [];
  const slot = element();
  Object.defineProperty(slot, 'innerHTML', {
    get: () => html,
    set(value) {
      html = value;
      slot.paints++;
      for (const node of [...selectors.values(), ...avatars]) node.isConnected = false;
      selectors = new Map();
      avatars = [];
      if (!value.includes(mobile ? 'nuvio-mobile-account signed-in' : 'nuvio-desktop-account-wrap')) return;
      const current = element();
      const strong = element(), small = element();
      current.querySelector = (selector) => ({ strong, small }[selector] || null);
      selectors.set(mobile ? '.nuvio-mobile-current-profile' : '.nuvio-desktop-popover-user', current);
      selectors.set(mobile ? '.nuvio-mobile-account.signed-in' : '.nuvio-desktop-account-wrap', element());
      selectors.set('.nuvio-desktop-profile-button', element());
      selectors.set('.nuvio-desktop-profile-name', element());
      selectors.set(mobile ? '[data-nuvio-signout-mobile]' : '[data-nuvio-signout-desktop]', element());
      for (const match of value.matchAll(/<span class="[^"]*"[^>]*data-nuvio-avatar="([^"]+)" data-nuvio-avatar-size="([^"]*)" data-nuvio-avatar-profile="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g)) {
        const avatar = element();
        avatar.dataset = { nuvioAvatar: match[1], nuvioAvatarSize: match[2], nuvioAvatarProfile: match[3] };
        let contents = match[4];
        Object.defineProperty(avatar, 'innerHTML', { get: () => contents, set: (next) => { contents = next; } });
        avatar.querySelector = (selector) => {
          const src = contents.match(/<img src="([^"]*)"/);
          return selector === 'img' && src ? { getAttribute: () => src[1] } : null;
        };
        avatars.push(avatar);
      }
    },
  });
  slot.paints = 0;
  slot.querySelector = (selector) => selectors.get(selector) || null;
  slot.querySelectorAll = (selector) => selector === '[data-nuvio-avatar]' ? avatars : selector === '[data-nuvio-avatar="active"]' ? avatars.filter((node) => node.dataset.nuvioAvatar === 'active') : [];
  slot.contains = (node) => [...selectors.values(), ...avatars].includes(node);
  return slot;
}

function loadNav() {
  const window = eventTarget(), document = eventTarget();
  const desktop = accountSlot(), mobile = accountSlot(true);
  const session = deferred(), token = deferred(), profiles = deferred(), catalog = deferred();
  const stored = new Map([['kollection-nuvio-profile-id:user-1', '2']]);
  const writes = [];
  document.getElementById = (id) => ({ nuvioDesktopAccount: desktop, nuvioMobileAccount: mobile }[id] || null);
  window.KollectionNuvioAuth = { getSession: () => session.promise, getAccessToken: () => token.promise };
  vm.runInNewContext(navSource, {
    window, document, queueMicrotask,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => { writes.push({ key, value }); stored.set(key, value); },
      removeItem: (key) => stored.delete(key),
    },
    fetch: (url) => url.endsWith('/sync_pull_profiles') ? profiles.promise : catalog.promise,
  });
  return { window, document, desktop, mobile, session, token, profiles, catalog, writes };
}

const signedIn = { authenticated: true, user: { id: 'user-1', displayName: 'Custom name' } };
const profilesData = [
  { profile_index: 1, name: 'First', avatar_id: 'first-avatar' },
  { profile_index: 2, name: 'Selected', avatar_id: 'selected-avatar' },
];

test('account controls appear before Nuvio profile and avatar requests and enhancements preserve the open menu', async () => {
  const h = loadNav();
  const initialized = h.window.KollectionNavAccount.init();
  h.session.resolve(signedIn);
  await tick();
  assert.match(h.desktop.innerHTML, /Set Up Collection/);
  assert.equal(h.window.KollectionNavAccount.getSelectedProfile(), null);
  assert.equal(h.writes.length, 0, 'loading must not invent a stored profile');
  const wrap = h.desktop.querySelector('.nuvio-desktop-account-wrap');
  const button = h.desktop.querySelector('.nuvio-desktop-profile-button');
  h.document.activeElement = button;
  button.dispatchEvent({ type: 'click', stopPropagation() {} });
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  h.token.resolve({ authenticated: true, accessToken: 'token', user: { id: 'user-1' } });
  h.profiles.resolve(Response.json(profilesData));
  await initialized;
  assert.equal(h.window.KollectionNavAccount.getSelectedProfile().id, 2);
  assert.equal(h.desktop.querySelector('.nuvio-desktop-account-wrap'), wrap);
  assert.equal(wrap.classList.contains('open'), true);
  assert.equal(h.document.activeElement, button);
  assert.equal(h.desktop.querySelector('.nuvio-desktop-profile-name').textContent, 'Custom name');
  assert.equal(h.desktop.querySelector('.nuvio-desktop-popover-user').querySelector('small').textContent, 'Profile: Selected');
  assert.equal(h.desktop.paints, 1);
  assert.equal(h.mobile.paints, 1);
  h.catalog.resolve(Response.json([{ id: 'selected-avatar', storage_path: 'selected.png' }]));
  await tick();
  assert.match(h.desktop.querySelectorAll('[data-nuvio-avatar="active"]')[0].innerHTML, /selected\.png/);
  assert.equal(h.desktop.querySelector('.nuvio-desktop-account-wrap'), wrap);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('logout prevents delayed profile responses from restoring the account menu or selection', async () => {
  const h = loadNav();
  const initialized = h.window.KollectionNavAccount.init();
  h.session.resolve(signedIn);
  h.token.resolve({ authenticated: true, accessToken: 'token' });
  await tick();
  h.window.dispatchEvent({ type: 'kollection:nuvio-signed-out' });
  h.profiles.resolve(Response.json(profilesData));
  h.catalog.resolve(Response.json([{ id: 'selected-avatar', storage_path: 'old.png' }]));
  await initialized;
  await tick();
  assert.equal(h.window.KollectionNavAccount.getSelectedProfile(), null);
  assert.match(h.desktop.innerHTML, /data-nuvio-signin-desktop/);
  assert.equal(h.desktop.querySelector('.nuvio-desktop-account-wrap'), null);
  assert.equal(h.writes.length, 0);
});

test('failed profile loading leaves navigation usable without assuming a profile ID', async () => {
  const h = loadNav();
  const initialized = h.window.KollectionNavAccount.init();
  h.session.resolve(signedIn);
  h.token.resolve({ authenticated: true, accessToken: 'token' });
  h.profiles.resolve(Response.json({ message: 'Unavailable' }, { status: 503 }));
  await initialized;
  assert.match(h.desktop.innerHTML, /Set Up Collection/);
  assert.equal(h.window.KollectionNavAccount.getSelectedProfile(), null);
  assert.equal(h.writes.length, 0);
  assert.equal(h.desktop.querySelector('.nuvio-desktop-popover-user').querySelector('small').textContent, 'Nuvio account');
});
