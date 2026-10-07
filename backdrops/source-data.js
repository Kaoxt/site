/* Source adapters shared by the browser controls and regression tests. */
(() => {
  'use strict';
  const normalize = (item, media) => ({id:item.id, media, title:item.title || item.name || 'Untitled', originalLanguage:item.original_language || '', year:String(item.release_date || item.first_air_date || '').slice(0,4), backdropPath:item.backdrop_path || '', posterPath:item.poster_path || ''});
  const unique = items => [...new Map(items.filter(x=>x.id && (x.backdropPath || x.posterPath)).map(x=>[`${x.media}:${x.id}`,x])).values()];
  function interleave(groups) {
    const result=[];
    for (let i=0;i<Math.max(0,...groups.map(g=>g.length));i++) for (const group of groups) if (group[i]) result.push(group[i]);
    return unique(result);
  }
  function browseRequest(media, filters) {
    if (filters.sort === 'trending') return {path:`/trending/${media}/week`, params:{language:'en-US'}};
    const params={include_adult:false,language:'en-US',sort_by:filters.sort === 'top_rated' ? 'vote_average.desc' : 'popularity.desc'};
    if(filters.sort === 'top_rated') params['vote_count.gte']=200;
    if(filters.genre) params.with_genres=filters.genre;
    if(filters.language) params.with_original_language=filters.language;
    if(filters.provider) Object.assign(params,{with_watch_providers:filters.provider,watch_region:'US',with_watch_monetization_types:'flatrate'});
    if(filters.decade) {
      const year=Number(filters.decade), field=media==='movie'?'primary_release_date':'first_air_date';
      params[`${field}.gte`]=`${year}-01-01`;params[`${field}.lte`]=`${year+9}-12-31`;
    }
    return {path:`/discover/${media}`,params};
  }
  function resolveDate(value, now=new Date()) {
    if(typeof value!=='string' || !value.startsWith('__tmdb_date__:')) return value;
    const [,preset,side]=value.split(':');
    const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(preset==='today') return fmt(now);
    if(preset==='this_year') return `${now.getFullYear()}-${side==='from'?'01-01':'12-31'}`;
    if(preset==='last_year') {const d=new Date(now);if(side==='from') d.setFullYear(d.getFullYear()-1);return fmt(d);}
    throw new Error(`Unsupported relative date: ${preset}. Export this catalog with fixed dates.`);
  }
  function catalogRequest(catalog) {
    const media=['series','show','tv'].includes(catalog.type)?'tv':catalog.type==='movie'?'movie':null;
    if(!media) throw new Error('Unsupported content type');
    if(catalog.source==='mdblist' || /^mdblist\./.test(catalog.id)) {
      const match=String(catalog.id).match(/^mdblist\.(\d+)$/);
      let path=match?.[1];
      if(!path && catalog.metadata?.url) {const url=new URL(catalog.metadata.url);if(url.protocol==='https:' && /^(www\.)?mdblist\.com$/.test(url.hostname)) path=url.pathname.match(/^\/lists\/(.+?)\/?$/)?.[1];}
      if(!path) throw new Error('Missing MDBList list ID');
      return {provider:'mdblist',path,media};
    }
    if(catalog.source!=='tmdb' && !/^tmdb\./.test(catalog.id)) throw new Error('This catalog provider is not supported');
    const discover=catalog.metadata?.discover;
    if(discover?.params && !Array.isArray(discover.params) && typeof discover.params==='object') {
      const type=discover.mediaType==='series'?'tv':discover.mediaType || media;
      if(!['movie','tv'].includes(type)) throw new Error('Unsupported discover content type');
      // Catalog imports never supply credentials or alter the API host.
      const params=Object.fromEntries(Object.entries(discover.params).filter(([k,v])=>!['api_key','access_token','page'].includes(k) && ['string','number','boolean'].includes(typeof v)).map(([k,v])=>[k,resolveDate(v)]));
      return {provider:'tmdb',media:type,path:`/discover/${type}`,params:{...params,include_adult:false}};
    }
    const id=String(catalog.id).replace(/\.(movie|series|tv)$/,'');
    const endpoints={'tmdb.trending':`/trending/${media}/week`,'tmdb.top':`/${media}/popular`,'tmdb.popular':`/${media}/popular`,'tmdb.top_rated':`/${media}/top_rated`};
    if(!endpoints[id]) throw new Error('This catalog has no supported TMDB filters');
    return {provider:'tmdb',media,path:endpoints[id],params:{language:'en-US'}};
  }
  function parseCatalogs(text) {
    if(text.length>2*1024*1024) throw new Error('Choose a catalog JSON file smaller than 2 MB.');
    let data;try {data=JSON.parse(text);} catch {throw new Error('Invalid JSON. Paste the complete catalog export and try again.');}
    const catalogs=Array.isArray(data)?data:data?.catalogs;
    if(!Array.isArray(catalogs) || !catalogs.length) throw new Error('No catalogs found. Import an export containing a catalogs array.');
    if(catalogs.length>2000) throw new Error('Import at most 2,000 catalogs at once.');
    const seen=new Set();return catalogs.filter(c=>c && typeof c.id==='string' && typeof c.type==='string').filter(c=>{const k=`${c.id}|${c.type}`;if(seen.has(k))return false;seen.add(k);return true;}).map(c=>({id:c.id,type:c.type,name:String(c.name||c.id),source:c.source,metadata:c.metadata}));
  }
  async function fetchPages(fetcher, request, maxPages=3) {
    const items=[];
    for(let page=1;page<=maxPages;page++) {
      const data=await fetcher(request.path,{...request.params,page});
      items.push(...(data.results||[]).filter(x=>!x.adult).map(x=>normalize(x,request.media)));
      if(page>=(data.total_pages||1) || items.length>=60) break;
    }
    return unique(items);
  }
  globalThis.KollectionSourceData=Object.freeze({normalize,unique,interleave,browseRequest,catalogRequest,parseCatalogs,resolveDate,fetchPages});
})();
