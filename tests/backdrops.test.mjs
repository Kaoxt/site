import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../backdrops/backdrops.js', import.meta.url),'utf8');
function harness(logos = []) {
 const nodes=new Map(), storage=new Map(), loads=[], requests=[], calls=[];
 const context2d=new Proxy({},{get:(target,key)=>key in target ? target[key] : key.startsWith('create')?()=>({addColorStop(){}}):(...args)=>calls.push({key,args})});
 const el=()=>({value:'',checked:false,hidden:false,disabled:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},querySelectorAll:()=>[],getContext:()=>context2d});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id)},querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el()};
 class Image {width=1280;height=720;set src(url){loads.push(url);queueMicrotask(()=>this.onload())}}
 const window={dispatchEvent(){}};
 vm.runInNewContext(source,{document,window,Image,Map,URL,CustomEvent:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({logos})}},setTimeout});
 return {api:window.KollectionBackdrops,nodes,loads,requests,calls};
}
test('search selections accumulate unique titles and require at least two',async()=>{
 const h=harness();
 const item={title:'Movie',media:'movie',backdropPath:'/a.jpg'};
 await h.api.addTitle(item);await h.api.addTitle(item);
 assert.equal(h.api.getState().selected.items.length,1);
 assert.equal(h.nodes.get('downloadBackdrop').disabled,true);
 await h.api.addTitle({...item,title:'Other',backdropPath:'/b.jpg'});
 assert.equal(h.api.getState().selected.items.length,2);
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
 const saved=h.api.getState();h.api.restore(saved);assert.equal(h.api.getState().selected.items.length,2);
 await h.api.selectTitle(saved.selected);assert.equal(h.loads.length,2);
});
test('collage uses tile-sized images and shares the preview pipeline',async()=>{
 const h=harness();await h.api.selectTitle({title:'Folder',items:[{backdropPath:'/a.jpg'},{backdropPath:'/b.jpg'}]});
 assert.equal(h.loads.length,2);assert.ok(h.loads.every(u=>u.includes('/w780/')));
 assert.equal(h.nodes.get('previewMeta').textContent,'2 titles · Folder backdrop');
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
});
test('clearing selection invalidates an in-flight image',async()=>{
 const h=harness();const pending=h.api.selectTitle({title:'Old',items:[{backdropPath:'/a.jpg'},{backdropPath:'/b.jpg'}]});
 await h.api.selectTitle(null);await pending;
 assert.equal(h.nodes.get('downloadBackdrop').disabled,true);
 assert.equal(h.nodes.get('emptyState').hidden,false);
});

test('logos prefer English, use image cache, and fall back to movie text',async()=>{
 const h=harness([{file_path:'/neutral.png',iso_639_1:null,vote_average:10},{file_path:'/english.png',iso_639_1:'en',vote_average:1}]);
 h.nodes.get('tmdbKey').value='test-key';
 const item={title:'Folder',items:[{id:1,media:'movie',title:'One',backdropPath:'/a.jpg'},{title:'No logo',backdropPath:'/b.jpg'}]};
 await h.api.selectTitle(item);await h.api.selectTitle(item);
 assert.equal(h.requests.length,1);
 assert.ok(h.requests[0].includes('/movie/1/images'));
 assert.equal(h.loads.filter(u=>u.endsWith('/english.png')).length,1);
 assert.ok(!h.loads.some(u=>u.endsWith('/neutral.png')));
 assert.ok(h.calls.some(c=>c.key==='fillText' && c.args[0]==='No logo'));
 const saved=h.api.getState();saved.showMovieLogos=false;h.api.restore(saved);
 h.calls.length=0;await h.api.selectTitle(item);
 assert.equal(h.requests.length,1);
 assert.ok(!h.calls.some(c=>c.key==='fillText'));
});
test('list selections deduplicate and cap at 18 titles',async()=>{
 const h=harness();const items=Array.from({length:22},(_,i)=>({title:String(i),backdropPath:`/${i}.jpg`}));
 await h.api.selectTitle({title:'List',items:[items[0],...items]});
 assert.equal(h.api.getState().selected.items.length,18);
});
