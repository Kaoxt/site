(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    session: null,
    nuvioFile: null,
    aioFile: null,
    nuvio: null,
    aio: null,
    validated: false,
  };

  const el = {
    authState: $('authState'),
    authMessage: $('authMessage'),
    authLoading: $('authLoading'),
    loginPanel: $('loginPanel'),
    continueNuvioButton: $('continueNuvioButton'),
    nuvioAdminStatus: $('nuvioAdminStatus'),
    signedInCard: $('signedInCard'),
    signedInEmail: $('signedInEmail'),
    signedInRole: $('signedInRole'),
    signedInAvatar: $('signedInAvatar'),
    signOutButton: $('signOutButton'),
    updaterShell: $('updaterShell'),
    whatUpdates: $('whatUpdates'),

    nuvioFile: $('nuvioFile'),
    aioFile: $('aioFile'),
    nuvioFileName: $('nuvioFileName'),
    aioFileName: $('aioFileName'),
    nuvioStats: $('nuvioStats'),
    aioStats: $('aioStats'),
    nuvioCard: $('nuvioCard'),
    aioCard: $('aioCard'),
    commitMessage: $('commitMessage'),
    confirmPublish: $('confirmPublish'),
    validateButton: $('validateButton'),
    publishButton: $('publishButton'),
    validationPanel: $('validationPanel'),
    validationSummary: $('validationSummary'),
    adminMessage: $('adminMessage'),
    publishResult: $('publishResult'),
  };

  function esc(text) {
    return String(text ?? '').replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[c]));
  }

  function setMessage(target, text, kind = 'error') {
    target.hidden = false;
    target.className = `admin-message ${kind}`;
    target.textContent = text;
  }

  function clearMessage(target) {
    target.hidden = true;
    target.textContent = '';
  }

  async function readBody(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function renderSession() {
    const s = state.session;
    const authenticated = Boolean(s?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;

    if (!authenticated) {
      el.authState.textContent = 'Signed out';
      el.authState.className = 'auth-state';
      el.updaterShell.hidden = true;
      el.whatUpdates.hidden = true;
      return;
    }

    const email = s.user?.email || 'Nuvio account';
    el.signedInEmail.textContent = email;
    el.signedInAvatar.textContent = email.charAt(0).toUpperCase() || 'N';

    if (s.isAdmin) {
      el.authState.textContent = 'Administrator';
      el.authState.className = 'auth-state good';
      el.signedInRole.textContent = 'Authorized administrator';
      el.updaterShell.hidden = false;
      el.whatUpdates.hidden = false;
      clearMessage(el.authMessage);
    } else {
      el.authState.textContent = 'Not authorized';
      el.authState.className = 'auth-state bad';
      el.signedInRole.textContent = 'Valid Nuvio account · not an administrator';
      el.updaterShell.hidden = true;
      el.whatUpdates.hidden = true;
      setMessage(
        el.authMessage,
        'This Nuvio account is signed in, but it is not authorized to publish The Kollection runtime. Sign out and use the administrator Nuvio account.'
      );
    }
  }

  async function loadSession() {
    el.authLoading.hidden = false;
    el.loginPanel.hidden = true;
    el.signedInCard.hidden = true;

    try {
      state.session = await window.KollectionNuvioAuth.getSession();
    } catch (error) {
      state.session = { authenticated: false, isAdmin: false };
      setMessage(el.authMessage, error.message || 'Could not check your Kollection session.');
    }

    renderSession();
  }

  el.continueNuvioButton.addEventListener('click', async () => {
    clearMessage(el.authMessage);
    const oldText = el.continueNuvioButton.textContent;
    el.continueNuvioButton.disabled = true;
    el.continueNuvioButton.textContent = 'Opening Nuvio…';

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection Admin',
        onStatus(message) {
          el.nuvioAdminStatus.textContent = message;
        },
      });

      state.session = await window.KollectionNuvioAuth.getSession();
      renderSession();
    } catch (error) {
      setMessage(el.authMessage, error.message || 'Could not sign in with Nuvio.');
    } finally {
      el.continueNuvioButton.disabled = false;
      el.continueNuvioButton.textContent = oldText;
    }
  });

  el.signOutButton.addEventListener('click', async () => {
    clearMessage(el.authMessage);

    try {
      await window.KollectionNuvioAuth.signOut();
    } finally {
      state.session = { authenticated: false, isAdmin: false };
      state.validated = false;
      el.nuvioAdminStatus.textContent = '';
      renderSession();
      updatePublishButton();
    }
  });

  function normalizeType(value) {
    const v = String(value || '').toLowerCase();
    if (['movies', 'movie'].includes(v)) return 'movie';
    if (['shows', 'show', 'series', 'tv'].includes(v)) return 'series';
    if (v === 'all') return 'all';
    return v || 'movie';
  }

  function getCollections(parsed) {
    if (Array.isArray(parsed)) return parsed;
    for (const key of ['collections', 'data', 'collectionPack']) {
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }
    return null;
  }

  function getAioConfig(parsed) {
    return parsed?.config && typeof parsed.config === 'object' ? parsed.config : parsed;
  }

  function statsForCollections(collections) {
    let folders = 0;
    const catalogIds = new Set();
    let recFolders = 0;

    for (const group of collections) {
      if (!group || !Array.isArray(group.folders)) continue;
      folders += group.folders.length;

      for (const folder of group.folders) {
        if (/^(for you|recommend(?:ed)? for you)$/i.test(String(folder?.title || '').trim())) recFolders++;

        for (const list of [folder?.sources, folder?.catalogSources]) {
          for (const source of (list || [])) {
            if (source?.catalogId && String(source.addonId || '') === 'aio-metadata') {
              catalogIds.add(String(source.catalogId));
            }
          }
        }
      }
    }

    return { groups: collections.length, folders, aioRefs: catalogIds.size, recFolders };
  }

  function statsForAio(config) {
    const catalogs = Array.isArray(config?.catalogs) ? config.catalogs : [];
    return {
      catalogs: catalogs.length,
      enabled: catalogs.filter((catalog) => catalog?.enabled !== false).length,
    };
  }

  function renderStats(target, stats) {
    target.innerHTML = Object.entries(stats)
      .map(([key, value]) => `<span>${esc(value)} ${esc(key)}</span>`)
      .join('');
    target.hidden = false;
  }

  async function readJson(file) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${file.name} is not valid JSON.`);
    }
  }

  async function inspectNuvio(file) {
    const parsed = await readJson(file);
    const collections = getCollections(parsed);

    if (!collections || !collections.length) {
      throw new Error('The Nuvio file does not contain a collection array.');
    }
    if (!collections.every((group) => group && typeof group === 'object' && Array.isArray(group.folders))) {
      throw new Error('The Nuvio collection file has an unexpected structure.');
    }

    state.nuvio = { parsed, collections, stats: statsForCollections(collections) };
    state.nuvioFile = file;
    el.nuvioFileName.textContent = file.name;
    renderStats(el.nuvioStats, {
      sections: state.nuvio.stats.groups,
      folders: state.nuvio.stats.folders,
      'AIO refs': state.nuvio.stats.aioRefs,
    });
    el.nuvioCard.classList.add('valid');
  }

  async function inspectAio(file) {
    const parsed = await readJson(file);
    const config = getAioConfig(parsed);

    if (!config || typeof config !== 'object' || !Array.isArray(config.catalogs)) {
      throw new Error('The AIOMetadata file does not contain config.catalogs.');
    }

    state.aio = {
      parsed,
      config,
      stats: statsForAio(config),
      version: parsed?.version || null,
    };
    state.aioFile = file;
    el.aioFileName.textContent = file.name;
    renderStats(el.aioStats, {
      catalogs: state.aio.stats.catalogs,
      enabled: state.aio.stats.enabled,
    });
    el.aioCard.classList.add('valid');
  }

  function resetValidation() {
    state.validated = false;
    el.validationPanel.hidden = true;
    el.validationSummary.innerHTML = '';
    el.publishResult.hidden = true;
    el.publishResult.innerHTML = '';
    updatePublishButton();
  }

  el.nuvioFile.addEventListener('change', async () => {
    resetValidation();
    clearMessage(el.adminMessage);
    const file = el.nuvioFile.files?.[0];
    if (!file) return;

    try {
      await inspectNuvio(file);
    } catch (error) {
      state.nuvio = null;
      state.nuvioFile = null;
      el.nuvioCard.classList.remove('valid');
      setMessage(el.adminMessage, error.message);
    }
  });

  el.aioFile.addEventListener('change', async () => {
    resetValidation();
    clearMessage(el.adminMessage);
    const file = el.aioFile.files?.[0];
    if (!file) return;

    try {
      await inspectAio(file);
    } catch (error) {
      state.aio = null;
      state.aioFile = null;
      el.aioCard.classList.remove('valid');
      setMessage(el.adminMessage, error.message);
    }
  });

  el.confirmPublish.addEventListener('change', updatePublishButton);

  function updatePublishButton() {
    el.publishButton.disabled = !(
      state.session?.isAdmin &&
      state.validated &&
      state.nuvioFile &&
      state.aioFile &&
      el.confirmPublish.checked
    );
  }

  el.validateButton.addEventListener('click', () => {
    clearMessage(el.adminMessage);
    resetValidation();

    if (!state.session?.isAdmin) return setMessage(el.adminMessage, 'Your administrator session is not active.');
    if (!state.nuvioFile || !state.nuvio) return setMessage(el.adminMessage, 'Choose a valid Nuvio collection JSON file.');
    if (!state.aioFile || !state.aio) return setMessage(el.adminMessage, 'Choose a valid AIOMetadata JSON file.');

    const aioIds = new Set(
      state.aio.config.catalogs
        .map((catalog) => String(catalog?.id || ''))
        .filter(Boolean)
    );

    const missing = new Set();
    for (const group of state.nuvio.collections) {
      for (const folder of (group.folders || [])) {
        for (const list of [folder.sources, folder.catalogSources]) {
          for (const source of (list || [])) {
            if (
              source?.addonId === 'aio-metadata' &&
              source?.catalogId &&
              !aioIds.has(String(source.catalogId))
            ) {
              missing.add(String(source.catalogId));
            }
          }
        }
      }
    }

    state.validated = true;
    const summary = {
      sections: state.nuvio.stats.groups,
      folders: state.nuvio.stats.folders,
      catalogs: state.aio.stats.catalogs,
      'recommendation folders': state.nuvio.stats.recFolders,
      'missing AIO refs': missing.size,
    };

    el.validationSummary.innerHTML = Object.entries(summary)
      .map(([key, value]) => `<span>${esc(value)} ${esc(key)}</span>`)
      .join('');

    el.validationPanel.hidden = false;

    if (missing.size) {
      setMessage(
        el.adminMessage,
        `Validation passed, but ${missing.size} AIOMetadata catalog reference(s) are not present in the uploaded AIOMetadata export. You can still publish if that is intentional.`,
        'good'
      );
    } else {
      setMessage(el.adminMessage, 'Validation passed. The files are ready to publish.', 'good');
    }

    updatePublishButton();
  });

  el.publishButton.addEventListener('click', async () => {
    if (el.publishButton.disabled) return;

    clearMessage(el.adminMessage);
    el.publishResult.hidden = true;

    const oldText = el.publishButton.textContent;
    el.publishButton.disabled = true;
    el.publishButton.textContent = 'Publishing…';

    try {
      const form = new FormData();
      form.append('nuvio', state.nuvioFile, state.nuvioFile.name);
      form.append('aio', state.aioFile, state.aioFile.name);
      form.append('message', el.commitMessage.value.trim());

      const res = await fetch('/api/admin/update-runtime', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });

      const data = await readBody(res);

      if (res.status === 401 || res.status === 403) {
        await loadSession();
        throw new Error(data?.error || 'Your administrator session is no longer authorized.');
      }

      if (!res.ok) throw new Error(data?.error || `Could not publish runtime update (HTTP ${res.status}).`);

      el.publishResult.hidden = false;
      el.publishResult.innerHTML =
        `<strong>Runtime updated successfully.</strong><br>` +
        `${esc(data.summary.sections)} sections · ${esc(data.summary.folders)} folders · ${esc(data.summary.catalogs)} AIOMetadata catalogs.<br>` +
        (data.commitUrl
          ? `<a href="${esc(data.commitUrl)}" target="_blank" rel="noopener">Open the GitHub commit</a>`
          : '');

      setMessage(
        el.adminMessage,
        'The new runtime was committed to Kaoxt/site. New Set Up Collection sessions will load it automatically.',
        'good'
      );
    } catch (error) {
      setMessage(el.adminMessage, error.message || 'Could not publish the runtime update.');
    } finally {
      el.publishButton.textContent = oldText;
      updatePublishButton();
    }
  });

  loadSession();
})();
