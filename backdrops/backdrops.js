(() => {
  'use strict';

  const STATE_KEY = 'kollection-backdrops-state-v1';
  const TMDB_KEY = 'kollection-backdrops-tmdb-key-v1';
  const CACHE_PREFIX = 'kollection-backdrops-cache-v1:';
  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
  const API_BASE = 'https://api.themoviedb.org/3';

  const defaults = {
    mediaType: 'movie',
    sourceList: 'popular',
    genre: '',
    decade: '',
    language: '',
    artworkShape: 'backdrop',
    imageCount: 18,
    cardScale: 100,
    cardGap: 18,
    cornerRadius: 16,
    artOpacity: 100,
    rowAngle: -7,
    offsetX: 0,
    offsetY: 0,
    overlayPreset: 'cinematic',
    overlayOpacity: 72,
    gradientCoverage: 68,
    showTitle: false,
    titleText: '',
    fontFamily: 'Inter, Arial, sans-serif',
    textPosition: 'left-center',
    fontSize: 72,
    textColor: '#ffffff',
    textShadow: true,
    resolution: '1920x1080',
    items: []
  };

  let state = loadState();
  let renderToken = 0;
  const imageCache = new Map();

  const $ = (id) => document.getElementById(id);
  const els = {};
  const ids = [
    'tmdbKey','toggleKey','saveKey','validateKey','keyStatus','mediaType','sourceList','genre','decade','language','artworkShape','imageCount','imageCountValue','fetchImages','sourceStatus',
    'cardScale','scaleValue','cardGap','gapValue','cornerRadius','radiusValue','artOpacity','artOpacityValue','rowAngle','angleValue','offsetX','offsetXValue','offsetY','offsetYValue',
    'overlayPreset','overlayOpacity','overlayOpacityValue','gradientCoverage','coverageValue','showTitle','textControls','titleText','fontFamily','textPosition','fontSize','fontSizeValue','textColor','textShadow',
    'backdropCanvas','emptyState','renderBusy','previewTitle','shuffleImages','clearCanvas','resolution','downloadBackdrop'
  ];

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      return { ...defaults, ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch (_) {
      return { ...defaults };
    }
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function getSavedKey() {
    try { return localStorage.getItem(TMDB_KEY) || ''; } catch (_) { return ''; }
  }

  function saveApiKey(key) {
    try {
      if (key) localStorage.setItem(TMDB_KEY, key);
      else localStorage.removeItem(TMDB_KEY);
    } catch (_) {}
  }

  function setStatus(el, message, type = '') {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok','error');
    if (type) el.classList.add(type);
  }

  function authFor(urlString) {
    const key = (els.tmdbKey?.value || getSavedKey()).trim();
    if (!key) throw new Error('Add your TMDB API key first.');
    const url = new URL(urlString);
    const headers = { Accept: 'application/json' };
    if (key.startsWith('eyJ') || key.length > 60) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);
    return { url: url.toString(), headers };
  }

  async function tmdbFetch(path, params = {}) {
    const url = new URL(`${API_BASE}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    const auth = authFor(url.toString());
    const response = await fetch(auth.url, { headers: auth.headers, cache: 'default' });
    if (!response.ok) {
      if (response.status === 401) throw new Error('TMDB rejected this key. Check your Read Access Token or API key.');
      if (response.status === 429) throw new Error('TMDB rate limit reached. Try again shortly.');
      throw new Error(`TMDB request failed (${response.status}).`);
    }
    return response.json();
  }

  async function validateKey() {
    const key = (els.tmdbKey.value || '').trim();
    if (!key) { setStatus(els.keyStatus, 'Paste a TMDB token or API key first.', 'error'); return; }
    setStatus(els.keyStatus, 'Testing directly with TMDB…');
    els.validateKey.disabled = true;
    try {
      await tmdbFetch('/configuration');
      saveApiKey(key);
      setStatus(els.keyStatus, 'TMDB key works and is saved in this browser.', 'ok');
      await loadGenres();
    } catch (error) {
      setStatus(els.keyStatus, error.message || 'Could not validate TMDB key.', 'error');
    } finally {
      els.validateKey.disabled = false;
    }
  }

  async function loadGenres() {
    const key = (els.tmdbKey.value || '').trim();
    if (!key) return;
    try {
      const [movie, tv] = await Promise.all([
        tmdbFetch('/genre/movie/list', { language: 'en-US' }),
        tmdbFetch('/genre/tv/list', { language: 'en-US' })
      ]);
      const merged = new Map();
      [...(movie.genres || []), ...(tv.genres || [])].forEach((g) => merged.set(String(g.id), g.name));
      const selected = state.genre;
      els.genre.innerHTML = '<option value="">Any genre</option>' + [...merged.entries()]
        .sort((a,b) => a[1].localeCompare(b[1]))
        .map(([id,name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
      els.genre.value = selected;
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function endpointFor(media, source) {
    if (source === 'trending') return `/trending/${media}/week`;
    if (source === 'now_playing') return media === 'movie' ? '/movie/now_playing' : '/tv/on_the_air';
    return `/${media}/${source}`;
  }

  function itemDate(item, media) {
    return media === 'movie' ? item.release_date : item.first_air_date;
  }

  function matchesFilters(item, media) {
    if (state.genre && !(item.genre_ids || []).map(String).includes(String(state.genre))) return false;
    if (state.language && item.original_language !== state.language) return false;
    if (state.decade) {
      const year = Number((itemDate(item, media) || '').slice(0,4));
      const start = Number(state.decade);
      if (!year || year < start || year > start + 9) return false;
    }
    const path = state.artworkShape === 'poster' ? item.poster_path : item.backdrop_path;
    return Boolean(path);
  }

  function normalizeItem(item, media) {
    const path = state.artworkShape === 'poster' ? item.poster_path : item.backdrop_path;
    return {
      id: `${media}:${item.id}`,
      tmdbId: item.id,
      media,
      title: item.title || item.name || 'Untitled',
      path,
      imageUrl: `${IMAGE_BASE}${path}`,
      backdropPath: item.backdrop_path || '',
      posterPath: item.poster_path || '',
      originalLanguage: item.original_language || '',
      genreIds: item.genre_ids || [],
      date: itemDate(item, media) || ''
    };
  }

  function cacheKey() {
    return [state.mediaType,state.sourceList,state.genre,state.decade,state.language,state.artworkShape,state.imageCount].join('|');
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + cacheKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.savedAt > CACHE_TTL || !Array.isArray(parsed.items)) return null;
      return parsed.items;
    } catch (_) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_PREFIX + cacheKey(), JSON.stringify({ savedAt: Date.now(), items })); } catch (_) {}
  }

  async function fetchForMedia(media, targetCount) {
    const found = [];
    const seen = new Set();
    for (let page = 1; page <= 5 && found.length < targetCount; page += 1) {
      const data = await tmdbFetch(endpointFor(media, state.sourceList), { page, language: 'en-US' });
      for (const item of data.results || []) {
        if (!matchesFilters(item, media)) continue;
        const normalized = normalizeItem(item, media);
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        found.push(normalized);
        if (found.length >= targetCount) break;
      }
      if (!data.total_pages || page >= data.total_pages) break;
    }
    return found;
  }

  function interleave(a, b, limit) {
    const out = [];
    let i = 0;
    while (out.length < limit && (i < a.length || i < b.length)) {
      if (i < a.length) out.push(a[i]);
      if (out.length >= limit) break;
      if (i < b.length) out.push(b[i]);
      i += 1;
    }
    return out.slice(0, limit);
  }

  async function fetchArtwork() {
    const key = (els.tmdbKey.value || '').trim();
    if (!key) { setStatus(els.sourceStatus, 'Add your TMDB key before fetching artwork.', 'error'); return; }
    saveApiKey(key);
    syncStateFromControls();

    const cached = readCache();
    if (cached?.length) {
      state.items = cached.slice(0, state.imageCount);
      saveState();
      setStatus(els.sourceStatus, `Loaded ${state.items.length} cached images without another TMDB API request.`, 'ok');
      await renderPreview();
      return;
    }

    els.fetchImages.disabled = true;
    els.fetchImages.textContent = 'Fetching…';
    setStatus(els.sourceStatus, 'Fetching artwork directly from TMDB…');
    try {
      let items;
      if (state.mediaType === 'both') {
        const perType = Math.max(12, Math.ceil(state.imageCount * 0.8));
        const [movies, shows] = await Promise.all([fetchForMedia('movie', perType), fetchForMedia('tv', perType)]);
        items = interleave(movies, shows, state.imageCount);
      } else {
        items = await fetchForMedia(state.mediaType, state.imageCount);
      }
      if (!items.length) throw new Error('No matching artwork was found. Try fewer filters.');
      state.items = items.slice(0, state.imageCount);
      writeCache(state.items);
      saveState();
      setStatus(els.sourceStatus, `Loaded ${state.items.length} images. Results are cached locally for 12 hours.`, 'ok');
      await renderPreview();
    } catch (error) {
      setStatus(els.sourceStatus, error.message || 'Could not fetch artwork.', 'error');
    } finally {
      els.fetchImages.disabled = false;
      els.fetchImages.textContent = 'Fetch artwork';
    }
  }

  function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load image: ${url}`));
      image.src = url;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function roundedPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawImageCover(ctx, image, x, y, w, h, radius, alpha, angle) {
    const scale = Math.max(w / image.width, h / image.height);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (image.width - sw) / 2;
    const sy = (image.height - sh) / 2;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.globalAlpha = alpha;
    roundedPath(ctx, -w/2, -h/2, w, h, radius);
    ctx.clip();
    ctx.drawImage(image, sx, sy, sw, sh, -w/2, -h/2, w, h);
    ctx.restore();
  }

  function applyOverlay(ctx, width, height, stateForRender) {
    const opacity = stateForRender.overlayOpacity / 100;
    if (stateForRender.overlayPreset === 'none' || opacity <= 0) return;
    const coverage = stateForRender.gradientCoverage / 100;
    ctx.save();

    if (stateForRender.overlayPreset === 'vignette' || stateForRender.overlayPreset === 'cinematic') {
      const radial = ctx.createRadialGradient(width/2, height/2, Math.min(width,height)*.12, width/2, height/2, Math.max(width,height)*.72);
      radial.addColorStop(0, 'rgba(0,0,0,0)');
      radial.addColorStop(.58, `rgba(0,0,0,${opacity * .18})`);
      radial.addColorStop(1, `rgba(0,0,0,${opacity * .88})`);
      ctx.fillStyle = radial;
      ctx.fillRect(0,0,width,height);
    }

    if (stateForRender.overlayPreset === 'dark-left' || stateForRender.overlayPreset === 'cinematic') {
      const gradient = ctx.createLinearGradient(0,0,width*coverage,0);
      gradient.addColorStop(0, `rgba(0,0,0,${Math.min(1, opacity)})`);
      gradient.addColorStop(.42, `rgba(0,0,0,${opacity * .74})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,width,height);
    } else if (stateForRender.overlayPreset === 'dark-right') {
      const gradient = ctx.createLinearGradient(width,0,width*(1-coverage),0);
      gradient.addColorStop(0, `rgba(0,0,0,${Math.min(1, opacity)})`);
      gradient.addColorStop(.42, `rgba(0,0,0,${opacity * .74})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,width,height);
    } else if (stateForRender.overlayPreset === 'bottom-fade') {
      const gradient = ctx.createLinearGradient(0,height,0,height*(1-coverage));
      gradient.addColorStop(0, `rgba(0,0,0,${Math.min(1, opacity)})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,width,height);
    }
    ctx.restore();
  }

  function drawTitle(ctx, width, height, stateForRender) {
    if (!stateForRender.showTitle || !stateForRender.titleText.trim()) return;
    const size = stateForRender.fontSize * (width / 1280);
    const padX = width * .075;
    const padY = height * .11;
    let x = padX;
    let y = height / 2;
    let align = 'left';
    if (stateForRender.textPosition === 'left-bottom') { x = padX; y = height - padY; }
    if (stateForRender.textPosition === 'center') { x = width / 2; y = height / 2; align = 'center'; }
    if (stateForRender.textPosition === 'right-center') { x = width - padX; y = height / 2; align = 'right'; }
    if (stateForRender.textPosition === 'right-bottom') { x = width - padX; y = height - padY; align = 'right'; }
    ctx.save();
    ctx.font = `700 ${size}px ${stateForRender.fontFamily}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stateForRender.textColor;
    if (stateForRender.textShadow) {
      ctx.shadowColor = 'rgba(0,0,0,.72)';
      ctx.shadowBlur = size * .18;
      ctx.shadowOffsetY = size * .06;
    }
    ctx.fillText(stateForRender.titleText.trim(), x, y, width * .82);
    ctx.restore();
  }

  async function renderToCanvas(canvas, width, height, items, stateForRender) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle = '#050608';
    ctx.fillRect(0,0,width,height);

    if (!items.length) return;

    const loaded = await Promise.all(items.map((item) => loadImage(item.imageUrl).catch(() => null)));
    const images = loaded.filter(Boolean);
    if (!images.length) throw new Error('TMDB images could not be loaded into the canvas.');

    const scaleFactor = stateForRender.cardScale / 100;
    const gap = stateForRender.cardGap * (width / 1280);
    const radius = stateForRender.cornerRadius * (width / 1280);
    const alpha = stateForRender.artOpacity / 100;
    const shape = stateForRender.artworkShape;
    const cardW = width * (shape === 'poster' ? .155 : .295) * scaleFactor;
    const cardH = shape === 'poster' ? cardW * 1.5 : cardW * 9 / 16;
    const rowStep = cardH + gap;
    const rows = Math.max(3, Math.ceil((height + cardH) / rowStep));
    const startY = (height - (rows * cardH + (rows - 1) * gap)) / 2 + stateForRender.offsetY * (height / 720);
    const stepX = cardW + gap;
    let imageIndex = 0;

    for (let row = 0; row < rows; row += 1) {
      const stagger = row % 2 ? stepX / 2 : 0;
      let x = -cardW * 1.6 - stagger + stateForRender.offsetX * (width / 1280);
      const y = startY + row * rowStep;
      while (x < width + cardW * 1.6) {
        const image = images[imageIndex % images.length];
        drawImageCover(ctx, image, x, y, cardW, cardH, radius, alpha, stateForRender.rowAngle);
        x += stepX;
        imageIndex += 1;
      }
    }

    applyOverlay(ctx, width, height, stateForRender);
    drawTitle(ctx, width, height, stateForRender);
  }

  async function renderPreview() {
    const token = ++renderToken;
    syncStateFromControls();
    saveState();
    updatePreviewUi();
    if (!state.items.length) {
      const ctx = els.backdropCanvas.getContext('2d');
      els.backdropCanvas.width = 1280;
      els.backdropCanvas.height = 720;
      ctx.clearRect(0,0,1280,720);
      ctx.fillStyle = '#050608';
      ctx.fillRect(0,0,1280,720);
      return;
    }
    els.renderBusy.hidden = false;
    try {
      await renderToCanvas(els.backdropCanvas, 1280, 720, state.items, state);
      if (token !== renderToken) return;
    } catch (error) {
      setStatus(els.sourceStatus, error.message || 'Could not render preview.', 'error');
    } finally {
      if (token === renderToken) els.renderBusy.hidden = true;
    }
  }

  function updatePreviewUi() {
    const hasItems = state.items.length > 0;
    els.emptyState.hidden = hasItems;
    els.shuffleImages.disabled = !hasItems;
    els.downloadBackdrop.disabled = !hasItems;
    els.previewTitle.textContent = hasItems ? `${state.items.length} TMDB images · ${state.artworkShape === 'poster' ? 'Poster collage' : 'Backdrop collage'}` : 'Your backdrop will appear here';
  }

  function syncStateFromControls() {
    state.sourceList = els.sourceList.value;
    state.genre = els.genre.value;
    state.decade = els.decade.value;
    state.language = els.language.value;
    state.artworkShape = els.artworkShape.value;
    state.imageCount = Number(els.imageCount.value);
    state.cardScale = Number(els.cardScale.value);
    state.cardGap = Number(els.cardGap.value);
    state.cornerRadius = Number(els.cornerRadius.value);
    state.artOpacity = Number(els.artOpacity.value);
    state.rowAngle = Number(els.rowAngle.value);
    state.offsetX = Number(els.offsetX.value);
    state.offsetY = Number(els.offsetY.value);
    state.overlayPreset = els.overlayPreset.value;
    state.overlayOpacity = Number(els.overlayOpacity.value);
    state.gradientCoverage = Number(els.gradientCoverage.value);
    state.showTitle = els.showTitle.checked;
    state.titleText = els.titleText.value;
    state.fontFamily = els.fontFamily.value;
    state.textPosition = els.textPosition.value;
    state.fontSize = Number(els.fontSize.value);
    state.textColor = els.textColor.value;
    state.textShadow = els.textShadow.checked;
    state.resolution = els.resolution.value;
  }

  function syncControlsFromState() {
    els.sourceList.value = state.sourceList;
    els.genre.value = state.genre;
    els.decade.value = state.decade;
    els.language.value = state.language;
    els.artworkShape.value = state.artworkShape;
    els.imageCount.value = state.imageCount;
    els.cardScale.value = state.cardScale;
    els.cardGap.value = state.cardGap;
    els.cornerRadius.value = state.cornerRadius;
    els.artOpacity.value = state.artOpacity;
    els.rowAngle.value = state.rowAngle;
    els.offsetX.value = state.offsetX;
    els.offsetY.value = state.offsetY;
    els.overlayPreset.value = state.overlayPreset;
    els.overlayOpacity.value = state.overlayOpacity;
    els.gradientCoverage.value = state.gradientCoverage;
    els.showTitle.checked = state.showTitle;
    els.titleText.value = state.titleText;
    els.fontFamily.value = state.fontFamily;
    els.textPosition.value = state.textPosition;
    els.fontSize.value = state.fontSize;
    els.textColor.value = state.textColor;
    els.textShadow.checked = state.textShadow;
    els.resolution.value = state.resolution;
    [...els.mediaType.querySelectorAll('button')].forEach((button) => button.classList.toggle('active', button.dataset.value === state.mediaType));
    updateTextControls();
    updateOutputs();
  }

  function updateTextControls() {
    els.textControls.hidden = !els.showTitle.checked;
  }

  function updateOutputs() {
    els.imageCountValue.value = els.imageCount.value;
    els.scaleValue.value = `${els.cardScale.value}%`;
    els.gapValue.value = els.cardGap.value;
    els.radiusValue.value = els.cornerRadius.value;
    els.artOpacityValue.value = `${els.artOpacity.value}%`;
    els.angleValue.value = `${els.rowAngle.value}°`;
    els.offsetXValue.value = els.offsetX.value;
    els.offsetYValue.value = els.offsetY.value;
    els.overlayOpacityValue.value = `${els.overlayOpacity.value}%`;
    els.coverageValue.value = `${els.gradientCoverage.value}%`;
    els.fontSizeValue.value = els.fontSize.value;
  }

  function resetSection(section) {
    const map = {
      layout: ['cardScale','cardGap','cornerRadius','artOpacity','rowAngle','offsetX','offsetY'],
      overlay: ['overlayPreset','overlayOpacity','gradientCoverage'],
      text: ['showTitle','titleText','fontFamily','textPosition','fontSize','textColor','textShadow']
    };
    (map[section] || []).forEach((key) => { state[key] = defaults[key]; });
    syncControlsFromState();
    renderPreview();
  }

  function debounce(fn, wait = 90) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function downloadBackdrop() {
    if (!state.items.length) return;
    syncStateFromControls();
    const [width, height] = els.resolution.value.split('x').map(Number);
    const exportCanvas = document.createElement('canvas');
    const original = els.downloadBackdrop.textContent;
    els.downloadBackdrop.disabled = true;
    els.downloadBackdrop.textContent = 'Rendering…';
    els.renderBusy.hidden = false;
    try {
      await renderToCanvas(exportCanvas, width, height, state.items, state);
      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not create the PNG file.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kollection-backdrop-${width}x${height}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      setStatus(els.sourceStatus, error.message || 'Could not download the backdrop.', 'error');
    } finally {
      els.renderBusy.hidden = true;
      els.downloadBackdrop.disabled = false;
      els.downloadBackdrop.textContent = original;
    }
  }

  function clearCanvas() {
    state.items = [];
    saveState();
    updatePreviewUi();
    renderPreview();
    setStatus(els.sourceStatus, 'Preview cleared. Your locally cached TMDB results are still available.');
  }

  function bindEvents() {
    els.toggleKey.addEventListener('click', () => {
      const showing = els.tmdbKey.type === 'text';
      els.tmdbKey.type = showing ? 'password' : 'text';
      els.toggleKey.setAttribute('aria-label', showing ? 'Show API key' : 'Hide API key');
      els.toggleKey.title = showing ? 'Show API key' : 'Hide API key';
    });
    els.saveKey.addEventListener('click', () => {
      const key = els.tmdbKey.value.trim();
      saveApiKey(key);
      setStatus(els.keyStatus, key ? 'TMDB key saved locally in this browser.' : 'TMDB key removed from this browser.', key ? 'ok' : '');
      if (key) loadGenres();
    });
    els.validateKey.addEventListener('click', validateKey);
    els.fetchImages.addEventListener('click', fetchArtwork);

    els.mediaType.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      state.mediaType = button.dataset.value;
      [...els.mediaType.querySelectorAll('button')].forEach((node) => node.classList.toggle('active', node === button));
      saveState();
    });

    const rerender = debounce(renderPreview, 80);
    const renderInputs = [els.cardScale,els.cardGap,els.cornerRadius,els.artOpacity,els.rowAngle,els.offsetX,els.offsetY,els.overlayPreset,els.overlayOpacity,els.gradientCoverage,els.showTitle,els.titleText,els.fontFamily,els.textPosition,els.fontSize,els.textColor,els.textShadow];
    renderInputs.forEach((input) => {
      const eventName = input.type === 'range' || input.type === 'text' || input.type === 'color' ? 'input' : 'change';
      input.addEventListener(eventName, () => {
        updateTextControls();
        updateOutputs();
        rerender();
      });
    });

    [els.imageCount,els.sourceList,els.genre,els.decade,els.language,els.artworkShape].forEach((input) => {
      input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
        updateOutputs();
        syncStateFromControls();
        saveState();
      });
    });

    document.querySelectorAll('[data-reset]').forEach((button) => button.addEventListener('click', () => resetSection(button.dataset.reset)));
    els.shuffleImages.addEventListener('click', () => {
      state.items = shuffle(state.items);
      saveState();
      renderPreview();
    });
    els.clearCanvas.addEventListener('click', clearCanvas);
    els.downloadBackdrop.addEventListener('click', downloadBackdrop);
    els.resolution.addEventListener('change', () => { state.resolution = els.resolution.value; saveState(); });
  }

  async function init() {
    ids.forEach((id) => { els[id] = $(id); });
    if (!els.backdropCanvas) return;
    els.tmdbKey.value = getSavedKey();
    syncControlsFromState();
    bindEvents();
    updatePreviewUi();
    if (els.tmdbKey.value) {
      setStatus(els.keyStatus, 'TMDB key loaded from this browser.', 'ok');
      loadGenres();
    }
    if (state.items.length) {
      setStatus(els.sourceStatus, `Restored ${state.items.length} locally saved images without another TMDB request.`, 'ok');
      await renderPreview();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
