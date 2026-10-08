(() => {
  'use strict';
  const form = document.getElementById('accountDisplayNameForm');
  if (!form) return;
  const field = form.elements.displayName, button = form.querySelector('button'), status = document.getElementById('accountDisplayNameStatus');
  const summary = document.getElementById('accountIdentityName'), settings = document.getElementById('accountIdentitySettings');
  let loaded = false, generation = 0;
  function showSavedName(name) { if (summary) summary.textContent = name || 'Nuvio profile name'; }
  function showQuota(data) {
    if (typeof data.changesRemaining !== 'number') return;
    const remaining = data.changesRemaining;
    document.getElementById('accountDisplayNameLimit').textContent = remaining > 0
      ? `First name is free · ${remaining} of 2 later changes available (rolling 60 days).`
      : `First name is free · 0 of 2 later changes available (rolling 60 days). Next change: ${new Date(data.nextChangeAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`;
  }
  async function request(options, version) {
    const response = await fetch('/api/account/preferences', { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json();
    if (version === generation) showQuota(data);
    if (!response.ok) throw new Error(data.error || 'Could not save your display name. Please try again.');
    return data;
  }
  function clear() {
    generation++; loaded = false; field.value = ''; field.disabled = button.disabled = true;
    field.removeAttribute('aria-invalid'); button.textContent = 'Save display name'; status.textContent = '';
    document.getElementById('accountDisplayNameLimit').textContent = 'First name is free · 2 later changes per rolling 60 days.';
    showSavedName(''); if (settings) settings.open = false;
  }
  async function load() {
    clear(); const version = generation;
    try { const data = await request(undefined, version); if (version !== generation) return; field.value = data.displayName || ''; showSavedName(data.displayName); status.textContent = ''; loaded = true; }
    catch (error) { if (version === generation) status.textContent = error.message; }
    finally { if (version === generation) field.disabled = button.disabled = !loaded; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded || button.disabled) return;
    status.textContent = ''; field.removeAttribute('aria-invalid');
    const name = field.value.trim();
    if (name.length > 50) { status.textContent = 'Display name must be 50 characters or fewer.'; field.setAttribute('aria-invalid', 'true'); field.focus(); return; }
    const version = generation;
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) }, version);
      if (version !== generation) return;
      field.value = data.displayName;
      showSavedName(data.displayName);
      status.textContent = data.displayName ? 'Display name saved. This name will appear across The Kollection.' : 'Display name cleared. Your selected Nuvio profile name will be used.';
      window.dispatchEvent(new CustomEvent('kollection:display-name-changed'));
    } catch (error) { if (version === generation) status.textContent = error.message; }
    finally { if (version === generation) { button.disabled = false; button.textContent = 'Save display name'; } }
  });
  window.addEventListener('kollection:nuvio-signed-in', load);
  window.addEventListener('kollection:nuvio-session-changed', load);
  window.addEventListener('kollection:nuvio-signed-out', clear);
  load();
})();
