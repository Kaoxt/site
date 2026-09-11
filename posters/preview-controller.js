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
      border-radius:50%;
      border:5px solid rgba(99,102,241,.18);
      border-top-color:#7c83ff;
      border-right-color:#6366f1;
      box-sizing:border-box;
      animation:kollectionPosterSpin .72s linear infinite;
    }
    @keyframes kollectionPosterSpin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.poster-mock.preview-refreshing::after{animation-duration:1.35s}}
  `;
  document.head.appendChild(style);

  let samples = [];
  let requestGeneration = 0;

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
  const selectedProvider = () => document.getElementById('artworkProvider')?.value || 'tmdb';
  const selectedRatingSource = () => document.getElementById('ratingSource')?.value || 'average';
  const selectedTags = () => [...document.querySelectorAll('.tag-option input[type="checkbox"]:checked')].map((input) => input.value);

  function setLoading() {
    posterMocks.forEach((posterMock) => {
      posterMock.classList.remove('service-live');
      posterMock.classList.add('preview-refreshing');
      const img = posterMock.querySelector('.poster-service-image');
      if (img) img.hidden = false;
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

  function refresh() {
    if (samples.length < 3) return;
    const generation = ++requestGeneration;
    const source = selectedSource();
    const provider = selectedProvider();
    const tags = selectedTags();
    const ratingSource = selectedRatingSource();

    updateDescription();

    posterMocks.forEach((posterMock, index) => {
      const img = posterMock.querySelector('.poster-service-image');
      const sample = samples[index];
      if (!img || !sample) return;

      posterMock.classList.remove('service-live');
      posterMock.classList.add('preview-refreshing');
      img.hidden = false;

      const onLoad = () => {
        if (generation !== requestGeneration) return;
        posterMock.classList.remove('preview-refreshing', 'service-loading');
        posterMock.classList.add('service-live');
        img.style.visibility = '';
      };
      const onError = () => {
        if (generation !== requestGeneration) return;
        posterMock.classList.remove('preview-refreshing', 'service-loading', 'service-live');
        img.hidden = true;
      };

      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });

      const params = new URLSearchParams({
        source,
        provider,
        tags: tags.join(','),
        ratingSource,
        preview: '1',
        previewVersion: `poster-controls-2-${source}-${provider}`,
      });
      img.src = `/api/posters-v2/${sample.type}/${sample.id}.webp?${params.toString()}`;
    });
  }

  async function loadSamples() {
    setLoading();
    try {
      const response = await fetch('/api/posters-preview-samples?previewVersion=4', {
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
    refresh();
  }

  window.KollectionPosterPreview = { refresh, setLoading, updateDescription };

  document.querySelectorAll('input[name="posterSource"], .tag-option input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      setLoading();
      queueMicrotask(refresh);
    });
  });
  document.getElementById('artworkProvider')?.addEventListener('change', () => {
    setLoading();
    queueMicrotask(refresh);
  });
  document.getElementById('ratingSource')?.addEventListener('change', () => {
    setLoading();
    queueMicrotask(refresh);
  });

  loadSamples();
})();