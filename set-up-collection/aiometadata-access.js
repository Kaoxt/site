(() => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Retain only access metadata. Never retain passwords or compressed install URLs.
  function normalize(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry, index) => {
      try {
        const host = new URL(entry.host);
        if (!['https:', 'http:'].includes(host.protocol) || host.username || host.password) return [];
        host.search = '';
        host.hash = '';
        host.pathname = host.pathname.replace(/\/+$/, '') + '/';
        let uuid = String(entry.uuid || entry.userUUID || '');
        if (!UUID.test(uuid) && entry.url) {
          const install = new URL(entry.url);
          if (install.origin === host.origin) uuid = install.pathname.match(/\/stremio\/([^/]+)/)?.[1] || '';
        }
        if (!UUID.test(uuid)) return [];
        return [{
          uuid, host: host.href,
          configureUrl: new URL(`stremio/${uuid}/configure`, host).href,
          name: String(entry.name || `AIOMetadata ${index + 1}`).slice(0, 120),
          userChosenPassword: entry.userChosenPassword === true,
        }];
      } catch { return []; }
    });
  }

  function markup(entries, { legacy = false } = {}) {
    const configs = normalize(entries);
    if (!configs.length) return legacy
      ? '<p class="aio-access-note">This older setup has no saved AIOMetadata login details. Use Update Existing to create a replacement with a password you choose.</p>' : '';
    return `<section class="aio-access" aria-label="AIOMetadata settings">
      <h3>AIOMetadata settings</h3>
      <p>Open your configuration and sign in with its UUID and the AIOMetadata password you chose during setup. This is separate from your Nuvio password.</p>
      ${configs.map((item, index) => `<div class="aio-access-config">
        <strong>${esc(configs.length > 1 ? `AIOMetadata ${index + 1}` : 'AIOMetadata')}</strong>
        <span class="aio-access-host">${esc(item.host)}</span>
        <span class="aio-access-label">UUID</span><code>${esc(item.uuid)}</code>
        <div class="aio-access-actions"><button type="button" data-aio-copy-uuid="${esc(item.uuid)}" aria-label="Copy UUID for AIOMetadata ${index + 1}">Copy UUID</button><a href="${esc(item.configureUrl)}" target="_blank" rel="noopener noreferrer">Edit AIOMetadata settings</a></div>
        ${item.userChosenPassword ? '' : '<p class="aio-access-note">The password for this older installation was not saved. Use Update Existing to create a replacement with a password you know.</p>'}
      </div>`).join('')}
      <p class="aio-access-note">If you change catalogs or search settings, follow AIOMetadata’s reinstall instructions. Before using Update Existing on Kollection, export your edited AIOMetadata JSON and choose Use my JSON file to carry those changes into the replacement.</p>
      <span class="aio-access-status" role="status" aria-live="polite"></span>
    </section>`;
  }

  async function copyUuid(button) {
    const uuid = button?.dataset?.aioCopyUuid;
    if (!UUID.test(uuid || '')) return;
    const status = button.closest('.aio-access')?.querySelector('.aio-access-status');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(uuid);
      if (status) status.textContent = 'UUID copied.';
    } catch {
      // iOS and browsers without clipboard permission can copy the selected text.
      const code = button.closest('.aio-access-config')?.querySelector('code');
      if (code && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (status) status.textContent = 'Select and copy the UUID shown above.';
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-aio-copy-uuid]');
    if (button) copyUuid(button);
  });
  window.KollectionAioAccess = Object.freeze({ normalize, markup, copyUuid });
})();
