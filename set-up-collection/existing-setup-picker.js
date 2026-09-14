(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const hasSavedSetup = Boolean(params.get('saved'));
  const $ = (selector, root = document) => root.querySelector(selector);
  let signedIn = false;
  let authChecked = false;
  let authCheckBusy = false;

  function currentStep() {
    const text = $('#mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Math.max(0, Number(match[1]) - 1) : 0;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function closeModal() {
    const root = $('#existingSetupModalRoot');
    if (!root) return;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('existing-setup-modal-open');
    document.body.classList.remove('existing-setup-modal-open');
  }

  function renderModalShell() {
    let root = $('#existingSetupModalRoot');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'existingSetupModalRoot';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="existing-setup-backdrop">
        <section class="existing-setup-modal" role="dialog" aria-modal="true" aria-labelledby="existingSetupTitle">
          <header class="existing-setup-modal-head">
            <div>
              <span class="existing-setup-kicker">SAVED SETUPS</span>
              <h3 id="existingSetupTitle">Edit Existing Setup</h3>
            </div>
            <button class="existing-setup-close" type="button" aria-label="Close saved setups" data-close-existing-setup>×</button>
          </header>
          <div class="existing-setup-modal-body">
            <p class="existing-setup-copy">Choose a saved setup to open it directly in Step 5. Your saved categories, folders, keys, and setup preferences will be restored.</p>
            <div id="existingSetupList" class="existing-setup-list"><div class="existing-setup-loading">Loading saved setups…</div></div>
            <div id="existingSetupError" class="existing-setup-error" role="status"></div>
          </div>
        </section>
      </div>`;
    document.body.appendChild(root);

    const backdrop = root.querySelector('.existing-setup-backdrop');
    const modal = root.querySelector('.existing-setup-modal');
    const closeButton = root.querySelector('[data-close-existing-setup]');

    // Bind the close button directly instead of relying on delegated click
    // handling. Firefox Android can retarget taps in fixed/backdrop-filtered
    // dialogs, which made the visible X appear unresponsive.
    const closeFromButton = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    };
    closeButton?.addEventListener('click', closeFromButton);
    closeButton?.addEventListener('pointerup', closeFromButton);

    // Clicking the dimmed area still closes the dialog, but clicks inside the
    // card never bubble into the backdrop close path.
    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal();
    });
    modal?.addEventListener('click', event => event.stopPropagation());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.classList.contains('open')) closeModal();
    });
    return root;
  }

  async function openExistingSetupModal() {
    if (!signedIn) return;
    const root = renderModalShell();
    const list = $('#existingSetupList', root);
    const error = $('#existingSetupError', root);
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('existing-setup-modal-open');
    document.body.classList.add('existing-setup-modal-open');
    list.innerHTML = '<div class="existing-setup-loading">Loading saved setups…</div>';
    error.textContent = '';

    try {
      const session = await window.KollectionNuvioAuth?.getSession?.();
      if (!session?.authenticated) {
        signedIn = false;
        syncToolbarButtons();
        throw new Error('Sign in with Nuvio to edit a saved setup.');
      }
      const response = await fetch('/api/account/collections', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Could not load saved setups (HTTP ${response.status}).`);
      const items = Array.isArray(body?.collections) ? body.collections : [];
      if (!items.length) {
        list.innerHTML = '<div class="existing-setup-empty"><b>No saved setups yet</b><span>Start a setup first, then save it to your account.</span></div>';
        return;
      }

      list.innerHTML = items.map((item) => {
        const completed = Number(item?.draftStep || 0) >= 7 || Boolean(item?.lastAppliedAt);
        const profile = item?.nuvioProfileName || (item?.nuvioProfileId ? `Profile ${item.nuvioProfileId}` : 'Nuvio profile');
        const when = formatDate(item?.updatedAt || item?.createdAt);
        return `<button class="existing-setup-row" type="button" data-saved-id="${escapeHtml(item?.id || '')}">
          <span class="existing-setup-row-main"><b>${escapeHtml(item?.name || 'Saved setup')}</b><small>${escapeHtml(profile)}${when ? ` · Updated ${escapeHtml(when)}` : ''}</small></span>
          <span class="existing-setup-state">${completed ? 'Edit' : 'Continue'}</span>
        </button>`;
      }).join('');

      list.querySelectorAll('[data-saved-id]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.savedId || '';
          if (!id) return;
          const next = new URL(window.location.href);
          next.search = '';
          next.searchParams.set('saved', id);
          next.searchParams.set('edit', '1');
          window.location.href = next.toString();
        });
      });
    } catch (err) {
      list.innerHTML = '';
      error.textContent = err?.message || 'Could not load saved setups.';
    }
  }

  function syncToolbarButtons() {
    const saveButton = $('#saveSetupBtn');
    const resetButton = $('#resetBtn');
    const step = currentStep();

    if (!authChecked || !signedIn) {
      if (saveButton) saveButton.hidden = true;
      if (resetButton) resetButton.hidden = true;
      return;
    }

    if (resetButton) resetButton.hidden = false;
    if (!saveButton) return;

    if (hasSavedSetup) {
      saveButton.hidden = false;
      return;
    }

    if (step === 0) {
      saveButton.hidden = false;
      saveButton.textContent = 'Edit Existing Setup';
      saveButton.dataset.existingSetupPicker = 'true';
      saveButton.setAttribute('aria-label', 'Edit an existing saved setup');
      return;
    }

    if (saveButton.dataset.existingSetupPicker === 'true') {
      saveButton.textContent = 'Save setup';
      saveButton.setAttribute('aria-label', 'Save setup');
      delete saveButton.dataset.existingSetupPicker;
    }
    saveButton.hidden = false;
  }

  async function refreshAuthState() {
    if (authCheckBusy) return;
    authCheckBusy = true;
    try {
      const session = await window.KollectionNuvioAuth?.getSession?.();
      signedIn = Boolean(session?.authenticated);
    } catch {
      signedIn = false;
    } finally {
      authChecked = true;
      authCheckBusy = false;
      syncToolbarButtons();
    }
  }

  function interceptToolbarClick(event) {
    const button = event.target.closest('#saveSetupBtn');
    if (!button || hasSavedSetup || currentStep() !== 0 || !signedIn || button.dataset.existingSetupPicker !== 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openExistingSetupModal();
  }

  function addEditAiButton() {
    if (currentStep() !== 4) return;
    const panel = $('#panelHost .panel');
    const head = panel?.querySelector('.panel-head');
    if (!head || head.querySelector('#editAiFromCustomize')) return;
    const row = document.createElement('div');
    row.className = 'customize-edit-ai-row';
    row.innerHTML = '<button class="ghost small" id="editAiFromCustomize" type="button">Edit AIOMetadata & API keys</button>';
    head.appendChild(row);
    row.querySelector('button').addEventListener('click', goToAiMetadata);
  }

  function goToAiMetadata() {
    const move = () => {
      const step = currentStep();
      if (step <= 2) return;
      const folderBack = $('#doneEditingBtn');
      if (folderBack) {
        folderBack.click();
        setTimeout(move, 90);
        return;
      }
      const back = $('#panelHost #backBtn');
      if (!back) return;
      back.click();
      setTimeout(move, 90);
    };
    move();
  }

  function refreshEnhancements() {
    syncToolbarButtons();
    addEditAiButton();
  }

  function init() {
    document.addEventListener('click', interceptToolbarClick, true);

    const saveButton = $('#saveSetupBtn');
    const resetButton = $('#resetBtn');
    if (saveButton) saveButton.hidden = true;
    if (resetButton) resetButton.hidden = true;

    const observer = new MutationObserver(() => setTimeout(refreshEnhancements, 0));
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('kollection:nuvio-signed-in', () => {
      signedIn = true;
      authChecked = true;
      syncToolbarButtons();
    });
    window.addEventListener('kollection:nuvio-signed-out', () => {
      signedIn = false;
      authChecked = true;
      closeModal();
      syncToolbarButtons();
    });
    window.addEventListener('kollection:nuvio-session-changed', refreshAuthState);

    refreshEnhancements();
    refreshAuthState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
