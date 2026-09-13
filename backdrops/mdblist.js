(() => {
  'use strict';

  const MDBLIST_KEY = 'kollection-backdrops-mdblist-key-v1';
  const TMDB_KEY = 'kollection-backdrops-tmdb-key-v1';
  const LIST_CACHE_PREFIX = 'kollection-backdrops-mdblist-cache-v1:';
  const CACHE_TTL = 30 * 60 * 1000;

  const $ = id => document.getElementById(id);
  const els = {
    titleSource: $('titleSource'), tmdbTitleSource: $('tmdbTitleSource'), mdblistTitleSource: $('mdblistTitleSource'),
    mdblistKey: $('mdblistKey'), toggleMdblistKey: $('toggleMdblistKey'), saveMdblistKey: $('saveMdblistKey'), validateMdblistKey: $('validateMdblistKey'), mdblistKeyStatus: $('mdblistKeyStatus'),
    mdblistMode: $('mdblistMode'), mdblistUsernameRow: $('mdblistUsernameRow'), mdblistUsername: $('mdblistUsername'), searchMdblistUser: $('searchMdblistUser'),
    mdblistUrlRow: $('mdblistUrlRow'), mdblistUrl: $('mdblistUrl'), loadMdblistUrl: $('loadMdblistUrl'), mdblistListRow: $('mdblistListRow'), mdblistList: $('mdblistList'),
    mdblistMediaRow: $('mdblistMediaRow'), mdblistMediaType: $('mdblistMediaType'), loadMdblistTitles: $('loadMdblistTitles'), mdblistStatus: $('mdblistStatus'), mdblistTitleResults: $('mdblistTitleResults')
  };

  if (!els.titleSource || !els.mdblistTitleSource) return;

  function saved(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
  function save(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {} }
  function status(el, message, type='') {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok','error');
    if (type) el.classList.add(type);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function mdblistKey() { return String(els.mdblistKey?.value || saved(MDBLIST_KEY)).trim(); }
  function tmdbKey() { return String(document.getElementById('tmdbKey')?.value || saved(TMDB_KEY)).trim(); }

  async function mdblistFetch(path, params={}) {
    const url = new URL(`https://api.mdblist.com/${path.replace(/^\/+/, '')}`);
    const key = mdblistKey();
    if (key) url.searchParams.set('apikey', key);
    Object.entries(params).forEach(([k,v]) => { if (v !== '' && v != null) url.searchParams.set(k, String(v)); });
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, cache: 'default' });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('MDBList rejected this API key.');
      if (response.status === 429) throw new Error('MDBList rate limit reached. Try again shortly.');
      throw new Error(`MDBList request failed (${response.status}).`);
    }
    return response.json();
  }

  async function validateKey() {
    const key = mdblistKey();
    if (!key) return status(els.mdblistKeyStatus, 'Paste an MDBList API key first.', 'error');
    els.validateMdblistKey.disabled = true;
    status(els.mdblistKeyStatus, 'Testing directly with MDBList…');
    try {
      await mdblistFetch('user');
      save(MDBLIST_KEY, key);
      status(els.mdblistKeyStatus, 'MDBList key works and is saved in this browser.', 'ok');
      if (els.titleSource.value === 'mdblist') await refreshLists();
    } catch (error) {
      status(els.mdblistKeyStatus, error.message || 'Could not validate MDBList key.', 'error');
    } finally { els.validateMdblistKey.disabled = false; }
  }

  function getListPath(list) {
    return els.mdblistMode.value === 'official' && list.slug ? `official/${list.slug}` : String(list.id ?? list.slug ?? '');
  }

  function listLabel(list) {
    const count = list.items != null ? ` (${list.items})` : '';
    const user = list.user_name ? ` · ${list.user_name}` : '';
    return `${list.name || list.title || 'Untitled list'}${count}${user}`;
  }

  function populateLists(lists) {
    els.mdblistList.innerHTML = '<option value="">Choose a list…</option>';
    (lists || []).forEach(list => {
      const value = getListPath(list);
      if (!value) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = listLabel(list);
      els.mdblistList.appendChild(option);
    });
  }

  async function refreshLists() {
    const mode = els.mdblistMode.value;
    els.mdblistUsernameRow.hidden = mode !== 'user';
    els.mdblistUrlRow.hidden = mode !== 'url';
    els.mdblistListRow.hidden = mode === 'url';
    els.mdblistMediaRow.hidden = mode !== 'official';
    els.mdblistTitleResults.innerHTML = '';

    if (mode === 'url' || mode === 'user') {
      populateLists([]);
      status(els.mdblistStatus, mode === 'url' ? 'Paste an MDBList list URL, then load it.' : 'Enter an MDBList username to search their lists.');
      return;
    }

    if (!mdblistKey()) {
      populateLists([]);
      status(els.mdblistStatus, 'Add your MDBList API key above to browse lists.', 'error');
      return;
    }

    const endpoints = { 'my-lists':'lists/user', official:'lists/official', top:'lists/top' };
    const endpoint = endpoints[mode];
    if (!endpoint) return;
    status(els.mdblistStatus, 'Loading MDBList lists…');
    try {
      const data = await mdblistFetch(endpoint, mode === 'top' ? { limit: 25 } : {});
      const lists = Array.isArray(data) ? data : (data.lists || data.data || []);
      populateLists(lists);
      status(els.mdblistStatus, lists.length ? `Loaded ${lists.length} list${lists.length === 1 ? '' : 's'}. Choose one below.` : 'No lists found.', lists.length ? 'ok' : '');
    } catch (error) {
      populateLists([]);
      status(els.mdblistStatus, error.message || 'Could not load MDBList lists.', 'error');
    }
  }

  async function searchUserLists() {
    const username = els.mdblistUsername.value.trim();
    if (!username) return status(els.mdblistStatus, 'Enter an MDBList username first.', 'error');
    if (!mdblistKey()) return status(els.mdblistStatus, 'Add your MDBList API key first.', 'error');
    els.searchMdblistUser.disabled = true;
    status(els.mdblistStatus, `Loading ${username}'s lists…`);
    try {
      const data = await mdblistFetch(`lists/user/${encodeURIComponent(username)}`);
      const lists = Array.isArray(data) ? data : (data.lists || data.data || []);
      populateLists(lists);
      els.mdblistListRow.hidden = false;
      status(els.mdblistStatus, lists.length ? `Found ${lists.length} list${lists.length === 1 ? '' : 's'} for ${username}.` : 'No lists found for that username.', lists.length ? 'ok' : '');
    } catch (error) {
      status(els.mdblistStatus, error.message || 'Could not search this MDBList user.', 'error');
    } finally { els.searchMdblistUser.disabled = false; }
  }

  function parseListUrl() {
    const raw = els.mdblistUrl.value.trim();
    const match = raw.match(/mdblist\.com\/lists\/([^?#]+)/i);
    if (!match) throw new Error('Use an MDBList URL like https://mdblist.com/lists/user/list-name');
    return match[1].replace(/\/$/, '');
  }

  function listItemsFromResponse(data) {
    const items = [];
    (data.movies || []).forEach(item => {
      const id = item.ids?.tmdb || item.tmdb_id || item.id;
      if (id) items.push({ id:Number(id), media:'movie', title:item.title || item.name || 'Movie' });
    });
    (data.shows || []).forEach(item => {
      const id = item.ids?.tmdb || item.tmdb_id || item.id;
      if (id) items.push({ id:Number(id), media:'tv', title:item.title || item.name || 'TV Show' });
    });
    if (Array.isArray(data)) {
      data.forEach(item => {
        const type = item.type === 'show' || item.media_type === 'tv' ? 'tv' : 'movie';
        const inner = type === 'tv' ? (item.show || item) : (item.movie || item);
        const id = inner.ids?.tmdb || inner.tmdb_id || inner.id;
        if (id) items.push({ id:Number(id), media:type, title:inner.title || inner.name || 'Untitled' });
      });
    }
    return items;
  }

  function cacheKey(listPath, mediaType) { return `${LIST_CACHE_PREFIX}${listPath}|${mediaType || 'all'}`; }
  function readCache(listPath, mediaType) {
    try {
      const raw = localStorage.getItem(cacheKey(listPath, mediaType));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Date.now() - parsed.savedAt < CACHE_TTL && Array.isArray(parsed.items) ? parsed.items : null;
    } catch { return null; }
  }
  function writeCache(listPath, mediaType, items) {
    try { localStorage.setItem(cacheKey(listPath, mediaType), JSON.stringify({ savedAt:Date.now(), items })); } catch {}
  }

  async function resolveTmdbItem(item) {
    if (!window.KollectionBackdrops?.tmdbFetch) throw new Error('Backdrop preview is still loading. Try again.');
    const data = await window.KollectionBackdrops.tmdbFetch(`/${item.media}/${item.id}`, { language:'en-US' });
    return {
      id: data.id,
      media: item.media,
      title: data.title || data.name || item.title || 'Untitled',
      year: String(data.release_date || data.first_air_date || '').slice(0,4),
      backdropPath: data.backdrop_path || '',
      posterPath: data.poster_path || ''
    };
  }

  async function loadListTitles(forcedPath='') {
    if (!tmdbKey()) return status(els.mdblistStatus, 'Add your TMDB key first so list titles can resolve to their TMDB backdrops.', 'error');
    let listPath = forcedPath;
    if (!listPath) {
      if (els.mdblistMode.value === 'url') {
        try { listPath = parseListUrl(); } catch (error) { return status(els.mdblistStatus, error.message, 'error'); }
      } else listPath = els.mdblistList.value;
    }
    if (!listPath) return status(els.mdblistStatus, 'Choose an MDBList list first.', 'error');

    const mediaType = els.mdblistMode.value === 'official' ? els.mdblistMediaType.value : '';
    els.loadMdblistTitles.disabled = true;
    status(els.mdblistStatus, 'Loading titles from MDBList…');
    try {
      let baseItems = readCache(listPath, mediaType);
      if (!baseItems) {
        const data = await mdblistFetch(`lists/${listPath}/items`, { limit:1000, mediatype:mediaType });
        baseItems = listItemsFromResponse(data);
        writeCache(listPath, mediaType, baseItems);
      }
      if (!baseItems.length) throw new Error('This MDBList list does not contain any TMDB-linked movies or shows.');

      const previewItems = baseItems.slice(0, 60);
      const resolved = [];
      for (let i=0; i<previewItems.length; i += 8) {
        const batch = previewItems.slice(i, i+8);
        const results = await Promise.allSettled(batch.map(resolveTmdbItem));
        results.forEach(result => { if (result.status === 'fulfilled' && result.value.backdropPath) resolved.push(result.value); });
      }
      renderTitleResults(resolved);
      status(els.mdblistStatus, `Loaded ${resolved.length} title${resolved.length === 1 ? '' : 's'} with backdrops from this list. Choose one to preview.`, 'ok');
    } catch (error) {
      els.mdblistTitleResults.innerHTML = '';
      status(els.mdblistStatus, error.message || 'Could not load titles from this MDBList list.', 'error');
    } finally { els.loadMdblistTitles.disabled = false; }
  }

  function renderTitleResults(items) {
    els.mdblistTitleResults.innerHTML = items.map(item => `
      <button class="title-result" type="button" data-id="${item.id}" data-media="${item.media}">
        ${item.posterPath ? `<img src="https://image.tmdb.org/t/p/w185${item.posterPath}" alt="" loading="lazy">` : '<span class="title-result-placeholder">▧</span>'}
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.year || (item.media === 'movie' ? 'Movie' : 'TV Show'))}</small></span>
      </button>`).join('');
    els.mdblistTitleResults.querySelectorAll('.title-result').forEach((button,index) => {
      button.addEventListener('click', () => window.KollectionBackdrops?.selectTitle?.(items[index]));
    });
  }

  function syncSource() {
    const isMDBList = els.titleSource.value === 'mdblist';
    els.tmdbTitleSource.hidden = isMDBList;
    els.mdblistTitleSource.hidden = !isMDBList;
    if (isMDBList) refreshLists();
  }

  els.mdblistKey.value = saved(MDBLIST_KEY);
  if (els.mdblistKey.value) status(els.mdblistKeyStatus, 'MDBList key is saved in this browser.', 'ok');

  els.toggleMdblistKey.addEventListener('click', () => {
    els.mdblistKey.type = els.mdblistKey.type === 'password' ? 'text' : 'password';
    els.toggleMdblistKey.setAttribute('aria-label', els.mdblistKey.type === 'password' ? 'Show MDBList key' : 'Hide MDBList key');
  });
  els.saveMdblistKey.addEventListener('click', () => {
    const key = els.mdblistKey.value.trim();
    save(MDBLIST_KEY, key);
    status(els.mdblistKeyStatus, key ? 'MDBList key saved in this browser.' : 'Saved MDBList key removed.', key ? 'ok' : '');
  });
  els.validateMdblistKey.addEventListener('click', validateKey);
  els.titleSource.addEventListener('change', syncSource);
  els.mdblistMode.addEventListener('change', refreshLists);
  els.searchMdblistUser.addEventListener('click', searchUserLists);
  els.mdblistUsername.addEventListener('keydown', event => { if (event.key === 'Enter') searchUserLists(); });
  els.loadMdblistUrl.addEventListener('click', () => loadListTitles());
  els.mdblistUrl.addEventListener('keydown', event => { if (event.key === 'Enter') loadListTitles(); });
  els.loadMdblistTitles.addEventListener('click', () => loadListTitles());

  syncSource();
})();
