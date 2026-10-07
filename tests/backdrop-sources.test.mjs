import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../backdrops/source-data.js';
const d=globalThis.KollectionSourceData;
test('movie and TV discover dates and streaming filters map to correct fields',()=>{
 for(const media of ['movie','tv']){const r=d.browseRequest(media,{sort:'top_rated',genre:16,provider:8,language:'ja',decade:'1990'});assert.equal(r.path,`/discover/${media}`);assert.equal(r.params.watch_region,'US');assert.equal(r.params.with_original_language,'ja');assert.equal(r.params[`${media==='movie'?'primary_release_date':'first_air_date'}.lte`],'1999-12-31');}
 assert.equal(d.browseRequest('tv',{sort:'trending',genre:16}).path,'/trending/tv/week');
});
test('AIO imports support native discover, builtin TMDB, and MDBList catalogs',()=>{
 const c=d.parseCatalogs(JSON.stringify({catalogs:[{id:'tmdb.trending.series',type:'series',source:'tmdb'},{id:'mdblist.123',type:'movie',source:'mdblist'},{id:'custom',type:'series',source:'tmdb',metadata:{discover:{mediaType:'tv',params:{with_genres:'16',api_key:'not-forwarded','first_air_date.gte':'__tmdb_date__:this_year:from'}}}}]}));
 assert.equal(d.catalogRequest(c[0]).path,'/trending/tv/week');assert.equal(d.catalogRequest(c[1]).path,'123');
 const r=d.catalogRequest(c[2]);assert.equal(r.params.with_genres,'16');assert.ok(!r.params.api_key);assert.match(r.params['first_air_date.gte'],/^\d{4}-01-01$/);
 assert.throws(()=>d.catalogRequest({id:'trakt.foo',source:'trakt',type:'movie'}),/not supported/);
});
test('bad JSON and missing catalogs produce actionable errors',()=>{
 assert.throws(()=>d.parseCatalogs('{'),/Invalid JSON/);assert.throws(()=>d.parseCatalogs('{}'),/catalogs array/);
 assert.throws(()=>d.catalogRequest({source:'mdblist',id:'missing',type:'movie',metadata:{url:'https://example.com/lists/test'}}),/Missing/);
});
test('combined groups alternate movie and TV without duplicating titles',()=>{
 const movie={id:1,media:'movie',backdropPath:'/a.jpg'},tv={id:1,media:'tv',posterPath:'/b.jpg'};
 assert.deepEqual(d.interleave([[movie,movie],[tv]]),[movie,tv]);
});
test('paginated catalog results preserve metadata and exclude adult entries',async()=>{
 const calls=[];const items=await d.fetchPages(async(path,params)=>{calls.push(params.page);return {total_pages:2,results:[{id:params.page,title:'A',backdrop_path:'/a.jpg',original_language:'ja'},{id:9,adult:true,backdrop_path:'/adult.jpg'}]};},{path:'/discover/movie',media:'movie',params:{}});
 assert.deepEqual(calls,[1,2]);assert.equal(items.length,2);assert.equal(items[0].originalLanguage,'ja');
});
