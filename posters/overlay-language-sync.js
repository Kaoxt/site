(() => {
  'use strict';

  const refreshPreview = () => window.KollectionPosterPreview?.refresh?.({ hard: false });

  const language = document.getElementById('postersLanguage');
  if (language) {
    language.addEventListener('change', refreshPreview);
  }

  requestAnimationFrame(() => requestAnimationFrame(refreshPreview));
})();
