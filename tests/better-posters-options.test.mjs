import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {decodeBetterPostersConfig} from '../functions/_lib/better-posters-config-token.js';
import {onRequest} from '../functions/bp/[[path]].js';
const browser={URLSearchParams};vm.createContext(browser);vm.runInContext(await readFile(new URL('../set-up-collection/better-posters-settings.js',import.meta.url),'utf8'),browser);
const helper=browser.KollectionBetterPostersSettings;
test('all setup rating choices and overlay combinations reach the native provider and AIO export',async()=>{
 const sources={average:null,imdb:'IM',tmdb:'TM',rottentomatoes:'RT',metacritic:'MC',trakt:'TR',letterboxd:'LB',rogerebert:'RE',none:null};
 for(const [source,code] of Object.entries(sources))for(let flags=0;flags<16;flags++){
  const s=helper.normalize({rating:source!=='none',ratingSource:source==='none'?'average':source,trendTags:!!(flags&1),qualityTags:!!(flags&2),genre:!!(flags&4),ageRating:!!(flags&8)});
  const token=helper.configId(s),decoded=decodeBetterPostersConfig(token);assert.equal(decoded.rating,source!=='none');assert.equal(decoded.trendTags,s.trendTags);assert.equal(decoded.qualityTags,s.qualityTags);assert.equal(decoded.ageRating,s.ageRating);
  const config=helper.applyToAioConfig({catalogs:[{id:'sample'}]},s);assert.equal(config.kollectionBetterPosters.settings.rating,s.rating);assert.equal(config.catalogs[0].enableRatingPosters,true);assert.equal(config.usePosterProxy,false);
  const url=new URL(helper.directPattern(s).replace('{imdb_id}','tt0133093'));assert.equal(url.searchParams.get('rs'),code);assert.equal(url.searchParams.get('tag'),s.trendTags?null:'none');
  const path=`${token}/movie/tt0133093.webp`;
  const r=await onRequest({request:new Request('https://kollection.tv/bp/'+path),env:{},params:{path:path.split('/')}});
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),url.href);
 }
});
