(() => {
  'use strict';

  const CFG = window.KOLLECTION_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const steps = [
    ['Overview', 'What Set Up Collection does'],
    ['Nuvio', 'Account & profile'],
    ['AIOMetadata', 'Catalog configuration'],
    ['Bingecat', 'Optional recommendations'],
    ['Customize', 'Choose collection sections'],
    ['Review', 'Backup & verify'],
    ['Set Up', 'Add selected sections to Nuvio'],
    ['Done', 'Setup complete'],
  ];

  const state = {
    step: 0,
    token: null,
    userId: null,
    profiles: [],
    profileId: null,
    profileName: null,
    addonProfileId: null,
    nuvioAuthMode: 'signin',
    nuvioEmail: '',
    profileCreateOpen: false,
    addons: [],
    existingCollections: [],

    mdblistKey: '',
    tmdbKey: '',
    aiHostPreference: CFG.aiometadataHosts?.[0]?.url || '',
    aiSetupMode: 'built-in',
    aiCustomFileName: '',
    aiCustomConfig: null,
    aiCustomCatalogLibrary: [],
    aiBaseConfig: null,
    aiCatalogLibrary: [],
    aiNeededCatalogs: [],
    aiChunks: [],
    aiInstalls: [],

    collectionPack: null,
    selectedCollectionGroupIds: [],
    collectionSelectionInitialized: false,
    bingecatManifestUrl: '',
    bingecatManifest: null,
    bingecatAddonId: '',
    bingecatCatalogs: [],
    bingecatSkipped: false,

    backup: null,
    previewCollections: null,
    finalCollections: null,
    installStarted: false,
  };

  const nav = $('#stepNav');
  const host = $('#panelHost');
  const alertHost = $('#alertHost');

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function normalizeUrl(url) {
    const raw = String(url || '').trim();
    if (raw.startsWith('stremio://')) return `https://${raw.slice('stremio://'.length)}`;
    return raw;
  }

  function normalizeHost(url) {
    const s = String(url || '').trim();
    return s.endsWith('/') ? s : `${s}/`;
  }

  function alert(message, type = 'info') {
    alertHost.innerHTML = `<div class="alert ${type}">${esc(message)}</div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function clearAlert() { alertHost.innerHTML = ''; }

  function renderNav() {
    nav.innerHTML = steps.map(([name, sub], i) => {
      const cls = i === state.step ? 'active' : i < state.step ? 'done' : '';
      const dot = i < state.step ? '✓' : String(i + 1).padStart(2, '0');
      return `<div class="step-link ${cls}"><span class="dot">${dot}</span><span class="step-copy"><b>${name}</b><span>${sub}</span></span></div>`;
    }).join('');
    $('#mobileStepText').textContent = `Step ${state.step + 1} of ${steps.length} · ${steps[state.step][0]}`;
    $('#mobileProgressBar').style.width = `${((state.step + 1) / steps.length) * 100}%`;
  }

  function setStep(step) {
    state.step = Math.max(0, Math.min(steps.length - 1, step));
    clearAlert();
    renderNav();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function panel(kicker, title, desc, body) {
    const titleHtml = title ? `<h2>${title}</h2>` : '';
    const descHtml = desc ? `<p>${desc}</p>` : '';
    return `<div class="panel"><div class="panel-head"><div class="kicker"><i></i>${esc(kicker)}</div>${titleHtml}${descHtml}</div>${body}</div>`;
  }

  function loading(text = 'Working…') {
    host.innerHTML = `<div class="panel"><div class="card"><div class="loading"><span class="spinner"></span><span>${esc(text)}</span></div></div></div>`;
  }

  function jsonClone(v) { return JSON.parse(JSON.stringify(v)); }

  function randomPassword() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function readResponse(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    return res.json();
  }

  async function fetchText(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    return res.text();
  }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: CFG.nuvioPublishableKey,
      Authorization: `Bearer ${state.token}`,
    };
  }

  async function nuvioLogin(email, password) {
    const res = await fetch(`${CFG.nuvioApiBase}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.nuvioPublishableKey },
      body: JSON.stringify({ email, password }),
    });
    const body = await readResponse(res);
    if (!res.ok || !body?.access_token) {
      const detail = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
      throw new Error(`Nuvio sign-in failed: ${detail}`);
    }
    state.token = body.access_token;
    state.userId = body.user?.id || null;
  }


  async function nuvioSignup(email, password) {
    const res = await fetch(`${CFG.nuvioApiBase}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.nuvioPublishableKey },
      body: JSON.stringify({ email, password }),
    });
    const body = await readResponse(res);
    if (!res.ok) {
      const detail = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
      throw new Error(`Nuvio account creation failed: ${detail}`);
    }
    if (body?.access_token) {
      state.token = body.access_token;
      state.userId = body.user?.id || null;
      return { signedIn: true };
    }
    return { signedIn: false };
  }

  async function rpc(name, body = {}) {
    const res = await fetch(`${CFG.nuvioApiBase}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    });
    const data = await readResponse(res);
    if (!res.ok) {
      const detail = typeof data === 'string' ? data.slice(0, 180) : JSON.stringify(data).slice(0, 180);
      throw new Error(`Nuvio ${name} failed (HTTP ${res.status}): ${detail}`);
    }
    return data;
  }

  async function getProfiles() {
    const data = await rpc('sync_pull_profiles', {});
    const rows = Array.isArray(data) ? data : (data?.profiles || []);
    return rows.map(p => {
      const id = Number(p.profile_index ?? p.id);
      return {
        id,
        name: String(p.name || `Profile ${p.profile_index ?? p.id}`),
        avatarColorHex: String(p.avatar_color_hex || p.avatarColorHex || '#1E88E5'),
        usesPrimaryAddons: id === 1 ? false : Boolean(p.uses_primary_addons ?? p.usesPrimaryAddons),
        usesPrimaryPlugins: id === 1 ? false : Boolean(p.uses_primary_plugins ?? p.usesPrimaryPlugins),
        avatarId: p.avatar_id ?? p.avatarId ?? null,
        avatarUrl: p.avatar_url ?? p.avatarUrl ?? null,
        profileBackgroundId: p.profile_background_id ?? p.profileBackgroundId ?? null,
        profileBackgroundUrl: p.profile_background_url ?? p.profileBackgroundUrl ?? null,
      };
    }).filter(p => Number.isFinite(p.id) && p.id >= 1);
  }

  function profileSyncPayload(profile) {
    return {
      profile_index: profile.id,
      name: profile.name,
      avatar_color_hex: profile.avatarColorHex || '#1E88E5',
      uses_primary_addons: profile.id === 1 ? false : Boolean(profile.usesPrimaryAddons),
      uses_primary_plugins: profile.id === 1 ? false : Boolean(profile.usesPrimaryPlugins),
      avatar_id: profile.avatarUrl ? null : (profile.avatarId || null),
      avatar_url: profile.avatarUrl || null,
      profile_background_id: profile.profileBackgroundId || null,
      profile_background_url: profile.profileBackgroundUrl || null,
    };
  }

  async function pushProfiles(profiles) {
    await rpc('sync_push_profiles', {
      p_client_max_profiles: 6,
      p_profiles: profiles.map(profileSyncPayload),
    });
  }

  async function createNuvioProfile(name, usesPrimaryAddons = true) {
    if ((state.profiles || []).length >= 6) throw new Error('Nuvio supports up to six profiles on an account.');
    const used = new Set((state.profiles || []).map(p => p.id));
    const nextId = [2, 3, 4, 5, 6].find(id => !used.has(id));
    if (!nextId) throw new Error('No additional Nuvio profile slot is available.');
    const profile = {
      id: nextId,
      name: String(name || '').trim() || `Profile ${nextId}`,
      avatarColorHex: '#1E88E5',
      usesPrimaryAddons: Boolean(usesPrimaryAddons),
      usesPrimaryPlugins: false,
      avatarId: null,
      avatarUrl: null,
      profileBackgroundId: null,
      profileBackgroundUrl: null,
    };
    await pushProfiles([...(state.profiles || []), profile]);
    state.profiles = await getProfiles();
    const created = state.profiles.find(p => p.id === nextId) || profile;
    state.profileId = created.id;
    state.profileName = created.name;
    state.addonProfileId = created.usesPrimaryAddons ? 1 : created.id;
    state.profileCreateOpen = false;
    state.backup = null;
    return created;
  }

  async function getSyncOwner() {
    const data = await rpc('get_sync_owner', {});
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && typeof data[0] === 'string') return data[0];
    throw new Error('Nuvio did not return a sync owner ID.');
  }

  async function listAddons() {
    const owner = await getSyncOwner();
    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${owner}`,
      profile_id: `eq.${state.addonProfileId || state.profileId}`,
      order: 'sort_order.asc,created_at.asc',
    });
    const res = await fetch(`${CFG.nuvioApiBase}/rest/v1/addons?${params}`, { headers: authHeaders() });
    const data = await readResponse(res);
    if (!res.ok) throw new Error(`Could not read Nuvio addons (HTTP ${res.status}).`);
    return Array.isArray(data) ? data : [];
  }

  async function addAddon(url, name) {
    const normalized = normalizeUrl(url);
    const current = await listAddons();
    const same = current.find(a => normalizeUrl(a.url).replace(/\/+$/, '') === normalized.replace(/\/+$/, ''));
    if (same) return same;
    const owner = await getSyncOwner();
    const nextSort = current.reduce((m, a) => Math.max(m, Number(a.sort_order) || 0), -1) + 1;
    const res = await fetch(`${CFG.nuvioApiBase}/rest/v1/addons`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify([{
        user_id: owner,
        profile_id: state.addonProfileId || state.profileId,
        url: normalized,
        name: name || '',
        enabled: true,
        sort_order: nextSort,
      }]),
    });
    const data = await readResponse(res);
    if (!res.ok) throw new Error(`Could not install ${name || 'addon'} in Nuvio (HTTP ${res.status}).`);
    return Array.isArray(data) ? data[0] : data;
  }

  async function pullCollections() {
    const data = await rpc('sync_pull_collections', { p_profile_id: state.profileId });
    const rows = Array.isArray(data) ? data : [];
    return rows.length ? (rows[0].collections_json ?? []) : [];
  }

  async function pushCollections(collections) {
    return rpc('sync_push_collections', {
      p_profile_id: state.profileId,
      p_collections_json: Array.isArray(collections) ? collections : [],
    });
  }

  async function fetchAddonManifest(url, bingecatOnly = false) {
    const normalized = normalizeUrl(url);
    try {
      return await fetchJson(normalized, { cache: 'no-store' });
    } catch (directErr) {
      if (!bingecatOnly) throw directErr;
      try {
        return await fetchJson(`/api/manifest?url=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      } catch {
        throw new Error('Could not read the Bingecat manifest. Make sure you pasted the personal manifest.json link, not the configure page.');
      }
    }
  }

  function parseKaoxtDatabase(jsText) {
    const marker = 'window.NUVIO_DATABASE =';
    const idx = jsText.indexOf(marker);
    if (idx < 0) throw new Error('Kaoxt collection asset did not contain window.NUVIO_DATABASE.');
    let json = jsText.slice(idx + marker.length).trim();
    json = json.replace(/;\s*$/, '');
    const data = JSON.parse(json);
    if (!Array.isArray(data)) throw new Error('Kaoxt collection asset was not an array.');
    return data;
  }

  async function loadKaoxtAssets() {
    if (state.collectionPack && state.aiBaseConfig && state.aiCatalogLibrary.length) return;
    const [dbText, catalogRaw, base] = await Promise.all([
      fetchText(CFG.kaoxtDatabaseUrl, { cache: 'no-store' }),
      fetchJson(CFG.kaoxtAioCatalogsUrl, { cache: 'no-store' }),
      fetchJson(CFG.kaoxtAioBaseConfigUrl, { cache: 'no-store' }),
    ]);
    state.collectionPack = parseKaoxtDatabase(dbText);
    state.aiCatalogLibrary = Array.isArray(catalogRaw) ? catalogRaw : (catalogRaw?.catalogs || []);
    state.aiBaseConfig = base && typeof base === 'object' ? base : {};
  }

  function isBingecatSource(s) {
    if (!s) return false;
    // catalogSources often omit provider, so the per-user com.aicat.* addon ID
    // is the reliable marker in both sources and catalogSources.
    return String(s.addonId || '').startsWith('com.aicat.');
  }

  function collectionGroupKey(group) {
    return mergeKey(group?.id || group?.title || '');
  }

  function ensureCollectionSelection() {
    if (state.collectionSelectionInitialized) return;
    state.selectedCollectionGroupIds = (state.collectionPack || []).map(collectionGroupKey).filter(Boolean);
    state.collectionSelectionInitialized = true;
  }

  function selectedCollectionPack() {
    ensureCollectionSelection();
    const selected = new Set(state.selectedCollectionGroupIds || []);
    return (state.collectionPack || []).filter(group => selected.has(collectionGroupKey(group)));
  }

  function packUsesBingecat(pack) {
    return (pack || []).some(group => (group.folders || []).some(folder =>
      [folder.sources, folder.catalogSources].some(list => (list || []).some(isBingecatSource))
    ));
  }

  function shouldInstallBingecat(pack = selectedCollectionPack()) {
    return !state.bingecatSkipped && Boolean(state.bingecatManifestUrl) && packUsesBingecat(pack);
  }

  function groupStats(group) {
    const folders = group?.folders || [];
    const sourceKeys = new Set();
    folders.forEach(folder => {
      for (const list of [folder.sources, folder.catalogSources]) {
        (list || []).forEach(source => {
          const key = `${source?.addonId || ''}|${source?.catalogId || ''}|${source?.type || ''}`;
          if (source?.catalogId) sourceKeys.add(key);
        });
      }
    });
    return { folders: folders.length, sources: sourceKeys.size };
  }

  function collectAioCatalogIds(collections) {
    const ids = new Set();
    const typeById = {};
    (collections || []).forEach(c => {
      (c.folders || []).forEach(f => {
        for (const list of [f.sources, f.catalogSources]) {
          (list || []).forEach(s => {
            if (!s || s.provider && s.provider !== 'addon') return;
            if (isBingecatSource(s)) return;
            const cid = s.catalogId;
            if (!cid) return;
            if (s.addonId === 'aio-metadata' || String(cid).startsWith('mdblist.')) {
              ids.add(cid);
              if (!typeById[cid]) typeById[cid] = s.type || 'movie';
            }
          });
        }
      });
    });
    return { ids: [...ids], typeById };
  }

  function synthesizeCatalog(id, typeHint) {
    const raw = String(typeHint || 'movie').toLowerCase();
    const type = ['series', 'tv', 'show'].includes(raw) ? 'series' : raw === 'all' ? 'all' : 'movie';
    return {
      id,
      type,
      name: id,
      enabled: true,
      showInHome: false,
      source: String(id).startsWith('mdblist.') ? 'mdblist' : 'custom',
      sort: 'default',
      order: 'asc',
      cacheTTL: 86400,
      genreSelection: 'standard',
      enableRatingPosters: true,
      displayType: type === 'all' ? 'movie' : type,
    };
  }

  function filterAioCatalogs(allCatalogs, wantedIds, typeById) {
    const byId = new Map();
    (allCatalogs || []).forEach(c => { if (c?.id) byId.set(c.id, c); });
    return wantedIds.map(id => byId.has(id) ? jsonClone(byId.get(id)) : synthesizeCatalog(id, typeById[id]));
  }

  function hostDef(url) {
    return CFG.aiometadataHosts.find(h => normalizeHost(h.url) === normalizeHost(url)) || CFG.aiometadataHosts[0];
  }

  async function chooseAiHost() {
    if (state.aiHostPreference !== 'auto') return normalizeHost(state.aiHostPreference);
    const checks = CFG.aiometadataHosts.map(async h => {
      const u = normalizeHost(h.url);
      const res = await fetch(`${u}manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('not available');
      return u;
    });
    try { return await Promise.any(checks); }
    catch { return normalizeHost(CFG.aiometadataHosts[0].url); }
  }

  function chunkAioCatalogs(catalogs, preferredHost) {
    const defs = CFG.aiometadataHosts.map(h => ({ ...h, url: normalizeHost(h.url) }));
    const primary = normalizeHost(preferredHost || defs[0].url);
    const ordered = [defs.find(h => h.url === primary) || defs[0], ...defs.filter(h => h.url !== primary)];
    const remaining = catalogs.slice();
    const chunks = [];
    let i = 0;
    while (remaining.length) {
      const def = ordered[Math.min(i, ordered.length - 1)] || ordered[0];
      const room = Math.max(50, Number(def.cap || 500));
      chunks.push({ host: def.url, label: def.label || def.url, catalogs: remaining.splice(0, room) });
      i += 1;
      if (i >= ordered.length && remaining.length) ordered.push(ordered[0]);
    }
    return chunks;
  }

  function prepareAiConfig(baseConfig, catalogs, index) {
    const config = jsonClone(state.aiCustomConfig || baseConfig || {});
    config.catalogs = catalogs;
    if (!config.apiKeys) config.apiKeys = {};
    if (state.mdblistKey) config.apiKeys.mdblist = state.mdblistKey;
    else if (!('mdblist' in config.apiKeys)) config.apiKeys.mdblist = '';
    if (state.tmdbKey) config.apiKeys.tmdb = state.tmdbKey;
    else if (!('tmdb' in config.apiKeys)) config.apiKeys.tmdb = '';
    config.apiKeys.traktTokenId = '';
    config.apiKeys.simklTokenId = '';
    config.apiKeys.anilistTokenId = '';
    delete config.sessionId;
    delete config.configHash;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) config.timezone = tz;
    } catch { /* keep base */ }
    config.searchEnabled = index === 0 ? (config.searchEnabled !== false) : false;
    if (config.search && typeof config.search === 'object') config.search.enabled = index === 0;
    const now = Date.now();
    if ('lastModified' in config) config.lastModified = now;
    if ('configVersion' in config) config.configVersion = now + index + 1;
    return config;
  }

  async function saveAioConfig(host, config) {
    const base = normalizeHost(host);
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(`${base}api/config/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, password: randomPassword() }),
        });
        const body = await readResponse(res);
        if (res.ok) return body;
        lastErr = new Error(`AIOMetadata save failed on ${base} (HTTP ${res.status}).`);
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
    throw lastErr || new Error('AIOMetadata save failed.');
  }

  async function loadCustomAiFile(file) {
    if (!file) throw new Error('Choose an AIOMetadata JSON file.');
    const raw = await file.text();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('That file is not valid JSON.'); }
    const config = parsed?.config && typeof parsed.config === 'object' ? parsed.config : parsed;
    if (!config || typeof config !== 'object' || !Array.isArray(config.catalogs)) {
      throw new Error('That file does not look like an AIOMetadata export with a catalogs array.');
    }
    state.aiCustomConfig = jsonClone(config);
    state.aiCustomCatalogLibrary = jsonClone(config.catalogs);
    state.aiCustomFileName = file.name || 'AIOMetadata.json';
    state.aiSetupMode = 'custom';
    state.backup = null;
  }

  async function provisionAiMetadata() {
    const chosenHost = await chooseAiHost();
    state.aiChunks = chunkAioCatalogs(state.aiNeededCatalogs, chosenHost);
    const installs = [];
    const catalogIdToAddonId = {};
    let firstManifestId = 'aio-metadata';

    for (let i = 0; i < state.aiChunks.length; i++) {
      const chunk = state.aiChunks[i];
      loading(`Creating AIOMetadata ${i + 1} of ${state.aiChunks.length}…`);
      const config = prepareAiConfig(state.aiBaseConfig, chunk.catalogs, i);
      const saveData = await saveAioConfig(chunk.host, config);
      const uuid = saveData?.userUUID || saveData?.uuid;
      const installUrl = normalizeUrl(saveData?.installUrl || (uuid ? `${normalizeHost(chunk.host)}stremio/${uuid}/manifest.json` : ''));
      if (!installUrl) throw new Error('AIOMetadata did not return an install URL.');

      let realAddonId = 'aio-metadata';
      let manifestName = state.aiChunks.length > 1 ? `AIOMetadata (${i + 1})` : 'AIOMetadata';
      try {
        const manifest = await fetchAddonManifest(installUrl);
        if (manifest?.id) realAddonId = manifest.id;
        if (manifest?.name) manifestName = manifest.name;
      } catch { /* shared aio-metadata id is the normal fallback */ }
      if (i === 0) firstManifestId = realAddonId;
      chunk.catalogs.forEach(c => { if (c?.id) catalogIdToAddonId[c.id] = realAddonId; });
      installs.push({ url: installUrl, name: manifestName, addonId: realAddonId, host: chunk.host, catalogCount: chunk.catalogs.length });
    }

    state.aiInstalls = installs;
    return { installs, catalogIdToAddonId, firstManifestId };
  }

  function repointAioSources(collections, catalogIdToAddonId, firstManifestId) {
    const defaultId = firstManifestId || 'aio-metadata';
    (collections || []).forEach(c => {
      (c.folders || []).forEach(f => {
        for (const list of [f.sources, f.catalogSources]) {
          (list || []).forEach(s => {
            if (!s || isBingecatSource(s)) return;
            if (s.addonId !== 'aio-metadata') return;
            s.addonId = catalogIdToAddonId[s.catalogId] || defaultId;
          });
        }
      });
    });
  }

  function bingecatCatalogRank(c) {
    const n = String(c?.name || '').trim().toLowerCase();
    if (n === 'ai recommendations') return 0;
    if (n.startsWith('because you watched')) return 1;
    if (n.startsWith('latest')) return 2;
    if (n === 'list for you') return 3;
    return 10;
  }

  function rewriteBingecatInCollections(collections, addonId, manifestCatalogs) {
    const catalogs = (manifestCatalogs || [])
      .map((c, index) => ({ c, index }))
      .filter(x => x.c && !x.c.isSearch)
      .sort((a, b) => bingecatCatalogRank(a.c) - bingecatCatalogRank(b.c) || a.index - b.index)
      .map(x => x.c);
    const movieIds = catalogs.filter(c => String(c.type).toLowerCase() === 'movie').map(c => c.id);
    const seriesIds = catalogs.filter(c => String(c.type).toLowerCase() === 'series').map(c => c.id);

    const rewriteList = (list) => {
      if (!Array.isArray(list)) return;
      let mi = 0;
      let si = 0;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!isBingecatSource(s)) continue;
        if (!addonId) {
          list.splice(i, 1); i -= 1; continue;
        }
        const asSeries = ['series', 'tv', 'show'].includes(String(s.type || '').toLowerCase());
        const nextId = asSeries ? seriesIds[si++] : movieIds[mi++];
        if (!nextId) {
          // Never leave the creator's personal catalog id behind.
          list.splice(i, 1); i -= 1; continue;
        }
        s.addonId = addonId;
        s.catalogId = nextId;
      }
    };

    (collections || []).forEach(c => {
      (c.folders || []).forEach(f => {
        // Reset selection for each mirror list so sources and catalogSources
        // point at the same personalized Bingecat catalogs.
        rewriteList(f.sources);
        rewriteList(f.catalogSources);
      });
    });
  }

  function mergeKey(id) {
    return String(id || '').replace(/-community$/i, '');
  }

  function mergeCollections(existing, pack, fullPack = pack) {
    const result = [];
    const incomingByKey = new Map((pack || []).map(c => [mergeKey(c?.id), c]));
    const allKollectionKeys = new Set((fullPack || []).map(c => mergeKey(c?.id)));
    const used = new Set();
    for (const c of (existing || [])) {
      const key = mergeKey(c?.id);
      if (incomingByKey.has(key)) {
        result.push(incomingByKey.get(key));
        used.add(key);
      } else if (!allKollectionKeys.has(key)) {
        // Preserve unrelated user-created collection groups. Matching Kollection
        // groups that were intentionally deselected are omitted.
        result.push(c);
      }
    }
    for (const c of (pack || [])) {
      const key = mergeKey(c?.id);
      if (!used.has(key)) result.push(c);
    }
    return result;
  }

  function bingecatDisplayCatalogs() {
    return (state.bingecatCatalogs || []).filter(c => c && !c.isSearch);
  }

  async function verifyBingecatManifest(url) {
    const normalized = normalizeUrl(url);
    if (!normalized || !/manifest\.json(?:[?#].*)?$/i.test(normalized)) {
      throw new Error('Paste the personal Bingecat addon URL that ends in manifest.json.');
    }
    const manifest = await fetchAddonManifest(normalized, true);
    if (!manifest?.id || !Array.isArray(manifest.catalogs)) throw new Error('That URL did not look like a valid Bingecat addon manifest.');
    const nonSearch = manifest.catalogs.filter(c => c && !c.isSearch);
    const movies = nonSearch.filter(c => String(c.type).toLowerCase() === 'movie');
    const series = nonSearch.filter(c => String(c.type).toLowerCase() === 'series');
    if (!movies.length || !series.length) throw new Error('That manifest did not expose both movie and series recommendation catalogs.');
    state.bingecatSkipped = false;
    state.bingecatManifestUrl = normalized;
    state.bingecatManifest = manifest;
    state.bingecatAddonId = manifest.id;
    state.bingecatCatalogs = manifest.catalogs;
    return manifest;
  }

  async function prepareReview() {
    await loadKaoxtAssets();
    ensureCollectionSelection();
    const selectedPack = selectedCollectionPack();
    if (!selectedPack.length) throw new Error('Choose at least one collection section before continuing.');

    state.addons = await listAddons();
    state.existingCollections = await pullCollections();

    const { ids, typeById } = collectAioCatalogIds(selectedPack);
    const catalogLibrary = state.aiCustomCatalogLibrary.length
      ? [...state.aiCustomCatalogLibrary, ...state.aiCatalogLibrary.filter(c => !state.aiCustomCatalogLibrary.some(u => u?.id && u.id === c?.id))]
      : state.aiCatalogLibrary;
    state.aiNeededCatalogs = filterAioCatalogs(catalogLibrary, ids, typeById);
    const preferred = normalizeHost(state.aiHostPreference || CFG.aiometadataHosts[0].url);
    state.aiChunks = chunkAioCatalogs(state.aiNeededCatalogs, preferred);

    const previewPack = jsonClone(selectedPack);
    rewriteBingecatInCollections(previewPack, state.bingecatAddonId, state.bingecatCatalogs);
    state.previewCollections = mergeCollections(state.existingCollections, previewPack, state.collectionPack);
    state.finalCollections = null;
    state.backup = {
      createdAt: new Date().toISOString(),
      profile: { id: state.profileId, name: state.profileName, addonProfileId: state.addonProfileId || state.profileId },
      selectedSections: selectedPack.map(group => ({ id: group.id, title: group.title })),
      addons: state.addons,
      collections: state.existingCollections,
    };
  }

  async function installEverything() {
    if (!state.backup || !state.collectionPack) await prepareReview();
    state.installStarted = true;

    // Provision everything first. No collection is pushed until every generated
    // manifest is ready, matching the proven friend-pack provisioning flow.
    const ai = await provisionAiMetadata();

    const bcNeeded = shouldInstallBingecat(selectedCollectionPack());
    loading(bcNeeded ? 'Installing AIOMetadata and Bingecat in Nuvio…' : 'Installing AIOMetadata in Nuvio…');
    for (let i = 0; i < ai.installs.length; i++) {
      const item = ai.installs[i];
      await addAddon(item.url, ai.installs.length > 1 ? `AIOMetadata (${i + 1})` : 'AIOMetadata');
    }
    const selectedPack = selectedCollectionPack();
    if (shouldInstallBingecat(selectedPack)) {
      await addAddon(state.bingecatManifestUrl, state.bingecatManifest?.name || 'Bingecat');
    }

    const finalPack = jsonClone(selectedPack);
    repointAioSources(finalPack, ai.catalogIdToAddonId, ai.firstManifestId);
    rewriteBingecatInCollections(finalPack, state.bingecatAddonId, state.bingecatCatalogs);
    state.finalCollections = mergeCollections(state.existingCollections, finalPack, state.collectionPack);

    loading('Adding The Kollection to Nuvio…');
    await pushCollections(state.finalCollections);
  }

  function renderWelcome() {
    host.innerHTML = panel('SET UP COLLECTION', '',
      'AIOMetadata handles the main collection catalogs. Bingecat is optional and can add personalized For You recommendations.',
      `<div class="card">
        <div class="hero-checks">
          <div class="hero-check"><i>1</i><b>Connect Nuvio</b><span>Choose the account and profile that should receive The Kollection during setup.</span></div>
          <div class="hero-check"><i>2</i><b>Prepare AIOMetadata</b><span>Use the built-in configuration or provide your own AIOMetadata JSON file.</span></div>
          <div class="hero-check"><i>3</i><b>Choose recommendations</b><span>Connect your personal Bingecat manifest or skip Bingecat entirely.</span></div>
        </div>
        <div class="actions right"><button class="btn" id="startBtn">Start setup</button></div>
      </div>`);
    $('#startBtn').onclick = () => setStep(1);
  }

  function renderNuvio() {
    const logged = Boolean(state.token);
    const signup = state.nuvioAuthMode === 'signup';
    const profileOptions = state.profiles.map(p => `<option value="${p.id}" ${p.id === state.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    host.innerHTML = panel('STEP 2 · NUVIO', 'Connect your Nuvio account',
      'Sign in or create an account, then choose the profile that should receive The Kollection during setup.',
      `<div class="nuvio-account-banner">
        <div class="nuvio-account-art"><img src="set-up-collection/assets/nuvio-account.webp" alt="Nuvio logo"></div>
        <div class="nuvio-account-copy"><span>NUVIO</span><h3>Your Nuvio Account</h3><p>Sign in, create an account, and choose or create the profile you want to configure.</p></div>
      </div>
      <div class="card">
        ${!logged ? `
          <div class="nuvio-auth-shell">
            <div class="setup-tabs nuvio-auth-tabs" role="tablist" aria-label="Nuvio account action">
              <button class="setup-tab ${!signup ? 'active' : ''}" id="signinTab" type="button">Sign in</button>
              <button class="setup-tab ${signup ? 'active' : ''}" id="signupTab" type="button">Create account</button>
            </div>
            <div class="nuvio-auth-fields">
              <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username" value="${esc(state.nuvioEmail)}" placeholder="you@example.com"></div>
              <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'At least 8 characters' : 'Enter your password'}"></div>
              ${signup ? `<small class="nuvio-auth-note">If Nuvio requires email confirmation, finish that step and then return here to sign in.</small>` : ''}
            </div>
            <div class="actions nuvio-auth-actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="${signup ? 'signupBtn' : 'loginBtn'}">${signup ? 'Create account' : 'Sign in'}</button></div>
          </div>` : `
          <div class="callout good">Signed in successfully. Choose the Nuvio profile to configure.</div>
          <div class="field profile-field" style="margin-top:18px">
            <label for="profile">Nuvio profile</label>
            <div class="profile-control-row">
              <select id="profile">${profileOptions}</select>
              <button class="ghost new-profile-btn" id="newProfileBtn" type="button">New profile</button>
            </div>
            <small>If a secondary profile uses Primary add-ons, add-ons are installed on Profile 1 while collections stay on the selected profile.</small>
          </div>
          ${state.profileCreateOpen ? `<div class="profile-create-card">
            <div class="field"><label for="newProfileName">Profile name</label><input id="newProfileName" type="text" maxlength="40" placeholder="New profile"></div>
            <label class="toggle-row"><input id="inheritPrimary" type="checkbox" checked><span><b>Use Profile 1 add-ons</b><small>Recommended if you want this profile to share the primary profile’s add-ons.</small></span></label>
            <div class="actions compact"><button class="ghost" id="cancelProfileBtn" type="button">Cancel</button><button class="btn" id="createProfileBtn" type="button">Create profile</button></div>
          </div>` : ''}
          <div class="actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="nextBtn">Continue</button></div>`}
      </div>`);

    $('#backBtn').onclick = () => setStep(0);
    if (!logged) {
      const rememberEmail = () => { const el = $('#email'); if (el) state.nuvioEmail = el.value.trim(); };
      $('#signinTab').onclick = () => { rememberEmail(); state.nuvioAuthMode = 'signin'; renderNuvio(); };
      $('#signupTab').onclick = () => { rememberEmail(); state.nuvioAuthMode = 'signup'; renderNuvio(); };
      if (signup) {
        $('#signupBtn').onclick = async () => {
          try {
            const email = $('#email').value.trim();
            const password = $('#password').value;
            state.nuvioEmail = email;
            if (!email || !password) throw new Error('Enter an email and password.');
            if (password.length < 8) throw new Error('Use a password with at least eight characters.');
            loading('Creating your Nuvio account…');
            const result = await nuvioSignup(email, password);
            if (result.signedIn) {
              state.profiles = await getProfiles();
              if (!state.profiles.length) throw new Error('The account was created, but no Nuvio profile was returned yet. Open Nuvio once, then return and sign in here.');
              const first = state.profiles[0];
              state.profileId = first.id;
              state.profileName = first.name;
              state.addonProfileId = first.usesPrimaryAddons ? 1 : first.id;
              renderNuvio();
              alert('Nuvio account created and signed in.', 'success');
            } else {
              state.nuvioAuthMode = 'signin';
              renderNuvio();
              alert('Nuvio account created. If you received a verification email, confirm it and then sign in here.', 'success');
            }
          } catch (e) { renderNuvio(); alert(e.message, 'error'); }
        };
      } else {
        $('#loginBtn').onclick = async () => {
          try {
            const email = $('#email').value.trim();
            const password = $('#password').value;
            state.nuvioEmail = email;
            if (!email || !password) throw new Error('Enter the Nuvio email and password.');
            loading('Signing in and loading Nuvio profiles…');
            await nuvioLogin(email, password);
            state.profiles = await getProfiles();
            if (!state.profiles.length) throw new Error('No Nuvio profiles were returned.');
            state.profileId = state.profiles[0].id;
            state.profileName = state.profiles[0].name;
            state.addonProfileId = state.profiles[0].usesPrimaryAddons ? 1 : state.profiles[0].id;
            renderNuvio();
            alert('Signed in to Nuvio.', 'success');
          } catch (e) { renderNuvio(); alert(e.message, 'error'); }
        };
      }
      return;
    }

    $('#profile').onchange = e => {
      const p = state.profiles.find(x => x.id === Number(e.target.value));
      if (!p) return;
      state.profileId = p.id;
      state.profileName = p.name;
      state.addonProfileId = p.usesPrimaryAddons ? 1 : p.id;
      state.backup = null;
    };
    $('#newProfileBtn').onclick = () => { state.profileCreateOpen = !state.profileCreateOpen; renderNuvio(); };
    if (state.profileCreateOpen) {
      $('#cancelProfileBtn').onclick = () => { state.profileCreateOpen = false; renderNuvio(); };
      $('#createProfileBtn').onclick = async () => {
        try {
          const name = $('#newProfileName').value.trim();
          if (!name) throw new Error('Enter a name for the new profile.');
          const inherit = $('#inheritPrimary').checked;
          loading('Creating the Nuvio profile…');
          const created = await createNuvioProfile(name, inherit);
          renderNuvio();
          alert(`${created.name} is ready and selected.`, 'success');
        } catch (e) { renderNuvio(); alert(e.message, 'error'); }
      };
    }
    $('#nextBtn').onclick = () => setStep(2);
  }

  function renderAi() {
    const custom = state.aiSetupMode === 'custom';
    const hostOptions = CFG.aiometadataHosts.map(h => `<option value="${esc(normalizeHost(h.url))}" ${normalizeHost(state.aiHostPreference || CFG.aiometadataHosts[0].url) === normalizeHost(h.url) ? 'selected' : ''}>${esc(h.label)} · ${h.cap} catalog limit</option>`).join('');
    const customMdblist = state.aiCustomConfig?.apiKeys?.mdblist || '';
    host.innerHTML = panel('STEP 3 · AIOMETADATA', 'Prepare AIOMetadata for The Kollection',
      'Use the built-in catalog setup or bring your own AIOMetadata JSON export. Midnight supports up to 500 catalogs per configuration.',
      `<div class="card">
        <div class="setup-tabs" role="tablist" aria-label="AIOMetadata setup method">
          <button class="setup-tab ${!custom ? 'active' : ''}" id="builtInTab" type="button">Built-in setup</button>
          <button class="setup-tab ${custom ? 'active' : ''}" id="customTab" type="button">Use my JSON file</button>
        </div>
        ${custom ? `
          <div class="file-picker-wrap">
            <label class="file-picker" for="aiFile">Choose AIOMetadata JSON</label>
            <input class="visually-hidden" id="aiFile" type="file" accept=".json,application/json">
            <div class="file-status">${state.aiCustomFileName ? `<b>${esc(state.aiCustomFileName)}</b><span>${state.aiCustomCatalogLibrary.length} catalogs found</span>` : '<span>No file selected yet.</span>'}</div>
          </div>
          <div class="field api-key-field">
            <div class="field-label-row"><label for="mdblist">MDBList API key <span class="optional">(only if missing from the file)</span></label><a class="get-key-link" href="https://mdblist.com/preferences/" target="_blank" rel="noopener">Get Key</a></div>
            <div class="secret-input-wrap"><input id="mdblist" type="password" value="${esc(state.mdblistKey)}" placeholder="Optional override" autocomplete="off"><button class="key-visibility-toggle" type="button" data-target="mdblist" aria-label="Show MDBList API key" title="Show API key"><svg class="eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg><svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.1 16.1 0 0 1-3 3.7"></path><path d="M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.4"></path></svg></button></div>
            <small>Your file is processed locally. If it already contains an MDBList key, you can leave this blank.</small>
          </div>
          <div class="field api-key-field">
            <div class="field-label-row"><label for="tmdb">TMDB API key <span class="optional">(optional override)</span></label><a class="get-key-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get Key</a></div>
            <div class="secret-input-wrap"><input id="tmdb" type="password" value="${esc(state.tmdbKey)}" placeholder="Optional TMDB v3 key" autocomplete="off"><button class="key-visibility-toggle" type="button" data-target="tmdb" aria-label="Show TMDB API key" title="Show API key"><svg class="eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg><svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.1 16.1 0 0 1-3 3.7"></path><path d="M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.4"></path></svg></button></div>
          </div>` : `
          <div class="field api-key-field">
            <div class="field-label-row"><label for="mdblist">MDBList API key</label><a class="get-key-link" href="https://mdblist.com/preferences/" target="_blank" rel="noopener">Get Key</a></div>
            <div class="secret-input-wrap"><input id="mdblist" type="password" value="${esc(state.mdblistKey)}" placeholder="Your MDBList API key" autocomplete="off"><button class="key-visibility-toggle" type="button" data-target="mdblist" aria-label="Show MDBList API key" title="Show API key"><svg class="eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg><svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.1 16.1 0 0 1-3 3.7"></path><path d="M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.4"></path></svg></button></div>
            <small>Required for the built-in setup. The key is used only while creating your AIOMetadata configuration.</small>
          </div>
          <div class="field api-key-field">
            <div class="field-label-row"><label for="tmdb">TMDB API key <span class="optional">(optional)</span></label><a class="get-key-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Get Key</a></div>
            <div class="secret-input-wrap"><input id="tmdb" type="password" value="${esc(state.tmdbKey)}" placeholder="Optional TMDB v3 key" autocomplete="off"><button class="key-visibility-toggle" type="button" data-target="tmdb" aria-label="Show TMDB API key" title="Show API key"><svg class="eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg><svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.1 16.1 0 0 1-3 3.7"></path><path d="M6.1 6.1C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.4"></path></svg></button></div>
            <small>Optional; it can improve metadata resolution.</small>
          </div>`}
        <div class="field"><label for="aiHost">AIOMetadata host</label><select id="aiHost">${hostOptions}</select><small>Midnight allows up to 500 catalogs in each configuration. If needed, Set Up Collection can split the required catalogs across more than one configuration.</small></div>
        ${custom ? `<div class="callout">The uploaded file supplies your AIOMetadata preferences and matching catalog definitions. Any required The Kollection catalog missing from your file falls back to the built-in catalog definition.</div>` : ''}
        <div class="actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="nextBtn">Continue to Bingecat</button></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(1);
    $('#builtInTab').onclick = () => { state.aiSetupMode = 'built-in'; state.backup = null; renderAi(); };
    $('#customTab').onclick = () => { state.aiSetupMode = 'custom'; state.backup = null; renderAi(); };
    $('#mdblist').oninput = e => { state.mdblistKey = e.target.value.trim(); state.backup = null; };
    $('#tmdb').oninput = e => { state.tmdbKey = e.target.value.trim(); state.backup = null; };
    $$('.key-visibility-toggle').forEach(button => {
      button.onclick = () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        const revealing = input.type === 'password';
        input.type = revealing ? 'text' : 'password';
        button.classList.toggle('revealed', revealing);
        const provider = button.dataset.target === 'mdblist' ? 'MDBList' : 'TMDB';
        button.setAttribute('aria-label', `${revealing ? 'Hide' : 'Show'} ${provider} API key`);
        button.title = `${revealing ? 'Hide' : 'Show'} API key`;
      };
    });
    $('#aiHost').onchange = e => { state.aiHostPreference = e.target.value; state.backup = null; };
    if (custom) {
      $('#aiFile').onchange = async e => {
        try {
          await loadCustomAiFile(e.target.files?.[0]);
          renderAi();
          alert('AIOMetadata file loaded.', 'success');
        } catch (err) { renderAi(); alert(err.message, 'error'); }
      };
    }
    $('#nextBtn').onclick = () => {
      state.mdblistKey = $('#mdblist').value.trim();
      state.tmdbKey = $('#tmdb').value.trim();
      state.aiHostPreference = $('#aiHost').value;
      if (custom && !state.aiCustomConfig) return alert('Choose your AIOMetadata JSON file to continue.', 'error');
      if (!custom && !state.mdblistKey) return alert('Paste your MDBList API key to continue.', 'error');
      if (custom && !state.mdblistKey && !customMdblist) return alert('Your AIOMetadata file does not include an MDBList key. Enter one to continue.', 'error');
      setStep(3);
    };
  }

  function renderBingecat() {
    const skipped = state.bingecatSkipped;
    const ready = Boolean(state.bingecatManifest?.id) && !skipped;
    const catalogs = bingecatDisplayCatalogs();
    const movieCount = catalogs.filter(c => String(c.type).toLowerCase() === 'movie').length;
    const seriesCount = catalogs.filter(c => String(c.type).toLowerCase() === 'series').length;
    host.innerHTML = panel('STEP 4 · BINGECAT', skipped ? 'Bingecat is skipped' : (ready ? 'Your personal Bingecat manifest is ready' : 'Connect Bingecat recommendations'),
      skipped ? 'The For You Bingecat placeholders will be removed and the rest of The Kollection will still be set up normally.' : (ready ? 'Set Up Collection will install this personal manifest and rewrite the For You sources to its add-on ID and catalog IDs.' : 'Bingecat is optional. Connect your personal manifest for recommendations, or skip this step.'),
      `<div class="card">
        ${skipped ? `
          <div class="callout">Bingecat is optional. Your setup will continue without personalized For You recommendation catalogs.</div>
          <div class="actions"><button class="ghost" id="backBtn">Back</button><div class="action-group"><button class="ghost" id="useBtn">Use Bingecat</button><button class="btn" id="nextBtn">Customize collection</button></div></div>` : ready ? `
          <div class="status-row"><div><b>${esc(state.bingecatManifest.name || 'Bingecat')}</b><span>${esc(state.bingecatAddonId)} · ${movieCount} movie + ${seriesCount} series recommendation catalogs</span></div><span class="badge good">Verified</span></div>
          <div class="catalog-list" style="margin-top:16px">${catalogs.slice(0, 8).map(c => `<div class="catalog-row"><div><b>${esc(c.name || c.id)}</b><small>${esc(c.id)}</small></div><span class="badge">${esc(c.type || '')}</span></div>`).join('')}</div>
          <div class="actions"><button class="ghost" id="backBtn">Back</button><div class="action-group"><button class="ghost" id="skipBtn">Skip Bingecat</button><button class="ghost" id="changeBtn">Use a different manifest</button><button class="btn" id="nextBtn">Customize collection</button></div></div>` : `
          <div class="callout">Open Bingecat, configure your recommendations, copy your personal add-on URL ending in <strong>manifest.json</strong>, and paste it below.</div>
          <div class="inline" style="margin-top:16px"><a class="btn secondary" href="${esc(CFG.bingecatUrl)}" target="_blank" rel="noopener">Open Bingecat</a></div>
          <div class="field" style="margin-top:18px"><label for="bcUrl">Bingecat manifest URL</label><input id="bcUrl" type="url" value="${esc(state.bingecatManifestUrl)}" placeholder="https://…/manifest.json" autocomplete="off"><small>The creator-specific Bingecat ID is never pushed. It is replaced with the ID from your manifest.</small></div>
          <div class="actions"><button class="ghost" id="backBtn">Back</button><div class="action-group"><button class="ghost" id="skipBtn">Skip Bingecat</button><button class="btn" id="verifyBtn">Verify Bingecat</button></div></div>`}
      </div>`);
    $('#backBtn').onclick = () => setStep(2);
    const skip = async () => {
      try {
        state.bingecatSkipped = true;
        state.bingecatManifestUrl = '';
        state.bingecatManifest = null;
        state.bingecatAddonId = '';
        state.bingecatCatalogs = [];
        state.backup = null;
        loading('Loading collection sections…');
        await loadKaoxtAssets();
        ensureCollectionSelection();
        setStep(4);
      } catch (e) { renderBingecat(); alert(e.message, 'error'); }
    };
    if (skipped) {
      $('#useBtn').onclick = () => { state.bingecatSkipped = false; state.backup = null; renderBingecat(); };
      $('#nextBtn').onclick = async () => {
        try { loading('Loading collection sections…'); await loadKaoxtAssets(); ensureCollectionSelection(); setStep(4); }
        catch (e) { renderBingecat(); alert(e.message, 'error'); }
      };
      return;
    }
    $('#skipBtn').onclick = skip;
    if (ready) {
      $('#changeBtn').onclick = () => {
        state.bingecatManifest = null;
        state.bingecatAddonId = '';
        state.bingecatCatalogs = [];
        state.backup = null;
        renderBingecat();
      };
      $('#nextBtn').onclick = async () => {
        try {
          loading('Loading collection sections…');
          await loadKaoxtAssets();
          ensureCollectionSelection();
          setStep(4);
        } catch (e) { renderBingecat(); alert(e.message, 'error'); }
      };
      return;
    }
    $('#verifyBtn').onclick = async () => {
      try {
        const url = $('#bcUrl').value.trim();
        loading('Reading your Bingecat manifest…');
        state.bingecatSkipped = false;
        await verifyBingecatManifest(url);
        state.backup = null;
        renderBingecat();
        alert('Bingecat manifest verified.', 'success');
      } catch (e) { renderBingecat(); alert(e.message, 'error'); }
    };
  }

  function renderCustomize() {
    ensureCollectionSelection();
    const groups = state.collectionPack || [];
    const selected = new Set(state.selectedCollectionGroupIds || []);
    const selectedCount = groups.filter(group => selected.has(collectionGroupKey(group))).length;
    const selectedFolders = groups.reduce((count, group) => selected.has(collectionGroupKey(group)) ? count + (group.folders || []).length : count, 0);

    host.innerHTML = panel('STEP 5 · CUSTOMIZE', 'Choose what you want in your collection',
      'Select only the sections you want to add. AIOMetadata will be prepared for the catalogs used by those sections, so leaving a section out also avoids provisioning catalogs that only that section needs.',
      `<div class="card">
        <div class="collection-select-toolbar">
          <div><b id="sectionSelectionCount">${selectedCount} of ${groups.length} sections selected</b><span id="folderSelectionCount">${selectedFolders} folders included</span></div>
          <div class="action-group"><button class="ghost small" id="selectAllSections">Select all</button><button class="ghost small" id="clearSections">Clear all</button></div>
        </div>
        <div class="collection-section-grid">
          ${groups.map(group => {
            const key = collectionGroupKey(group);
            const on = selected.has(key);
            const stats = groupStats(group);
            return `<label class="collection-section-choice ${on ? 'selected' : ''}">
              <input class="section-checkbox" type="checkbox" value="${esc(key)}" ${on ? 'checked' : ''}>
              <span class="collection-section-check" aria-hidden="true"></span>
              <span class="collection-section-copy"><b>${esc(group.title || 'Untitled section')}</b><small>${stats.folders} folder${stats.folders === 1 ? '' : 's'} · ${stats.sources} catalog source${stats.sources === 1 ? '' : 's'}${packUsesBingecat([group]) ? ' · includes For You' : ''}</small></span>
            </label>`;
          }).join('')}
        </div>
        <div class="callout" style="margin-top:18px"><strong>Your choice is authoritative for The Kollection sections.</strong> If this profile already has a matching The Kollection section and you deselect it here, that section is removed during this setup. Unrelated personal collection groups stay untouched.</div>
        <div class="actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="nextBtn" ${selectedCount ? '' : 'disabled'}>Continue to review</button></div>
      </div>`);

    const syncSelection = () => {
      state.selectedCollectionGroupIds = $$('.section-checkbox:checked').map(input => input.value);
      state.collectionSelectionInitialized = true;
      state.backup = null;
      state.previewCollections = null;
      const selectedNow = new Set(state.selectedCollectionGroupIds);
      const groupCount = groups.filter(group => selectedNow.has(collectionGroupKey(group))).length;
      const folderCount = groups.reduce((count, group) => selectedNow.has(collectionGroupKey(group)) ? count + (group.folders || []).length : count, 0);
      $('#sectionSelectionCount').textContent = `${groupCount} of ${groups.length} sections selected`;
      $('#folderSelectionCount').textContent = `${folderCount} folders included`;
      $('#nextBtn').disabled = groupCount === 0;
      $$('.collection-section-choice').forEach(label => {
        const input = $('.section-checkbox', label);
        label.classList.toggle('selected', Boolean(input?.checked));
      });
    };

    $$('.section-checkbox').forEach(input => { input.onchange = syncSelection; });
    $('#selectAllSections').onclick = () => { $$('.section-checkbox').forEach(input => { input.checked = true; }); syncSelection(); };
    $('#clearSections').onclick = () => { $$('.section-checkbox').forEach(input => { input.checked = false; }); syncSelection(); };
    $('#backBtn').onclick = () => setStep(3);
    $('#nextBtn').onclick = async () => {
      syncSelection();
      if (!state.selectedCollectionGroupIds.length) return alert('Choose at least one collection section to continue.', 'error');
      try {
        loading('Preparing your selected collection sections…');
        await prepareReview();
        setStep(5);
      } catch (e) { renderCustomize(); alert(e.message, 'error'); }
    };
  }

  function renderReview() {
    const bc = bingecatDisplayCatalogs();
    const selectedPack = selectedCollectionPack();
    const selectedFolders = selectedPack.reduce((n, group) => n + (group.folders || []).length, 0);
    const bcNeeded = shouldInstallBingecat(selectedPack);
    const existingCount = state.existingCollections?.length || 0;
    const previewCount = state.previewCollections?.length || 0;
    host.innerHTML = panel('STEP 6 · REVIEW', 'Your collection is ready to add to Nuvio',
      'Nothing has been added to Nuvio yet. The backup below contains the profile’s current collections and add-on list before setup.',
      `<div class="card">
        <div class="summary">
          <div class="summary-item"><span class="icon">N</span><div><b>${esc(state.profileName)}</b><span>Nuvio profile ${state.profileId}; add-ons target profile ${state.addonProfileId || state.profileId}.</span></div></div>
          <div class="summary-item"><span class="icon">A</span><div><b>${state.aiNeededCatalogs.length} AIOMetadata catalogs</b><span>${state.aiSetupMode === 'custom' ? `Using ${esc(state.aiCustomFileName)} as the configuration base. ` : ''}Planned across ${state.aiChunks.length} configuration${state.aiChunks.length === 1 ? '' : 's'} with Midnight’s 500-catalog limit.</span></div></div>
          <div class="summary-item"><span class="icon">B</span><div><b>${state.bingecatSkipped ? 'Bingecat skipped' : (bcNeeded ? `Bingecat · ${bc.length} recommendation catalogs` : 'Bingecat not needed')}</b><span>${state.bingecatSkipped ? 'For You Bingecat placeholders will be removed.' : (bcNeeded ? `Your personal add-on ID ${esc(state.bingecatAddonId)} will replace the creator-specific For You references.` : 'None of the selected sections use Bingecat, so its add-on will not be installed.')}</span></div></div>
          <div class="summary-item"><span class="icon">K</span><div><b>The Kollection</b><span>${selectedPack.length} of ${state.collectionPack?.length || 0} sections selected · ${selectedFolders} folders included. This profile goes from ${existingCount} to ${previewCount} groups after the ID-aware merge.</span></div></div>
        </div>
        <hr class="sep">
        <div class="callout warn"><strong>The final setup adds AIOMetadata${bcNeeded ? ' and Bingecat' : ''} before pushing your selected sections.</strong> Unselected matching The Kollection sections are omitted; unrelated add-ons and collection groups are preserved.</div>
        <div class="actions"><button class="ghost" id="backBtn">Back</button><div class="action-group"><button class="ghost" id="backupBtn">Download backup</button><button class="btn" id="nextBtn">Continue</button></div></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(4);
    $('#backupBtn').onclick = () => downloadJson(`nuvio-backup-profile-${state.profileId}-${new Date().toISOString().slice(0,10)}.json`, state.backup);
    $('#nextBtn').onclick = () => setStep(6);
  }

  function renderInstall() {
    const selectedPack = selectedCollectionPack();
    const bcNeeded = shouldInstallBingecat(selectedPack);
    host.innerHTML = panel('STEP 7 · SET UP', 'Ready to set up The Kollection',
      `Set Up Collection will generate the required AIOMetadata configuration${state.aiChunks.length === 1 ? '' : 's'}, install ${bcNeeded ? 'AIOMetadata and your personal Bingecat manifest' : 'AIOMetadata'}, rewrite the collection sources, and add ${selectedPack.length} selected section${selectedPack.length === 1 ? '' : 's'} to Nuvio.`,
      `<div class="card">
        <div class="callout good"><strong>Provision-first flow:</strong> if AIOMetadata configuration fails before Nuvio add-ons are installed, your Nuvio collection is left unchanged.</div>
        <div class="actions"><button class="ghost" id="backBtn">Back</button><button class="btn" id="installBtn">Set Up The Kollection</button></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(5);
    $('#installBtn').onclick = async () => {
      try {
        await installEverything();
        setStep(7);
      } catch (e) {
        renderInstall();
        alert(`${e.message}${state.installStarted ? ' Your pre-setup backup is still available from the Review step.' : ''}`, 'error');
      }
    };
  }

  function renderDone() {
    const selectedPack = selectedCollectionPack();
    const bcNeeded = shouldInstallBingecat(selectedPack);
    const bcStatus = state.bingecatSkipped ? 'Bingecat skipped' : (bcNeeded ? 'Bingecat personalized' : 'Bingecat not needed');
    const bcDescription = state.bingecatSkipped
      ? 'The setup completed without Bingecat recommendation catalogs.'
      : (bcNeeded ? 'The creator-specific Bingecat IDs were replaced with your manifest ID and recommendation catalogs.' : 'None of the selected sections required Bingecat, so its add-on was not installed.');
    host.innerHTML = panel('COMPLETE', 'The Kollection is set up',
      `The selected Nuvio profile now has ${selectedPack.length} selected The Kollection section${selectedPack.length === 1 ? '' : 's'} and the required AIOMetadata catalog configuration${state.aiInstalls.length === 1 ? '' : 's'}${bcNeeded ? ', with your personal Bingecat recommendations wired into For You.' : ''}`,
      `<div class="card"><div class="done-mark">✓</div>
        <div class="summary">
          <div class="summary-item"><span class="icon">✓</span><div><b>AIOMetadata ready</b><span>${state.aiInstalls.length} configuration${state.aiInstalls.length === 1 ? '' : 's'} installed for ${state.aiNeededCatalogs.length} required catalogs.</span></div></div>
          <div class="summary-item"><span class="icon">✓</span><div><b>${bcStatus}</b><span>${bcDescription}</span></div></div>
          <div class="summary-item"><span class="icon">✓</span><div><b>Nuvio synced</b><span>${selectedPack.length} selected The Kollection sections were synced to profile ${state.profileId}; unrelated existing groups were preserved.</span></div></div>
        </div>
        <div class="actions"><button class="ghost" id="recordBtn">Download setup record</button><a class="btn" href="https://nuvio.tv/" target="_blank" rel="noopener">Open Nuvio</a></div>
      </div>`);
    $('#recordBtn').onclick = () => downloadJson(`the-kollection-setup-${new Date().toISOString().slice(0,10)}.json`, {
      completedAt: new Date().toISOString(),
      profile: { id: state.profileId, name: state.profileName },
      aiometadata: { instances: state.aiInstalls.length, catalogs: state.aiNeededCatalogs.length, source: state.aiSetupMode, customFile: state.aiCustomFileName || null },
      bingecat: { skipped: state.bingecatSkipped, installed: bcNeeded, addonId: bcNeeded ? state.bingecatAddonId : null, nonSearchCatalogs: bcNeeded ? bingecatDisplayCatalogs().length : 0 },
      selection: selectedPack.map(group => ({ id: group.id, title: group.title, folders: (group.folders || []).length })),
      collections: { before: state.existingCollections.length, after: state.finalCollections?.length || 0 },
    });
  }

  function render() {
    renderNav();
    const fn = [renderWelcome, renderNuvio, renderAi, renderBingecat, renderCustomize, renderReview, renderInstall, renderDone][state.step];
    fn();
  }

  $('#resetBtn').onclick = () => {
    if (!confirm('Start over? This clears this browser-tab setup session. It does not undo changes already synced to Nuvio.')) return;
    Object.assign(state, {
      step: 0,
      token: null,
      userId: null,
      profiles: [],
      profileId: null,
      profileName: null,
      addonProfileId: null,
      nuvioAuthMode: 'signin',
      nuvioEmail: '',
      profileCreateOpen: false,
      addons: [],
      existingCollections: [],
      mdblistKey: '',
      tmdbKey: '',
      aiHostPreference: CFG.aiometadataHosts?.[0]?.url || '',
      aiSetupMode: 'built-in',
      aiCustomFileName: '',
      aiCustomConfig: null,
      aiCustomCatalogLibrary: [],
      aiBaseConfig: null,
      aiCatalogLibrary: [],
      aiNeededCatalogs: [],
      aiChunks: [],
      aiInstalls: [],
      collectionPack: null,
      selectedCollectionGroupIds: [],
      collectionSelectionInitialized: false,
      bingecatManifestUrl: '',
      bingecatManifest: null,
      bingecatAddonId: '',
      bingecatCatalogs: [],
      bingecatSkipped: false,
      backup: null,
      previewCollections: null,
      finalCollections: null,
      installStarted: false,
    });
    setStep(0);
  };

  render();
})();
