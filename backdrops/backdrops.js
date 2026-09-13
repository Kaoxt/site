(() => {
  'use strict';

  const STATE_KEY = 'kollection-backdrops-title-state-v1';
  const TMDB_KEY = 'kollection-backdrops-tmdb-key-v1';
  const API_BASE = 'https://api.themoviedb.org/3';
  const IMAGE_BASE = 'https://image.tmdb.org/t/p/original';

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
    fontFamily: 'Inter, Arial, sans-serif',
    textPosition: 'left-center',
    fontSize: 72,
    textColor: '#ffffff',
    textShadow: true,
    resolution: '1920x1080'
  };

  let state = loadState();
  let renderToken = 0;
  const imageCache = new Map();
  const $ = id => document.getElementById(id);
  const els = {};
  [
    'backdropSourceMode','backdropModeStatus','tmdbKey','toggleKey','saveKey','validateKey','keyStatus','mediaType','titleSearch','searchTitle','titleSearchStatus','titleResults',
    'overlayPreset','overlayOpacity','overlayOpacityValue','gradientCoverage','coverageValue','backdropZoom','zoomValue','positionX','positionXValue','showTitle','textControls','fontFamily','textPosition','fontSize','fontSizeValue','textColor','textShadow',
    'backdropCanvas','emptyState','renderBusy','previewTitle','previewMeta','resolution','downloadBackdrop'
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
    const query = els.titleSearch.value.trim();
    if (!query) return setStatus(els.titleSearchStatus, 'Type a movie or TV title first.', 'error');
    if (!String(els.tmdbKey.value || getSavedKey()).trim()) return setStatus(els.titleSearchStatus, 'Add your TMDB key first.', 'error');
    els.searchTitle.disabled = true;
    setStatus(els.titleSearchStatus, 'Searching TMDB…');
    try {
      const data = await tmdbFetch(`/search/${state.mediaType}`, { query, include_adult: false, language: 'en-US', page: 1 });
      const results = (data.results || []).filter(item => item.backdrop_path).slice(0, 8).map(item => normalizeSearchItem(item, state.mediaType));
      renderResults(results);
      setStatus(els.titleSearchStatus, results.length ? `Choose a title below. Each result has its own backdrop.` : 'No matching titles with backdrops were found.', results.length ? 'ok' : '');
    } catch (error) {
      setStatus(els.titleSearchStatus, error.message || 'Could not search TMDB.', 'error');
    } finally { els.searchTitle.disabled = false; }
  }

  function renderResults(results) {
    els.titleResults.innerHTML = results.map(item => `
      <button class="title-result" type="button" data-id="${item.id}" data-media="${item.media}">
        ${item.posterPath ? `<img src="https://image.tmdb.org/t/p/w185${item.posterPath}" alt="" loading="lazy">` : '<span class="title-result-placeholder">▧</span>'}
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.year || item.media)}</small></span>
      </button>`).join('');
    els.titleResults.querySelectorAll('.title-result').forEach((button, index) => {
      button.addEventListener('click', () => selectTitle(results[index]));
    });
  }

  async function selectTitle(item) {
    state.selected = item;
    saveState();
    els.titleResults.querySelectorAll('.title-result').forEach(button => button.classList.toggle('selected', Number(button.dataset.id) === Number(item.id)));
    await renderPreview();
  }

  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load this TMDB backdrop.'));
      image.src = url;
    });
    imageCache.set(url, promise);
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

  async function renderPreview() {
    const item = state.selected;
    if (!item?.backdropPath) {
      els.emptyState.hidden = false;
      els.downloadBackdrop.disabled = true;
      els.previewTitle.textContent = 'Search for a movie or TV show';
      els.previewMeta.textContent = '';
      return;
    }
    const token = ++renderToken;
    els.renderBusy.hidden = false;
    try {
      const image = await loadImage(`${IMAGE_BASE}${item.backdropPath}`);
      if (token !== renderToken) return;
      const canvas = els.backdropCanvas;
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      drawCover(ctx, image, canvas.width, canvas.height);
      applyOverlay(ctx, canvas.width, canvas.height);
      drawTitle(ctx, canvas.width, canvas.height);
      els.emptyState.hidden = true;
      els.downloadBackdrop.disabled = false;
      els.previewTitle.textContent = item.title;
      els.previewMeta.textContent = `${item.year || ''}${item.year ? ' · ' : ''}${item.media === 'movie' ? 'Movie' : 'TV Show'} · ${state.mode === 'custom' ? 'Custom style' : 'Original backdrop'}`;
    } catch (error) {
      setStatus(els.titleSearchStatus, error.message || 'Could not render backdrop.', 'error');
    } finally { if (token === renderToken) els.renderBusy.hidden = true; }
  }

  async function downloadPreview() {
    if (!state.selected?.backdropPath) return;
    const [width,height] = els.resolution.value.split('x').map(Number);
    const image = await loadImage(`${IMAGE_BASE}${state.selected.backdropPath}`);
    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx = canvas.getContext('2d');
    drawCover(ctx,image,width,height); applyOverlay(ctx,width,height); drawTitle(ctx,width,height);
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob); const a=document.createElement('a');
      const slug = state.selected.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'backdrop';
      a.href=url; a.download=`${slug}-backdrop.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
    },'image/png');
  }

  function applyMode() {
    state.mode = els.backdropSourceMode.value === 'custom' ? 'custom' : 'original';
    document.querySelector('.backdrop-app')?.classList.toggle('mode-custom', state.mode === 'custom');
    document.querySelector('.backdrop-app')?.classList.toggle('mode-original', state.mode === 'original');
    setStatus(els.backdropModeStatus, state.mode === 'custom'
      ? 'Custom styling is selected. Every title still uses its own TMDB backdrop image.'
      : 'Original is selected. Each title uses its own TMDB backdrop.', 'ok');
    saveState(); renderPreview();
  }

  function syncState() {
    state.overlayPreset = els.overlayPreset.value;
    state.overlayOpacity = Number(els.overlayOpacity.value);
    state.gradientCoverage = Number(els.gradientCoverage.value);
    state.backdropZoom = Number(els.backdropZoom.value);
    state.positionX = Number(els.positionX.value);
    state.showTitle = els.showTitle.checked;
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
    saveState(); renderPreview();
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
    state.mediaType = button.dataset.value;
    els.mediaType.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn === button));
    saveState();
  });
  els.searchTitle.addEventListener('click', searchTitles);
  els.titleSearch.addEventListener('keydown', event => { if (event.key === 'Enter') searchTitles(); });
  [els.overlayPreset,els.overlayOpacity,els.gradientCoverage,els.backdropZoom,els.positionX,els.showTitle,els.fontFamily,els.textPosition,els.fontSize,els.textColor,els.textShadow,els.resolution]
    .forEach(el => el.addEventListener('input', syncState));
  els.downloadBackdrop.addEventListener('click', downloadPreview);

  hydrate();
  applyMode();
})();
