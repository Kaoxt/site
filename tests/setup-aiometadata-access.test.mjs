import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { sanitizeConfig } from '../functions/_lib/saved-collections.js';

const root = new URL('../', import.meta.url);
const helper = await readFile(new URL('set-up-collection/aiometadata-access.js', root), 'utf8');
const source = await readFile(new URL('set-up-collection/set-up-collection.js', root), 'utf8');
const saved = await readFile(new URL('set-up-collection/saved-setup.js', root), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const uuid1 = '12d56b78-1234-4123-a123-123456789abc';
const uuid2 = '87654321-4321-4321-b321-cba987654321';
function harness(extra = {}) {
  const context = vm.createContext({ window: {}, URL, document: { addEventListener() {} }, ...extra });
  vm.runInContext(helper, context);
  return { context, api: context.window.KollectionAioAccess };
}

test('each configuration has its own UUID and safe edit URL, including self-hosted base paths', () => {
  const { api } = harness();
  const items = api.normalize([
    { host: 'https://midnight.example/', uuid: uuid1, userChosenPassword: true, password: 'omit-me' },
    { host: 'https://self.example/aio/?secret=omit-me', url: `https://self.example/aio/stremio/${uuid2}/compressed-secret/manifest.json`, userChosenPassword: true },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].configureUrl, `https://midnight.example/stremio/${uuid1}/configure`);
  assert.equal(items[1].configureUrl, `https://self.example/aio/stremio/${uuid2}/configure`);
  assert.doesNotMatch(JSON.stringify(items), /omit-me|compressed-secret|password/);
  const html = api.markup(items);
  assert.ok(html.includes(uuid1) && html.includes(uuid2));
  assert.equal((html.match(/data-aio-copy-uuid=/g) || []).length, 2);
  assert.equal((html.match(/Edit AIOMetadata settings/g) || []).length, 2);
  assert.doesNotMatch(html, /password for this older/);
});

test('invalid IDs and unsafe links are rejected; old configurations never claim a recoverable password', () => {
  const { api } = harness();
  for (const host of ['javascript:alert(1)', 'data:text/html,foo', 'https://user:pass@host.example/']) {
    assert.equal(api.normalize([{ host, uuid: uuid1 }]).length, 0);
  }
  assert.equal(api.normalize([{ host: 'https://aio.example', uuid: '<script>alert(1)</script>' }]).length, 0);
  assert.match(api.markup([], { legacy: true }), /older setup.*replacement/);
  const html = api.markup([{ host: 'https://aio.example', uuid: uuid1, configureUrl: 'javascript:alert(1)' }]);
  assert.match(html, /password for this older installation was not saved/);
  assert.doesNotMatch(html, /javascript:/);
});

test('copy uses the UUID and reports blocked clipboard access', async () => {
  const copied = [], status = { textContent: '' };
  const button = { dataset: { aioCopyUuid: uuid2 }, closest: () => ({ querySelector: () => status }) };
  const { api } = harness({ navigator: { clipboard: { writeText: async value => copied.push(value) } } });
  await api.copyUuid(button);
  assert.deepEqual(copied, [uuid2]);
  assert.equal(status.textContent, 'UUID copied.');
  const blocked = harness({ navigator: {} });
  await blocked.api.copyUuid(button);
  assert.match(status.textContent, /Select and copy/);
});

test('provisioning sends the exact chosen password on retries and rejects missing or mismatched passwords before fetch', async () => {
  const requests = [];
  const context = vm.createContext({
    state: { aiConfigPassword: ' chosen-test-password ', aiConfigPasswordConfirm: ' chosen-test-password ' },
    normalizeHost: value => value, readResponse: response => response.json(),
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: requests.length > 1, status: 503, json: async () => ({ userUUID: uuid1 }) }; },
    setTimeout: fn => fn(),
  });
  vm.runInContext(section('  async function saveAioConfig(', '  async function loadCustomAiFile('), context);
  await vm.runInContext('saveAioConfig("https://aio.example/", { catalogs: [] })', context);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(body => body.password === ' chosen-test-password '));
  context.state.aiConfigPasswordConfirm = 'different';
  await assert.rejects(vm.runInContext('saveAioConfig("https://aio.example/", {})', context), /Choose and confirm/);
  context.state.aiConfigPassword = '';
  await assert.rejects(vm.runInContext('saveAioConfig("https://aio.example/", {})', context), /Choose and confirm/);
  assert.equal(requests.length, 2);
});

test('passwords are excluded from wizard storage and saved JSON; completed UUIDs are retained', () => {
  let stored;
  const context = vm.createContext({
    state: { aiConfigPassword: 'private-password', aiConfigPasswordConfirm: 'private-password', aiInstalls: [{ uuid: uuid1 }] },
    persistTimer: null, clearTimeout() {}, SETUP_SESSION_KEY: 'test',
    sessionStorage: { setItem(key, data) { stored = data; } },
  });
  vm.runInContext(section('  function persistWizardSession()', '  function scheduleWizardSession('), context);
  vm.runInContext('persistWizardSession()', context);
  assert.ok(stored.includes(uuid1));
  assert.doesNotMatch(stored, /private-password|aiConfigPassword/);
  assert.deepEqual(sanitizeConfig({ aiConfigPassword: 'private-password', aiConfigPasswordConfirm: 'private-password', aiometadataConfigurations: [{ uuid: uuid1 }] }).clean, { aiometadataConfigurations: [{ uuid: uuid1 }] });
});

test('saved setup serialization keeps current UUIDs, retains existing ones during edits, and clears obsolete configurations after a successful empty install', () => {
  const { api } = harness();
  let installed = null;
  const context = vm.createContext({
    snapshot: { aiometadataConfigurations: [{ host: 'https://aio.example/', uuid: uuid1 }] },
    window: { KollectionAioAccess: api, KollectionAioExport: { getInstalledConfigurations: () => installed } },
  });
  const start = saved.indexOf('  function getInstalledConfigurations(');
  vm.runInContext(saved.slice(start, saved.indexOf('  async function prepareInstall(', start)), context);
  assert.equal(vm.runInContext('getInstalledConfigurations()[0].uuid', context), uuid1);
  installed = [{ host: 'https://aio.example/', uuid: uuid2, userChosenPassword: true }];
  assert.equal(vm.runInContext('getInstalledConfigurations()[0].uuid', context), uuid2);
  installed = [];
  assert.equal(vm.runInContext('getInstalledConfigurations().length', context), 0);
});
