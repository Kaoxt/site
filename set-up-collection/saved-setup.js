(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const sourceSavedId = params.get('saved') || '';
  const cloneSavedSetup = params.get('clone') === '1';
  const updateExistingSetup = params.get('update') === '1';
  let savedId = cloneSavedSetup ? '' : sourceSavedId;
  const targetProfileId = Number(params.get('targetProfile')) || null;
  let savedName = '';
  let targetStep = 0;
  let restoring = Boolean(sourceSavedId);
  let snapshot = {
    profileId: null,
    profileName: '',
    aiSetupMode: 'built-in',
    aiHostPreference: '',
    aiHostMode: '',
    aiSelfHostUrl: '',
    aiCustomFileName: '',
    betterPostersEnabled: false,
    betterPostersSettings: null,
    bingecatSkipped: false,
    bingecatManifestUrl: '',
    selectedCollectionGroupIds: [],
    knownCollectionGroupIds: [],
    selectedCollectionFolderIds: {},
  };
  let autoAction = false;
  let collectionRestoreApplied = false;
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
    const selfHost = $('#aiSelfHostUrl');
    if (host) {
      if (host.value === '__self_host__') {
        snapshot.aiHostMode = 'self';
        if (selfHost?.value?.trim()) {
          snapshot.aiSelfHostUrl = selfHost.value.trim();
          snapshot.aiHostPreference = selfHost.value.trim();
        }
      } else if (host.value) {
        snapshot.aiHostMode = 'managed';
        snapshot.aiHostPreference = host.value;
      }
    }

    const customFile = $('.file-status b');
    if (customFile) snapshot.aiCustomFileName = customFile.textContent.trim();

    const posterToggle = $('#betterPostersEnabled');
    if (posterToggle) snapshot.betterPostersEnabled = Boolean(posterToggle.checked);
    const betterPostersSettingsJson = $('#betterPostersSettingsJson');
    if (betterPostersSettingsJson?.value) {
      try { snapshot.betterPostersSettings = JSON.parse(betterPostersSettingsJson.value); } catch {}
    }

    const bcUrl = $('#bcUrl');
    if (bcUrl?.value?.trim()) snapshot.bingecatManifestUrl = bcUrl.value.trim();

    const panelText = $('#panelHost')?.textContent || '';
    if (/Bingecat is skipped/i.test(panelText)) snapshot.bingecatSkipped = true;
    if (/personal Bingecat manifest is ready/i.test(panelText)) snapshot.bingecatSkipped = false;

    const checks = $('.section-checkbox');
    if (checks.length) {
      snapshot.knownCollectionGroupIds = checks.map((input) => input.value);
      snapshot.selectedCollectionGroupIds = checks.filter((input) => input.checked).map((input) => input.value);
    }
  }

  function serializableConfig() {
    captureVisible();
    return {
      version: 5,
      aiSetupMode: snapshot.aiSetupMode === 'custom' ? 'custom' : 'built-in',
      aiHostPreference: snapshot.aiHostPreference || '',
      aiHostMode: snapshot.aiHostMode || '',
      aiSelfHostUrl: snapshot.aiSelfHostUrl || '',
      aiCustomFileName: snapshot.aiCustomFileName || '',
      betterPostersEnabled: Boolean(snapshot.betterPostersEnabled),
      betterPostersSettings: snapshot.betterPostersSettings && typeof snapshot.betterPostersSettings === 'object'
        ? JSON.parse(JSON.stringify(snapshot.betterPostersSettings))
        : null,
      bingecatSkipped: Boolean(snapshot.bingecatSkipped),
      bingecatManifestUrl: snapshot.bingecatManifestUrl || '',
      selectedCollectionGroupIds: Array.isArray(snapshot.selectedCollectionGroupIds)
        ? snapshot.selectedCollectionGroupIds.slice()
        : [],
      knownCollectionGroupIds: Array.isArray(snapshot.knownCollectionGroupIds)
        ? snapshot.knownCollectionGroupIds.slice()
        : [],
      selectedCollectionFolderIds: snapshot.selectedCollectionFolderIds && typeof snapshot.selectedCollectionFolderIds === 'object'
        ? JSON.parse(JSON.stringify(snapshot.selectedCollectionFolderIds))
        : {},
    };
  }

  async function prepareInstall(options = {}) {
    const name = String(options.name ?? savedName ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) throw new Error('Give this setup a name before adding it to your profile.');

    const session = await window.KollectionNuvioAuth?.getSession?.();
    if (!session?.authenticated) throw new Error('Sign in with Nuvio before finishing this setup.');

    captureVisible();
    savedName = name;

    const profileId = Number(options.profileId ?? snapshot.profileId);
    const profileName = String(options.profileName ?? snapshot.profileName ?? '').trim();
    if (!Number.isFinite(profileId) || profileId < 1) throw new Error('Choose a Nuvio profile before finishing this setup.');

    snapshot.profileId = profileId;
    if (profileName) snapshot.profileName = profileName;

    const secrets = window.KollectionSetupSync?.getSecrets?.() || undefined;
    const payload = {
      name: savedName,
      draftStep: savedId ? Math.max(6, targetStep) : 6,
      nuvioProfileId: profileId,
      nuvioProfileName: profileName,
      config: serializableConfig(),
      ...(secrets && (secrets.mdblistKey || secrets.tmdbKey) ? { secrets } : {}),
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
        next.searchParams.set('edit', '1');
        next.searchParams.delete('clone');
        next.searchParams.delete('switch');
        next.searchParams.delete('targetProfile');
        next.searchParams.delete('update');
        history.replaceState(null, '', next);
      }
    }

    return result.collection || {};
  }

  async function saveApplied(options = {}) {
    const name = String(options.name ?? savedName ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) throw new Error('Give this setup a name before adding it to your profile.');

    const session = await window.KollectionNuvioAuth?.getSession?.();
    if (!session?.authenticated) throw new Error('Sign in with Nuvio before finishing this setup.');

    captureVisible();
    savedName = name;

    const profileId = Number(options.profileId ?? snapshot.profileId);
    const profileName = String(options.profileName ?? snapshot.profileName ?? '').trim();
    if (!Number.isFinite(profileId) || profileId < 1) throw new Error('Choose a Nuvio profile before finishing this setup.');

    snapshot.profileId = profileId;
    if (profileName) snapshot.profileName = profileName;

    const secrets = window.KollectionSetupSync?.getSecrets?.() || undefined;
    const payload = {
      name: savedName,
      draftStep: 7,
      nuvioProfileId: profileId,
      nuvioProfileName: profileName,
      config: serializableConfig(),
      markApplied: true,
      ...(secrets && (secrets.mdblistKey || secrets.tmdbKey) ? { secrets } : {}),
    };

    setStatus(savedId ? 'Updating saved setup…' : 'Saving setup…');

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
        next.searchParams.set('edit', '1');
        next.searchParams.delete('clone');
        next.searchParams.delete('switch');
        next.searchParams.delete('targetProfile');
        next.searchParams.delete('update');
        history.replaceState(null, '', next);
      }
    }

    const collection = result.collection || {};
    const syncedAt = collection.updatedAt || new Date().toISOString();
    setStatus('Saved automatically to Your setups.', 'success');
    window.dispatchEvent(new CustomEvent('kollection:setup-auto-saved', {
      detail: {
        id: savedId,
        name: savedName,
        profileId,
        profileName,
        syncedAt,
        draftStep: 7,
        lastAppliedAt: collection.lastAppliedAt || syncedAt,
      },
    }));
    window.dispatchEvent(new CustomEvent('kollection:setup-synced', {
      detail: { id: savedId, syncedAt, draftStep: 7 },
    }));
    return collection;
  }

  function getName() {
    return savedName || '';
  }

  function setName(value) {
    savedName = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return savedName;
  }

  function getId() {
    return savedId || '';
  }

  async function rename(value) {
    const nextName = setName(value);
    if (!nextName) throw new Error('Enter a setup name.');
    if (!savedId) return nextName;

    setStatus('Updating setup name…');
    const result = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(savedId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nextName }),
    }));
    savedName = result?.collection?.name || nextName;
    setStatus('Setup name updated.', 'success');
    setTimeout(() => {
      if (/Setup name updated\./i.test(String(status()?.textContent || ''))) setStatus('');
    }, 2200);
    window.dispatchEvent(new CustomEvent('kollection:setup-renamed', {
      detail: { id: savedId, name: savedName },
    }));
    return savedName;
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
      const posterToggle = $('#betterPostersEnabled');
      if (posterToggle) {
        const desiredEnabled = Boolean(snapshot.betterPostersEnabled);
        let currentSettings = null;
        try { currentSettings = JSON.parse($('#betterPostersSettingsJson')?.value || 'null'); } catch {}
        const settingsChanged = desiredEnabled && snapshot.betterPostersSettings &&
          JSON.stringify(currentSettings || null) !== JSON.stringify(snapshot.betterPostersSettings);
        if (posterToggle.checked !== desiredEnabled || settingsChanged) {
          window.dispatchEvent(new CustomEvent('kollection:restore-better-posters-settings', {
            detail: {
              enabled: desiredEnabled,
              settings: snapshot.betterPostersSettings && typeof snapshot.betterPostersSettings === 'object'
                ? JSON.parse(JSON.stringify(snapshot.betterPostersSettings))
                : null,
            },
          }));
          return;
        }
      }
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
      if (host && snapshot.aiHostPreference) {
        const exact = [...host.options].some((o) => o.value === snapshot.aiHostPreference);
        if (snapshot.aiHostMode === 'self' || (!exact && snapshot.aiHostPreference)) {
          host.value = '__self_host__';
          dispatchChange(host);
          const selfHost = $('#aiSelfHostUrl');
          if (selfHost) {
            selfHost.value = snapshot.aiSelfHostUrl || snapshot.aiHostPreference;
            selfHost.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if (exact) {
          host.value = snapshot.aiHostPreference;
          dispatchChange(host);
        }
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
      if (!collectionRestoreApplied) {
        collectionRestoreApplied = true;
        window.dispatchEvent(new CustomEvent('kollection:restore-collection-selection', {
          detail: {
            selectedCollectionGroupIds: Array.isArray(snapshot.selectedCollectionGroupIds)
              ? snapshot.selectedCollectionGroupIds.slice()
              : [],
            knownCollectionGroupIds: Array.isArray(snapshot.knownCollectionGroupIds)
              ? snapshot.knownCollectionGroupIds.slice()
              : [],
            autoSelectNewCollectionGroups: updateExistingSetup,
            selectedCollectionFolderIds: snapshot.selectedCollectionFolderIds && typeof snapshot.selectedCollectionFolderIds === 'object'
              ? JSON.parse(JSON.stringify(snapshot.selectedCollectionFolderIds))
              : {},
          },
        }));
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
    if (!sourceSavedId) return;
    setStatus('Loading saved setup…');
    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(sourceSavedId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      const item = data.collection;
      savedName = item?.name || 'My Kollection';
      const routedStep = Number(window.KollectionSetupRoute?.getStep?.() ?? 0);
      targetStep = updateExistingSetup
        ? 4
        : routedStep > 0
          ? Math.max(0, Math.min(7, routedStep))
          : cloneSavedSetup
            ? Math.max(0, Math.min(6, Number(item?.draftStep) || 0))
            : Math.max(0, Math.min(7, Number(item?.draftStep) || 0));
      snapshot = {
        ...snapshot,
        ...(item?.config && typeof item.config === 'object' ? item.config : {}),
        profileId: targetProfileId ?? item?.nuvioProfileId ?? snapshot.profileId,
        profileName: targetProfileId ? snapshot.profileName : (item?.nuvioProfileName || snapshot.profileName),
      };
      collectionRestoreApplied = false;
      restoring = true;
      applyVisible();
    } catch (error) {
      restoring = false;
      setStatus(error?.message || 'Could not load the saved setup.', 'error');
    }
  }

  function init() {
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
    window.addEventListener('kollection:nuvio-profile-changed', event => {
      const detail = event?.detail || {};
      const id = Number(detail.profileId ?? detail.profile?.id ?? detail.profile?.profile_index);
      if (Number.isFinite(id) && id >= 1) snapshot.profileId = id;
      const name = String(detail.profileName || detail.profile?.name || '').trim();
      if (name) snapshot.profileName = name;
    });
    window.addEventListener('kollection:collection-selection-changed', event => {
      const detail = event?.detail || {};
      if (Array.isArray(detail.selectedCollectionGroupIds)) {
        snapshot.selectedCollectionGroupIds = detail.selectedCollectionGroupIds.slice();
      }
      if (detail.selectedCollectionFolderIds && typeof detail.selectedCollectionFolderIds === 'object') {
        snapshot.selectedCollectionFolderIds = JSON.parse(JSON.stringify(detail.selectedCollectionFolderIds));
      }
    });

    loadSaved();
  }

  window.KollectionSavedSetup = Object.freeze({
    getId,
    getName,
    setName,
    rename,
    prepareInstall,
    saveApplied,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
