(() => {
  'use strict';

  let busy = false;

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function empty(container, message = 'Create a setup and save it to your account to see it here.') {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'account-empty-state';
    const strong = document.createElement('strong');
    strong.textContent = 'No saved setups yet';
    const span = document.createElement('span');
    span.textContent = message;
    box.append(strong, span);
    container.appendChild(box);
  }

  function render(collections) {
    const container = document.getElementById('accountSavedCollections');
    if (!container) return;
    container.innerHTML = '';

    if (!collections.length) {
      empty(container);
      return;
    }

    for (const item of collections) {
      const row = document.createElement('article');
      row.className = 'account-saved-row';

      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name || 'My Kollection';
      const meta = document.createElement('small');
      const pieces = [];
      if (item.nuvioProfileName) pieces.push(item.nuvioProfileName);
      if (item.updatedAt) pieces.push(`Updated ${formatDate(item.updatedAt)}`);
      meta.textContent = pieces.join(' · ') || 'Saved configuration';
      copy.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'account-saved-actions';

      const resume = document.createElement('a');
      resume.className = 'account-secondary-button account-small-button';
      resume.href = `/set-up-collection?saved=${encodeURIComponent(item.id)}`;
      resume.textContent = 'Resume';

      const remove = document.createElement('button');
      remove.className = 'account-secondary-button account-small-button';
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete “${item.name || 'My Kollection'}”?`)) return;
        remove.disabled = true;
        try {
          await readJson(await fetch(`/api/account/collections/${encodeURIComponent(item.id)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            cache: 'no-store',
          }));
          await load();
        } catch (error) {
          const status = document.getElementById('accountSavedStatus');
          if (status) status.textContent = error?.message || 'Could not delete saved setup.';
          remove.disabled = false;
        }
      });

      actions.append(resume, remove);
      row.append(copy, actions);
      container.appendChild(row);
    }
  }

  async function load() {
    if (busy) return;
    const container = document.getElementById('accountSavedCollections');
    const status = document.getElementById('accountSavedStatus');
    if (!container) return;

    busy = true;
    if (status) status.textContent = 'Loading saved setups…';
    try {
      const session = await window.KollectionNuvioAuth?.getSession?.();
      if (!session?.authenticated) {
        container.innerHTML = '';
        if (status) status.textContent = '';
        return;
      }

      const data = await readJson(await fetch('/api/account/collections', {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      render(Array.isArray(data.collections) ? data.collections : []);
      if (status) status.textContent = data.collections?.length
        ? `${data.collections.length} saved setup${data.collections.length === 1 ? '' : 's'}.`
        : '';
    } catch (error) {
      empty(container, 'Saved collection storage needs the Cloudflare D1 database binding before it can be used.');
      if (status) status.textContent = error?.message || 'Could not load saved setups.';
    } finally {
      busy = false;
    }
  }

  function init() {
    load();
    window.addEventListener('kollection:nuvio-signed-in', load);
    window.addEventListener('kollection:nuvio-signed-out', () => {
      const container = document.getElementById('accountSavedCollections');
      const status = document.getElementById('accountSavedStatus');
      if (container) container.innerHTML = '';
      if (status) status.textContent = '';
    });
  }

  window.KollectionSavedCollections = Object.freeze({ load });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
