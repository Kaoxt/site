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

    const keyPanel = step.querySelector('#mdblistKeyPanel');
    const status = step.querySelector('#mdblistKeyStatus');
    if (keyPanel && status && !keyPanel.querySelector('.mdblist-get-key')) {
      const help = document.createElement('div');
      help.className = 'mdblist-key-help';
      help.innerHTML = '<a class="mdblist-get-key" href="https://mdblist.com/preferences/#api" target="_blank" rel="noopener noreferrer">Get an API key from MDBList ↗</a>';
      status.after(help);
    }

    if (!document.getElementById('mdblistOnlyStyles')) {
      const style = document.createElement('style');
      style.id = 'mdblistOnlyStyles';
      style.textContent = `
        .mdblist-key-help{margin-top:2px;grid-column:1/-1}
        .mdblist-get-key{display:inline-flex;align-items:center;gap:5px;color:#9ca1ff;font-size:12px;font-weight:700;text-decoration:none;line-height:1.4}
        .mdblist-get-key:hover,.mdblist-get-key:focus-visible{color:#bec1ff;text-decoration:underline;text-underline-offset:3px}
      `;
      document.head.appendChild(style);
    }
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
