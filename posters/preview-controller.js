(() => {
  'use strict';

  const posterMocks = [...document.querySelectorAll('.poster-mock')];
  if (!posterMocks.length) return;

  const style = document.createElement('style');
  style.textContent = `
    @import url('/posters/provider.css?v=20260910-1');
    .poster-mock.preview-refreshing{overflow:hidden;background:#050608}
    .poster-mock.preview-refreshing .poster-art,
    .poster-mock.preview-refreshing .overlay,
    .poster-mock.preview-refreshing .poster-service-image{visibility:hidden!important}
    .poster-mock.preview-refreshing::before{
      content:"";
      position:absolute;
      inset:0;
      z-index:7;
      background:#050608;
    }
    .poster-mock.preview-refreshing::after{
      content:"";
      position:absolute;
      left:50%;
      top:50%;
      z-index:8;
      width:54px;
      height:54px;
      margin:-27px 0 0 -27px;
      border:5px solid rgba(99,102,241,.18);
      border-top-color:#7c83ff;
      border-right-color:#6366f1;
      border-radius:50%;
      box-sizing:border-box;
      animation:kollectionPosterSpin .72s linear infinite;
    }
    .poster-mock.preview-updating::after{
      content:"";
      position:absolute;
      right:10px;
      bottom:10px;
      z-index:8;
      width:18px;
      height:18px;
      border:3px solid rgba(99,102,241,.2);
      border-top-color:#7c83ff;
      border-radius:50%;
      box-sizing:border-box;
      animation:kollectionPosterSpin .72s linear infinite;
      pointer-events:none;
    }
    @keyframes kollectionPosterSpin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.poster-mock.preview-refreshing::after,.poster-mock.preview-updating::after{animation-duration:1.35s}}
  `;
  document.head.appendChild(style);

  let samples = [];
  let requestGeneration = 0;

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedProvider = () => document.getElementById('artworkProvider')?.value || 'tmdb';
  const selectedRatingSource = () => document.getElementById('ratingSource')?.value || 'average';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);

  function syncUiState() {
    const trend = document.querySelector('.tag-option input[value="trend"]');
    if (trend) {
      trend.disabled = false;
      trend.closest('.tag-option')?.classList.remove('is-forced');
    }

    document.querySelectorAll('input[name="posterSource"]').forEach((input) => {
      input.closest('.choice-card')?.classList.toggle('selected', input.checked);
    });

    const rating = document.querySelector('.tag-option input[value="rating"]');
    const row = document.querySelector('.rating-source-row');
    if (row) row.hidden = !rating?.checked;
  }

  function setLoading() {
    posterMocks.forEach((posterMock) => {
      posterMock.classList.remove('service-live', 'service-loading', 'preview-updating');
      posterMock.classList.add('preview-refreshing');
      const img = posterMock.querySelector('.poster-service-image');
      if (img) img.hidden = false;
    });
  }

  function setUpdating() {
    posterMocks.forEach((posterMock) => {
      posterMock.classList.remove('preview-refreshing', 'service-loading');
      if (posterMock.classList.contains('service-live')) posterMock.classList.add('preview-updating');
    });
  }

  function updateDescription() {
    const source = selectedSource();
    const provider = selectedProvider();
    const tags = selectedTags();
    const providerLabel = provider === 'tmdb' ? 'TMDB' : provider;
    const styleLabel = source === 'smart' ? 'Smart Posters' : 'Original Posters';
    const description = document.getElementById('previewDescription');
    if (description) {
      description.textContent = `${styleLabel} using ${providerLabel} artwork. ${tags.length} Smart Tag${tags.length === 1 ? '' : 's'} enabled.`;
    }
  }

  function refresh({ hard = false } = {}) {
    syncUiState();
    if (samples.length < 3) return;

    const generation = ++requestGeneration;
    const source = selectedSource();
    const provider = selectedProvider();
    const tags = selectedTags();
    const ratingSource = selectedRatingSource();

    updateDescription();

    posterMocks.forEach((posterMock, index) => {
      const currentImg = posterMock.querySelector('.poster-service-image');
      const sample = samples[index];
      if (!currentImg || !sample) return;

      if (hard || !posterMock.classList.contains('service-live')) {
        posterMock.classList.remove('service-live', 'service-loading', 'preview-updating');
        posterMock.classList.add('preview-refreshing');
      } else {
        posterMock.classList.remove('preview-refreshing', 'service-loading');
        posterMock.classList.add('preview-updating');
      }

      const nextImg = new Image();
      nextImg.className = 'poster-service-image';
      nextImg.alt = currentImg.alt || 'Live poster preview';
      nextImg.decoding = 'async';

      const params = new URLSearchParams({
        source,
        provider,
        tags: tags.join(','),
        ratingSource,
        preview: '1',
        previewVersion: `bp-match-6-${source}-${provider}-${tags.join('-') || 'none'}-${ratingSource}`,
      });

      nextImg.addEventListener('load', () => {
        if (generation !== requestGeneration) return;
        currentImg.replaceWith(nextImg);
        nextImg.hidden = false;
        nextImg.style.visibility = '';
        posterMock.classList.remove('preview-refreshing', 'preview-updating', 'service-loading');
        posterMock.classList.add('service-live');
      }, { once: true });

      nextImg.addEventListener('error', () => {
        if (generation !== requestGeneration) return;
        posterMock.classList.remove('preview-refreshing', 'preview-updating', 'service-loading');
      }, { once: true });

      nextImg.src = `/api/posters-v2/${sample.type}/${sample.id}.webp?${params.toString()}`;
    });
  }

  async function loadSamples() {
    syncUiState();
    setLoading();
    try {
      const response = await fetch('/api/posters-preview-samples?previewVersion=5', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.samples) && data.samples.length >= 3) {
          samples = data.samples.slice(0, 3);
        }
      }
    } catch {}

    if (samples.length < 3) {
      samples = [
        { type: 'movie', id: '27205' },
        { type: 'movie', id: '155' },
        { type: 'tv', id: '1399' },
      ];
    }
    refresh({ hard: true });
  }

  window.KollectionPosterPreview = { refresh, setLoading, setUpdating, updateDescription };

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const relevant = target.matches('input[name="posterSource"], .tag-option input[type="checkbox"], #artworkProvider, #ratingSource');
    if (!relevant) return;

    event.stopImmediatePropagation();
    syncUiState();

    const hardChange = target.matches('input[name="posterSource"], #artworkProvider');
    if (hardChange) setLoading();
    else setUpdating();

    queueMicrotask(() => refresh({ hard: hardChange }));
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-usage]');
    if (!button) return;
    setTimeout(() => {
      syncUiState();
      setLoading();
      refresh({ hard: true });
    }, 0);
  }, true);

  loadSamples();
})();
