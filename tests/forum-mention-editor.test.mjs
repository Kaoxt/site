import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../forum/editor.js', import.meta.url), 'utf8');
const ids = ['12345678-1234-1234-abcd-1234567890ab', 'abcdef12-1234-1234-abcd-1234567890ab'];
const member = (author, index = 0) => ({ author, member_id: ids[index], avatar_url: '', avatar_color: '#6568e8' });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

class UIEvent {
  constructor(type, options = {}) { this.type = type; this.defaultPrevented = false; Object.assign(this, options); }
  preventDefault() { this.defaultPrevented = true; }
}

// This harness executes the complete editor with its native textarea and event
// boundaries represented explicitly. It does not claim browser layout coverage.
function editorHarness() {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.attributes = new Map(); this.listeners = new Map(); this.dataset = {};
      this.hidden = false; this.value = ''; this.selectionStart = 0; this.selectionEnd = 0;
      this.maxLength = 10000; this.disabled = false; this.readOnly = false; this.textContent = '';
    }
    get id() { return this.attributes.get('id') || ''; }
    set id(value) { this.attributes.set('id', value); }
    get form() { let node = this.parentElement; while (node && node.tagName !== 'FORM') node = node.parentElement; return node; }
    get isConnected() { return document.body.contains(this); }
    append(...nodes) { nodes.forEach(node => { node.remove(); node.parentElement = this; this.children.push(node); }); }
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    before(node) { node.remove(); const parent = this.parentElement; node.parentElement = parent; parent.children.splice(parent.children.indexOf(this), 0, node); }
    after(node) { node.remove(); const parent = this.parentElement; node.parentElement = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); }
    replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); }
    closest(tag) { let node = this; while (node) { if (node.tagName.toLowerCase() === tag) return node; node = node.parentElement; } return null; }
    contains(node) { while (node) { if (node === this) return true; node = node.parentElement; } return false; }
    querySelectorAll(selector) { return descendants(this).filter(node => selector === 'textarea[name="body"]' && node.tagName === 'TEXTAREA'); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    dispatchEvent(event) { event.target = this; this['on' + event.type]?.(event); for (const fn of this.listeners.get(event.type) || []) fn(event); return !event.defaultPrevented; }
    focus() { if (document.activeElement !== this) { document.activeElement = this; this.dispatchEvent(new UIEvent('focus')); } }
    scrollIntoView() {}
    setRangeText(text, start, end, mode) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = mode === 'select' ? start : start + text.length;
      this.selectionEnd = start + text.length;
    }
  }
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  document = { createElement: tag => new Element(tag), activeElement: null, body: new Element('body') };
  const form = new Element('form'), input = new Element('textarea');
  document.body.append(form); form.append(input);
  const timers = new Map(), requests = [];
  const context = vm.createContext({
    window: { KollectionForum: {
      esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
      api: params => { const response = deferred(); requests.push({ params, response }); return response.promise; },
    } },
    document, Event: UIEvent, URL,
    setTimeout: fn => { const id = {}; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  context.window.KollectionForumEditor.attach(form);
  const all = () => descendants(form);
  const find = className => all().find(node => (node.className || '').split(' ').includes(className));
  const options = () => all().filter(node => node.getAttribute('role') === 'option');
  const type = (value, caret = value.length) => {
    input.focus(); input.value = value; input.selectionStart = input.selectionEnd = caret;
    input.dispatchEvent(new UIEvent('input'));
  };
  const key = (name, extra = {}) => { const event = new UIEvent('keydown', { key: name, ...extra }); input.dispatchEvent(event); return event; };
  const runTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { input, form, document, requests, timers, type, key, runTimers, options, find, all };
}

async function suggest(h, name, rows) {
  h.type(name); h.runTimers();
  h.requests.at(-1).response.resolve({ members: rows }); await flush();
}

test('typing coalesces lookups and keyboard selection inserts an escaped named member at the caret', async () => {
  const h = editorHarness();
  h.type('@J'); h.type('@Ja'); h.type('@Jam');
  assert.equal(h.timers.size, 1);
  h.runTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].params.view, 'mentionMembers');
  assert.equal(h.requests[0].params.q, 'Jam');
  h.requests[0].response.resolve({ members: [member('Jamie One'), member('Jamie [Two]', 1)] }); await flush();
  assert.equal(h.options().length, 2);
  assert.equal(h.key('ArrowDown').defaultPrevented, true);
  assert.equal(h.options()[1].getAttribute('aria-selected'), 'true');
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.options()[1].id);
  assert.equal(h.key('Enter').defaultPrevented, true);
  assert.equal(h.input.value, '@[Jamie \\[Two\\]](member:' + ids[1] + ') ');
  assert.equal(h.input.selectionStart, h.input.value.length);
  assert.equal(h.find('forum-mention-picker').hidden, true);
  const preview = h.all().find(node => node.textContent === 'Preview');
  preview.dispatchEvent(new UIEvent('click'));
  assert.ok(h.find('forum-editor-preview').innerHTML.includes('>@Jamie [Two]</a>'));
});

test('out-of-order responses cannot replace newer suggestions or insert at a changed caret', async () => {
  const h = editorHarness();
  h.type('@Al'); h.runTimers();
  h.type('@Be'); h.runTimers();
  h.requests[1].response.resolve({ members: [member('Beta', 1)] }); await flush();
  h.requests[0].response.resolve({ members: [member('Alpha')] }); await flush();
  assert.equal(h.options()[0].children[1].textContent, 'Beta');
  const stale = h.options()[0];
  h.input.selectionStart = h.input.selectionEnd = 0;
  stale.dispatchEvent(new UIEvent('click'));
  assert.equal(h.input.value, '@Be');
  assert.equal(h.find('forum-mention-picker').hidden, true);
});

test('Escape cancels delayed results and leaving the editor prevents another lookup', async () => {
  const h = editorHarness();
  h.type('@Ja'); h.runTimers();
  assert.equal(h.key('Escape').defaultPrevented, true);
  h.requests[0].response.resolve({ members: [member('Jamie')] }); await flush();
  assert.equal(h.options().length, 0);
  assert.equal(h.find('forum-mention-picker').hidden, true);
  h.type('@Jo');
  h.input.dispatchEvent(new UIEvent('blur', { relatedTarget: null }));
  h.document.activeElement = null;
  h.runTimers();
  assert.equal(h.requests.length, 1);
});

test('quoted text, code, email addresses, escaped tokens and IME composition never look up members', () => {
  const h = editorHarness();
  for (const value of ['> @Ja', '  > @Ja', '```\n@Ja', '```js\n@Ja', '~~~\n@Ja', '`code @Ja', '``code\n@Ja', 'name@Ja', '\\@Ja']) {
    h.type(value); h.runTimers();
  }
  h.input.dispatchEvent(new UIEvent('compositionstart'));
  h.type('@Ja'); h.runTimers();
  assert.equal(h.requests.length, 0);
  h.input.dispatchEvent(new UIEvent('compositionend')); h.runTimers();
  assert.equal(h.requests.length, 1);
});

test('touch selection preserves surrounding text and maximum length refuses an oversized insertion', async () => {
  const h = editorHarness();
  h.type('Hello @Ja!', 9); h.runTimers();
  h.requests[0].response.resolve({ members: [member('Jamie Lee')] }); await flush();
  const option = h.options()[0];
  h.input.dispatchEvent(new UIEvent('blur', { relatedTarget: option }));
  h.document.activeElement = option;
  option.dispatchEvent(new UIEvent('click'));
  assert.equal(h.input.value, 'Hello @[Jamie Lee](member:' + ids[0] + ')!');
  assert.equal(h.document.activeElement, h.input);

  h.input.maxLength = 12;
  await suggest(h, '@Ja', [member('Jamie Lee')]);
  h.options()[0].dispatchEvent(new UIEvent('click'));
  assert.equal(h.input.value, '@Ja');
  assert.match(h.find('forum-mention-status').textContent, /does not fit/);
});

test('invalid or duplicate suggestions are removed and form submission cancels pending results', async () => {
  const h = editorHarness();
  await suggest(h, '@J', [member('Jamie'), member('Duplicate'), { author: 'Unsafe', member_id: 'javascript:alert(1)' }, member('Jess', 1)]);
  assert.equal(h.options().length, 2);
  h.type('@Jo'); h.runTimers();
  h.form.dispatchEvent(new UIEvent('submit'));
  h.requests.at(-1).response.resolve({ members: [member('Jo')] }); await flush();
  assert.equal(h.find('forum-mention-picker').hidden, true);
  assert.equal(h.options().length, 0);
});

test('a delayed click on an old option cannot select a different member from a newer query', async () => {
  const h = editorHarness();
  await suggest(h, '@Al', [member('Alpha')]);
  const oldOption = h.options()[0];
  await suggest(h, '@Be', [member('Beta', 1)]);
  oldOption.dispatchEvent(new UIEvent('click'));
  assert.equal(h.input.value, '@Be');
  assert.equal(h.options()[0].children[1].textContent, 'Beta');
  assert.equal(h.find('forum-mention-picker').hidden, false);
});

test('backticks in a selected display name do not suppress later tagging', () => {
  const h = editorHarness();
  h.type('@[Jamie `Name](member:' + ids[0] + ') @Be'); h.runTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].params.q, 'Be');
});

test('a caret inside an existing mention cannot nest another member token', () => {
  const h = editorHarness();
  const value = '@[Ann @Bo](member:' + ids[0] + ')';
  h.type(value, value.indexOf('@Bo') + 3); h.runTimers();
  assert.equal(h.requests.length, 0);
  const tag = h.all().find(node => node.getAttribute('aria-label') === 'Tag a member');
  tag.dispatchEvent(new UIEvent('click'));
  assert.equal(h.input.value, value);
  assert.match(h.find('forum-mention-status').textContent, /outside the existing tag/);
});
