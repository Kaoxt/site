(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  let savedId = params.get('saved') || '';
  let savedName = 'My Kollection';
  let targetStep = 0;
  let restoring = Boolean(savedId);
  let snapshot = {
    profileId: null,
    profileName: '',
    aiSetupMode: 'built-in',
    aiHostPreference: '',
    aiCustomFileName: '',
    bingecatSkipped: false,
    bingecatManifestUrl: '',
    selectedCollectionGroupIds: [],
  };
  let autoAction = false;
  let restoreNoticeShown = false;
  let verifiedBingecatOnce = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const status = () => $('#saveSetupStatus');
  const saveButton = () => $('#saveSetupBtn');

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function currentStep() {
    const text = $('#mobileStepText')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of/i);
    return match ? Math.max(0, Number(match[1]) - 1) : 0;
  }

  function setStatus(message, kind = '') {
    const el = status();
    if (!el) return;
    el.textContent = message || '';
    el.dataset.kind = kind;
  }

  function captureVisible() {
    const profile = $('#profile');
    if (profile) {
      const id = Number(profile.value);
      if (Number.isFinite(id)) snapshot.profileId = id;
      snapshot.profileName = profile.selectedOptions?.[0]?.textContent?.trim() || snapshot.profileName || '';
    }

    if ($('#customTab')?.classList.contains('active')) snapshot.aiSetupMode = 'custom';
    else if ($('#builtInTab')?.classList.contains('active')) snapshot.aiSetupMode = 'built-in';

    const host = $('#aiHost');
    if (host) snapshot.aiHostPreference = host.value || snapshot.aiHostPreference || '';

    const customFile = $('.file-status b');
    if (customFile) snapshot.aiCustomFileName = customFile.textContent.trim();

    const bcUrl = $('#bcUrl');
    if (bcUrl?.value?.trim()) snapshot.bingecatManifestUrl = bcUrl.value.trim();

    const panelText = $('#panelHost')?.textContent || '';
    if (/Bingecat is skipped/i.test(panelText)) snapshot.bingecatSkipped = true;
    if (/personal Bingecat manifest is ready/i.test(panelText)) snapshot.bingecatSkipped = false;

    const checks = $$('.section-checkbox');
    if (checks.length) {
      snapshot.selectedCollectionGroupIds = checks.filter((input) => input.checked).map((input) => input.value);
    }
  }

  function serializableConfig() {
    captureVisible();
    return {
      version: 1,
      aiSetupMode: snapshot.aiSetupMode === 'custom' ? 'custom' : 'built-in',
      aiHostPreference: snapshot.aiHostPreference || '',
      aiCustomFileName: snapshot.aiCustomFileName || '',
      bingecatSkipped: Boolean(snapshot.bingecatSkipped),
      bingecatManifestUrl: snapshot.bingecatManifestUrl || '',
      selectedCollectionGroupIds: Array.isArray(snapshot.selectedCollectionGroupIds)
        ? snapshot.selectedCollectionGroupIds.slice()
        : [],
    };
  }

  async function save() {
    const button = saveButton();
    if (button) button.disabled = true;
    setStatus('Saving…');

    try {
      const session = await window.KollectionNuvioAuth?.getSession?.();
      if (!session?.authenticated) throw new Error('Sign in with Nuvio before saving this setup.');

      captureVisible();
      if (!savedId) {
        const entered = window.prompt('Name this saved setup:', savedName || 'My Kollection');
        if (entered === null) {
          setStatus('');
          return;
        }
        savedName = entered.trim() || 'My Kollection';
      }

      const payload = {
        name: savedName,
        draftStep: currentStep(),
        nuvioProfileId: snapshot.profileId,
        nuvioProfileName: snapshot.profileName,
        config: serializableConfig(),
      };

      const url = savedId
        ? `/api/account/collections/${encodeURIComponent(savedId)}`
        : '/api/account/collections';
      const result = await readJson(await fetch(url, {
        method: savedId ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));

      if (!savedId) {
        savedId = result.collection?.id || '';
        if (savedId) {
          const next = new URL(window.location.href);
          next.searchParams.set('saved', savedId);
          history.replaceState(null, '', next);
        }
      }

      setStatus('Saved to your account.', 'success');
      setTimeout(() => setStatus(''), 3500);
    } catch (error) {
      setStatus(error?.message || 'Could not save this setup.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showResumeNotice(message) {
    if (restoreNoticeShown) return;
    restoreNoticeShown = true;
    setStatus(message, 'info');
  }

  function dispatchChange(element) {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickOnce(element) {
    if (!element || autoAction) return false;
    autoAction = true;
    setTimeout(() => {
      try { element.click(); } finally { setTimeout(() => { autoAction = false; }, 250); }
    }, 30);
    return true;
  }

  function applyVisible() {
    if (!restoring) return;
    const step = currentStep();

    if (step === 0 && targetStep > 0) {
      clickOnce($('#startBtn'));
      return;
    }

    if (step === 1) {
      const profile = $('#profile');
      if (!profile) {
        showResumeNotice('Saved setup loaded. Sign in with Nuvio to continue restoring it.');
        return;
      }
      if (snapshot.profileId != null && [...profile.options].some((o) => Number(o.value) === Number(snapshot.profileId))) {
        if (Number(profile.value) !== Number(snapshot.profileId)) {
          profile.value = String(snapshot.profileId);
          dispatchChange(profile);
        }
      }
      if (targetStep > 1) clickOnce($('#nextBtn'));
      return;
    }

    if (step === 2) {
      const desiredCustom = snapshot.aiSetupMode === 'custom';
      if (desiredCustom && !$('#customTab')?.classList.contains('active')) {
        clickOnce($('#customTab'));
        return;
      }
      if (!desiredCustom && !$('#builtInTab')?.classList.contains('active')) {
        clickOnce($('#builtInTab'));
        return;
      }
      const host = $('#aiHost');
      if (host && snapshot.aiHostPreference && [...host.options].some((o) => o.value === snapshot.aiHostPreference)) {
        host.value = snapshot.aiHostPreference;
        dispatchChange(host);
      }
      if (targetStep > 2) {
        showResumeNotice(desiredCustom
          ? 'Saved setup restored. Re-upload your AIOMetadata JSON and re-enter any required API keys, then continue; your later choices will restore automatically.'
          : 'Saved setup restored. Re-enter your MDBList/API keys, then continue; your later choices will restore automatically.');
      } else {
        restoring = false;
        setStatus('Saved setup restored.', 'success');
      }
      return;
    }

    if (step === 3) {
      if (snapshot.bingecatSkipped) {
        if ($('#skipBtn')) {
          clickOnce($('#skipBtn'));
          return;
        }
        if ($('#nextBtn') && targetStep > 3) clickOnce($('#nextBtn'));
        return;
      }

      const bcUrl = $('#bcUrl');
      if (bcUrl && snapshot.bingecatManifestUrl) {
        bcUrl.value = snapshot.bingecatManifestUrl;
        bcUrl.dispatchEvent(new Event('input', { bubbles: true }));
        if ($('#verifyBtn') && !verifiedBingecatOnce && targetStep > 3) {
          verifiedBingecatOnce = true;
          clickOnce($('#verifyBtn'));
          return;
        }
      }
      if ($('#nextBtn') && targetStep > 3) clickOnce($('#nextBtn'));
      else if (targetStep <= 3) {
        restoring = false;
        setStatus('Saved setup restored.', 'success');
      }
      return;
    }

    if (step === 4) {
      const selected = new Set(snapshot.selectedCollectionGroupIds || []);
      const checks = $$('.section-checkbox');
      if (checks.length && selected.size) {
        let changed = false;
        for (const input of checks) {
          const should = selected.has(input.value);
          if (input.checked !== should) {
            input.checked = should;
            changed = true;
          }
        }
        if (changed) dispatchChange(checks[0]);
      }
      if (targetStep > 4) clickOnce($('#nextBtn'));
      else {
        restoring = false;
        setStatus('Saved setup restored.', 'success');
      }
      return;
    }

    if (step >= targetStep) {
      restoring = false;
      setStatus('Saved setup restored.', 'success');
      setTimeout(() => setStatus(''), 3500);
    }
  }

  async function loadSaved() {
    if (!savedId) return;
    setStatus('Loading saved setup…');
    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(savedId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      const item = data.collection;
      savedName = item?.name || 'My Kollection';
      targetStep = Math.max(0, Math.min(7, Number(item?.draftStep) || 0));
      snapshot = {
        ...snapshot,
        ...(item?.config && typeof item.config === 'object' ? item.config : {}),
        profileId: item?.nuvioProfileId ?? snapshot.profileId,
        profileName: item?.nuvioProfileName || snapshot.profileName,
      };
      restoring = true;
      applyVisible();
    } catch (error) {
      restoring = false;
      setStatus(error?.message || 'Could not load the saved setup.', 'error');
    }
  }

  function init() {
    saveButton()?.addEventListener('click', save);

    const panel = $('#panelHost');
    if (panel) {
      const observer = new MutationObserver(() => {
        captureVisible();
        setTimeout(applyVisible, 40);
      });
      observer.observe(panel, { childList: true, subtree: true });
    }

    document.addEventListener('change', () => setTimeout(captureVisible, 0), true);
    document.addEventListener('input', () => setTimeout(captureVisible, 0), true);
    document.addEventListener('click', () => setTimeout(captureVisible, 80), true);
    window.addEventListener('kollection:nuvio-signed-in', () => setTimeout(applyVisible, 200));

    loadSaved();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
