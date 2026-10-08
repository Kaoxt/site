import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const sources = await Promise.all(['display-name', 'default-avatar'].map(name => readFile(new URL(`../account/${name}.js`, import.meta.url), 'utf8')));
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor() { this.listeners = new Map(); this.children = []; this.value = ''; this.disabled = true; this._text = ''; this.attributes = new Map(); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
  emit(type) { this.dispatchEvent({ type, preventDefault() {} }); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() { this.focused = true; }
  replaceChildren() { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; }
  append(child) { this.children.push(child); child.parentNode = this; }
  set textContent(value) { this.replaceChildren(); this._text = value; }
  get textContent() { return this._text; }
}

function fixture({ summaries = true } = {}) {
  const ids = ['accountDisplayNameForm', 'accountDisplayName', 'accountDisplayNameStatus', 'accountDisplayNameLimit',
    'accountAvatarForm', 'accountAvatarUrl', 'accountAvatarFile', 'accountAvatarPreview', 'accountAvatarStatus', 'accountAvatarRemove',
    ...(summaries ? ['accountIdentitySettings', 'accountIdentityName', 'accountIdentityAvatar'] : [])];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const nameButton = new Element(), avatarButton = new Element();
  nodes.accountDisplayNameForm.elements = { displayName: nodes.accountDisplayName };
  nodes.accountDisplayNameForm.querySelector = () => nameButton;
  nodes.accountAvatarForm.querySelectorAll = () => [nodes.accountAvatarUrl, nodes.accountAvatarFile, avatarButton, nodes.accountAvatarRemove];
  nodes.accountAvatarFile.files = [];
  if (summaries) nodes.accountIdentitySettings.open = false;
  const window = new Element(), events = [], requests = [], images = [], revoked = [];
  const dispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = event => { events.push(event.type); dispatch(event); };
  const encoded = 'data:image/jpeg;base64,cHJldmlldw==';
  class LocalURL extends URL {
    static createObjectURL() { return 'blob:fixture-avatar'; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  class LocalImage { constructor() { this.naturalWidth = this.naturalHeight = 100; images.push(this); } }
  const context = vm.createContext({ window, URL: LocalURL, Image: LocalImage, atob,
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: {
      getElementById: id => nodes[id] || null,
      createElement: tag => tag === 'canvas' ? { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => encoded } : new Element(),
    },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, respond(data, status = 200) { resolve({ ok: status < 400, json: async () => data }); } })),
  });
  for (const source of sources) vm.runInContext(source, context);
  function loadResponses(start = 0, name = 'Saved name', avatar = 'https://images.test/saved.png') {
    requests[start].respond({ displayName: name, changesRemaining: 2 });
    requests[start + 1].respond({ avatarUrl: avatar });
  }
  return { nodes, nameButton, avatarButton, window, events, requests, images, revoked, encoded, loadResponses };
}

test('summary reflects saved values while name typing and image preparation remain drafts', async () => {
  const f = fixture(); const n = f.nodes;
  f.loadResponses(); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Saved name');
  assert.equal(n.accountIdentityAvatar.children[0].src, 'https://images.test/saved.png');
  assert.equal(n.accountIdentityAvatar.children[0].alt, '');
  assert.equal(n.accountIdentitySettings.open, false);
  assert.equal(n.accountDisplayNameLimit.textContent, 'First name is free · 2 of 2 later changes available (rolling 60 days).');
  for (const request of f.requests) {
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.cache, 'no-store');
  }
  n.accountDisplayName.value = 'Draft name'; n.accountDisplayName.emit('input');
  n.accountAvatarFile.files = [{ type: 'image/png', size: 100 }]; n.accountAvatarFile.emit('change');
  f.images[0].onload(); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Saved name');
  assert.equal(n.accountIdentityAvatar.children[0].src, 'https://images.test/saved.png');
  assert.equal(n.accountAvatarPreview.children[0].src, f.encoded);
  assert.deepEqual(f.revoked, ['blob:fixture-avatar']);

  n.accountDisplayNameForm.emit('submit'); n.accountAvatarForm.emit('submit');
  assert.deepEqual(JSON.parse(f.requests[2].options.body), { displayName: 'Draft name' });
  assert.deepEqual(JSON.parse(f.requests[3].options.body), { image: f.encoded });
  assert.equal(n.accountIdentityName.textContent, 'Saved name');
  f.requests[2].respond({ displayName: 'Draft name', changesRemaining: 1 });
  f.requests[3].respond({ avatarUrl: '/api/avatars/saved-image' }); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Draft name');
  assert.equal(n.accountIdentityAvatar.children[0].src, '/api/avatars/saved-image');
  assert.equal(n.accountAvatarPreview.children[0].src, '/api/avatars/saved-image');
  assert.equal(n.accountIdentitySettings.open, false);
  assert.ok(f.events.includes('kollection:display-name-changed'));
  assert.ok(f.events.includes('kollection:avatar-changed'));

  n.accountDisplayName.value = ''; n.accountDisplayNameForm.emit('submit'); n.accountAvatarRemove.emit('click');
  f.requests[4].respond({ displayName: '', changesRemaining: 0, nextChangeAt: '2026-12-08T12:00:00Z' });
  f.requests[5].respond({ avatarUrl: '' }); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Nuvio profile name');
  assert.equal(n.accountIdentityAvatar.textContent, 'N');
  assert.deepEqual(JSON.parse(f.requests[5].options.body), { remove: true });
});

test('failed saves retain the saved summary and show concise quota without opening settings', async () => {
  const f = fixture(); const n = f.nodes; f.loadResponses(); await tick();
  n.accountDisplayName.value = 'Unsaved name'; n.accountDisplayNameForm.emit('submit');
  n.accountAvatarUrl.value = 'https://images.test/unsaved.png'; n.accountAvatarUrl.emit('input'); n.accountAvatarForm.emit('submit');
  f.requests[2].respond({ error: 'Name limit reached.', changesRemaining: 0, nextChangeAt: '2026-12-08T12:00:00Z' }, 429);
  f.requests[3].respond({ error: 'Please try again.' }, 503); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Saved name');
  assert.equal(n.accountIdentityAvatar.children[0].src, 'https://images.test/saved.png');
  assert.match(n.accountDisplayNameLimit.textContent, /^First name is free · 0 of 2 later changes available \(rolling 60 days\)\. Next change:/);
  assert.equal(n.accountDisplayNameStatus.textContent, 'Name limit reached.');
  assert.equal(n.accountAvatarStatus.textContent, 'Please try again.');
  assert.equal(n.accountIdentitySettings.open, false);
  assert.equal(f.nameButton.disabled, false); assert.equal(f.avatarButton.disabled, false);
});

test('signed-out errors stay collapsed and late loads cannot undo logout', async () => {
  const f = fixture(); const n = f.nodes;
  f.requests[0].respond({ error: 'Sign in with Nuvio first.' }, 401);
  f.requests[1].respond({ error: 'Sign in with Nuvio first.' }, 401); await tick();
  assert.equal(n.accountIdentitySettings.open, false);
  assert.equal(f.nameButton.disabled, true); assert.equal(f.avatarButton.disabled, true);
  f.window.emit('kollection:nuvio-signed-in');
  n.accountIdentitySettings.open = true;
  f.window.emit('kollection:nuvio-signed-out');
  f.loadResponses(2, 'Former account', 'https://images.test/former.png'); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Nuvio profile name'); assert.equal(n.accountIdentityAvatar.textContent, 'N');
  assert.equal(n.accountDisplayName.value, ''); assert.equal(n.accountAvatarUrl.value, '');
  assert.equal(n.accountDisplayNameStatus.textContent, ''); assert.equal(n.accountAvatarStatus.textContent, '');
  assert.equal(n.accountIdentitySettings.open, false);
  assert.equal(f.nameButton.disabled, true); assert.equal(f.avatarButton.disabled, true);
});

test('older loads and saves cannot repaint a newly signed-in account or emit save events', async () => {
  const f = fixture(); const n = f.nodes;
  f.window.emit('kollection:nuvio-signed-in');
  f.loadResponses(2, 'Current account', 'https://images.test/current.png'); await tick();
  f.loadResponses(0, 'Old account', 'https://images.test/old.png'); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Current account');
  assert.equal(n.accountIdentityAvatar.children[0].src, 'https://images.test/current.png');

  n.accountDisplayName.value = 'Pending old save'; n.accountDisplayNameForm.emit('submit');
  n.accountAvatarUrl.value = 'https://images.test/pending.png'; n.accountAvatarForm.emit('submit');
  f.window.emit('kollection:nuvio-session-changed');
  f.loadResponses(6, 'Next account', 'https://images.test/next.png'); await tick();
  f.requests[4].respond({ displayName: 'Pending old save', changesRemaining: 0, nextChangeAt: '2026-12-08T12:00:00Z' });
  f.requests[5].respond({ error: 'Old save failed.' }, 503); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Next account');
  assert.equal(n.accountIdentityAvatar.children[0].src, 'https://images.test/next.png');
  assert.equal(n.accountDisplayName.value, 'Next account'); assert.equal(n.accountAvatarUrl.value, 'https://images.test/next.png');
  assert.match(n.accountDisplayNameLimit.textContent, /2 of 2/);
  assert.equal(n.accountDisplayNameStatus.textContent, ''); assert.equal(n.accountAvatarStatus.textContent, '');
  assert.equal(f.events.includes('kollection:display-name-changed'), false);
  assert.equal(f.events.includes('kollection:avatar-changed'), false);
});

test('logout invalidates pending saves and prepared-image callbacks, including old image errors', async () => {
  const f = fixture(); const n = f.nodes; f.loadResponses(); await tick();
  const oldPreview = n.accountAvatarPreview.children[0], oldSummary = n.accountIdentityAvatar.children[0];
  n.accountDisplayName.value = 'Pending name'; n.accountDisplayNameForm.emit('submit');
  n.accountAvatarFile.files = [{ type: 'image/png', size: 100 }]; n.accountAvatarFile.emit('change');
  f.window.emit('kollection:nuvio-signed-out');
  f.requests[2].respond({ displayName: 'Pending name', changesRemaining: 1 });
  f.images[0].onload(); oldPreview.onerror(); oldSummary.onerror(); await tick();
  assert.equal(n.accountIdentityName.textContent, 'Nuvio profile name'); assert.equal(n.accountIdentityAvatar.textContent, 'N');
  assert.equal(n.accountAvatarPreview.textContent, 'N');
  assert.equal(n.accountDisplayNameStatus.textContent, ''); assert.equal(n.accountAvatarStatus.textContent, '');
  assert.equal(f.nameButton.disabled, true); assert.equal(f.avatarButton.disabled, true);
  assert.equal(f.events.includes('kollection:display-name-changed'), false);
  assert.deepEqual(f.revoked, ['blob:fixture-avatar']);

  f.window.emit('kollection:nuvio-signed-in'); f.loadResponses(3); await tick();
  n.accountAvatarRemove.emit('click'); f.window.emit('kollection:nuvio-signed-out');
  f.requests[5].respond({ avatarUrl: 'https://images.test/late.png' }); await tick();
  assert.equal(n.accountIdentityAvatar.textContent, 'N'); assert.equal(n.accountAvatarPreview.textContent, 'N');
  assert.equal(n.accountAvatarStatus.textContent, ''); assert.equal(f.avatarButton.disabled, true);
  assert.equal(f.events.includes('kollection:avatar-changed'), false);
});

test('forms also work when optional compact summary nodes are absent', async () => {
  const f = fixture({ summaries: false }); f.loadResponses(); await tick();
  assert.equal(f.nodes.accountDisplayName.value, 'Saved name');
  assert.equal(f.nodes.accountAvatarPreview.children[0].src, 'https://images.test/saved.png');
  assert.equal(f.nameButton.disabled, false); assert.equal(f.avatarButton.disabled, false);
});
