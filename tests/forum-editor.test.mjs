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
