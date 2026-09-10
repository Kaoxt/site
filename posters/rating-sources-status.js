(() => {
  'use strict';

  const applyRatingSourceStatus = () => {
    const select = document.getElementById('ratingSource');
    if (!select) return false;

    const labels = {
      average: 'Score (average) · TMDB',
      score: 'Score · TMDB',
      imdb: 'IMDb Rating · Live',
      tmdb: 'TMDB Rating · Live',
      letterboxd: 'Letterboxd · Coming soon',
      mal: 'MyAnimeList · Coming soon',
      rogerebert: 'RogerEbert · Coming soon',
      tomatometer: 'Tomatometer · Coming soon',
      popcornmeter: 'Popcornmeter · Coming soon',
    };

    const upcoming = new Set(['letterboxd', 'mal', 'rogerebert', 'tomatometer', 'popcornmeter']);

    [...select.options].forEach((option) => {
      if (labels[option.value]) option.textContent = labels[option.value];
      option.disabled = upcoming.has(option.value);
    });

    const row = select.closest('.rating-source-row');
    const note = row?.querySelector('.rating-source-copy small');
    if (note) {
      note.textContent = 'IMDb and TMDB are live. Other providers stay disabled until a reliable source is connected.';
    }

    return true;
  };

  if (!applyRatingSourceStatus()) {
    const observer = new MutationObserver(() => {
      if (applyRatingSourceStatus()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
