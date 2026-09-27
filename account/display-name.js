(() => {
  'use strict';
  const form = document.getElementById('accountDisplayNameForm');
  if (!form) return;
  const field = form.elements.displayName, button = form.querySelector('button'), status = document.getElementById('accountDisplayNameStatus');
  let loaded = false;
  async function request(options) {
    const response = await fetch('/api/account/preferences', { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your display name. Please try again.');
    return data;
  }
  async function load() {
    loaded = false; field.disabled = button.disabled = true;
    try { const data = await request(); field.value = data.displayName || ''; status.textContent = ''; loaded = true; }
    catch (error) { status.textContent = error.message; }
    finally { field.disabled = button.disabled = !loaded; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded || button.disabled) return;
    status.textContent = ''; field.removeAttribute('aria-invalid');
    const name = field.value.trim();
    if (name.length > 50) { status.textContent = 'Display name must be 50 characters or fewer.'; field.setAttribute('aria-invalid', 'true'); field.focus(); return; }
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
      field.value = data.displayName;
      status.textContent = data.displayName ? 'Display name saved. This name will appear across The Kollection.' : 'Display name cleared. Your selected Nuvio profile name will be used.';
      window.dispatchEvent(new CustomEvent('kollection:display-name-changed'));
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Save display name'; }
  });
  window.addEventListener('kollection:nuvio-signed-in', load);
  window.addEventListener('kollection:nuvio-signed-out', () => { loaded = false; field.value = ''; field.disabled = button.disabled = true; });
  load();
})();
