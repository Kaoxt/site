(() => {
  'use strict';
  if (window.KollectionNavLoginRedirect) return;
  function init() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest?.('[data-nuvio-signin-desktop],[data-nuvio-signin-mobile]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = '/account';
    }, true);
  }
  window.KollectionNavLoginRedirect = Object.freeze({ init });
})();