import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context=vm.createContext({window:{},URL});
vm.runInContext(fs.readFileSync(new URL('../forum/common.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../forum/editor.js',import.meta.url),'utf8'),context);
const {render}=context.window.KollectionForumEditor;
test('formatting supports toolbar syntax and keeps code literal',()=>{
 const html=render('**bold** *italic* ++underline++\n> quote\n- first\n- second\n1. numbered\n`**literal**`\n```\n<script>\n```');
 for(const expected of ['<strong>bold</strong>','<em>italic</em>','<u>underline</u>','<blockquote>quote</blockquote>','<ul><li>first</li><li>second</li></ul>','<ol><li>numbered</li></ol>','<code>**literal**</code>','&lt;script&gt;'])assert.ok(html.includes(expected),expected);
});
test('HTML and link attributes are escaped and dangerous schemes stay text',()=>{
 const html=render('<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n[x](https://example.com/"onclick="alert)');
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('"onclick="'));assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
 assert.ok(render('[ok](https://example.com)').includes('href="https://example.com/"'));
});

const memberId = '12345678-1234-1234-abcd-1234567890ab';
const token = name => '@[' + name.replace(/[\\[\]]/g, '\\$&') + '](member:' + memberId + ')';

test('selected mentions render a clean label and a canonical internal member link', () => {
  const html = render('Hello ' + token('Jamie Lee') + '!');
  assert.ok(html.includes('<a class="forum-mention" href="/discussions#member/' + memberId + '">@Jamie Lee</a>'));
  assert.ok(!html.includes('](member:'));
  assert.ok(render(token('Jamie').replace(memberId, memberId.toUpperCase())).includes('#member/' + memberId));
  assert.equal(context.window.KollectionForumEditor.plainMentions('Hi ' + token('Jamie Lee')), 'Hi @Jamie Lee');
});

test('mention labels escape HTML and preserve literal formatting, brackets and backslashes', () => {
  const name = 'A [Team] \\ *name* `code` <img src=x> "Q"';
  const html = render(token(name));
  assert.ok(html.includes('@A [Team] \\ *name* `code` &lt;img src=x&gt; &quot;Q&quot;</a>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<em>'));
  assert.ok(!html.includes('<code>'));
  assert.equal(context.window.KollectionForumEditor.plainMentions(token(name)), '@' + name);
});

test('invalid mention IDs and escaped literal tokens cannot become profile links', () => {
  for (const id of ['not-a-member', memberId + '" onclick="alert(1)', '../admin', 'javascript:alert(1)']) {
    const html = render('@[<b>name</b>](member:' + id + ')');
    assert.ok(!html.includes('class="forum-mention"'));
    assert.ok(!html.includes('<b>'));
  }
  assert.ok(!render('\\' + token('Jamie')).includes('class="forum-mention"'));
  assert.ok(render('\\\\' + token('Jamie')).includes('class="forum-mention"'));
});

test('mentions in code stay literal while quoted member labels remain readable', () => {
  for (const text of ['`' + token('Jamie') + '`', '```\n' + token('Jamie') + '\n```']) {
    const html = render(text);
    assert.ok(html.includes('<code>'));
    assert.ok(html.includes('](member:' + memberId + ')'));
    assert.ok(!html.includes('class="forum-mention"'));
  }
  const quote = render('> ' + token('Jamie Lee'));
  assert.ok(quote.includes('<blockquote>'));
  assert.ok(quote.includes('>@Jamie Lee</a>'));
});

test('language, tilde and indented fences keep mentions literal until the matching close', () => {
  for (const [open, close] of [['```js', '```'], ['~~~text', '~~~'], ['  ```', '  ```'], ['````', '````']]) {
    const html = render(open + '\n' + token('Jamie') + '\n' + close + '\n' + token('After code'));
    assert.ok(html.includes('<pre><code>' + token('Jamie') + '</code></pre>'));
    assert.equal((html.match(/class="forum-mention"/g) || []).length, 1);
    assert.ok(html.includes('>@After code</a>'));
  }
});

test('matching inline backtick runs can span lines without rendering mentions as links', () => {
  const html = render('Before ``first ` tick\n' + token('Jamie') + '`` after ' + token('Visible'));
  assert.ok(html.includes('<code>first ` tick\n' + token('Jamie') + '</code>'));
  assert.equal((html.match(/class="forum-mention"/g) || []).length, 1);
  assert.ok(html.includes('>@Visible</a>'));
});

test('encoded mention labels obey the same 160-character limit as the server', () => {
  const accepted = '@[' + '\\]'.repeat(80) + '](member:' + memberId + ')';
  const tooLong = '@[' + '\\]'.repeat(81) + '](member:' + memberId + ')';
  assert.ok(render(accepted).includes('class="forum-mention"'));
  assert.ok(!render(tooLong).includes('class="forum-mention"'));
  assert.equal(context.window.KollectionForumEditor.plainMentions(tooLong), tooLong);
});
