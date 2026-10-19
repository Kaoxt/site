import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
let source = await readFile(new URL('../functions/api/admin/artwork-folder.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;\n/, `const authServerReady = () => true;
const assertSameOrigin = r => r.headers.get('Origin') === new URL(r.url).origin;
const readSession = async (_, env) => env.signedOut ? null : {};
const isAdminUser = (_, env) => !env.notAdmin;\n`);
const { onRequestPost } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
function fixture(t, flags = {}) {
  const prefix = 'images/Genres/AMC+/';
  const files = [{path: prefix+'cover.webp', sha:'a', type:'blob', mode:'100644'}, {path:prefix+'nested/logo.webp', sha:'b', type:'blob', mode:'100644'}, {path:'images/Genres/AMC+Extra/cover.webp', sha:'c', type:'blob', mode:'100644'}];
  const events = [];
  const env = { GITHUB_TOKEN:'test', ...flags, IMAGES: {
    async list({prefix: actual, cursor}) { assert.equal(actual,prefix); return { objects: cursor ? [{key:prefix+'nested/logo.webp',etag:'b'}] : [{key:prefix+'cover.webp',etag:flags.changed?'changed':'a'}], truncated:!cursor, cursor:cursor?null:'next' }; },
    async delete(keys) { events.push(['r2',keys]); if(flags.r2Fail) throw Error('R2 unavailable'); },
  }};
  t.mock.method(globalThis,'fetch',async (url, opts={}) => {
    if (opts.method === 'POST' || opts.method === 'PATCH') events.push([url.split('/').at(-1),JSON.parse(opts.body)]);
    if(url.endsWith('/git/ref/heads/main')) return Response.json({object:{sha:'parent'}});
    if(url.endsWith('/git/commits/parent')) return Response.json({tree:{sha:'base'}});
    if(url.endsWith('?recursive=1')) return Response.json({tree:files,truncated:!!flags.truncated});
    if(url.endsWith('/git/trees')) return Response.json({sha:'newtree'});
    if(url.endsWith('/git/commits')) return Response.json({sha:'commit'});
    if(url.endsWith('/git/refs/heads/main')) return Response.json({}, {status:flags.conflict?422:200});
    throw Error(url);
  });
  async function call(body={},origin='https://kollection.tv') {
    return onRequestPost({env,request:new Request('https://kollection.tv/api/admin/artwork-folder',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({category:'Genres',folder:'AMC+',action:'preview',...body})})});
  }
  return {call,events,flags};
}
test('preview is read-only; confirmed delete includes nested files, preserves siblings and commits before R2',async t=>{
 const f=fixture(t);const preview=await (await f.call()).json(); assert.equal(preview.files.length,2);assert.equal(f.events.length,0);
 const res=await f.call({action:'delete',revision:preview.revision});assert.equal(res.status,200);
 assert.deepEqual(f.events[0][1].tree.map(x=>x.path),preview.files);assert.ok(f.events[0][1].tree.every(x=>x.sha===null));
 assert.equal(f.events[2][1].force,false);assert.equal(f.events[3][0],'r2');assert.deepEqual(f.events[3][1],preview.files);
});
test('auth, origin and invalid path requests cannot mutate storage',async t=>{
 for (const [flags,body,origin,status] of [[{signedOut:true},{},undefined,401],[{notAdmin:true},{},undefined,403],[{}, {},'https://evil.example',403],[{},{category:'..'},undefined,400],[{},{folder:'../AMC+'},undefined,400],[{},{folder:''},undefined,400],[{},{folder:'AMC+//nested'},undefined,400]]) {
  const f=fixture(t,flags);assert.equal((await f.call(body,origin)).status,status);assert.equal(f.events.length,0);
 }
});
test('missing confirmation and changed folder are rejected',async t=>{
 const flags={};const f=fixture(t,flags);assert.equal((await f.call({action:'delete'})).status,409);
 const preview=await (await f.call()).json();flags.changed=true;
 assert.equal((await f.call({action:'delete',revision:preview.revision})).status,409);assert.equal(f.events.length,0);
});
test('truncated GitHub listing fails closed',async t=>{const f=fixture(t,{truncated:true});assert.equal((await f.call()).status,409);assert.equal(f.events.length,0);});
test('GitHub conflict prevents R2 deletion',async t=>{const f=fixture(t,{conflict:true});const p=await(await f.call()).json();assert.equal((await f.call({action:'delete',revision:p.revision})).status,502);assert.ok(!f.events.some(x=>x[0]==='r2'));});
test('partial failure explains how to retry R2 cleanup',async t=>{const f=fixture(t,{r2Fail:true});const p=await(await f.call()).json();const r=await f.call({action:'delete',revision:p.revision});assert.equal(r.status,502);assert.match((await r.json()).error,/GitHub deletion succeeded/);});
