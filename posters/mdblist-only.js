(() => {
  'use strict';

  const CONNECTIONS_KEY = 'kollection-posters-connections-v1';

  function keepMdblistOnlyState() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}') || {};
      if ('traktConnected' in saved) {
        delete saved.traktConnected;
        localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(saved));
      }
    } catch {}
  }

  function simplifyConnectionStep() {
    const step = document.getElementById('postersConnectionStep');
    if (!step) return;

    step.setAttribute('aria-label', 'Connect MDBList');
    step.querySelector('[data-connection="trakt"]')?.remove();

    const title = step.querySelector('.config-routebar strong');
    if (title) title.textContent = 'Connect MDBList';

    const intro = step.querySelector('.connection-intro p');
    if (intro) intro.textContent = 'Add your MDBList API key to use your own lists, or continue with public MDBList lists.';
  }

  function stripTraktFromGeneratedJson() {
    const output = document.getElementById('jsonOutput');
    if (!output?.textContent.trim()) return;
    try {
      const data = JSON.parse(output.textContent);
      const containers = [data, data.config, data.kollectionPosters].filter((value) => value && typeof value === 'object');
      for (const container of containers) {
        if (container.catalogSelection?.connections && typeof container.catalogSelection.connections === 'object') {
          delete container.catalogSelection.connections.trakt;
        }
        if (Array.isArray(container.discoveredLists)) {
          container.discoveredLists = container.discoveredLists.filter((item) => String(item?.provider || '').toLowerCase() !== 'trakt');
        }
      }
      const text = JSON.stringify(data, null, 2);
      output.textContent = text;
      output.dataset.generatedJson = text;
    } catch {}
  }

  keepMdblistOnlyState();
  simplifyConnectionStep();

  document.getElementById('generateBtn')?.addEventListener('click', () => setTimeout(stripTraktFromGeneratedJson, 1));
  document.getElementById('copyBtn')?.addEventListener('click', () => setTimeout(stripTraktFromGeneratedJson, 1));
  document.getElementById('downloadBtn')?.addEventListener('click', () => setTimeout(stripTraktFromGeneratedJson, 1));
})();
