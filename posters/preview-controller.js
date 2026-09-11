(() => {
  'use strict';

  const posterMocks = [...document.querySelectorAll('.poster-mock')];
  if (!posterMocks.length) return;

  const style = document.createElement('style');
  style.textContent = `
    .poster-mock.preview-refreshing{overflow:hidden;background:#0d0f18}
    .poster-mock.preview-refreshing .poster-art,
    .poster-mock.preview-refreshing .overlay,
    .poster-mock.preview-refreshing .poster-service-image{visibility:hidden!important}
    .poster-mock.preview-refreshing::before{
      content:"";
      position:absolute;
      inset:0;
      z-index:7;
      background:
        radial-gradient(circle at 50% 38%,rgba(99,102,241,.24),transparent 42%),
        linear-gradient(145deg,rgba(67,56,202,.24),rgba(15,17,28,.96) 58%,rgba(49,46,129,.28));
    }
    .poster-mock.preview-refreshing::after{
      content:"";
      position:absolute;
      left:50%;
      top:50%;
      z-index:8;
      width:24px;
      height:24px;
      margin:-12px 0 0 -12px;
      border:3px solid rgba(255,255,255,.22);
      border-top-color:#8b8df8;
      border-radius:50%;
      animation:kollectionPosterSpin .7s linear infinite;
    }
    @keyframes kollectionPosterSpin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(style);

  let samples = [];
  let requestGeneration = 0;

  const selectedSource = () => document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';
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

  function refresh() {
    if (samples.length < 3) return;
    const generation = ++requestGeneration;
    const source = selectedSource();
    const tags = selectedTags();
    const ratingSource = selectedRatingSource();

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
        tags: tags.join(','),
        ratingSource,
        preview: '1',
        previewVersion: `overlay-scale-2-${source}`,
      });
      img.src = `/api/posters-v2/${sample.type}/${sample.id}.webp?${params.toString()}`;
    });
  }

  async function loadSamples() {
    setLoading();
    try {
      const response = await fetch('/api/posters-preview-samples?previewVersion=2', {
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

  document.querySelectorAll('input[name="posterSource"], .tag-option input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      setLoading();
      queueMicrotask(refresh);
    });
  });
  document.getElementById('ratingSource')?.addEventListener('change', () => {
    setLoading();
    queueMicrotask(refresh);
  });

  loadSamples();
})();