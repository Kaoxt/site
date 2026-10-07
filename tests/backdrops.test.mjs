import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../backdrops/backdrops.js', import.meta.url),'utf8');
function harness(logos = [], responder = null) {
 const nodes=new Map(), storage=new Map(), loads=[], requests=[], calls=[];
 const context2d=new Proxy({},{get:(target,key)=>key in target ? target[key] : key.startsWith('create')?()=>({addColorStop(){}}):(...args)=>calls.push({key,args})});
 const el=()=>({value:'',checked:false,hidden:false,disabled:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},querySelectorAll:()=>[],getContext:()=>context2d});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id)},querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el()};
 class Image {width=1280;height=720;set src(url){loads.push(url);queueMicrotask(()=>this.onload())}}
 const window={dispatchEvent(){}};
 vm.runInNewContext(source,{document,window,Image,Map,URL,AbortSignal,CustomEvent:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>responder ? responder(url) : ({logos})}},setTimeout});
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

const pair = {title:'Collage',items:[{id:1,media:'movie',title:'One',backdropPath:'/a.jpg'},{id:2,media:'tv',title:'Two',backdropPath:'/b.jpg'}]};
test('Fanart thumbnails use movie TMDB IDs and TVDB IDs; embedded titles get no duplicate logo',async()=>{
 const h=harness([],url=>url.includes('external_ids') ? {tvdb_id:99} : {
   moviethumb:[{url:'https://assets.fanart.tv/movie.jpg',lang:'en',likes:'5'}],
   moviebackground:[{url:'https://assets.fanart.tv/background.jpg',lang:'en',likes:'99'}],
   tvthumb:[{url:'https://assets.fanart.tv/tv.jpg',lang:'en',likes:'3'}]
 });
 h.nodes.get('tmdbKey').value='tmdb-test';h.nodes.get('fanartKey').value='fanart-test';
 await h.api.selectTitle(pair);await h.api.selectTitle(pair);
 assert.ok(h.requests.some(u=>u.includes('/movies/1?')));
 assert.ok(h.requests.some(u=>u.includes('/tv/99?')));
 assert.equal(h.requests.length,3);
 assert.deepEqual(h.loads,['https://assets.fanart.tv/movie.jpg','https://assets.fanart.tv/tv.jpg']);
 assert.ok(!h.calls.some(c=>c.key==='fillText'));
 assert.ok(h.nodes.get('artworkStatus').textContent.startsWith('2 Fanart.tv'));
});
test('TMDB title-bearing art is preferred without a Fanart key and does not get a second title',async()=>{
 const h=harness([],()=>({backdrops:[{file_path:'/titled.jpg',iso_639_1:'en'}],logos:[{file_path:'/logo.png'}]}));
 h.nodes.get('tmdbKey').value='test';
 await h.api.selectTitle(pair);
 assert.deepEqual(h.loads,['https://image.tmdb.org/t/p/w780/titled.jpg']);
 assert.ok(!h.calls.some(c=>c.key==='fillText'));
});
test('Fanart failure falls back to TMDB and explains the fallback',async()=>{
 const h=harness([],url=>{if(url.includes('fanart.tv')) throw new Error('Unavailable');return {};});
 h.nodes.get('tmdbKey').value='test';h.nodes.get('fanartKey').value='bad';
 await h.api.selectTitle(pair);
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
 assert.ok(h.loads.every(u=>u.includes('image.tmdb.org')));
 assert.ok(h.nodes.get('artworkStatus').textContent.includes('could not load'));
});
test('disabling movie titles avoids Fanart thumbs and title artwork requests',async()=>{
 const h=harness();const saved=h.api.getState();saved.showMovieLogos=false;h.api.restore(saved);
 h.nodes.get('tmdbKey').value='test';h.nodes.get('fanartKey').value='test';
 await h.api.selectTitle(pair);
 assert.equal(h.requests.length,0);
 assert.ok(!h.calls.some(c=>c.key==='fillText'));
});
test('poster mode loads portrait covers, keeps titles, and survives saved-state restore',async()=>{
 const h=harness();h.api.restore({...h.api.getState(),tileType:'posters'});
 const items=pair.items.map((item,i)=>({...item,posterPath:`/poster${i}.jpg`}));
 await h.api.selectTitle({title:'Posters',items});
 assert.ok(h.loads.every(url=>url.includes('/w500/poster')));
 assert.ok(!h.calls.some(c=>c.key==='fillText'));
 assert.equal(h.nodes.get('showMovieLogos').disabled,true);
 const saved=h.api.getState();h.api.restore(saved);
 assert.equal(h.api.getState().tileType,'posters');
 const tiles=h.calls.filter(c=>c.key==='roundRect');
 assert.ok(tiles.every(c=>Math.abs(c.args[3]/c.args[2]-1.5)<.001));
});
test('poster mode uses Fanart poster categories rather than landscape thumbnails',async()=>{
 const h=harness([],url=>url.includes('external_ids') ? {tvdb_id:99} : {
   movieposter:[{url:'https://assets.fanart.tv/movieposter.jpg',lang:'en'}],
   tvposter:[{url:'https://assets.fanart.tv/tvposter.jpg',lang:'en'}],
   moviethumb:[{url:'https://assets.fanart.tv/thumb.jpg',lang:'en'}]
 });
 h.api.restore({...h.api.getState(),tileType:'posters'});
 h.nodes.get('fanartKey').value='test';h.nodes.get('tmdbKey').value='test';
 await h.api.selectTitle(pair);
 assert.deepEqual(h.loads,['https://assets.fanart.tv/movieposter.jpg','https://assets.fanart.tv/tvposter.jpg']);
});
test('poster-only titles can be selected and missing posters use uncropped backdrop fallback',async()=>{
 const h=harness();h.api.restore({...h.api.getState(),tileType:'posters'});
 await h.api.addTitle({title:'Poster only',posterPath:'/poster.jpg'});
 await h.api.addTitle({title:'Backdrop only',backdropPath:'/backdrop.jpg'});
 assert.equal(h.api.getState().selected.items.length,2);
 assert.equal(h.nodes.get('downloadBackdrop').disabled,false);
 assert.ok(h.calls.some(c=>c.key==='drawImage' && c.args.length===5));
});
