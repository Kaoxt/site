import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../components.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Navigation source section: ${start}`);
  return source.slice(from, to);
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
};

// Execute the production initialization with independently controlled downloads.
// A visible menu must not wait for either the footer or account helpers.
test('primary navigation binds before a pending footer and pending account helpers', async () => {
  const nav = deferred();
  const footer = deferred();
  const downloads = [];
  const bound = [];
  const assets = {};
  let prepared = false;
  const context = vm.createContext({
    NAV_VERSION: 'test',
    document: { getElementById: id => ({ id }) },
    ensureStylesheet() {}, applyTheme() {}, readTheme: () => 'dark',
    loadNavigationAssets: () => assets,
    loadFragment: filename => {
      downloads.push(filename);
      return filename.startsWith('footer') ? footer.promise : nav.promise;
    },
    ...Object.fromEntries([
      'setActiveNav', 'bindThemeButtons', 'bindMenu', 'bindNavigationFeedback',
      'bindResponsiveNav', 'syncResponsiveNav',
    ].map(name => [name, () => bound.push(name)])),
    prepareNuvioNavigation: value => { assert.equal(value, assets); prepared = true; },
  });
  vm.runInContext(section('  const init = async () => {', '  if (document.readyState'), context);
  const completion = vm.runInContext('init()', context);
  assert.equal(downloads.length, 2);
  assert.equal(bound.length, 0, 'controls wait for their own markup');
  nav.resolve(true);
  await flush();
  assert.ok(bound.includes('bindMenu'), 'the footer must not hold menu handlers');
  assert.ok(bound.includes('bindThemeButtons'));
  assert.ok(prepared);
  await completion;
  footer.resolve(true);
});

test('deferred shared components initialize before later scripts finish DOMContentLoaded', () => {
  const calls = [];
  const context = vm.createContext({
    document: { readyState: 'interactive', addEventListener: () => calls.push('wait') },
    init: () => calls.push('initialize'),
  });
  const boot = source.slice(source.indexOf('  if (document.readyState'), source.lastIndexOf('})();'));
  vm.runInContext(boot, context);
  assert.deepEqual(calls, ['initialize']);
});

test('navigation helper downloads overlap and each initializes only after its dependencies', async () => {
  const modules = {};
  const started = [];
  const initialized = [];
  const names = {
    'nuvio-auth': 'KollectionNuvioAuth',
    'nav-account': 'KollectionNavAccount',
    'nav-login-redirect': 'KollectionNavLoginRedirect',
    'account-link': 'KollectionAccountLink',
    'admin-nav': 'KollectionAdminNav',
  };
  const context = vm.createContext({
    NAV_VERSION: 'test', ensureStylesheet() {}, console,
    window: Object.fromEntries(Object.values(names).map(name => [name, {
      init: () => initialized.push(name),
    }])),
    loadScriptOnce: path => {
      const file = path.split('/').at(-1).split('.')[0];
      started.push(file);
      modules[file] = deferred();
      return modules[file].promise;
    },
  });
  vm.runInContext(section('  const loadNavigationAssets = () => {', '  const resolvePage'), context);
  vm.runInContext('const assets = loadNavigationAssets(); prepareNuvioNavigation(assets)', context);
  assert.equal(started.length, 5, 'all requests start without awaiting another helper');
  modules['nav-account'].resolve(true);
  modules['nav-login-redirect'].resolve(true);
  modules['account-link'].resolve(true);
  await flush();
  assert.ok(initialized.includes('KollectionNavLoginRedirect'));
  assert.ok(initialized.includes('KollectionAccountLink'));
  assert.ok(!initialized.includes('KollectionNavAccount'), 'account waits for auth');
  modules['nuvio-auth'].resolve(true);
  await flush();
  assert.ok(initialized.includes('KollectionNavAccount'), 'slow admin helper cannot hold account');
  assert.ok(!initialized.includes('KollectionAdminNav'));
  modules['admin-nav'].resolve(true);
  await flush();
  assert.ok(initialized.includes('KollectionAdminNav'));
});

function fragmentHarness({ extensionlessStatus = 200 } = {}) {
  const storage = new Map();
  const requests = [];
  let fail = false;
  let body = '<header>Public navigation</header>';
  const context = vm.createContext({
    FRAGMENT_TTL: 300000, Date, URL, console,
    assetUrl: file => new URL(file, 'https://kollection.example/').href,
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: async url => {
      requests.push(url);
      if (fail) throw new Error('Simulated unavailable network');
      const status = new URL(url).pathname.endsWith('.html') ? 200 : extensionlessStatus;
      return { ok: status < 400, status, text: async () => body };
    },
  });
  vm.runInContext(section('  const loadFragment = async', '  const ensureStylesheet'), context);
  const load = (target, version = 'one') => {
    context.target = target;
    context.version = version;
    return vm.runInContext('loadFragment(`nav?v=${version}`, target)', context);
  };
  return {
    load, storage, requests,
    setBody: value => { body = value; },
    setFail: value => { fail = value; },
  };
}

test('public fragment reuse avoids another request and versions invalidate cached markup', async () => {
  const h = fragmentHarness();
  const first = {};
  await h.load(first);
  const second = {};
  await h.load(second);
  assert.equal(first.innerHTML, second.innerHTML);
  assert.equal(h.requests.length, 1);
  h.setBody('<header>Updated navigation</header>');
  const updated = {};
  await h.load(updated, 'two');
  assert.equal(h.requests.length, 2);
  assert.equal(updated.innerHTML, '<header>Updated navigation</header>');
});

test('a missing extensionless route retries the HTML file and caches it under the canonical URL', async () => {
  const h = fragmentHarness({ extensionlessStatus: 404 });
  const target = {};
  assert.equal(await h.load(target), true);
  assert.deepEqual(h.requests, [
    'https://kollection.example/nav?v=one',
    'https://kollection.example/nav.html?v=one',
  ]);
  assert.equal(target.innerHTML, '<header>Public navigation</header>');
  await h.load({});
  assert.equal(h.requests.length, 2, 'the fallback response is reused on the next page');
});

test('expired fragments are refreshed but remain usable when the network fails', async () => {
  const h = fragmentHarness();
  await h.load({});
  for (const [key, value] of h.storage) {
    h.storage.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: Date.now() - 1 }));
  }
  h.setFail(true);
  const fallback = {};
  assert.equal(await h.load(fallback), true);
  assert.equal(h.requests.length, 2, 'expired markup attempted a refresh');
  assert.equal(fallback.innerHTML, '<header>Public navigation</header>');
  h.setFail(false);
  h.setBody('<header>Recovered navigation</header>');
  await h.load(fallback);
  assert.equal(fallback.innerHTML, '<header>Recovered navigation</header>');
});

test('nested setup routes select Set Up Collection and regular page routes remain correct', () => {
  const window = { location: { pathname: '/' } };
  const context = vm.createContext({ window });
  vm.runInContext(section('  const resolvePage = () => {', '  const setActiveNav'), context);
  for (const [path, expected] of [
    ['/', 'index.html'], ['/news', 'news.html'], ['/news.html', 'news.html'],
    ['/set-up-collection', 'set-up-collection.html'],
    ['/set-up-collection/templates/a.html', 'set-up-collection.html'],
    ['/discussions', 'discussions.html'], ['/backdrops', 'backdrops.html'],
  ]) {
    window.location.pathname = path;
    assert.equal(vm.runInContext('resolvePage()', context), expected, path);
  }
});

function feedbackHarness() {
  const listeners = {};
  const lifecycle = {};
  const classes = new Set();
  const timers = new Set();
  const links = [];
  const location = new URL('https://kollection.example/account');
  const context = vm.createContext({
    URL, location,
    window: { location, addEventListener: (name, fn) => { lifecycle[name] = fn; } },
    document: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
      querySelectorAll: () => links.filter(link => link.attributes.has('data-navigation-pending')),
    },
    setTimeout: fn => { timers.add(fn); return fn; },
    clearTimeout: fn => timers.delete(fn),
  });
  vm.runInContext(section('  const bindNavigationFeedback = () => {', '  const COMPACT_NAV_QUERY'), context);
  vm.runInContext('bindNavigationFeedback()', context);
  const link = (href, attrs = {}) => {
    const attributes = new Map(Object.entries(attrs));
    const node = {
      href: new URL(href, location).href, target: attrs.target, attributes,
      closest: () => node,
      hasAttribute: key => attributes.has(key),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
    };
    links.push(node);
    return node;
  };
  const click = (target, options = {}) => {
    const event = {
      target, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...options,
    };
    listeners.click(event);
    return event;
  };
  return { link, click, lifecycle, classes, timers };
}

test('native navigation gives immediate feedback and history lifecycle clears it', () => {
  const h = feedbackHarness();
  const link = h.link('/news');
  assert.equal(h.click(link).defaultPrevented, false, 'navigation stays browser-managed');
  assert.equal(link.attributes.get('aria-busy'), 'true');
  assert.ok(h.classes.has('kollection-navigating'));
  h.lifecycle.pagehide();
  assert.equal(link.attributes.has('aria-busy'), false);
  h.click(link);
  h.lifecycle.pageshow({ persisted: true });
  assert.equal(link.attributes.has('data-navigation-pending'), false);
  assert.equal(h.classes.has('kollection-navigating'), false);
  assert.equal(h.timers.size, 0);
});

test('modified clicks, downloads, external destinations and same-page anchors preserve native behavior', () => {
  const h = feedbackHarness();
  const link = h.link('/news');
  for (const options of [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
  ]) {
    assert.equal(h.click(link, options).defaultPrevented, false);
    assert.equal(link.attributes.has('aria-busy'), false);
  }
  for (const candidate of [
    h.link('/news', { download: '' }), h.link('/news', { target: '_blank' }),
    h.link('https://example.org/'), h.link('/account#profiles'),
  ]) {
    assert.equal(h.click(candidate).defaultPrevented, false);
    assert.equal(candidate.attributes.has('aria-busy'), false);
  }
  assert.equal(h.classes.has('kollection-navigating'), false);
});
