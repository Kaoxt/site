(() => {
  'use strict';

  const STATE_KEY = 'kollection-backdrops-title-state-v1';
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
    fontFamily: 'Inter, Arial, sans-serif',
    textPosition: 'left-center',
    fontSize: 72,
    textColor: '#ffffff',
    textShadow: true,
    resolution: '1920x1080'
  };

  let state = loadState();
  let renderToken = 0;
  let searchToken = 0;
  let renderFrame = 0;
  const imageCache = new Map();
  const logoCache = new Map();
  const $ = id => document.getElementById(id);
  const els = {};
  [
    'backdropSourceMode','backdropModeStatus','tmdbKey','toggleKey','saveKey','validateKey','keyStatus','mediaType','titleSearch','searchTitle','titleSearchStatus','titleResults',
    'overlayPreset','overlayOpacity','overlayOpacityValue','gradientCoverage','coverageValue','backdropZoom','zoomValue','positionX','positionXValue','showTitle','textControls','fontFamily','textPosition','fontSize','fontSizeValue','textColor','textShadow',
    'showMovieLogos','collageLayout','collageTitles','collageStatus','clearCollage','shuffleCollage','backdropCanvas','emptyState','renderBusy','previewTitle','previewMeta','resolution','downloadBackdrop'
  ].forEach(id => { els[id] = $(id); });

  function loadState() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; }
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
    const response = await fetch(auth.url, { headers: auth.headers, cache: 'default' });
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
      const results = (data.results || []).filter(item => item.backdrop_path).slice(0, 8).map(item => normalizeSearchItem(item, media));
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

  const titleKey = item => `${item.media || 'movie'}:${item.id || item.backdropPath}`;
  function selectedItems() {
    return state.selected?.items || (state.selected?.backdropPath ? [state.selected] : []);
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
  async function selectTitle(item) {
    if (item?.items) {
      const unique = new Map(item.items.filter(entry => entry.backdropPath).map(entry => [titleKey(entry), entry]));
      item = {...item, items:[...unique.values()].slice(0,18)};
    }
    state.selected = item;
    saveState(); updateSelection();
    await renderPreview();
  }
  async function addTitle(item) {
    if (!item?.backdropPath) return;
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
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(url); reject(new Error('Could not load this TMDB backdrop. Try selecting it again.')); };
      image.src = url;
    });
    imageCache.set(url, promise);
    if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
    return promise;
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

  async function titleLogo(item) {
    if (!item.id || !['movie','tv'].includes(item.media)) return null;
    const key = titleKey(item);
    if (!logoCache.has(key)) {
      const promise = tmdbFetch(`/${item.media}/${item.id}/images`, {include_image_language:'en,null'})
        .then(data => (data.logos || []).filter(logo => /\.png$/i.test(logo.file_path))
          .sort((a,b) => (Number(b.iso_639_1 === 'en') - Number(a.iso_639_1 === 'en')) || (b.vote_average || 0) - (a.vote_average || 0))[0]?.file_path || null)
        .catch(() => { logoCache.delete(key); return null; });
      logoCache.set(key, promise);
      if (logoCache.size > 80) logoCache.delete(logoCache.keys().next().value);
    }
    const path = await logoCache.get(key);
    return path ? loadImage(`${IMAGE_BASE}w500${path}`).catch(() => null) : null;
  }
  async function artwork(item, size, width=1280, height=720) {
    const entries = item.items || [item];
    const useLogos = state.showMovieLogos;
    const layout = state.collageLayout;
    const assets = [];
    // Limit concurrent image/metadata requests and reuse them for slider changes.
    for (let i=0; i<entries.length; i+=4) {
      assets.push(...await Promise.all(entries.slice(i,i+4).map(async entry => ({
        entry,
        image:await loadImage(`${IMAGE_BASE}${width > 1920 ? 'w1280' : 'w780'}${entry.backdropPath}`),
        logo:useLogos ? await titleLogo(entry) : null
      }))));
    }
    const surface = document.createElement('canvas');
    surface.width = width; surface.height = height;
    const ctx = surface.getContext('2d');
    ctx.fillStyle = '#050608'; ctx.fillRect(0,0,width,height);
    const tilted = layout === 'tilted';
    const cols = tilted ? 4 : Math.min(4, Math.ceil(Math.sqrt(assets.length * 16/9)));
    const rows = tilted ? 6 : Math.ceil(assets.length / cols);
    const gap = width * .008;
    const w = tilted ? width * .24 : width / cols;
    const h = tilted ? w * 9/16 : height / rows;
    ctx.save();
    if (tilted) { ctx.translate(width*.22, -height*.13); ctx.rotate(-12*Math.PI/180); }
    for (let index=0; index<(tilted ? cols*rows : assets.length); index++) {
      const {image,logo,entry} = assets[index % assets.length];
      const row = Math.floor(index/cols), col=index%cols;
      const rowCount = tilted ? cols : Math.min(cols, assets.length-row*cols);
      const tw = (tilted ? w : width/rowCount)-gap, th=h-gap;
      ctx.save();ctx.translate(tilted ? col*w : col*width/rowCount, row*h);
      ctx.beginPath();ctx.rect(0,0,tw,th);ctx.clip();
      const scale=Math.max(tw/image.width,th/image.height),sw=tw/scale,sh=th/scale;
      ctx.drawImage(image,(image.width-sw)/2,(image.height-sh)/2,sw,sh,0,0,tw,th);
      if (useLogos) {
        const fade=ctx.createLinearGradient(0,th*.45,0,th);
        fade.addColorStop(0,'rgba(0,0,0,0)');fade.addColorStop(1,'rgba(0,0,0,.8)');
        ctx.fillStyle=fade;ctx.fillRect(0,0,tw,th);
        if (logo) {
          const factor=Math.min(tw*.72/logo.width,th*.29/logo.height);
          const lw=logo.width*factor,lh=logo.height*factor;
          ctx.drawImage(logo,(tw-lw)/2,th-lh-th*.07,lw,lh);
        } else {
          ctx.fillStyle='#fff';ctx.font=`700 ${Math.max(12,th*.105)}px Arial, sans-serif`;
          ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(entry.title || 'Untitled',tw/2,th*.84,tw*.88);
        }
      }
      ctx.restore();
    }
    ctx.restore();
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
    if (!canRender()) {
      els.renderBusy.hidden = true;
      els.emptyState.hidden = false;
      els.backdropCanvas.getContext('2d').clearRect(0,0,1280,720);
      els.previewTitle.textContent = 'Add at least two titles to begin';
      els.previewMeta.textContent = '';
      return;
    }
    els.renderBusy.hidden = false;
    try {
      const image = await artwork(item, 'w1280');
      if (token !== renderToken) return;
      const canvas = els.backdropCanvas;
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      drawCover(ctx, image, canvas.width, canvas.height);
      applyOverlay(ctx, canvas.width, canvas.height);
      drawTitle(ctx, canvas.width, canvas.height);
      els.emptyState.hidden = true;
      els.downloadBackdrop.disabled = false;
      els.previewTitle.textContent = item.title;
      els.previewMeta.textContent = item.items ? `${item.items.length} titles · Folder backdrop` : `${item.year || ''} · ${item.media === 'movie' ? 'Movie' : 'TV Show'}`;
    } catch (error) {
      if (token !== renderToken) return;
      els.backdropCanvas.getContext('2d').clearRect(0,0,1280,720);
      els.emptyState.hidden = false;
      setStatus(els.titleSearchStatus, error.message || 'Could not render backdrop.', 'error');
    } finally { if (token === renderToken) els.renderBusy.hidden = true; }
  }

  async function downloadPreview() {
    if (!canRender()) return;
    const item = state.selected;
    const token = renderToken;
    els.downloadBackdrop.disabled = true;
    try {
      const [width,height] = els.resolution.value.split('x').map(Number);
      const image = await artwork(item, 'original', width, height);
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
      setStatus(els.titleSearchStatus, error.message || 'Could not download backdrop.', 'error');
    } finally { els.downloadBackdrop.disabled = !canRender(); }
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
  [els.showMovieLogos,els.collageLayout,els.overlayPreset,els.overlayOpacity,els.gradientCoverage,els.backdropZoom,els.positionX,els.showTitle,els.fontFamily,els.textPosition,els.fontSize,els.textColor,els.textShadow,els.resolution]
    .forEach(el => el.addEventListener('input', syncState));
  els.downloadBackdrop.addEventListener('click', downloadPreview);

  els.clearCollage.addEventListener('click', () => selectTitle(null));
  els.shuffleCollage.addEventListener('click', () => {
    const items=[...selectedItems()];
    for(let i=items.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
    selectTitle({title:state.selected?.title || 'Movie collage',items});
  });
  window.KollectionBackdrops = Object.freeze({ selectTitle, addTitle, tmdbFetch, getState: () => JSON.parse(JSON.stringify(state)), restore: value => { ++renderToken; state = { ...defaults, ...value }; hydrate(); applyMode(); } });
  window.dispatchEvent(new CustomEvent('kollection:backdrops-ready'));

  hydrate();
  applyMode();
})();
