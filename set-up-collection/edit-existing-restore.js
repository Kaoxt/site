(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const editExisting = params.get('edit') === '1' && Boolean(params.get('saved'));
  if (!editExisting) return;

  let active = true;
  let busy = false;
  let reachedCustomize = false;
  const $ = (selector, root = document) => root.querySelector(selector);

  function currentStep() {
    const text = $('#mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Math.max(0, Number(match[1]) - 1) : -1;
  }

  function clickOnce(button, delay = 50) {
    if (!button || busy || button.disabled) return false;
    busy = true;
    setTimeout(() => {
      try { button.click(); }
      finally { setTimeout(() => { busy = false; }, 250); }
    }, delay);
    return true;
  }

  function findButtonByText(pattern) {
    return Array.from(document.querySelectorAll('#panelHost button')).find((button) => pattern.test((button.textContent || '').trim()));
  }

  function driveToCustomize() {
    if (!active || reachedCustomize) return;
    const step = currentStep();

    if (step >= 4) {
      reachedCustomize = true;
      active = false;
      const status = $('#saveSetupStatus');
      if (status && /Loading saved setup|restor/i.test(status.textContent || '')) {
        status.textContent = 'Saved setup restored.';
        status.dataset.kind = 'success';
      }
      return;
    }

    // Step 1 -> Step 2. The saved-setup restore layer applies the saved profile first.
    if (step === 0) {
      clickOnce($('#startBtn'));
      return;
    }

    if (step === 1) {
      const profile = $('#profile');
      const next = $('#nextBtn');
      if (profile && profile.value && next && !next.disabled) clickOnce(next);
      return;
    }

    // Step 3 AIOMetadata. Saved encrypted API keys are restored by setup-sync/saved-secrets.
    // Do not advance until MDBList and the saved/default host are actually back in the form.
    if (step === 2) {
      const builtIn = $('#builtInTab')?.classList.contains('active');
      const custom = $('#customTab')?.classList.contains('active');
      const next = $('#nextBtn');

      if (builtIn) {
        const mdblist = $('#mdblist')?.value?.trim();
        const host = $('#aiHost')?.value;
        if (mdblist && host && next && !next.disabled) clickOnce(next, 80);
        return;
      }

      // Custom JSON setups cannot be reconstructed from a filename alone, so leave them
      // on AIOMetadata instead of silently advancing with missing configuration.
      if (custom) return;
    }

    // Step 4 Bingecat. saved-setup.js restores the saved manifest URL (or saved skip state)
    // and verifies it. Once the ready state is visible, continue straight to Customize.
    if (step === 3) {
      const customize = findButtonByText(/Customize collection/i);
      if (customize && !customize.disabled) {
        clickOnce(customize, 80);
        return;
      }

      const next = $('#nextBtn');
      const panelText = $('#panelHost')?.textContent || '';
      if (next && !next.disabled && /Bingecat is skipped|manifest is ready|Bingecat connected/i.test(panelText)) {
        clickOnce(next, 80);
      }
    }
  }

  function init() {
    const panel = $('#panelHost');
    if (panel) {
      new MutationObserver(() => setTimeout(driveToCustomize, 25))
        .observe(panel, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener('input', () => setTimeout(driveToCustomize, 20), true);
    document.addEventListener('change', () => setTimeout(driveToCustomize, 20), true);
    window.addEventListener('kollection:nuvio-signed-in', () => setTimeout(driveToCustomize, 150));

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      driveToCustomize();
      if (!active || tries > 300) clearInterval(timer);
    }, 100);

    setTimeout(driveToCustomize, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
