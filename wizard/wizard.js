(() => {
  'use strict';

  const CFG = window.KOLLECTION_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const steps = [
    ['Welcome', 'What the wizard installs'],
    ['Nuvio', 'Sign in & choose profile'],
    ['AIOMetadata', 'MDBList key & catalog hosts'],
    ['Bingecat', 'Connect your personal manifest'],
    ['Review', 'Backup & verify the build'],
    ['Install', 'Provision add-ons & sync'],
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
    addons: [],
    existingCollections: [],

    mdblistKey: '',
    tmdbKey: '',
    aiHostPreference: 'auto',
    aiBaseConfig: null,
    aiCatalogLibrary: [],
    aiNeededCatalogs: [],
    aiChunks: [],
    aiInstalls: [],

    collectionPack: null,
    bingecatManifestUrl: '',
    bingecatManifest: null,
    bingecatAddonId: '',
    bingecatCatalogs: [],

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
    return rows.map(p => ({
      id: Number(p.profile_index ?? p.id),
      name: String(p.name || `Profile ${p.profile_index ?? p.id}`),
      usesPrimaryAddons: Number(p.profile_index ?? p.id) === 1 ? false : Boolean(p.uses_primary_addons ?? p.usesPrimaryAddons),
    })).filter(p => Number.isFinite(p.id) && p.id >= 1);
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
      const room = Math.max(50, Number(def.cap || 200) - 8);
      chunks.push({ host: def.url, label: def.label || def.url, catalogs: remaining.splice(0, room) });
      i += 1;
      if (i >= ordered.length && remaining.length) ordered.push(ordered[0]);
    }
    return chunks;
  }

  function prepareAiConfig(baseConfig, catalogs, index) {
    const config = jsonClone(baseConfig || {});
    config.catalogs = catalogs;
    if (!config.apiKeys) config.apiKeys = {};
    config.apiKeys.mdblist = state.mdblistKey || '';
    config.apiKeys.tmdb = state.tmdbKey || '';
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

  function mergeCollections(existing, pack) {
    const result = [];
    const incomingByKey = new Map((pack || []).map(c => [mergeKey(c?.id), c]));
    const used = new Set();
    for (const c of (existing || [])) {
      const key = mergeKey(c?.id);
      if (incomingByKey.has(key)) {
        result.push(incomingByKey.get(key));
        used.add(key);
      } else {
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
    state.bingecatManifestUrl = normalized;
    state.bingecatManifest = manifest;
    state.bingecatAddonId = manifest.id;
    state.bingecatCatalogs = manifest.catalogs;
    return manifest;
  }

  async function prepareReview() {
    await loadKaoxtAssets();
    state.addons = await listAddons();
    state.existingCollections = await pullCollections();

    const { ids, typeById } = collectAioCatalogIds(state.collectionPack);
    state.aiNeededCatalogs = filterAioCatalogs(state.aiCatalogLibrary, ids, typeById);
    const preferred = state.aiHostPreference === 'auto' ? normalizeHost(CFG.aiometadataHosts[0].url) : normalizeHost(state.aiHostPreference);
    state.aiChunks = chunkAioCatalogs(state.aiNeededCatalogs, preferred);

    const previewPack = jsonClone(state.collectionPack);
    rewriteBingecatInCollections(previewPack, state.bingecatAddonId, state.bingecatCatalogs);
    state.previewCollections = mergeCollections(state.existingCollections, previewPack);
    state.finalCollections = null;
    state.backup = {
      createdAt: new Date().toISOString(),
      profile: { id: state.profileId, name: state.profileName, addonProfileId: state.addonProfileId || state.profileId },
      addons: state.addons,
      collections: state.existingCollections,
    };
  }

  async function installEverything() {
    if (!state.backup || !state.collectionPack) await prepareReview();
    state.installStarted = true;

    // Provision everything first. No collection is pushed until every generated
    // manifest is ready, matching the friend-pack flow used by kaoxtv1.
    const ai = await provisionAiMetadata();

    loading('Installing AIOMetadata and Bingecat in Nuvio…');
    for (let i = 0; i < ai.installs.length; i++) {
      const item = ai.installs[i];
      await addAddon(item.url, ai.installs.length > 1 ? `AIOMetadata (${i + 1})` : 'AIOMetadata');
    }
    await addAddon(state.bingecatManifestUrl, state.bingecatManifest?.name || 'Bingecat');

    const finalPack = jsonClone(state.collectionPack);
    repointAioSources(finalPack, ai.catalogIdToAddonId, ai.firstManifestId);
    rewriteBingecatInCollections(finalPack, state.bingecatAddonId, state.bingecatCatalogs);
    state.finalCollections = mergeCollections(state.existingCollections, finalPack);

    loading('Syncing The Kollection to Nuvio…');
    await pushCollections(state.finalCollections);
  }

  function renderWelcome() {
    host.innerHTML = panel('THE KOLLECTION WIZARD', '',
      'AIOMetadata handles the main collection catalogs. Bingecat stays a separate personalized add-on, and only the For You sources are rewritten to each installer’s own Bingecat manifest.',
      `<div class="card">
        <div class="hero-checks">
          <div class="hero-check"><i>1</i><b>Connect Nuvio</b><span>Choose exactly which profile receives The Kollection.</span></div>
          <div class="hero-check"><i>2</i><b>Provision AIOMetadata</b><span>Use the visitor’s MDBList key and automatically split the large catalog pack across supported hosts.</span></div>
          <div class="hero-check"><i>3</i><b>Personalize Bingecat</b><span>Install the visitor’s own manifest and replace the creator-specific For You IDs before sync.</span></div>
        </div>
        <div class="actions right"><button class="btn" id="startBtn">Start setup →</button></div>
      </div>`);
    $('#startBtn').onclick = () => setStep(1);
  }

  function renderNuvio() {
    const logged = Boolean(state.token);
    host.innerHTML = panel('STEP 2 · NUVIO', 'Connect the Nuvio account.',
      'The sign-in request goes directly to Nuvio. Then choose the profile that should receive The Kollection.',
      `<div class="card">
        ${!logged ? `<div class="grid-2">
          <div class="field"><label for="email">Nuvio email</label><input id="email" type="email" autocomplete="username" placeholder="you@example.com"></div>
          <div class="field"><label for="password">Nuvio password</label><input id="password" type="password" autocomplete="current-password" placeholder="••••••••••••"></div>
        </div>
        <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="btn" id="loginBtn">Sign in to Nuvio</button></div>` : `
          <div class="callout good">Signed in successfully. Choose the Nuvio profile to configure.</div>
          <div class="field" style="margin-top:16px"><label for="profile">Nuvio profile</label><select id="profile">${state.profiles.map(p => `<option value="${p.id}" ${p.id === state.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><small>If a secondary profile inherits Primary add-ons, add-ons are installed on Profile 1 while the collections remain on the selected profile.</small></div>
          <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="btn" id="nextBtn">Continue →</button></div>`}
      </div>`);
    $('#backBtn').onclick = () => setStep(0);
    if (!logged) {
      $('#loginBtn').onclick = async () => {
        try {
          const email = $('#email').value.trim();
          const password = $('#password').value;
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
    $('#nextBtn').onclick = () => setStep(2);
  }

  function renderAi() {
    const options = CFG.aiometadataHosts.map(h => `<option value="${esc(normalizeHost(h.url))}" ${normalizeHost(state.aiHostPreference) === normalizeHost(h.url) ? 'selected' : ''}>${esc(h.label)} · ${h.cap} catalog limit</option>`).join('');
    host.innerHTML = panel('STEP 3 · AIOMETADATA', 'Prepare the catalog providers for The Kollection.',
      'The KaoxtV1 setup uses each installer’s own MDBList API key and splits large selections over multiple AIOMetadata configurations when a host limit would be exceeded.',
      `<div class="card">
        <div class="field"><label for="mdblist">MDBList API key</label><input id="mdblist" type="password" value="${esc(state.mdblistKey)}" placeholder="Your free MDBList API key" autocomplete="off"><small>Required. This key is inserted into the generated AIOMetadata configs in your browser; it is not stored by this wizard.</small></div>
        <div class="field" style="margin-top:16px"><label for="tmdb">TMDB API key <span style="opacity:.65">(optional)</span></label><input id="tmdb" type="password" value="${esc(state.tmdbKey)}" placeholder="Optional TMDB v3 key" autocomplete="off"><small>Optional; it can improve metadata resolution.</small></div>
        <div class="field" style="margin-top:16px"><label for="aiHost">AIOMetadata host</label><select id="aiHost"><option value="auto" ${state.aiHostPreference === 'auto' ? 'selected' : ''}>Auto · choose an available host</option>${options}</select><small>The installer may create more than one AIOMetadata configuration so the full catalog pack stays within service limits.</small></div>
        <div class="callout" style="margin-top:16px">The original full AIOMetadata export remains bundled with this project, but the live install follows the smaller base-config + selected-catalog approach used by the KaoxtV1 friend pack.</div>
        <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="btn" id="nextBtn">Continue to Bingecat →</button></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(1);
    $('#mdblist').oninput = e => { state.mdblistKey = e.target.value.trim(); state.backup = null; };
    $('#tmdb').oninput = e => { state.tmdbKey = e.target.value.trim(); state.backup = null; };
    $('#aiHost').onchange = e => { state.aiHostPreference = e.target.value; state.backup = null; };
    $('#nextBtn').onclick = () => {
      state.mdblistKey = $('#mdblist').value.trim();
      state.tmdbKey = $('#tmdb').value.trim();
      state.aiHostPreference = $('#aiHost').value;
      if (!state.mdblistKey) return alert('Paste your MDBList API key to continue.', 'error');
      setStep(3);
    };
  }

  function renderBingecat() {
    const ready = Boolean(state.bingecatManifest?.id);
    const catalogs = bingecatDisplayCatalogs();
    const movieCount = catalogs.filter(c => String(c.type).toLowerCase() === 'movie').length;
    const seriesCount = catalogs.filter(c => String(c.type).toLowerCase() === 'series').length;
    host.innerHTML = panel('STEP 4 · BINGECAT', ready ? 'Your personal Bingecat manifest is ready.' : 'Connect your Bingecat recommendations.',
      ready ? 'The wizard will install this exact personal manifest and rewrite the For You sources to its add-on ID and catalog IDs.' : 'Configure Bingecat separately, then paste the personal addon URL that ends in manifest.json. This matches the KaoxtV1 friend-pack setup.',
      `<div class="card">
        ${ready ? `<div class="status-row"><div><b>${esc(state.bingecatManifest.name || 'Bingecat')}</b><span>${esc(state.bingecatAddonId)} · ${movieCount} movie + ${seriesCount} series recommendation catalogs</span></div><span class="badge good">Verified</span></div>
          <div class="catalog-list" style="margin-top:16px">${catalogs.slice(0, 8).map(c => `<div class="catalog-row"><div><b>${esc(c.name || c.id)}</b><small>${esc(c.id)}</small></div><span class="badge">${esc(c.type || '')}</span></div>`).join('')}</div>
          <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="ghost" id="changeBtn">Use a different manifest</button><button class="btn" id="nextBtn">Review setup →</button></div>` : `
          <div class="callout">1. Open Bingecat and configure your recommendations. 2. Copy your personal addon <strong>manifest.json</strong> URL — not the configure-page URL. 3. Paste it below. The wizard will install it into Nuvio during the final setup.</div>
          <div class="inline" style="margin-top:16px"><a class="btn secondary" href="${esc(CFG.bingecatUrl)}" target="_blank" rel="noopener">Open Bingecat ↗</a></div>
          <div class="field" style="margin-top:18px"><label for="bcUrl">Bingecat manifest URL</label><input id="bcUrl" type="url" value="${esc(state.bingecatManifestUrl)}" placeholder="https://…/manifest.json" autocomplete="off"><small>The creator-specific Bingecat ID in the collection is never pushed; it is replaced with the ID from this manifest.</small></div>
          <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="btn" id="verifyBtn">Verify Bingecat →</button></div>`}
      </div>`);
    $('#backBtn').onclick = () => setStep(2);
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
          loading('Loading the KaoxtV1 collection assets and current Nuvio state…');
          await prepareReview();
          setStep(4);
        } catch (e) { renderBingecat(); alert(e.message, 'error'); }
      };
      return;
    }
    $('#verifyBtn').onclick = async () => {
      try {
        const url = $('#bcUrl').value.trim();
        loading('Reading your Bingecat manifest…');
        await verifyBingecatManifest(url);
        state.backup = null;
        renderBingecat();
        alert('Bingecat manifest verified.', 'success');
      } catch (e) { renderBingecat(); alert(e.message, 'error'); }
    };
  }

  function renderReview() {
    const bc = bingecatDisplayCatalogs();
    const existingCount = state.existingCollections?.length || 0;
    const previewCount = state.previewCollections?.length || 0;
    host.innerHTML = panel('STEP 5 · REVIEW', 'The KaoxtV1-style build is ready.',
      'Nothing has been pushed to the collection yet. The backup below contains the profile’s current collections and add-on list before installation.',
      `<div class="card">
        <div class="summary">
          <div class="summary-item"><span class="icon">N</span><div><b>${esc(state.profileName)}</b><span>Nuvio profile ${state.profileId}; add-ons target profile ${state.addonProfileId || state.profileId}.</span></div></div>
          <div class="summary-item"><span class="icon">A</span><div><b>${state.aiNeededCatalogs.length} AIOMetadata catalogs</b><span>Planned across ${state.aiChunks.length} generated configuration${state.aiChunks.length === 1 ? '' : 's'} to respect host limits.</span></div></div>
          <div class="summary-item"><span class="icon">B</span><div><b>Bingecat · ${bc.length} non-search catalogs</b><span>The personal add-on ID ${esc(state.bingecatAddonId)} will replace the creator-specific For You references.</span></div></div>
          <div class="summary-item"><span class="icon">K</span><div><b>The Kollection</b><span>${state.collectionPack?.length || 0} top-level groups; this profile goes from ${existingCount} to ${previewCount} groups after ID-aware merge.</span></div></div>
        </div>
        <hr class="sep">
        <div class="callout warn"><strong>The final install adds AIOMetadata and Bingecat add-ons before pushing collections.</strong> Existing unrelated add-ons and collection groups are preserved.</div>
        <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="ghost" id="backupBtn">Download backup</button><button class="btn" id="nextBtn">Continue to install →</button></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(3);
    $('#backupBtn').onclick = () => downloadJson(`nuvio-backup-profile-${state.profileId}-${new Date().toISOString().slice(0,10)}.json`, state.backup);
    $('#nextBtn').onclick = () => setStep(5);
  }

  function renderInstall() {
    host.innerHTML = panel('STEP 6 · INSTALL', 'Ready to install The Kollection.',
      'The wizard will now generate the required AIOMetadata configurations, install those manifests and your personal Bingecat manifest, rewrite the collection sources, and push the merged collection to Nuvio.',
      `<div class="card">
        <div class="callout good"><strong>Provision-first flow:</strong> if AIOMetadata configuration fails before Nuvio add-ons are installed, your Nuvio collection is left unchanged.</div>
        <div class="actions"><button class="ghost" id="backBtn">← Back</button><button class="btn" id="installBtn">Install The Kollection</button></div>
      </div>`);
    $('#backBtn').onclick = () => setStep(4);
    $('#installBtn').onclick = async () => {
      try {
        await installEverything();
        setStep(6);
      } catch (e) {
        renderInstall();
        alert(`${e.message}${state.installStarted ? ' Your pre-install backup is still available from the Review step.' : ''}`, 'error');
      }
    };
  }

  function renderDone() {
    host.innerHTML = panel('COMPLETE', 'The Kollection is installed.',
      'The selected Nuvio profile now has the Kaoxt collection, the required AIOMetadata catalog configurations, and the installer’s own Bingecat catalogs wired into For You.',
      `<div class="card"><div class="done-mark">✓</div>
        <div class="summary">
          <div class="summary-item"><span class="icon">✓</span><div><b>AIOMetadata provisioned</b><span>${state.aiInstalls.length} configuration${state.aiInstalls.length === 1 ? '' : 's'} installed for ${state.aiNeededCatalogs.length} required catalogs.</span></div></div>
          <div class="summary-item"><span class="icon">✓</span><div><b>Bingecat personalized</b><span>The creator’s Bingecat IDs were replaced with this installer’s manifest ID and recommendation catalogs.</span></div></div>
          <div class="summary-item"><span class="icon">✓</span><div><b>Nuvio synced</b><span>The Kollection was merged with unrelated existing groups and pushed to profile ${state.profileId}.</span></div></div>
        </div>
        <div class="actions"><button class="ghost" id="recordBtn">Download setup record</button><a class="btn" href="https://nuvio.tv/" target="_blank" rel="noopener">Open Nuvio ↗</a></div>
      </div>`);
    $('#recordBtn').onclick = () => downloadJson(`the-kollection-setup-${new Date().toISOString().slice(0,10)}.json`, {
      completedAt: new Date().toISOString(),
      profile: { id: state.profileId, name: state.profileName },
      aiometadata: { instances: state.aiInstalls.length, catalogs: state.aiNeededCatalogs.length },
      bingecat: { addonId: state.bingecatAddonId, nonSearchCatalogs: bingecatDisplayCatalogs().length },
      collections: { before: state.existingCollections.length, after: state.finalCollections?.length || 0 },
    });
  }

  function render() {
    renderNav();
    const fn = [renderWelcome, renderNuvio, renderAi, renderBingecat, renderReview, renderInstall, renderDone][state.step];
    fn();
  }

  $('#resetBtn').onclick = () => {
    if (!confirm('Start over? This clears this browser-tab wizard session. It does not undo changes already synced to Nuvio.')) return;
    Object.assign(state, {
      step: 0,
      token: null,
      userId: null,
      profiles: [],
      profileId: null,
      profileName: null,
      addonProfileId: null,
      addons: [],
      existingCollections: [],
      mdblistKey: '',
      tmdbKey: '',
      aiHostPreference: 'auto',
      aiBaseConfig: null,
      aiCatalogLibrary: [],
      aiNeededCatalogs: [],
      aiChunks: [],
      aiInstalls: [],
      collectionPack: null,
      bingecatManifestUrl: '',
      bingecatManifest: null,
      bingecatAddonId: '',
      bingecatCatalogs: [],
      backup: null,
      previewCollections: null,
      finalCollections: null,
      installStarted: false,
    });
    setStep(0);
  };

  render();
})();
