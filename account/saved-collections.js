(() => {
  'use strict';

  const NUVIO_API = 'https://api.nuvio.tv';
  const NUVIO_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
  let busy = false;
  let reloadPending = false;

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportSlug(value) {
    return String(value || 'My-Kollection')
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'My-Kollection';
  }

  const LEGACY_AIO_HOST = 'https://aiometadatafortheweebs.midnightignite.me/';

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeCollectionKey(value) {
    return String(value || '').replace(/-community$/i, '');
  }

  function normalizeAioCatalogType(value) {
    const raw = String(value || 'movie').trim().toLowerCase();
    if (raw === 'tv' || raw === 'show') return 'series';
    return ['movie', 'series', 'anime', 'all'].includes(raw) ? raw : 'movie';
  }

  function aioCatalogRouteKey(id, type) {
    return `${String(id || '').trim()}|${normalizeAioCatalogType(type)}`;
  }

  function manifestBaseCatalogId(id) {
    return String(id || '').trim().replace(/_(movie|series|anime|all)$/i, '');
  }

  function parseKollectionDatabase(jsText) {
    const marker = 'window.NUVIO_DATABASE =';
    const index = String(jsText || '').indexOf(marker);
    if (index < 0) throw new Error('The Kollection catalog database could not be read.');
    const json = String(jsText).slice(index + marker.length).trim().replace(/;\s*$/, '');
    const data = JSON.parse(json);
    if (!Array.isArray(data)) throw new Error('The Kollection catalog database is invalid.');
    return data;
  }

  function filterSavedCollectionPack(pack, savedConfig) {
    const selectedGroups = new Set(
      (Array.isArray(savedConfig?.selectedCollectionGroupIds) ? savedConfig.selectedCollectionGroupIds : [])
        .map(mergeCollectionKey)
    );
    const folderSelections = savedConfig?.selectedCollectionFolderIds && typeof savedConfig.selectedCollectionFolderIds === 'object'
      ? savedConfig.selectedCollectionFolderIds
      : {};

    const source = Array.isArray(pack) ? pack : [];
    const groups = selectedGroups.size
      ? source.filter(group => selectedGroups.has(mergeCollectionKey(group?.id || group?.title)))
      : source;

    return groups.map(group => {
      const copy = cloneJson(group);
      const groupKey = mergeCollectionKey(group?.id || group?.title);
      const chosen = Array.isArray(folderSelections[groupKey]) ? folderSelections[groupKey].map(mergeCollectionKey) : null;
      if (chosen && chosen.length) {
        const set = new Set(chosen);
        copy.folders = (copy.folders || []).filter(folder => set.has(mergeCollectionKey(folder?.id || folder?.title)));
      }
      return copy;
    });
  }

  function collectAioCatalogRefs(collections) {
    const refs = new Map();
    (collections || []).forEach(group => {
      (group.folders || []).forEach(folder => {
        for (const list of [folder.sources, folder.catalogSources]) {
          (list || []).forEach(source => {
            if (!source || (source.provider && source.provider !== 'addon')) return;
            if (String(source.addonId || '').startsWith('com.aicat.')) return;
            const manifestId = String(source.catalogId || '').trim();
            if (!manifestId) return;
            if (source.addonId !== 'aio-metadata' && !manifestId.startsWith('mdblist.')) return;
            const type = normalizeAioCatalogType(source.type);
            refs.set(aioCatalogRouteKey(manifestId, type), { manifestId, type });
          });
        }
      });
    });
    return [...refs.values()];
  }

  function synthesizeCatalog(id, typeHint) {
    const type = normalizeAioCatalogType(typeHint);
    const prefix = String(id || '').split('.')[0].toLowerCase();
    const knownSources = new Set([
      'mdblist', 'streaming', 'flixpatrol', 'tmdb', 'tvdb', 'trakt',
      'simkl', 'mal', 'anilist', 'letterboxd', 'movielens', 'publicmetadb',
    ]);
    return {
      id,
      type,
      name: id,
      enabled: true,
      showInHome: false,
      source: knownSources.has(prefix) ? prefix : 'custom',
      sort: 'default',
      order: 'asc',
      cacheTTL: 86400,
      genreSelection: 'standard',
      enableRatingPosters: true,
      displayType: type === 'all' ? 'movie' : type,
    };
  }

  function filterAioCatalogs(allCatalogs, wantedRefs) {
    const source = Array.isArray(allCatalogs) ? allCatalogs : [];
    const selected = new Map();

    for (const ref of wantedRefs || []) {
      const ids = [ref.manifestId];
      const base = manifestBaseCatalogId(ref.manifestId);
      if (base && base !== ref.manifestId) ids.push(base);

      let found = null;
      for (const id of ids) {
        found = source.find(catalog =>
          catalog?.id === id && normalizeAioCatalogType(catalog?.type) === ref.type
        ) || source.find(catalog =>
          catalog?.id === id && catalog?.displayType && normalizeAioCatalogType(catalog.displayType) === ref.type
        );
        if (found) break;
      }

      const baseId = found?.id || manifestBaseCatalogId(ref.manifestId) || ref.manifestId;
      const catalog = found ? cloneJson(found) : synthesizeCatalog(baseId, ref.type);
      selected.set(aioCatalogRouteKey(catalog.id, catalog.type), catalog);
    }

    return [...selected.values()];
  }

  function prepareLegacyAioConfig(baseConfig, catalogs, index, savedConfig, secrets) {
    const config = cloneJson(baseConfig || {});
    config.catalogs = catalogs;

    if (savedConfig?.betterPostersEnabled && window.KollectionBetterPostersSettings) {
      window.KollectionBetterPostersSettings.applyToAioConfig(
        config,
        savedConfig.betterPostersSettings || {}
      );
    }

    if (!config.apiKeys || typeof config.apiKeys !== 'object') config.apiKeys = {};
    if (secrets?.mdblistKey) config.apiKeys.mdblist = secrets.mdblistKey;
    else if (!('mdblist' in config.apiKeys)) config.apiKeys.mdblist = '';
    if (secrets?.tmdbKey) config.apiKeys.tmdb = secrets.tmdbKey;
    else if (!('tmdb' in config.apiKeys)) config.apiKeys.tmdb = '';
    config.apiKeys.traktTokenId = '';
    config.apiKeys.simklTokenId = '';
    config.apiKeys.anilistTokenId = '';
    delete config.sessionId;
    delete config.configHash;

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezone) config.timezone = timezone;
    } catch {}

    config.searchEnabled = index === 0 ? (config.searchEnabled !== false) : false;
    if (config.search && typeof config.search === 'object') config.search.enabled = index === 0;
    const now = Date.now();
    if ('lastModified' in config) config.lastModified = now;
    if ('configVersion' in config) config.configVersion = now + index + 1;
    return config;
  }

  function redactExportConfig(config) {
    const copy = cloneJson(config || {});
    if (copy.apiKeys && typeof copy.apiKeys === 'object') {
      for (const key of Object.keys(copy.apiKeys)) copy.apiKeys[key] = '';
    }
    return copy;
  }

  async function rebuildLegacyAioExports(collection) {
    const savedConfig = collection?.config && typeof collection.config === 'object' ? collection.config : {};
    if (savedConfig.aiSetupMode === 'custom') {
      throw new Error('This older setup used a custom AIOMetadata file that was not stored. Open Edit, re-upload that JSON once, then export it from Review. Future saved exports will be available here.');
    }

    const [databaseText, catalogResponse, baseResponse] = await Promise.all([
      fetch('/runtime/database.kaoxt.js', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Could not load The Kollection database.');
        return response.text();
      }),
      fetch('/runtime/kaoxt-aio-catalogs.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Could not load AIOMetadata catalogs.');
        return response.json();
      }),
      fetch('/runtime/kaoxt-aio-base-config.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('Could not load the AIOMetadata base configuration.');
        return response.json();
      }),
    ]);

    const pack = filterSavedCollectionPack(parseKollectionDatabase(databaseText), savedConfig);
    const refs = collectAioCatalogRefs(pack);
    const library = Array.isArray(catalogResponse) ? catalogResponse : (catalogResponse?.catalogs || []);
    const catalogs = filterAioCatalogs(library, refs);
    const chunks = [];
    const remaining = catalogs.slice();
    while (remaining.length) chunks.push(remaining.splice(0, 500));

    const secrets = collection?.secrets && typeof collection.secrets === 'object' ? collection.secrets : {};
    const configs = chunks.map((chunk, index) => prepareLegacyAioConfig(baseResponse, chunk, index, savedConfig, secrets));
    if (!configs.length) throw new Error('No AIOMetadata catalogs were found in this saved setup.');

    const slug = exportSlug(collection?.name);
    const stored = configs.map((config, index) => ({
      index: index + 1,
      host: savedConfig.aiHostPreference && /^https?:/i.test(savedConfig.aiHostPreference)
        ? savedConfig.aiHostPreference
        : LEGACY_AIO_HOST,
      fileName: `AIOMetadata-${slug}${configs.length > 1 ? `-${index + 1}` : ''}.json`,
      config: redactExportConfig(config),
    }));

    try {
      await readJson(await fetch(`/api/account/collections/${encodeURIComponent(collection.id)}/export-snapshot`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ aiometadataExports: stored }),
      }));
    } catch (error) {
      console.warn('[The Kollection] AIOMetadata legacy export migration could not be saved.', error);
    }

    return configs;
  }

  async function exportSavedAiMetadata(item, button) {
    const status = document.getElementById('accountSavedStatus');
    const id = String(item?.id || '').trim();
    if (!id) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Exporting…';
    try {
      const data = await readJson(await fetch(`/api/account/collections/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }));
      const collection = data?.collection || {};
      const exports = Array.isArray(collection?.config?.aiometadataExports)
        ? collection.config.aiometadataExports.filter(entry => entry?.config && typeof entry.config === 'object')
        : [];

      const secrets = collection?.secrets && typeof collection.secrets === 'object' ? collection.secrets : {};
      const slug = exportSlug(collection?.name || item?.name);
      let configs = [];

      if (exports.length) {
        configs = exports.map(entry => {
          const config = cloneJson(entry.config);
          if (!config.apiKeys || typeof config.apiKeys !== 'object') config.apiKeys = {};
          if (secrets.mdblistKey) config.apiKeys.mdblist = secrets.mdblistKey;
          if (secrets.tmdbKey) config.apiKeys.tmdb = secrets.tmdbKey;
          return config;
        });
      } else {
        if (status) status.textContent = 'Preparing AIOMetadata export from this older saved setup…';
        configs = await rebuildLegacyAioExports(collection);
      }

      configs.forEach((config, index) => {
        const suffix = configs.length > 1 ? `-${index + 1}` : '';
        downloadJson(`AIOMetadata-${slug}${suffix}.json`, config);
      });

      if (status) {
        status.textContent = `Exported ${configs.length} AIOMetadata configuration${configs.length === 1 ? '' : 's'} for “${collection?.name || item?.name || 'My Kollection'}”.`;
      }
    } catch (error) {
      if (status) status.textContent = error?.message || 'Could not export AIOMetadata.';
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
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

  function config() {
    const cfg = window.KOLLECTION_CONFIG || {};
    return {
      apiBase: String(cfg.nuvioApiBase || NUVIO_API).replace(/\/+$/, ''),
      publishableKey: String(cfg.nuvioPublishableKey || NUVIO_KEY),
    };
  }

  function parseCollections(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }
    return [];
  }

  function collectionKey(value) {
    return String(value || '').trim().replace(/-community$/i, '');
  }

  async function pullProfileCollections(profileId) {
    if (window.KollectionProfileState) {
      const rows = await window.KollectionProfileState.rpc('sync_pull_collections', { p_profile_id: Number(profileId) });
      return rows.length ? parseCollections(rows[0]?.collections_json) : [];
    }
    const tokenResult = await window.KollectionNuvioAuth?.getAccessToken?.();
    const accessToken = tokenResult?.accessToken;
    if (!accessToken) throw new Error('Nuvio session unavailable.');
    const { apiBase, publishableKey } = config();
    const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_collections`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_profile_id: Number(profileId) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Could not verify Nuvio collections (HTTP ${response.status}).`);
    const rows = Array.isArray(data) ? data : [];
    return rows.length ? parseCollections(rows[0]?.collections_json) : [];
  }

  async function pullProfiles() {
    if (window.KollectionProfileState) return window.KollectionProfileState.rpc('sync_pull_profiles');
    const tokenResult = await window.KollectionNuvioAuth?.getAccessToken?.();
    const accessToken = tokenResult?.accessToken;
    if (!accessToken) throw new Error('Nuvio session unavailable.');
    const { apiBase, publishableKey } = config();
    const response = await fetch(`${apiBase}/rest/v1/rpc/sync_pull_profiles`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`Could not verify Nuvio profiles (HTTP ${response.status}).`);
    return Array.isArray(data) ? data : (data?.profiles || []);
  }

  const profileIdOf = (profile) => Number(profile?.profile_index ?? profile?.id);
  const profileNameOf = (profile) => String(profile?.name || '').trim();

  async function repairSavedProfileLink(item, profile) {
    if (!item?.id || !profile) return;
    const profileId = profileIdOf(profile);
    if (!Number.isFinite(profileId) || profileId < 1) return;
    try {
      await readJson(await fetch(`/api/account/collections/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nuvioProfileId: profileId,
          nuvioProfileName: profileNameOf(profile) || item.nuvioProfileName || '',
        }),
      }));
      item.nuvioProfileId = profileId;
      if (profileNameOf(profile)) item.nuvioProfileName = profileNameOf(profile);
    } catch (error) {
      console.warn('[The Kollection] Could not repair saved setup profile link.', error);
    }
  }

  function liveIds(collections) {
    return new Set(parseCollections(collections).map(item => collectionKey(item?.id)).filter(Boolean));
  }

  function expectedIds(item) {
    const ids = item?.config?.selectedCollectionGroupIds;
    return Array.isArray(ids) ? ids.map(collectionKey).filter(Boolean) : [];
  }

  function activeProfileIdForUser(userId) {
    const row = document.querySelector('#accountProfiles .account-profile-row.active-profile');
    const rowId = Number(row?.dataset?.profileId);
    if (Number.isFinite(rowId) && rowId >= 1) return rowId;
    try {
      const stored = Number(localStorage.getItem(`kollection-nuvio-profile-id:${String(userId || 'default')}`));
      return Number.isFinite(stored) && stored >= 1 ? stored : null;
    } catch {
      return null;
    }
  }

  async function getActiveKollectionContext(userId) {
    const profileId = activeProfileIdForUser(userId);
    if (!profileId) return null;

    const activeRow = document.querySelector(`#accountProfiles .account-profile-row[data-profile-id="${CSS.escape(String(profileId))}"]`);
    if (activeRow?.dataset?.collectionEligibilityState === 'kollection') {
      return { profileId, eligibility: { state: 'kollection', eligible: true, hasKollection: true } };
    }

    if (!window.KollectionCollectionEligibility) return null;
    try {
      const eligibility = await window.KollectionCollectionEligibility.check(profileId, { force: true });
      if (eligibility?.state !== 'kollection' || !eligibility?.hasKollection) return null;
      return { profileId, eligibility };
    } catch {
      return null;
    }
  }

  async function verifyCompletedSetup(item, cache, profileCache, activeKollection) {
    if (Number(item?.draftStep || 0) < 7) return { state: 'draft' };

    const expected = expectedIds(item);
    const savedProfileId = Number(item?.nuvioProfileId);
    const savedProfileName = String(item?.nuvioProfileName || '').trim();

    const inspect = async (profileId) => {
      if (!Number.isFinite(profileId) || profileId < 1) return null;
      if (!cache.has(profileId)) cache.set(profileId, pullProfileCollections(profileId));
      const collections = await cache.get(profileId);
      const ids = liveIds(collections);
      const matched = expected.filter(id => ids.has(id));

      if (matched.length) {
        return { state: 'valid', matched: matched.length, expected: expected.length, profileId };
      }

      if (window.KollectionCollectionEligibility) {
        const eligibility = await window.KollectionCollectionEligibility.check(profileId, { force: true });
        if (eligibility?.state === 'kollection' && eligibility?.hasKollection) {
          return {
            state: 'valid',
            matched: 0,
            expected: expected.length,
            profileId,
            verifiedByOrigin: true,
          };
        }
      }
      return null;
    };

    if (Number.isFinite(savedProfileId) && savedProfileId >= 1) {
      const direct = await inspect(savedProfileId);
      if (direct) return direct;
    }

    if (!profileCache.value) profileCache.value = pullProfiles();
    const profiles = await profileCache.value;

    const named = savedProfileName
      ? profiles.filter((profile) => profileNameOf(profile).toLowerCase() === savedProfileName.toLowerCase())
      : [];

    for (const profile of named) {
      const id = profileIdOf(profile);
      if (id === savedProfileId) continue;
      const resolved = await inspect(id);
      if (resolved) {
        await repairSavedProfileLink(item, profile);
        return { ...resolved, repairedProfileLink: true };
      }
    }

    if (expected.length) {
      const exactMatches = [];
      for (const profile of profiles) {
        const id = profileIdOf(profile);
        if (!Number.isFinite(id) || id < 1 || id === savedProfileId || named.includes(profile)) continue;
        if (!cache.has(id)) cache.set(id, pullProfileCollections(id));
        const collections = await cache.get(id);
        const ids = liveIds(collections);
        const matched = expected.filter(key => ids.has(key));
        if (matched.length) exactMatches.push({ profile, matched });
      }

      if (exactMatches.length === 1) {
        const candidate = exactMatches[0];
        await repairSavedProfileLink(item, candidate.profile);
        return {
          state: 'valid',
          matched: candidate.matched.length,
          expected: expected.length,
          profileId: profileIdOf(candidate.profile),
          repairedProfileLink: true,
        };
      }
    }

    if (activeKollection?.profileId) {
      return {
        state: 'valid',
        profileId: activeKollection.profileId,
        editableViaActiveProfile: true,
        message: 'Editable using the active Nuvio profile that currently has The Kollection installed.',
      };
    }

    return {
      state: 'invalid',
      message: 'This saved setup could not be matched to The Kollection currently installed on its Nuvio profile. Editing is disabled.',
    };
  }

  function buildRow(item) {
    const row = document.createElement('article');
    row.className = 'account-saved-row';
    row.dataset.savedId = item.id || '';

    const copy = document.createElement('div');
    const titleRow = document.createElement('div');
    titleRow.className = 'account-saved-title-row';
    const name = document.createElement('strong');
    name.textContent = item.name || 'My Kollection';
    const badge = document.createElement('span');
    badge.className = 'account-origin-badge';
    badge.hidden = true;
    titleRow.append(name, badge);

    const meta = document.createElement('small');
    const pieces = [];
    const complete = Number(item.draftStep || 0) >= 7;
    if (item.nuvioProfileName) pieces.push(item.nuvioProfileName);
    if (item.updatedAt) pieces.push(`${complete ? 'Last synced' : 'Updated'} ${formatDate(item.updatedAt)}`);
    meta.textContent = pieces.join(' · ') || (complete ? 'Setup complete' : 'Saved configuration');

    const originMessage = document.createElement('small');
    originMessage.className = 'account-origin-message';
    originMessage.hidden = true;
    copy.append(titleRow, meta, originMessage);

    const actions = document.createElement('div');
    actions.className = 'account-saved-actions';

    const resume = document.createElement('a');
    resume.className = 'account-secondary-button account-small-button';
    resume.href = `/set-up-collection?saved=${encodeURIComponent(item.id)}${complete ? '&edit=1' : ''}`;
    resume.textContent = complete ? 'Checking…' : 'Resume';
    resume.setAttribute('aria-label', complete ? `Verify ${item.name || 'saved setup'} before editing` : `Resume ${item.name || 'saved setup'}`);
    if (complete) {
      resume.classList.add('account-edit-pending');
      resume.setAttribute('aria-disabled', 'true');
      resume.addEventListener('click', event => {
        if (resume.classList.contains('account-edit-pending') || resume.classList.contains('account-edit-invalid')) event.preventDefault();
      });
    }

    let exportButton = null;
    if (complete) {
      exportButton = document.createElement('button');
      exportButton.className = 'account-secondary-button account-small-button';
      exportButton.type = 'button';
      exportButton.textContent = 'Export AIOMetadata';
      exportButton.setAttribute('aria-label', `Export AIOMetadata for ${item.name || 'saved setup'}`);
      exportButton.addEventListener('click', () => exportSavedAiMetadata(item, exportButton));
    }

    const remove = document.createElement('button');
    remove.className = 'account-secondary-button account-small-button';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete “${item.name || 'My Kollection'}”?`)) return;
      remove.disabled = true;
      try {
        await readJson(await fetch(`/api/account/collections/${encodeURIComponent(item.id)}`, {
          method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
        }));
        await load();
      } catch (error) {
        const status = document.getElementById('accountSavedStatus');
        if (status) status.textContent = error?.message || 'Could not delete saved setup.';
        remove.disabled = false;
      }
    });

    if (exportButton) actions.append(exportButton);
    actions.append(resume, remove);
    row.append(copy, actions);
    return { row, resume, badge, originMessage, meta, complete };
  }

  async function render(collections, activeKollection = null) {
    const container = document.getElementById('accountSavedCollections');
    if (!container) return;
    container.innerHTML = '';
    if (!collections.length) { empty(container); return; }

    const cache = new Map();
    const profileCache = { value: null };
    const pending = [];
    for (const item of collections) {
      const ui = buildRow(item);
      container.appendChild(ui.row);
      if (!ui.complete) continue;
      pending.push((async () => {
        try {
          const result = await verifyCompletedSetup(item, cache, profileCache, activeKollection);
          ui.resume.classList.remove('account-edit-pending');
          ui.resume.removeAttribute('aria-disabled');
          ui.badge.hidden = false;
          if (result.state === 'valid') {
            ui.badge.textContent = item.lastAppliedAt ? 'Active' : (result.editableViaActiveProfile ? 'Editable' : 'Verified');
            ui.badge.dataset.state = item.lastAppliedAt ? 'active' : (result.editableViaActiveProfile ? 'editable' : 'valid');
            ui.resume.textContent = 'Edit';
            ui.resume.setAttribute('aria-label', `Edit ${item.name || 'saved setup'}`);
            if (result.editableViaActiveProfile && result.profileId) {
              ui.resume.href = `/set-up-collection?saved=${encodeURIComponent(item.id)}&edit=1&targetProfile=${encodeURIComponent(result.profileId)}`;
              ui.originMessage.textContent = 'This saved setup can be edited using your active Nuvio profile, which currently has The Kollection installed.';
              ui.originMessage.hidden = false;
              ui.originMessage.classList.add('account-origin-message-info');
            } else {
              ui.originMessage.hidden = true;
              ui.originMessage.classList.remove('account-origin-message-info');
            }
            if (result.repairedProfileLink && ui.meta) {
              const parts = [];
              if (item.nuvioProfileName) parts.push(item.nuvioProfileName);
              if (item.updatedAt) parts.push(`Last synced ${formatDate(item.updatedAt)}`);
              ui.meta.textContent = parts.join(' · ') || 'Setup complete';
            }
          } else {
            ui.badge.textContent = 'Invalid';
            ui.badge.dataset.state = 'invalid';
            ui.resume.textContent = 'Edit unavailable';
            ui.resume.classList.add('account-edit-invalid');
            ui.resume.setAttribute('aria-disabled', 'true');
            ui.resume.removeAttribute('href');
            ui.originMessage.textContent = result.message || 'This setup is not recognized as The Kollection on the saved Nuvio profile.';
            ui.originMessage.hidden = false;
            ui.row.classList.add('account-saved-invalid');
          }
        } catch (error) {
          ui.resume.classList.remove('account-edit-pending');
          ui.resume.textContent = 'Edit unavailable';
          ui.resume.classList.add('account-edit-invalid');
          ui.resume.removeAttribute('href');
          ui.badge.hidden = false;
          ui.badge.textContent = 'Unable to verify';
          ui.badge.dataset.state = 'unknown';
          ui.originMessage.textContent = error?.message || 'The Kollection could not verify this setup against Nuvio.';
          ui.originMessage.hidden = false;
        }
      })());
    }
    await Promise.allSettled(pending);
  }

  async function load() {
    if (busy) {
      reloadPending = true;
      return;
    }
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
      const data = await readJson(await fetch('/api/account/collections', { credentials: 'same-origin', cache: 'no-store' }));
      const collections = Array.isArray(data.collections) ? data.collections : [];
      const activeKollection = await getActiveKollectionContext(session.user?.id || '');
      await render(collections, activeKollection);
      if (status) status.textContent = collections.length
        ? `${collections.length} saved setup${collections.length === 1 ? '' : 's'}. Completed setups can be edited when their linked profile or your active Nuvio profile currently has The Kollection installed.`
        : '';
    } catch (error) {
      empty(container, 'Saved collection storage needs the Cloudflare D1 database binding before it can be used.');
      if (status) status.textContent = error?.message || 'Could not load saved setups.';
    } finally {
      busy = false;
      if (reloadPending) {
        reloadPending = false;
        setTimeout(load, 0);
      }
    }
  }

  function init() {
    load();
    window.addEventListener('kollection:nuvio-signed-in', load);
    window.addEventListener('kollection:setup-synced', load);
    window.addEventListener('kollection:nuvio-profile-changed', load);
    window.addEventListener('kollection:profile-eligibility-resolved', event => {
      const activeRow = document.querySelector('#accountProfiles .account-profile-row.active-profile');
      const activeId = Number(activeRow?.dataset?.profileId);
      const resolvedId = Number(event?.detail?.profileId);
      if (Number.isFinite(activeId) && activeId === resolvedId) load();
    });
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
