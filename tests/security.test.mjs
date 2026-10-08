import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assertSameOrigin} from '../functions/_lib/nuvio-session.js';
import {limitForumWrites,forumInput} from '../functions/_lib/forum.js';
import {onRequest} from '../functions/api/_middleware.js';
test('mutations require same-origin evidence and reject cross-site and null origins',()=>{
 const request=(headers={},method='POST')=>new Request('https://kollection.tv/api/forum',{method,headers});
 for(const headers of [{},{Origin:'null'},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'},{Referer:'https://evil.test/page'}])assert.equal(assertSameOrigin(request(headers)),false);
 for(const headers of [{Origin:'https://kollection.tv'},{'Sec-Fetch-Site':'same-origin'},{Referer:'https://kollection.tv/discussions'}])assert.equal(assertSameOrigin(request(headers)),true);
 assert.equal(assertSameOrigin(request({},'GET')),true);
 assert.equal(assertSameOrigin(request({'Sec-Fetch-Site':'cross-site'},'GET')),false);
});
test('durable write counters reject concurrent excess and recover in a new window',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE forum_rate_limits(user_id TEXT,scope TEXT,window_start INTEGER,count INTEGER,PRIMARY KEY(user_id,scope))');
 const db={prepare(q){return {bind(...args){return {async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};}};}};
 const realNow=Date.now;Date.now=()=>120000;
 try{
  const results=await Promise.allSettled(Array.from({length:25},()=>limitForumWrites(db,'alice','edits',20,600)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,20);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===429).length,5);
  await limitForumWrites(db,'bob','edits',20,600);
  Date.now=()=>720000;await limitForumWrites(db,'alice','edits',20,600);
  assert.equal(sql.prepare("SELECT count FROM forum_rate_limits WHERE user_id='alice'").get().count,1);
 }finally{Date.now=realNow;sql.close();}
});
test('forum rejects oversized streamed bodies and non-JSON payloads',async()=>{
 await assert.rejects(()=>forumInput(new Request('https://kollection.tv/api/forum',{method:'POST',body:'x'.repeat(32001),headers:{'Content-Type':'application/json'}})),e=>e.status===413);
 await assert.rejects(()=>forumInput(new Request('https://kollection.tv/api/forum',{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}})),e=>e.status===415);
});
test('API security headers preserve bodies, cookies and CORS',async()=>{
 const response=await onRequest({next:async()=>new Response('image bytes',{status:200,headers:{'Content-Type':'image/webp','Set-Cookie':'session=test; HttpOnly','Access-Control-Allow-Origin':'*'}})});
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('X-Frame-Options'),'DENY');
 assert.equal(response.headers.get('Set-Cookie'),'session=test; HttpOnly');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(await response.text(),'image bytes');
});
