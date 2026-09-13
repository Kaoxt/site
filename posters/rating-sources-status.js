(() => {
  'use strict';

  const applyRatingSourceStatus = () => {
    const select = document.getElementById('ratingSource');
    if (!select) return false;

    const labels = {
      average: 'Average',
      score: 'Score',
      imdb: 'IMDb',
      tmdb: 'TMDB',
      letterboxd: 'Letterboxd',
      mal: 'MyAnimeList',
      rogerebert: 'Roger Ebert',
      tomatometer: 'Tomatometer',
      popcornmeter: 'Popcornmeter',
    };

    const upcoming = new Set();

    [...select.options].forEach((option) => {
      if (labels[option.value]) option.textContent = labels[option.value];
      option.disabled = upcoming.has(option.value);
    });

    const imdbOption = [...select.options].find(option => option.value === 'imdb');
    const averageOption = [...select.options].find(option => option.value === 'average');
    if (imdbOption && averageOption) averageOption.after(imdbOption);

    const row = select.closest('.rating-source-row');
    const note = row?.querySelector('.rating-source-copy small');
    if (note) {
      note.textContent = 'Ratings are supplied by MDBList and cached to reduce API usage.';
    }

    return true;
  };

  const syncPosterControlUi = () => {
    const trend = document.querySelector('.tag-option input[value="trend"]');
    const rating = document.querySelector('.tag-option input[value="rating"]');
    const quality = document.querySelector('.tag-option input[value="quality"]');
    const source = document.querySelector('input[name="posterSource"]:checked')?.value || 'smart';

    if (trend) {
      trend.disabled = false;
      trend.closest('.tag-option')?.classList.remove('is-forced');
    }

    document.querySelectorAll('#posterSourceChoices .choice-card').forEach((card) => {
      card.classList.toggle('selected', Boolean(card.querySelector('input[name="posterSource"]')?.checked));
    });

    const ratingRow = document.querySelector('.rating-source-row');
    if (ratingRow) ratingRow.hidden = !rating?.checked;

    document.querySelectorAll('.poster-mock').forEach((posterMock) => {
      posterMock.classList.toggle('smart-layout', source === 'smart');
      posterMock.classList.toggle('quality-on', Boolean(quality?.checked));
      posterMock.querySelectorAll('[data-tag]').forEach((badge) => {
        const input = document.querySelector(`.tag-option input[value="${badge.dataset.tag}"]`);
        badge.classList.toggle('tag-hidden', !input?.checked);
      });
    });
  };

  const isPosterControl = (target) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches(
      'input[name="posterSource"], .tag-option input[type="checkbox"], #ratingSource, #artworkProvider'
    );
  };

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!isPosterControl(target)) return;

    event.stopImmediatePropagation();
    syncPosterControlUi();
    document.dispatchEvent(new Event('kollection:poster-settings-changed'));

    const preview = window.KollectionPosterPreview;
    preview?.setLoading?.();
    queueMicrotask(() => {
      syncPosterControlUi();
      preview?.refresh?.();
    });
  }, true);

  const initialize = () => {
    applyRatingSourceStatus();
    syncPosterControlUi();
  };

  if (!applyRatingSourceStatus()) {
    const observer = new MutationObserver(() => {
      if (applyRatingSourceStatus()) {
        syncPosterControlUi();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    initialize();
  }
})();