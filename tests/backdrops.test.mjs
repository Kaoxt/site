import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../backdrops/backdrops.js', import.meta.url),'utf8');
function harness() {
 const nodes=new Map(), storage=new Map(), loads=[];
 const context2d=new Proxy({},{get:(_,key)=>key.startsWith('create')?()=>({addColorStop(){}}):()=>{}});
 const el=()=>({value:'',checked:false,hidden:false,disabled:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},querySelectorAll:()=>[],getContext:()=>context2d});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id)},querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el()};
 class Image {width=1280;height=720;set src(url){loads.push(url);queueMicrotask(()=>this.onload())}}
 const window={dispatchEvent(){}};
 vm.runInNewContext(source,{document,window,Image,Map,URL,CustomEvent:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch(){},setTimeout});
 return {api:window.KollectionBackdrops,nodes,loads};
}
test('preview uses smaller image, reuses cache, and restores selected design',async()=>{
 const h=harness();
 const item={title:'Movie',media:'movie',backdropPath:'/a.jpg'};
 await h.api.selectTitle(item);await h.api.selectTitle(item);
 assert.deepEqual(h.loads,['https://image.tmdb.org/t/p/w1280/a.jpg']);
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
 const saved=h.api.getState();h.api.restore(saved);assert.equal(h.api.getState().selected.title,'Movie');
});
test('collage uses tile-sized images and shares the preview pipeline',async()=>{
 const h=harness();await h.api.selectTitle({title:'Folder',items:[{backdropPath:'/a.jpg'},{backdropPath:'/b.jpg'}]});
 assert.equal(h.loads.length,2);assert.ok(h.loads.every(u=>u.includes('/w780/')));
 assert.equal(h.nodes.get('previewMeta').textContent,'2 titles · Folder backdrop');
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
});
test('clearing selection invalidates an in-flight image',async()=>{
 const h=harness();const pending=h.api.selectTitle({title:'Old',backdropPath:'/a.jpg'});
 await h.api.selectTitle(null);await pending;
 assert.equal(h.nodes.get('downloadBackdrop').disabled,true);
 assert.equal(h.nodes.get('emptyState').hidden,false);
});
