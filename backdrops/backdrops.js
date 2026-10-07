(() => {
  'use strict';

  const STATE_KEY = 'kollection-backdrops-title-state-v1';
  const FANART_KEY = 'kollection-backdrops-fanart-key-v1';
  const TMDB_KEY = 'kollection-backdrops-tmdb-key-v1';
  const API_BASE = 'https://api.themoviedb.org/3';
  const IMAGE_BASE = 'https://image.tmdb.org/t/p/';

  const defaults = {
    mode: 'original',
    mediaType: 'movie',
    selected: null,
    overlayPreset: 'cinematic',
    overlayOpacity: 72,
    gradientCoverage: 68,
    backdropZoom: 100,
    positionX: 50,
    showTitle: false,
    showMovieLogos: true,
    collageLayout: 'tilted',
    artworkSource: 'fanart',
    artworkVersion: 3,
    tileType: 'backdrops',
    fontFamily: 'Inter, Arial, sans-serif',
    textPosition: 'left-center',
    fontSize: 72,
    textColor: '#ffffff',
    textShadow: true,
    resolution: '1920x1080'
  };

  let state = loadState();
  let editMode = false;
  let previewRegions = [];
  const excludedTiles = new Set();
  let removalUndo = null;
  let renderToken = 0;
  let searchToken = 0;
  let renderFrame = 0;
  const imageCache = new Map();
  const metadataCache = new Map();
  const fanartCache = new Map();
  const $ = id => document.getElementById(id);
  const els = {};
  [
    'backdropSourceMode','backdropModeStatus','tmdbKey','toggleKey','saveKey','validateKey','keyStatus','mediaType','titleSearch','searchTitle','titleSearchStatus','titleResults',
    'overlayPreset','overlayOpacity','overlayOpacityValue','gradientCoverage','coverageValue','backdropZoom','zoomValue','positionX','positionXValue','showTitle','textControls','fontFamily','textPosition','fontSize','fontSizeValue','textColor','textShadow',
    'editImages','undoRemoval','editImagesHelp','tileEditor','tileType','tileTypeHelp','fanartKeySection','fanartKey','saveFanartKey','toggleFanartKey','fanartKeyStatus','artworkSource','artworkStatus','showMovieLogos','collageLayout','collageTitles','collageStatus','clearCollage','shuffleCollage','backdropCanvas','emptyState','renderBusy','renderStatus','retryRender','previewTitle','resolution','downloadBackdrop'
  ].forEach(id => { els[id] = $(id); });

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      if (saved.artworkVersion !== 3) {
        if (saved.artworkSource === 'tmdb-original') { saved.artworkSource = 'fanart'; saved.showMovieLogos = true; }
        saved.artworkVersion = 3;
      }
      return { ...defaults, ...saved };
    }
    catch { return { ...defaults }; }
  }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }
  function getSavedKey() { try { return localStorage.getItem(TMDB_KEY) || ''; } catch { return ''; } }
  function saveApiKey(key) { try { key ? localStorage.setItem(TMDB_KEY, key) : localStorage.removeItem(TMDB_KEY); } catch {} }
  function setStatus(el, message, type='') {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok','error');
    if (type) el.classList.add(type);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function authFor(urlString) {
    const key = String(els.tmdbKey?.value || getSavedKey()).trim();
    if (!key) throw new Error('Add your TMDB API key first.');
    const url = new URL(urlString);
    const headers = { Accept: 'application/json' };
    if (key.startsWith('eyJ') || key.length > 60) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);
    return { url: url.toString(), headers };
  }

  async function tmdbFetch(path, params={}) {
    const url = new URL(`${API_BASE}${path}`);
    Object.entries(params).forEach(([k,v]) => {
      if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, String(v));
    });
    const auth = authFor(url.toString());
    const response = await fetch(auth.url, { headers: auth.headers, cache: 'default', signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      if (response.status === 401) throw new Error('TMDB rejected this key.');
      if (response.status === 429) throw new Error('TMDB rate limit reached. Try again shortly.');
      throw new Error(`TMDB request failed (${response.status}).`);
    }
    return response.json();
  }

  async function validateKey() {
    const key = els.tmdbKey.value.trim();
    if (!key) return setStatus(els.keyStatus, 'Paste a TMDB token or API key first.', 'error');
    els.validateKey.disabled = true;
    setStatus(els.keyStatus, 'Testing directly with TMDB…');
    try {
      await tmdbFetch('/configuration');
      saveApiKey(key);
      setStatus(els.keyStatus, 'TMDB key works and is saved in this browser.', 'ok');
    } catch (error) {
      setStatus(els.keyStatus, error.message || 'Could not validate TMDB key.', 'error');
    } finally { els.validateKey.disabled = false; }
  }

  function normalizeSearchItem(item, media) {
    return {
      id: item.id,
      media,
      title: item.title || item.name || 'Untitled',
      originalLanguage: item.original_language || '',
      year: String(item.release_date || item.first_air_date || '').slice(0,4),
      backdropPath: item.backdrop_path || '',
      posterPath: item.poster_path || ''
    };
  }

  async function searchTitles() {
    const token = ++searchToken;
    const media = state.mediaType;
    const query = els.titleSearch.value.trim();
    if (!query) return setStatus(els.titleSearchStatus, 'Type a movie or TV title first.', 'error');
    if (!String(els.tmdbKey.value || getSavedKey()).trim()) return setStatus(els.titleSearchStatus, 'Add your TMDB key first.', 'error');
    els.searchTitle.disabled = true;
    setStatus(els.titleSearchStatus, 'Searching TMDB…');
    try {
      const data = await tmdbFetch(`/search/${media}`, { query, include_adult: false, language: 'en-US', page: 1 });
      const results = (data.results || []).filter(item => item.backdrop_path || item.poster_path).slice(0, 8).map(item => normalizeSearchItem(item, media));
      if (token !== searchToken) return;
      renderResults(results);
      setStatus(els.titleSearchStatus, results.length ? `Tap titles to add them to your collage. Search again to add more.` : 'No matching titles with backdrops were found.', results.length ? 'ok' : '');
    } catch (error) {
      if (token === searchToken) setStatus(els.titleSearchStatus, error.message || 'Could not search TMDB.', 'error');
    } finally { if (token === searchToken) els.searchTitle.disabled = false; }
  }

  function renderResults(results) {
    els.titleResults.innerHTML = results.map(item => `
      <button class="title-result" type="button" data-id="${item.id}" data-media="${item.media}">
        ${item.posterPath ? `<img src="https://image.tmdb.org/t/p/w185${item.posterPath}" alt="" loading="lazy">` : '<span class="title-result-placeholder">▧</span>'}
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.year || item.media)}</small></span>
      </button>`).join('');
    els.titleResults.querySelectorAll('.title-result').forEach((button, index) => {
      button.addEventListener('click', () => addTitle(results[index]));
    });
  }

  const titleKey = item => `${item.media || 'movie'}:${item.id || item.backdropPath || item.posterPath}`;
  function selectedItems() {
    return state.selected?.items || ((state.selected?.backdropPath || state.selected?.posterPath) ? [state.selected] : []);
  }
  function updateSelection() {
    const items = selectedItems();
    document.querySelectorAll('.title-result').forEach(button => {
      button.classList.toggle('selected', items.some(item => String(item.id) === button.dataset.id && item.media === button.dataset.media));
    });
    els.collageTitles.innerHTML = items.map((item, index) => `<button type="button" class="ghost-button" data-index="${index}" aria-label="Remove ${escapeHtml(item.title)}">${escapeHtml(item.title || 'Untitled')} ×</button>`).join('');
    els.collageTitles.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      const next = selectedItems().filter((_, index) => index !== Number(button.dataset.index));
      selectTitle({title:state.selected?.title || 'Movie collage', items:next});
    }));
    setStatus(els.collageStatus, `${items.length}/18 titles selected. ${items.length < 2 ? 'Add at least two titles to create a collage.' : 'Ready to preview and download.'}`);
  }
  async function selectTitle(item, keepUndo=false) {
    if (!keepUndo) removalUndo = null;
    excludedTiles.clear();
    if (item?.items) {
      const unique = new Map(item.items.filter(entry => entry.backdropPath || entry.posterPath).map(entry => [titleKey(entry), entry]));
      item = {...item, items:[...unique.values()].slice(0,18)};
    }
    state.selected = item;
    saveState(); updateSelection();
    await renderPreview();
  }
  async function addTitle(item) {
    if (!item?.backdropPath && !item?.posterPath) return;
    const items = selectedItems();
    if (items.some(entry => titleKey(entry) === titleKey(item))) return;
    if (items.length >= 18) return setStatus(els.collageStatus, 'Your collage has 18 titles. Remove one before adding another.', 'error');
    await selectTitle({title:state.selected?.items ? state.selected.title : 'Movie collage', items:[...items, item]});
  }

  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const timer = setTimeout(() => {
        image.onload = image.onerror = null;
        image.src = '';
        imageCache.delete(url);
        reject(new Error('Artwork took too long to load. Check your connection and retry.'));
      }, 12000);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => {
        clearTimeout(timer); imageCache.delete(url);
        reject(new Error('Artwork could not load from the image provider. Retry or remove this title.'));
      };
      image.src = url;
    });
    imageCache.set(url, promise);
    if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
    return promise;
  }

  async function withRenderTimeout(task) {
    let timer;
    try {
      return await Promise.race([task, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Artwork is taking too long to load. Retry, or try TMDB only in the artwork source settings.')), 45000);
      })]);
    } finally { clearTimeout(timer); }
  }

  function applyOverlay(ctx, width, height) {
    if (state.mode !== 'custom' || state.overlayPreset === 'none' || state.overlayOpacity <= 0) return;
    const opacity = state.overlayOpacity / 100;
    const coverage = state.gradientCoverage / 100;
    ctx.save();
    if (state.overlayPreset === 'vignette' || state.overlayPreset === 'cinematic') {
      const radial = ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.15,width/2,height/2,Math.max(width,height)*.72);
      radial.addColorStop(0,'rgba(0,0,0,0)');
      radial.addColorStop(.58,`rgba(0,0,0,${opacity*.18})`);
      radial.addColorStop(1,`rgba(0,0,0,${opacity*.88})`);
      ctx.fillStyle = radial; ctx.fillRect(0,0,width,height);
    }
    if (state.overlayPreset === 'dark-left' || state.overlayPreset === 'cinematic') {
      const g = ctx.createLinearGradient(0,0,width*coverage,0);
      g.addColorStop(0,`rgba(0,0,0,${opacity})`); g.addColorStop(.45,`rgba(0,0,0,${opacity*.72})`); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,width,height);
    } else if (state.overlayPreset === 'dark-right') {
      const g = ctx.createLinearGradient(width,0,width*(1-coverage),0);
      g.addColorStop(0,`rgba(0,0,0,${opacity})`); g.addColorStop(.45,`rgba(0,0,0,${opacity*.72})`); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,width,height);
    } else if (state.overlayPreset === 'bottom-fade') {
      const g = ctx.createLinearGradient(0,height*(1-coverage),0,height);
      g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(0,0,0,${opacity})`);
      ctx.fillStyle = g; ctx.fillRect(0,0,width,height);
    }
    ctx.restore();
  }

  function drawCover(ctx, image, width, height) {
    const zoom = state.mode === 'custom' ? state.backdropZoom / 100 : 1;
    const scale = Math.max(width / image.width, height / image.height) * zoom;
    const sw = width / scale, sh = height / scale;
    const maxX = Math.max(0, image.width - sw);
    const sx = maxX * (state.mode === 'custom' ? state.positionX / 100 : .5);
    const sy = Math.max(0, (image.height - sh) / 2);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  }

  function drawTitle(ctx, width, height) {
    if (state.mode !== 'custom' || !state.showTitle || !state.selected?.title) return;
    const size = Math.round(state.fontSize * (width / 1920));
    ctx.save();
    ctx.fillStyle = state.textColor;
    ctx.font = `700 ${size}px ${state.fontFamily}`;
    ctx.textBaseline = 'middle';
    if (state.textShadow) { ctx.shadowColor='rgba(0,0,0,.75)'; ctx.shadowBlur=Math.max(8,size*.18); ctx.shadowOffsetY=Math.max(2,size*.04); }
    const pad = width * .055;
    let x = pad, y = height/2, align='left';
    if (state.textPosition === 'left-bottom') y = height*.82;
    if (state.textPosition === 'center') { x=width/2; y=height/2; align='center'; }
    if (state.textPosition === 'right-center') { x=width-pad; y=height/2; align='right'; }
    if (state.textPosition === 'right-bottom') { x=width-pad; y=height*.82; align='right'; }
    ctx.textAlign = align;
    ctx.fillText(state.selected.title, x, y, width*.7);
    ctx.restore();
  }

  function savedFanartKey() {
    try { return localStorage.getItem(FANART_KEY) || ''; } catch { return ''; }
  }
  function fanartKey() { return String(els.fanartKey.value || savedFanartKey()).trim(); }
  async function tmdbImages(item) {
    if (!item.id || !['movie','tv'].includes(item.media)) return {};
    const key = titleKey(item);
    if (!metadataCache.has(key)) {
      metadataCache.set(key, tmdbFetch(`/${item.media}/${item.id}/images`)
        .catch(() => { metadataCache.delete(key); return {}; }));
      if (metadataCache.size > 80) metadataCache.delete(metadataCache.keys().next().value);
    }
    return metadataCache.get(key);
  }
  function artworkLanguageRank(language, item) {
    if (language === 'en') return 0;
    if (item.originalLanguage && language === item.originalLanguage) return 1;
    if (!language || language === '00') return 2;
    return 3;
  }
  async function titleLogo(item, data, source, key) {
    const logos = (data.logos || []).filter(logo => /\.(png|svg)$/i.test(logo.file_path))
      .sort((a,b) => artworkLanguageRank(a.iso_639_1,item)-artworkLanguageRank(b.iso_639_1,item) || (b.vote_average || 0)-(a.vote_average || 0));
    for (const logo of logos.slice(0,3)) {
      try { return await loadImage(`${IMAGE_BASE}${/\.svg$/i.test(logo.file_path) ? 'original' : 'w500'}${logo.file_path}`); } catch {}
    }
    if (source === 'fanart' && key) {
      try {
        const candidates = await fanartCandidates(item,key,'logos');
        for (const logo of candidates.slice(0,2)) {
          try { return await loadImage(logo.url); } catch {}
        }
      } catch {}
    }
    return null;
  }
  async function fanartCandidates(item, key, tileType='backdrops') {
    if (!key || !item.id || !['movie','tv'].includes(item.media)) return [];
    const cacheKey = `${key}:${titleKey(item)}:${item.originalLanguage || ''}:${tileType}`;
    if (!fanartCache.has(cacheKey)) {
      const request = (async () => {
        let id = item.id;
        if (item.media === 'tv') {
          const ids = await tmdbFetch(`/tv/${item.id}/external_ids`);
          id = ids.tvdb_id;
          if (!id) return [];
        }
        const url = new URL(`https://webservice.fanart.tv/v3/${item.media === 'tv' ? 'tv' : 'movies'}/${id}`);
        url.searchParams.set('api_key', key);
        const response = await fetch(url.toString(), {signal:AbortSignal.timeout(12000)});
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Fanart.tv rejected the key.' : 'Fanart.tv is unavailable.');
        const data = await response.json();
        const thumbs = tileType === 'logos' ? (item.media === 'tv' ? [...(data.hdtvlogo || []), ...(data.clearlogo || [])] : [...(data.hdmovielogo || []), ...(data.movielogo || [])]) : tileType === 'posters' ? (item.media === 'tv' ? data.tvposter : data.movieposter) : (item.media === 'tv' ? data.tvthumb : data.moviethumb);
        const backgrounds = tileType !== 'backdrops' ? [] : (item.media === 'tv' ? data.showbackground : data.moviebackground);
        return [ ...(thumbs || []).map(x=>({...x,thumb:true})), ...(backgrounds || []).map(x=>({...x,thumb:false})) ]
          .filter(x => { try { const u=new URL(x.url); return u.protocol==='https:' && (u.hostname==='assets.fanart.tv' || u.hostname.endsWith('.fanart.tv')); } catch { return false; } })
          .map(x => ({...x,rank:artworkLanguageRank(x.lang,item)}))
          .filter(x=>x.rank<2 || tileType==='logos')
          .sort((a,b)=>a.rank-b.rank || Number(b.thumb)-Number(a.thumb) || (Number(b.likes)||0)-(Number(a.likes)||0));
      })();
      fanartCache.set(cacheKey, request.catch(error => { fanartCache.delete(cacheKey); throw error; }));
      if (fanartCache.size > 80) fanartCache.delete(fanartCache.keys().next().value);
    }
    return fanartCache.get(cacheKey);
  }
  async function tileArtwork(entry, width, useTitles, source, key, tileType) {
    if (source === 'tmdb-original') {
      const path = tileType === 'posters' ? entry.posterPath || entry.backdropPath : entry.backdropPath;
      if (!path && tileType === 'backdrops') return null;
      if (!path) throw new Error('No TMDB artwork is available for this title.');
      const size = tileType === 'posters' ? (width > 1920 ? 'w780' : 'w500') : (width > 1920 ? 'w1280' : 'w780');
      return {entry,image:await loadImage(`${IMAGE_BASE}${size}${path}`),logo:null,embeddedTitle:true,
        contain:tileType === 'posters' ? !entry.posterPath : !entry.backdropPath,source:'tmdb-original'};
    }
    let fanartFailed = false;
    if ((useTitles || tileType === 'posters') && source === 'fanart' && key) {
      try {
        const candidates = await fanartCandidates(entry,key,tileType);
        for (const candidate of candidates.slice(0,2)) {
          try { return {entry,image:await loadImage(candidate.url),logo:null,embeddedTitle:true,source:'fanart'}; }
          catch { fanartFailed = true; }
        }
      } catch { fanartFailed = true; }
    }
    const data = useTitles || tileType === 'posters' || !entry.backdropPath ? await tmdbImages(entry) : {};
    if (tileType === 'posters') {
      const posters = (data.posters || []).filter(x=>x.file_path && x.iso_639_1==='en')
        .sort((a,b)=>(b.vote_average||0)-(a.vote_average||0));
      const paths = [...new Set([...posters.slice(0,2).map(x=>x.file_path),entry.posterPath].filter(Boolean))];
      for (const path of paths) {
        try { return {entry,image:await loadImage(`${IMAGE_BASE}${width > 1920 ? 'w780' : 'w500'}${path}`),logo:null,embeddedTitle:true,source:'tmdb-poster',fanartFailed}; }
        catch {}
      }
      if (!entry.backdropPath) throw new Error(`No poster artwork could be loaded for ${entry.title || 'this title'}. Remove it or try Backdrops.`);
      return {entry,image:await loadImage(`${IMAGE_BASE}w780${entry.backdropPath}`),logo:null,embeddedTitle:false,contain:true,source:'tmdb',fanartFailed};
    }
    const titled = (data.backdrops || []).filter(x=>x.file_path && artworkLanguageRank(x.iso_639_1,entry)<2)
      .sort((a,b)=>artworkLanguageRank(a.iso_639_1,entry)-artworkLanguageRank(b.iso_639_1,entry) || (b.vote_average||0)-(a.vote_average||0) || (b.width||0)-(a.width||0));
    const size = width > 1920 ? 'w1280' : 'w780';
    for (const candidate of titled.slice(0,2)) {
      try { return {entry,image:await loadImage(`${IMAGE_BASE}${size}${candidate.file_path}`),logo:null,embeddedTitle:true,source:'tmdb-title',fanartFailed}; }
      catch {}
    }
    const paths = [...new Set([entry.backdropPath, ...(data.backdrops || []).filter(x=>!x.aspect_ratio || x.aspect_ratio>1.2).map(x=>x.file_path)].filter(Boolean))];
    for (const path of paths.slice(0,3)) {
      try {
        const image = await loadImage(`${IMAGE_BASE}${size}${path}`);
        if (image.width <= image.height * 1.2) continue;
        return {entry,image,logo:useTitles ? await titleLogo(entry,data,source,key) : null,embeddedTitle:false,source:'tmdb',fanartFailed};
      } catch (error) { if (path === paths[paths.length-1]) throw error; }
    }
    return null;

  }
  async function artwork(item, size, width=1280, height=720) {
    const entries = item.items || [item];
    const useLogos = state.showMovieLogos;
    const layout = state.collageLayout;
    const tileType = state.tileType;
    const posterMode = tileType === 'posters';
    const source = posterMode && state.artworkSource === 'fanart' ? 'tmdb' : state.artworkSource;
    const key = fanartKey();
    if (!posterMode && !savedFanartKey().trim()) throw new Error('Backdrops requires a Fanart.tv API key. Add and save it in API Keys, or switch to Posters.');
    const assets = [];
    const skipped = [];
    const deadline = Date.now() + 45000;
    // Limit concurrent image/metadata requests and reuse them for slider changes.
    for (let i=0; i<entries.length; i+=4) {
      if (Date.now() >= deadline) throw new Error('Artwork loading timed out. Please retry.');
      const batch = entries.slice(i,i+4);
      const loaded = await Promise.all(batch.map(entry => tileArtwork(entry,width,useLogos,source,key,tileType)));
      loaded.forEach((asset,index)=>{
        if (!asset || (!posterMode && asset.image.width <= asset.image.height * 1.2)) skipped.push(batch[index].title || 'Untitled');
        else assets.push(asset);
      });
    }
    if (assets.length < 2) throw new Error('At least two titles with landscape backdrops are needed. Try Posters or add other titles.');
    const surface = document.createElement('canvas');
    surface.width = width; surface.height = height;
    surface.tileRegions = [];
    const ctx = surface.getContext('2d');
    ctx.fillStyle = '#050608'; ctx.fillRect(0,0,width,height);
    const tilted = layout === 'tilted';
    const cols = posterMode ? (tilted ? 5 : Math.ceil(Math.sqrt(assets.length * (width/height) / (2/3)))) : (tilted ? 4 : Math.min(4, Math.ceil(Math.sqrt(assets.length * 16/9))));
    const rows = tilted ? (posterMode ? 5 : 7) : Math.ceil(assets.length / cols);
    const gap = width * .008;
    const w = posterMode ? (tilted ? width*.17 : Math.min(width/cols,height/rows*2/3)) : (tilted ? width*.24 : width/cols);
    const h = posterMode ? w*3/2 : (tilted ? w*9/16 : height/rows);
    const slots = [];
    for (let index=0; index<(tilted ? cols*rows : assets.length); index++) {
      const row = Math.floor(index/cols), col=index%cols;
      const rowCount = tilted ? cols : Math.min(cols, assets.length-row*cols);
      const tw = (tilted || posterMode ? w : width/rowCount)-gap, th=posterMode ? tw*3/2 : h-gap;
      // Offset neighboring columns to form a staggered wall in both artwork formats.
      // Extra rows cover the lower edge after staggering and rotation.
      const columnOffset = tilted ? [0, -.45, -.15, -.6, -.3][col] * h : 0;
      const tx = tilted ? col*w : posterMode ? (width-rowCount*w)/2+col*w : col*width/rowCount;
      const ty = row*h + columnOffset;
      // Keep the same tile geometry for the accessible preview editing layer.
      const angle = tilted ? -12*Math.PI/180 : 0;
      const points = [[0,0],[tw,0],[tw,th],[0,th]].map(([x,y]) => ({
        x:(tilted ? width*.22 : 0)+(tx+x)*Math.cos(angle)-(ty+y)*Math.sin(angle),
        y:(tilted ? -height*.13 : 0)+(tx+x)*Math.sin(angle)+(ty+y)*Math.cos(angle)
      }));
      const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
      const visibleWidth=Math.max(0,Math.min(width,Math.max(...xs))-Math.max(0,Math.min(...xs)));
      const visibleHeight=Math.max(0,Math.min(height,Math.max(...ys))-Math.max(0,Math.min(...ys)));
      slots.push({index,tx,ty,tw,th,points,visibleArea:visibleWidth*visibleHeight});
    }
    // Fill the most visible positions once each; never cycle through movie assets.
    const chosenSlots = tilted ? slots.sort((a,b)=>b.visibleArea-a.visibleArea || a.index-b.index)
      .slice(0,assets.length).sort((a,b)=>a.index-b.index) : slots;
    ctx.save();
    if (tilted) { ctx.translate(width*.22, -height*.13); ctx.rotate(-12*Math.PI/180); }
    for (let index=0; index<chosenSlots.length; index++) {
      const {image,logo,entry,embeddedTitle,contain}=assets[index];
      const {tx,ty,tw,th,points}=chosenSlots[index];
      ctx.save();ctx.translate(tx,ty);
      surface.tileRegions.push({key:titleKey(entry),title:entry.title || 'Untitled',points});
      ctx.beginPath();ctx.roundRect(0,0,tw,th,width*.004);ctx.clip();
      const scale=Math.max(tw/image.width,th/image.height),sw=tw/scale,sh=th/scale;
      if (contain) {
        const fit = Math.min(tw/image.width,th/image.height);
        ctx.drawImage(image,(tw-image.width*fit)/2,(th-image.height*fit)/2,image.width*fit,image.height*fit);
      } else ctx.drawImage(image,(image.width-sw)/2,(image.height-sh)/2,sw,sh,0,0,tw,th);
      if (useLogos && !embeddedTitle && logo) {
        const fade=ctx.createLinearGradient(0,th*.45,0,th);
        fade.addColorStop(0,'rgba(0,0,0,0)');fade.addColorStop(1,'rgba(0,0,0,.8)');
        ctx.fillStyle=fade;ctx.fillRect(0,0,tw,th);
        if (logo) {
          const factor=Math.min(tw*.72/logo.width,th*.29/logo.height);
          const lw=logo.width*factor,lh=logo.height*factor;
          ctx.drawImage(logo,(tw-lw)/2,th-lh-th*.07,lw,lh);
        }
      }
      ctx.restore();
    }
    ctx.restore();
    const fanartCount = assets.filter(x=>x.source==='fanart').length;
    const titledCount = assets.filter(x=>x.source===(posterMode ? 'tmdb-poster' : 'tmdb-title')).length;
    const fallbackCount = assets.length-fanartCount-titledCount;
    surface.artworkSummary = `${fanartCount} Fanart.tv · ${titledCount} TMDB ${posterMode ? 'posters' : 'title artwork'} · ${fallbackCount} TMDB backdrops`;
    if (source === 'tmdb-original') surface.artworkSummary = `${assets.length} original TMDB ${posterMode ? 'posters' : 'images'}. Titles are shown only when included in the artwork.`;
    const missingTitles = useLogos && !posterMode && source !== 'tmdb-original' ? assets.filter(asset=>!asset.embeddedTitle && !asset.logo).length : 0;
    if (missingTitles) surface.artworkSummary += `. Title artwork unavailable for ${missingTitles} of ${assets.length} titles; those tiles show the image only.`;
    if ((useLogos || posterMode) && source === 'fanart' && !key) surface.artworkSummary += '. Add a Fanart.tv key in API Keys to use its title artwork.';
    if (assets.some(x=>x.fanartFailed)) surface.artworkSummary += '. Some Fanart.tv artwork could not load; TMDB was used instead. Check your key or try again.';
    if (skipped.length) surface.artworkSummary += ` Skipped ${skipped.length} without landscape artwork: ${skipped.join(', ')}. These titles remain available in Posters.`;
    return surface;
  }

  function canRender() { return selectedItems().length >= 2; }
  function queuePreview() {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(renderPreview);
  }
  async function renderPreview() {
    const token = ++renderToken;
    const item = state.selected;
    els.downloadBackdrop.disabled = true;
    previewRegions = [];
    updateTileEditor();
    if (!canRender()) {
      els.renderBusy.hidden = true;
      els.renderStatus.hidden = true;
      els.retryRender.hidden = true;
      els.emptyState.hidden = false;
      els.backdropCanvas.getContext('2d').clearRect(0,0,1280,720);
      els.previewTitle.textContent = 'Add at least two titles to begin';
      els.artworkStatus.textContent = '';
      return;
    }
    els.renderBusy.hidden = false;
    els.renderStatus.hidden = true;
    els.retryRender.hidden = true;
    try {
      const image = await withRenderTimeout(artwork(item, 'w1280'));
      if (token !== renderToken) return;
      const canvas = els.backdropCanvas;
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      drawCover(ctx, image, canvas.width, canvas.height);
      applyOverlay(ctx, canvas.width, canvas.height);
      drawTitle(ctx, canvas.width, canvas.height);
      els.emptyState.hidden = true;
      els.downloadBackdrop.disabled = editMode;
      previewRegions = image.tileRegions || [];
      updateTileEditor();
      setStatus(els.artworkStatus, image.artworkSummary);
      els.previewTitle.textContent = item.title;
    } catch (error) {
      if (token !== renderToken) return;
      els.backdropCanvas.getContext('2d').clearRect(0,0,1280,720);
      els.emptyState.hidden = false;
      setStatus(els.renderStatus, error.message || 'Could not render backdrop.', 'error');
      els.renderStatus.hidden = false;
      els.retryRender.hidden = false;
    } finally { if (token === renderToken) { els.renderBusy.hidden = true; updateTileEditor(); } }
  }

  async function downloadPreview() {
    if (!canRender() || editMode) return;
    const item = state.selected;
    const token = renderToken;
    els.downloadBackdrop.disabled = true;
    try {
      const [width,height] = els.resolution.value.split('x').map(Number);
      const image = await withRenderTimeout(artwork(item, 'original', width, height));
      if (token !== renderToken) throw new Error('Artwork changed. Download the updated preview again.');
      const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const ctx = canvas.getContext('2d');
      drawCover(ctx,image,width,height); applyOverlay(ctx,width,height); drawTitle(ctx,width,height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      if (!blob) throw new Error('Could not create the download. Try again.');
      const url = URL.createObjectURL(blob); const a=document.createElement('a');
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'backdrop';
      a.href=url; a.download=`${slug}-backdrop.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
    } catch (error) {
      setStatus(els.renderStatus, error.message || 'Could not download backdrop.', 'error');
      els.renderStatus.hidden = false;
    } finally { els.downloadBackdrop.disabled = editMode || !canRender(); }
  }

  function applyMode() {
    state.mode = els.backdropSourceMode.value === 'custom' ? 'custom' : 'original';
    document.querySelector('.backdrop-app')?.classList.toggle('mode-custom', state.mode === 'custom');
    document.querySelector('.backdrop-app')?.classList.toggle('mode-original', state.mode === 'original');
    setStatus(els.backdropModeStatus, state.mode === 'custom'
      ? 'Custom styling is selected for your movie collage.'
      : 'Original artwork is selected for your collage, without the overall overlay.', 'ok');
    saveState(); queuePreview();
  }

  function syncState() {
    state.overlayPreset = els.overlayPreset.value;
    state.overlayOpacity = Number(els.overlayOpacity.value);
    state.gradientCoverage = Number(els.gradientCoverage.value);
    state.backdropZoom = Number(els.backdropZoom.value);
    state.positionX = Number(els.positionX.value);
    state.showTitle = els.showTitle.checked;
    state.showMovieLogos = els.showMovieLogos.checked;
    state.collageLayout = els.collageLayout.value;
    state.artworkSource = els.artworkSource.value;
    syncTileType();
    state.fontFamily = els.fontFamily.value;
    state.textPosition = els.textPosition.value;
    state.fontSize = Number(els.fontSize.value);
    state.textColor = els.textColor.value;
    state.textShadow = els.textShadow.checked;
    state.resolution = els.resolution.value;
    els.overlayOpacityValue.value = `${state.overlayOpacity}%`;
    els.coverageValue.value = `${state.gradientCoverage}%`;
    els.zoomValue.value = `${state.backdropZoom}%`;
    els.positionXValue.value = `${state.positionX}%`;
    els.fontSizeValue.value = state.fontSize;
    els.textControls.hidden = !state.showTitle;
    saveState(); queuePreview();
  }

  function hydrate() {
    els.backdropSourceMode.value = state.mode;
    els.tmdbKey.value = getSavedKey();
    els.mediaType.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.value === state.mediaType));
    els.overlayPreset.value = state.overlayPreset;
    els.overlayOpacity.value = state.overlayOpacity;
    els.gradientCoverage.value = state.gradientCoverage;
    els.backdropZoom.value = state.backdropZoom;
    els.positionX.value = state.positionX;
    els.showTitle.checked = state.showTitle;
    els.showMovieLogos.checked = state.showMovieLogos;
    els.collageLayout.value = state.collageLayout;
    els.artworkSource.value = state.artworkSource;
    syncTileType();
    els.fanartKey.value = savedFanartKey();
    setStatus(els.fanartKeyStatus, els.fanartKey.value ? 'Fanart.tv key is saved in this browser.' : 'Required for Backdrops. Add and save your Fanart.tv key.');
    updateSelection();
    els.fontFamily.value = state.fontFamily;
    els.textPosition.value = state.textPosition;
    els.fontSize.value = state.fontSize;
    els.textColor.value = state.textColor;
    els.textShadow.checked = state.textShadow;
    els.resolution.value = state.resolution;
    syncState();
    if (els.tmdbKey.value) setStatus(els.keyStatus,'TMDB key is saved in this browser.','ok');
  }

  els.toggleKey.addEventListener('click', () => {
    els.tmdbKey.type = els.tmdbKey.type === 'password' ? 'text' : 'password';
    els.toggleKey.setAttribute('aria-label', els.tmdbKey.type === 'password' ? 'Show API key' : 'Hide API key');
  });
  els.saveKey.addEventListener('click', () => {
    const key = els.tmdbKey.value.trim(); saveApiKey(key); setStatus(els.keyStatus, key ? 'Saved in this browser.' : 'Saved key removed.', key ? 'ok' : '');
  });
  els.validateKey.addEventListener('click', validateKey);
  els.backdropSourceMode.addEventListener('change', applyMode);
  els.mediaType.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]'); if (!button) return;
    ++searchToken;
    els.searchTitle.disabled = false;
    els.titleResults.innerHTML = '';
    state.mediaType = button.dataset.value;
    els.mediaType.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn === button));
    saveState();
  });
  els.searchTitle.addEventListener('click', searchTitles);
  els.titleSearch.addEventListener('keydown', event => { if (event.key === 'Enter') searchTitles(); });
  [els.artworkSource,els.showMovieLogos,els.collageLayout,els.overlayPreset,els.overlayOpacity,els.gradientCoverage,els.backdropZoom,els.positionX,els.showTitle,els.fontFamily,els.textPosition,els.fontSize,els.textColor,els.textShadow,els.resolution]
    .forEach(el => el.addEventListener('input', syncState));
  els.downloadBackdrop.addEventListener('click', downloadPreview);

  function updateTileEditor() {
    els.shuffleCollage.disabled = selectedItems().length < 2 || !previewRegions.length;
    els.editImages.textContent = editMode ? 'Done' : 'Edit images';
    els.editImages.setAttribute('aria-pressed',String(editMode));
    els.editImages.disabled = !editMode && !previewRegions.length;
    els.undoRemoval.hidden = !removalUndo;
    els.undoRemoval.disabled = editMode;
    els.editImagesHelp.hidden = !editMode;
    els.editImagesHelp.textContent = excludedTiles.size
      ? `${excludedTiles.size} title(s) marked for removal. Tap again to keep. Press Done to remove.`
      : 'Tap a tile to mark it for removal, then press Done. All repeated tiles for that title will be removed.';
    els.tileEditor.classList.toggle('is-editing', editMode && previewRegions.length > 0);
    if (!editMode || !previewRegions.length) { els.tileEditor.innerHTML = ''; return; }
    const zoom = state.mode === 'custom' ? state.backdropZoom/100 : 1;
    const sx = (1280-1280/zoom)*(state.mode==='custom' ? state.positionX/100 : .5);
    const sy = (720-720/zoom)/2;
    els.tileEditor.innerHTML = previewRegions.map((region,index)=>{
      const points=region.points.map(p=>({x:(p.x-sx)*zoom,y:(p.y-sy)*zoom}));
      if (points.every(p=>p.x<0) || points.every(p=>p.x>1280) || points.every(p=>p.y<0) || points.every(p=>p.y>720)) return '';
      const center={x:points.reduce((sum,p)=>sum+p.x,0)/4,y:points.reduce((sum,p)=>sum+p.y,0)/4};
      const marked=excludedTiles.has(region.key);
      return `<g class="tile-edit-target${marked ? ' marked' : ''}" data-region="${index}" role="button" tabindex="0" aria-label="${marked ? 'Keep' : 'Remove'} ${escapeHtml(region.title)}" aria-pressed="${marked}"><title>${escapeHtml(region.title)}</title><polygon points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/><path d="M${center.x-12} ${center.y-12}l24 24m0-24l-24 24"/></g>`;
    }).join('');
    els.tileEditor.querySelectorAll('[data-region]').forEach(target=>{
      const toggle=()=>{
        const region=previewRegions[Number(target.dataset.region)];
        if (!region) return;
        excludedTiles.has(region.key) ? excludedTiles.delete(region.key) : excludedTiles.add(region.key);
        const index=target.dataset.region;
        updateTileEditor();
        els.tileEditor.querySelector(`[data-region="${index}"]`)?.focus({preventScroll:true});
      };
      target.addEventListener('click',toggle);
      target.addEventListener('keydown',event=>{
        if (event.key==='Enter' || event.key===' ') { event.preventDefault(); toggle(); }
      });
    });
  }
  els.retryRender.addEventListener('click', renderPreview);
  els.editImages.addEventListener('click', async () => {
    if (!editMode) { editMode=true; els.downloadBackdrop.disabled=true; updateTileEditor(); return; }
    editMode=false;
    if (excludedTiles.size) {
      removalUndo=JSON.parse(JSON.stringify(state.selected));
      const items=selectedItems().filter(item=>!excludedTiles.has(titleKey(item)));
      await selectTitle({title:state.selected?.title || 'Movie collage',items},true);
    } else { els.downloadBackdrop.disabled=!canRender(); updateTileEditor(); }
  });
  els.undoRemoval.addEventListener('click',async()=>{
    if (!removalUndo || editMode) return;
    const previous=removalUndo; removalUndo=null;
    await selectTitle(previous);
  });
  function syncTileType() {
    els.tileType.querySelectorAll('button').forEach(button => {
      const active = button.dataset.value === state.tileType;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    els.fanartKeySection.hidden = state.tileType === 'posters';
    els.fanartKey.required = state.tileType !== 'posters';
    els.showMovieLogos.disabled = state.tileType === 'posters' || state.artworkSource === 'tmdb-original';
    els.tileTypeHelp.textContent = state.tileType === 'posters'
      ? 'Portrait movie covers. Titles printed on posters stay as part of the artwork; no extra logo is added. Downloads remain widescreen.'
      : 'Landscape artwork with optional movie titles. Downloads remain widescreen.';
  }
  els.tileType.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || !['backdrops','posters'].includes(button.dataset.value)) return;
    state.tileType = button.dataset.value;
    syncTileType(); saveState(); queuePreview();
  });
  els.toggleFanartKey.addEventListener('click', () => {
    els.fanartKey.type = els.fanartKey.type === 'password' ? 'text' : 'password';
    els.toggleFanartKey.setAttribute('aria-label', els.fanartKey.type === 'password' ? 'Show Fanart.tv key' : 'Hide Fanart.tv key');
  });
  els.saveFanartKey.addEventListener('click', () => {
    const key = els.fanartKey.value.trim();
    try { localStorage.setItem(FANART_KEY,key); }
    catch { return setStatus(els.fanartKeyStatus,'Could not save the key in this browser.','error'); }
    fanartCache.clear();
    setStatus(els.fanartKeyStatus,key ? 'Key saved. Fanart.tv artwork will be tried when titles are enabled.' : 'Key removed. Save a Fanart.tv key to generate Backdrops.', 'ok');
    queuePreview();
  });
  els.clearCollage.addEventListener('click', () => selectTitle(null));
  els.shuffleCollage.addEventListener('click', async () => {
    const original=selectedItems();
    if (original.length < 2 || !previewRegions.length) return;
    const items=[...original];
    for(let i=items.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
    // Always show a changed arrangement, even if the random shuffle repeats the order.
    if (items.every((item,index)=>titleKey(item)===titleKey(original[index]))) items.push(items.shift());
    state.selected={title:state.selected?.title || 'Movie collage',items};
    // Preserve pending red marks and removal undo while changing only tile order.
    saveState(); updateSelection();
    await renderPreview();
  });
  window.KollectionBackdrops = Object.freeze({ selectTitle, addTitle, tmdbFetch, getState: () => JSON.parse(JSON.stringify(state)), restore: value => { ++renderToken; state = { ...defaults, ...value }; hydrate(); applyMode(); } });
  window.dispatchEvent(new CustomEvent('kollection:backdrops-ready'));

  hydrate();
  applyMode();
})();
