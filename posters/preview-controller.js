(() => {
  'use strict';

  const posterMocks = [...document.querySelectorAll('.poster-mock')];
  if (!posterMocks.length) return;

  const TODAY_LABELS = {
    en: 'Today', es: 'Hoy', fr: 'Aujourd’hui', de: 'Heute', it: 'Oggi', pt: 'Hoje', ja: '今日', ko: '오늘',
  };
  const GENRE_TRANSLATIONS = {
    es: { Action:'Acción', Adventure:'Aventura', Animation:'Animación', Comedy:'Comedia', Crime:'Crimen', Documentary:'Documental', Drama:'Drama', Family:'Familia', Fantasy:'Fantasía', History:'Historia', Horror:'Terror', Music:'Música', Mystery:'Misterio', Romance:'Romance', 'Science Fiction':'Ciencia ficción', 'Sci-Fi':'Ciencia ficción', Thriller:'Suspenso', War:'Guerra', Western:'Western' },
    fr: { Action:'Action', Adventure:'Aventure', Animation:'Animation', Comedy:'Comédie', Crime:'Crime', Documentary:'Documentaire', Drama:'Drame', Family:'Familial', Fantasy:'Fantastique', History:'Histoire', Horror:'Horreur', Music:'Musique', Mystery:'Mystère', Romance:'Romance', 'Science Fiction':'Science-fiction', 'Sci-Fi':'Science-fiction', Thriller:'Thriller', War:'Guerre', Western:'Western' },
    de: { Action:'Action', Adventure:'Abenteuer', Animation:'Animation', Comedy:'Komödie', Crime:'Krimi', Documentary:'Dokumentation', Drama:'Drama', Family:'Familie', Fantasy:'Fantasy', History:'Historie', Horror:'Horror', Music:'Musik', Mystery:'Mystery', Romance:'Romanze', 'Science Fiction':'Science-Fiction', 'Sci-Fi':'Science-Fiction', Thriller:'Thriller', War:'Krieg', Western:'Western' },
    it: { Action:'Azione', Adventure:'Avventura', Animation:'Animazione', Comedy:'Commedia', Crime:'Crime', Documentary:'Documentario', Drama:'Dramma', Family:'Famiglia', Fantasy:'Fantasy', History:'Storia', Horror:'Horror', Music:'Musica', Mystery:'Mistero', Romance:'Romance', 'Science Fiction':'Fantascienza', 'Sci-Fi':'Fantascienza', Thriller:'Thriller', War:'Guerra', Western:'Western' },
    pt: { Action:'Ação', Adventure:'Aventura', Animation:'Animação', Comedy:'Comédia', Crime:'Crime', Documentary:'Documentário', Drama:'Drama', Family:'Família', Fantasy:'Fantasia', History:'História', Horror:'Terror', Music:'Música', Mystery:'Mistério', Romance:'Romance', 'Science Fiction':'Ficção científica', 'Sci-Fi':'Ficção científica', Thriller:'Suspense', War:'Guerra', Western:'Faroeste' },
    ja: { Action:'アクション', Adventure:'アドベンチャー', Animation:'アニメーション', Comedy:'コメディ', Crime:'犯罪', Documentary:'ドキュメンタリー', Drama:'ドラマ', Family:'ファミリー', Fantasy:'ファンタジー', History:'歴史', Horror:'ホラー', Music:'音楽', Mystery:'ミステリー', Romance:'ロマンス', 'Science Fiction':'SF', 'Sci-Fi':'SF', Thriller:'スリラー', War:'戦争', Western:'西部劇' },
    ko: { Action:'액션', Adventure:'모험', Animation:'애니메이션', Comedy:'코미디', Crime:'범죄', Documentary:'다큐멘터리', Drama:'드라마', Family:'가족', Fantasy:'판타지', History:'역사', Horror:'공포', Music:'음악', Mystery:'미스터리', Romance:'로맨스', 'Science Fiction':'SF', 'Sci-Fi':'SF', Thriller:'스릴러', War:'전쟁', Western:'서부' },
  };

  const style = document.createElement('style');
  style.textContent = `
    @import url('/posters/provider.css?v=20260910-1');

    .poster-mock .overlay{display:none!important}
    .poster-mock{isolation:isolate}
    .poster-service-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1}

    .poster-mock.preview-refreshing{overflow:hidden;background:#050608}
    .poster-mock.preview-refreshing .poster-art,
    .poster-mock.preview-refreshing .poster-service-image,
    .poster-mock.preview-refreshing .client-preview-layer{visibility:hidden!important}
    .poster-mock.preview-refreshing::before{
      content:"";
      position:absolute;inset:0;z-index:7;
      background:
        radial-gradient(circle at 50% 42%,rgba(99,102,241,.28),transparent 42%),
        linear-gradient(110deg,#151622 8%,#22233b 30%,#5b5ce2 46%,#272847 60%,#151622 84%);
      background-size:220% 100%;
      animation:posterPreviewPulse 1.25s ease-in-out infinite;
    }
    .poster-mock.preview-refreshing::after{
      content:"Loading preview…";
      position:absolute;left:50%;top:50%;z-index:8;
      transform:translate(-50%,-50%);
      width:max-content;max-width:85%;padding:8px 12px;
      border:1px solid rgba(165,180,252,.38);border-radius:9px;
      background:rgba(38,39,78,.82);color:#eef0ff;
      box-shadow:0 8px 28px rgba(45,46,110,.34);
      font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
    }
    @keyframes posterPreviewPulse{0%{background-position:0 0}100%{background-position:100% 0}}

    .client-preview-layer{position:absolute;inset:0;z-index:5;pointer-events:none}
    .client-preview-layer [hidden]{display:none!important}
    .client-preview-top{position:absolute;top:0;left:0;right:0;height:29px;width:100%;pointer-events:none}
    .client-preview-top .client-preview-trend,.client-preview-top .client-preview-quality{position:absolute;top:0}
    .client-preview-top.center-layout .client-preview-trend{left:50%;transform:translateX(-50%)}
    .client-preview-top.split-layout .client-preview-trend{left:10px;transform:none}
    .client-preview-top.split-layout .client-preview-quality{right:10px}
    .client-preview-tag{display:inline-flex;align-items:center;justify-content:center;height:29px;min-height:29px;padding:0 11px;border-radius:0 0 6px 6px;background:rgba(18,18,20,.78);color:#fff;font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:clamp(11px,1.65vw,16px);font-weight:700;line-height:1;letter-spacing:-.015em;white-space:nowrap;text-shadow:0 2px 6px rgba(0,0,0,.72);backdrop-filter:blur(4px);box-sizing:border-box}
    .client-preview-quality{font-size:clamp(10px,1.45vw,14px);min-width:42px}
    .client-preview-age{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);padding:5px 8px;border-radius:7px;background:rgba(15,16,20,.66);color:#fff;font-size:clamp(8px,1.25vw,12px);font-weight:750;text-shadow:0 2px 5px rgba(0,0,0,.8)}
    .client-preview-bottom{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);width:calc(100% - 16px);color:#dedee2;text-align:center;font-size:clamp(15px,2.25vw,23px);font-weight:700;line-height:1.05;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 2px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.95),0 0 16px rgba(0,0,0,.7)}

    @media(max-width:700px){.client-preview-top{height:27px}.client-preview-top.split-layout .client-preview-trend{left:7px}.client-preview-top.split-layout .client-preview-quality{right:7px}.client-preview-tag{height:27px;min-height:27px;padding:0 8px;border-radius:0 0 6px 6px}.client-preview-bottom{bottom:7px;width:calc(100% - 12px)}}
    @media(max-width:520px){.client-preview-top{height:25px}.client-preview-tag{height:25px;min-height:25px;padding:0 7px;font-size:clamp(10px,3.2vw,13px)}.client-preview-bottom{bottom:6px}}
    @media(prefers-reduced-motion:reduce){.poster-mock.preview-refreshing::before{animation:none}}
  `;
  document.head.appendChild(style);

  let samples = [];
  let started = false;
  let requestGeneration = 0;
  let currentBaseKey = '';

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedProvider = () => document.getElementById('artworkProvider')?.value || 'tmdb';
  const selectedRatingSource = () => document.getElementById('ratingSource')?.value || 'average';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);
  const selectedOverlayLanguage = () => document.getElementById('postersLanguage')?.value || 'en';

  function localizeTrend(value, index, language) {
    const match = String(value || '').match(/#\s*(\d+)/);
    const rank = match?.[1] || String(index + 1);
    return `#${rank} ${TODAY_LABELS[language] || TODAY_LABELS.en}`;
  }

  function localizeGenre(value, language) {
    const text = String(value || '').trim();
    if (!text || language === 'en') return text;
    return GENRE_TRANSLATIONS[language]?.[text] || text;
  }

  function sampleFor(index) {
    return samples[index] || [
      { trend:'#1 Today', rating:'6.8', genre:'Drama', age:'PG-13', quality:'4K' },
      { trend:'#2 Today', rating:'5.2', genre:'Comedy', age:'PG-13', quality:'4K' },
      { trend:'#1 Today', rating:'7.4', genre:'Drama', age:'TV-14', quality:'4K' },
    ][index] || {};
  }

  function ensureClientLayer(posterMock) {
    let layer = posterMock.querySelector('.client-preview-layer');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'client-preview-layer';
    layer.innerHTML = `<div class="client-preview-top"><span class="client-preview-tag client-preview-trend"></span><span class="client-preview-tag client-preview-quality"></span></div><span class="client-preview-age"></span><div class="client-preview-bottom"></div>`;
    posterMock.appendChild(layer);
    return layer;
  }

  function ratingText(sample) {
    const value = String(sample?.rating || '').trim();
    if (!value) return '';
    return `★ ${value}`;
  }

  function updateClientOverlays() {
    const tags = new Set(selectedTags());
    const language = selectedOverlayLanguage();
    posterMocks.forEach((posterMock, index) => {
      const sample = sampleFor(index);
      const layer = ensureClientLayer(posterMock);
      const top = layer.querySelector('.client-preview-top');
      const trend = layer.querySelector('.client-preview-trend');
      const quality = layer.querySelector('.client-preview-quality');
      const age = layer.querySelector('.client-preview-age');
      const bottom = layer.querySelector('.client-preview-bottom');

      const qualityOn = tags.has('quality');
      top.classList.toggle('split-layout', qualityOn);
      top.classList.toggle('center-layout', !qualityOn);

      trend.textContent = localizeTrend(sample.trend, index, language);
      trend.hidden = !tags.has('trend');
      trend.style.display = tags.has('trend') ? '' : 'none';

      quality.textContent = sample.quality || '4K';
      quality.hidden = !qualityOn;
      quality.style.display = qualityOn ? '' : 'none';

      age.textContent = sample.age || (sample.type === 'tv' ? 'TV-14' : 'PG-13');
      age.hidden = !tags.has('age');
      age.style.display = tags.has('age') ? '' : 'none';

      const bottomParts = [];
      if (tags.has('genre') && sample.genre) bottomParts.push(localizeGenre(sample.genre, language));
      if (tags.has('rating')) {
        const rating = ratingText(sample);
        if (rating) bottomParts.push(rating);
      }
      bottom.textContent = bottomParts.join(' · ');
      bottom.hidden = bottomParts.length === 0;
    });

    const description = document.getElementById('previewDescription');
    if (description) {
      const source = selectedSource() === 'smart' ? 'Smart Posters' : 'Original Posters';
      const provider = selectedProvider().toUpperCase();
      const count = selectedTags().length;
      description.textContent = `${source} using ${provider} artwork. ${count} Smart Tag${count === 1 ? '' : 's'} enabled. Preview tags render locally to reduce server usage.`;
    }
  }

  function syncUiState() {
    document.querySelectorAll('input[name="posterSource"]').forEach((input) => input.closest('.choice-card')?.classList.toggle('selected', input.checked));
    const rating = document.querySelector('.tag-option input[value="rating"]');
    const row = document.querySelector('.rating-source-row');
    if (row) row.hidden = !rating?.checked;
    updateClientOverlays();
  }

  function ensureServiceImage(posterMock) {
    let img = posterMock.querySelector('.poster-service-image');
    if (!img) {
      img = document.createElement('img');
      img.className = 'poster-service-image';
      img.alt = 'Poster preview artwork';
      img.decoding = 'async';
      posterMock.prepend(img);
    }
    return img;
  }

  async function loadBasePreviews({ force = false } = {}) {
    if (samples.length < 3) return;
    const source = selectedSource();
    const provider = selectedProvider();
    const baseKey = `${source}:${provider}`;
    if (!force && baseKey === currentBaseKey && posterMocks.every((mock) => mock.classList.contains('service-live'))) {
      updateClientOverlays();
      return;
    }
    currentBaseKey = baseKey;
    const generation = ++requestGeneration;

    await Promise.all(posterMocks.map((posterMock, index) => new Promise((resolve) => {
      const sample = samples[index];
      if (!sample) return resolve();
      const currentImg = ensureServiceImage(posterMock);
      posterMock.classList.remove('service-live', 'service-loading');
      posterMock.classList.add('preview-refreshing');
      const nextImg = new Image();
      nextImg.className = 'poster-service-image';
      nextImg.alt = currentImg.alt || 'Poster preview artwork';
      nextImg.decoding = 'async';
      const params = new URLSearchParams({ source, provider, tags: 'none', preview: '1', previewVersion: `client-base-3-${source}-${provider}` });
      nextImg.addEventListener('load', () => {
        if (generation !== requestGeneration) return resolve();
        currentImg.replaceWith(nextImg);
        posterMock.classList.remove('preview-refreshing', 'service-loading');
        posterMock.classList.add('service-live');
        updateClientOverlays();
        resolve();
      }, { once: true });
      nextImg.addEventListener('error', () => {
        if (generation === requestGeneration) posterMock.classList.remove('preview-refreshing', 'service-loading');
        resolve();
      }, { once: true });
      nextImg.src = `/api/posters-v2/${sample.type}/${sample.id}.webp?${params.toString()}`;
    })));
  }

  async function loadSamples() {
    try {
      const response = await fetch('/api/posters-preview-samples?previewVersion=client-2', { headers: { accept: 'application/json' }, cache: 'default' });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.samples) && data.samples.length >= 3) samples = data.samples.slice(0, 3);
      }
    } catch {}
    if (samples.length < 3) {
      samples = [
        { type:'movie', id:'27205', trend:'#1 Today', rating:'6.8', genre:'Drama', age:'PG-13', quality:'4K' },
        { type:'movie', id:'155', trend:'#2 Today', rating:'8.5', genre:'Crime', age:'PG-13', quality:'4K' },
        { type:'tv', id:'1399', trend:'#1 Today', rating:'9.2', genre:'Drama', age:'TV-MA', quality:'4K' },
      ];
    }
  }

  async function ensureStarted() {
    if (started) { updateClientOverlays(); return; }
    started = true;
    syncUiState();
    await loadSamples();
    updateClientOverlays();
    await loadBasePreviews({ force: true });
  }

  window.KollectionPosterPreview = {
    ensureStarted,
    refresh: ({ hard = false } = {}) => hard ? loadBasePreviews({ force: true }) : updateClientOverlays(),
    updateDescription: updateClientOverlays,
  };

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const isBaseChange = target.matches('input[name="posterSource"], #artworkProvider');
    const isOverlayChange = target.matches('.tag-option input[type="checkbox"], #ratingSource, #postersLanguage');
    if (!isBaseChange && !isOverlayChange) return;
    syncUiState();
    if (!started) return;
    if (isBaseChange) loadBasePreviews({ force: false });
    else updateClientOverlays();
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-usage]');
    if (!button) return;
    setTimeout(() => ensureStarted(), 0);
  }, true);

  syncUiState();
  if (!document.getElementById('postersConfigurator')?.hidden) ensureStarted();
})();
