(() => {
  'use strict';
  const $=id=>document.getElementById(id), api=window.KollectionBackdrops, data=globalThis.KollectionSourceData;
  if(!api || !$('sourceTabs')) return;
  const tabs=[...$('sourceTabs').querySelectorAll('[data-source]')];
  const storageKey='kollection-backdrops-sources-v1';
  let catalogs=[], selected=new Set(), requestToken=0, optionsToken=0, filterData=null;
  const status=(id,message,error=false)=>{const node=$(id);node.textContent=message;node.classList.toggle('error',error);};
  const key=()=>String($('tmdbKey').value||'').trim();
  const catalogKey=c=>`${c.id}|${c.type}`;
  function save() {try {localStorage.setItem(storageKey,JSON.stringify({source:$('titleSource').value,catalogs,selected:[...selected]}));}catch{status('aioStatus','Imported for this visit. Browser storage is full; this import cannot be remembered.');}}
  function cancel() {requestToken++;$('loadTmdbBrowse').disabled=false;$('loadAioTitles').disabled=selected.size===0;}
  function choose(source) {
    if(!['mdblist','aio','tmdb'].includes(source)) source='tmdb';
    cancel();$('titleSource').value=source;
    for(const tab of tabs){const active=tab.dataset.source===source;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    for(const [name,id] of Object.entries({tmdb:'tmdbTitleSource',mdblist:'mdblistTitleSource',aio:'aioTitleSource'})) $(id).hidden=name!==source;
    $('titleSource').dispatchEvent(new Event('change'));
    save();if(source==='tmdb') loadOptions();
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>choose(tab.dataset.source));
    tab.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:null;
      if(next!==null){event.preventDefault();tabs[next].focus();choose(tabs[next].dataset.source);}
    });
  });
  function options(id,values,placeholder) {
    const select=$(id), previous=select.value;select.replaceChildren(new Option(placeholder,''));
    values.forEach(([value,label])=>select.add(new Option(label,value)));
    if([...select.options].some(x=>x.value===previous)) select.value=previous;
  }
  function refreshFilters() {
    if(!filterData) return;
    const types=$('browseType').value==='both'?['movie','tv']:[$('browseType').value];
    const genres=new Map(), providers=new Map();
    types.forEach(type=>{
      filterData[type].genres.forEach(g=>{if(!genres.has(g.name)) genres.set(g.name,{});genres.get(g.name)[type]=g.id;});
      filterData[type].providers.forEach(p=>providers.set(p.provider_id,p.provider_name));
    });
    options('browseGenre',[...genres].sort(([a],[b])=>a.localeCompare(b)).map(([name,ids])=>[JSON.stringify(ids),name]),'Any genre');
    options('browseProvider',[...providers].sort((a,b)=>a[1].localeCompare(b[1])),'Any service');
  }
  async function loadOptions() {
    if(!key()) return status('tmdbBrowseStatus','Add your TMDB key above to load filters and titles.');
    if(filterData?.key===key()) return refreshFilters();
    const token=++optionsToken, usedKey=key();
    status('tmdbBrowseStatus','Loading browsing filters…');
    try {
      const [mg,tg,mp,tp,languages]=await Promise.all([api.tmdbFetch('/genre/movie/list'),api.tmdbFetch('/genre/tv/list'),api.tmdbFetch('/watch/providers/movie',{watch_region:'US'}),api.tmdbFetch('/watch/providers/tv',{watch_region:'US'}),api.tmdbFetch('/configuration/languages')]);
      if(token!==optionsToken || usedKey!==key()) return;
      filterData={key:usedKey,movie:{genres:mg.genres||[],providers:mp.results||[]},tv:{genres:tg.genres||[],providers:tp.results||[]}};
      refreshFilters();options('browseLanguage',languages.map(l=>[l.iso_639_1,l.english_name||l.name]).sort((a,b)=>a[1].localeCompare(b[1])),'Any language');
      status('tmdbBrowseStatus','Choose filters, then load titles.');
    }catch(error){if(token===optionsToken) status('tmdbBrowseStatus',error.message+' Click Load titles to browse, or save your key again to retry filters.',true);}
  }
  for(let year=Math.floor(new Date().getFullYear()/10)*10;year>=1920;year-=10) $('browseDecade').add(new Option(`${year}s`,String(year)));
  $('browseType').addEventListener('change',()=>{cancel();refreshFilters();});
  $('browseSort').addEventListener('change',()=>{cancel();const trending=$('browseSort').value==='trending';$('browseFilters').hidden=trending;$('trendingHelp').hidden=!trending;});
  ['browseProvider','browseGenre','browseLanguage','browseDecade'].forEach(id=>$(id).addEventListener('change',cancel));
  ['saveKey','validateKey'].forEach(id=>$(id).addEventListener('click',()=>{filterData=null;loadOptions();}));
  function renderResults(id,items) {
    const root=$(id);root.replaceChildren();
    for(const item of items) {
      const button=document.createElement('button');button.type='button';button.className='title-result';button.dataset.id=item.id;button.dataset.media=item.media;
      if(item.posterPath){const img=document.createElement('img');img.src=`https://image.tmdb.org/t/p/w185${item.posterPath}`;img.alt='';img.loading='lazy';button.append(img);}
      const label=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');title.textContent=item.title;detail.textContent=`${item.year} · ${item.media==='movie'?'Movie':'TV Show'}`;label.append(title,detail);button.append(label);
      button.addEventListener('click',()=>api.addTitle(item));root.append(button);
    }
  }
  async function finish(groups,statusId,resultId,token) {
    if(token!==requestToken) return;
    const good=groups.filter(r=>r.status==='fulfilled').map(r=>r.value), failures=groups.filter(r=>r.status==='rejected');
    const items=data.interleave(good);
    if(!items.length) throw new Error(failures[0]?.reason?.message || 'No titles with artwork matched. Try different filters or catalogs.');
    renderResults(resultId,items);
    await api.selectTitle({title:'Movie collage',items:items.slice(0,18)});
    if(token!==requestToken) return;
    status(statusId,`${items.length} unique titles loaded; ${Math.min(18,items.length)} selected.${failures.length?` ${failures.length} source(s) failed: ${failures[0].reason.message}`:''}`,failures.length>0);
  }
  $('loadTmdbBrowse').addEventListener('click',async()=>{
    const token=++requestToken;$('loadTmdbBrowse').disabled=true;status('tmdbBrowseStatus','Loading titles…');
    try {
      const genre=JSON.parse($('browseGenre').value||'{}'),sort=$('browseSort').value;
      const types=($('browseType').value==='both'?['movie','tv']:[$('browseType').value]).filter(type=>sort==='trending'||!Object.keys(genre).length||genre[type]);
      const groups=await Promise.allSettled(types.map(media=>data.fetchPages(api.tmdbFetch,{...data.browseRequest(media,{sort,genre:genre[media],provider:$('browseProvider').value,language:$('browseLanguage').value,decade:$('browseDecade').value}),media})));
      await finish(groups,'tmdbBrowseStatus','tmdbBrowseResults',token);
    }catch(error){if(token===requestToken) status('tmdbBrowseStatus',error.message,true);}
    finally {if(token===requestToken) $('loadTmdbBrowse').disabled=false;}
  });
  function renderCatalogs() {
    $('aioCatalogControls').hidden=!catalogs.length;$('aioCatalogs').replaceChildren();
    const query=$('aioFilter').value.toLowerCase();
    for(const c of catalogs.filter(c=>c.name.toLowerCase().includes(query))) {
      let reason='';try{data.catalogRequest(c);}catch(e){reason=e.message;}
      const label=document.createElement('label');label.className='aio-catalog';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(catalogKey(c));checkbox.disabled=!!reason||(!checkbox.checked&&selected.size>=4);
      const name=document.createElement('span'),detail=document.createElement('small');name.textContent=c.name;detail.textContent=reason?`Unavailable · ${reason}`:`${c.type==='movie'?'Movie':'TV Show'} · ${c.source||'TMDB'}`;name.append(detail);label.append(checkbox,name);$('aioCatalogs').append(label);
      checkbox.addEventListener('change',()=>{cancel();checkbox.checked?selected.add(catalogKey(c)):selected.delete(catalogKey(c));save();renderCatalogs();});
    }
    $('aioCount').textContent=`${selected.size}/4 catalogs selected`;$('loadAioTitles').disabled=!selected.size;
  }
  function importJson(text) {
    try {
      const next=data.parseCatalogs(text);if(!next.length) throw new Error('No valid catalogs found in this export.');
      cancel();catalogs=next;selected.clear();$('aioJson').value='';$('aioFilter').value='';$('aioTitleResults').replaceChildren();save();renderCatalogs();status('aioStatus',`${catalogs.length} catalogs imported. Choose catalogs below.`);
    }catch(error){status('aioStatus',error.message,true);}
  }
  $('importAioJson').addEventListener('click',()=>importJson($('aioJson').value));
  $('importAioFile').addEventListener('click',()=>$('aioFile').click());
  $('aioFile').addEventListener('change',async()=>{const file=$('aioFile').files[0];if(!file)return;try {if(file.size>2*1024*1024) throw new Error('Choose a JSON file smaller than 2 MB.');importJson(await file.text());}catch(error){status('aioStatus',error.message,true);}finally{$('aioFile').value='';}});
  $('aioFilter').addEventListener('input',renderCatalogs);
  $('clearAio').addEventListener('click',()=>{cancel();selected.clear();save();renderCatalogs();});
  $('resetAio').addEventListener('click',()=>{cancel();catalogs=[];selected.clear();$('aioTitleResults').replaceChildren();save();renderCatalogs();status('aioStatus','Import removed.');});
  async function fetchCatalog(c) {
    const request=data.catalogRequest(c);
    if(request.provider==='tmdb') return data.fetchPages(api.tmdbFetch,request);
    const mdb=window.KollectionMDBList;
    const response=await mdb.mdblistFetch(`lists/${request.path}/items`,{limit:60,mediatype:request.media==='tv'?'show':'movie'});
    const items=mdb.listItemsFromResponse(response).filter(x=>x.media===request.media).slice(0,60), resolved=[],errors=[];
    for(let i=0;i<items.length;i+=6) {
      const batch=await Promise.allSettled(items.slice(i,i+6).map(mdb.resolveTmdbItem));
      batch.forEach(r=>r.status==='fulfilled'?resolved.push(r.value):errors.push(r.reason));
    }
    if(!resolved.length && errors.length) throw errors[0];
    return data.unique(resolved);
  }
  $('loadAioTitles').addEventListener('click',async()=>{
    if(!selected.size) return;
    const token=++requestToken;$('loadAioTitles').disabled=true;status('aioStatus','Loading selected catalogs…');
    try {
      if(!key()) throw new Error('Add your TMDB key above to resolve catalog artwork.');
      const groups=await Promise.allSettled(catalogs.filter(c=>selected.has(catalogKey(c))).map(fetchCatalog));
      await finish(groups,'aioStatus','aioTitleResults',token);
    }catch(error){if(token===requestToken) status('aioStatus',error.message,true);}
    finally{if(token===requestToken) $('loadAioTitles').disabled=!selected.size;}
  });
  let initial='tmdb';
  try {const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved){initial=saved.source;catalogs=saved.catalogs?.length?data.parseCatalogs(JSON.stringify({catalogs:saved.catalogs})):[];selected=new Set((saved.selected||[]).filter(k=>catalogs.some(c=>{try{data.catalogRequest(c);return catalogKey(c)===k;}catch{return false;}})).slice(0,4));initial=saved.source;}}catch{}
  renderCatalogs();choose(initial);
})();
