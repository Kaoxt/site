(() => {
  'use strict';

  const MODE_KEY = 'kollection-backdrop-source-mode-v1';
  const TARGET_KEY = 'kollection-backdrop-target-v1';

  const app = document.querySelector('.backdrop-app');
  const modeSelect = document.getElementById('backdropSourceMode');
  const collectionSelect = document.getElementById('backdropCollection');
  const folderSelect = document.getElementById('backdropFolder');
  const collectionField = document.getElementById('backdropCollectionField');
  const folderField = document.getElementById('backdropFolderField');
  const status = document.getElementById('collectionBackdropStatus');
  const currentPreview = document.getElementById('collectionCurrentPreview');
  const currentImage = document.getElementById('collectionCurrentImage');
  const currentEmpty = document.getElementById('collectionCurrentEmpty');
  const currentTitle = document.getElementById('collectionCurrentTitle');
  const currentCopy = document.getElementById('collectionCurrentCopy');
  const previewTitle = document.getElementById('previewTitle');
  const targetLine = document.getElementById('backdropTargetLine');
  const titleText = document.getElementById('titleText');

  if (!app || !modeSelect) return;

  let setups = [];
  let folders = [];

  function setStatus(message, type = '') {
    if (!status) return;
    status.textContent = message || '';
    status.classList.remove('ok', 'error');
    if (type) status.classList.add(type);
  }

  function readStored(key, fallback = '') {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  }

  function writeStored(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function savedTarget() {
    try { return JSON.parse(readStored(TARGET_KEY, '{}')); } catch (_) { return {}; }
  }

  function saveTarget() {
    const payload = {
      setupId: collectionSelect?.value || '',
      folderKey: folderSelect?.value || '',
      folderName: folderSelect?.selectedOptions?.[0]?.textContent || '',
    };
    writeStored(TARGET_KEY, JSON.stringify(payload));
    return payload;
  }

  function firstUrl(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const preferred = [
      'backdropUrl','backdrop_url','backgroundUrl','background_url','imageUrl','image_url',
      'heroUrl','hero_url','coverUrl','cover_url','landscapeUrl','landscape_url'
    ];
    for (const key of preferred) {
      const value = obj[key];
      if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
    }
    return '';
  }

  function candidateName(obj, fallback = '') {
    return String(obj?.name || obj?.title || obj?.label || obj?.collectionName || obj?.folderName || fallback || '').trim();
  }

  function collectFolderCandidates(root) {
    const out = [];
    const seenObjects = new WeakSet();
    const seenKeys = new Set();

    function visit(value, path = 'config') {
      if (!value || typeof value !== 'object') return;
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      if (!Array.isArray(value)) {
        const name = candidateName(value);
        const id = value.id ?? value.key ?? value.slug ?? value.folderId ?? value.collectionId ?? '';
        const url = firstUrl(value);
        const looksLikeFolder = Boolean(name) && (
          /folder|collection|catalog|section|group/i.test(path) ||
          value.folderId != null || value.collectionId != null || value.catalogId != null ||
          url
        );
        if (looksLikeFolder) {
          const key = String(id || path);
          const dedupe = `${key}|${name}`;
          if (!seenKeys.has(dedupe)) {
            seenKeys.add(dedupe);
            out.push({ key, name, url, raw: value, path });
          }
        }
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
      } else {
        Object.entries(value).forEach(([key, child]) => {
          if (child && typeof child === 'object') visit(child, `${path}.${key}`);
        });
      }
    }

    visit(root);
    return out.filter(item => item.name && item.name.length <= 90).slice(0, 250);
  }

  function setupBackdrop(setup) {
    if (!setup) return '';
    const direct = firstUrl(setup) || firstUrl(setup.config);
    if (direct) return direct;
    let found = '';
    const seen = new WeakSet();
    function walk(value) {
      if (found || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const url = firstUrl(value);
      if (url) { found = url; return; }
      if (Array.isArray(value)) value.forEach(walk);
      else Object.values(value).forEach(walk);
    }
    walk(setup.config || setup);
    return found;
  }

  function selectedSetup() {
    return setups.find(item => String(item.id || '') === String(collectionSelect?.value || '')) || null;
  }

  function selectedFolder() {
    return folders.find(item => String(item.key) === String(folderSelect?.value || '')) || null;
  }

  function renderCurrentPreview() {
    const setup = selectedSetup();
    const folder = selectedFolder();
    const label = folder?.name || setup?.name || 'The Kollection backdrop';
    const url = folder?.url || setupBackdrop(setup);

    if (currentTitle) currentTitle.textContent = label;
    if (url && currentImage) {
      currentImage.src = url;
      currentImage.alt = `${label} backdrop`;
      currentImage.hidden = false;
      if (currentEmpty) currentEmpty.hidden = true;
      if (currentCopy) currentCopy.textContent = 'This is the backdrop already supplied by your saved collection setup.';
    } else {
      if (currentImage) {
        currentImage.hidden = true;
        currentImage.removeAttribute('src');
      }
      if (currentEmpty) currentEmpty.hidden = false;
      if (currentCopy) currentCopy.textContent = 'This collection will keep the backdrop already provided by The Kollection. Choose “Create my own backdrop” if you want to replace it.';
    }
  }

  function updateTargetLabel() {
    const setup = selectedSetup();
    const folder = selectedFolder();
    const name = folder?.name || setup?.name || 'your collection';
    if (targetLine) targetLine.innerHTML = `<strong>Target:</strong> ${escapeHtml(name)}`;
    if (modeSelect.value === 'custom' && previewTitle && !document.getElementById('backdropCanvas')?.dataset?.hasArtwork) {
      previewTitle.textContent = `Create a backdrop for ${name}`;
    }
    if (titleText && !titleText.value && folder?.name) titleText.placeholder = folder.name;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function applyMode() {
    const mode = modeSelect.value === 'custom' ? 'custom' : 'provided';
    app.classList.toggle('mode-provided', mode === 'provided');
    app.classList.toggle('mode-custom', mode === 'custom');
    writeStored(MODE_KEY, mode);
    renderCurrentPreview();
    updateTargetLabel();

    if (mode === 'provided') {
      if (previewTitle) previewTitle.textContent = 'Using your collection backdrop';
      setStatus('Default selected: keep the backdrop already provided with this collection.', 'ok');
    } else {
      const name = selectedFolder()?.name || selectedSetup()?.name || 'this collection';
      if (previewTitle) previewTitle.textContent = `Create a backdrop for ${name}`;
      setStatus('Custom mode selected. Your generated image is still rendered only in this browser.', 'ok');
    }
  }

  function populateFolders() {
    const setup = selectedSetup();
    folders = setup ? collectFolderCandidates(setup.config || setup) : [];
    const saved = savedTarget();

    if (!folderSelect || !folderField) return;
    folderSelect.innerHTML = '';

    if (!setup) {
      folderField.hidden = true;
      saveTarget();
      renderCurrentPreview();
      updateTargetLabel();
      return;
    }

    const whole = document.createElement('option');
    whole.value = '__setup__';
    whole.textContent = 'Entire collection setup';
    folderSelect.appendChild(whole);

    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.key;
      option.textContent = folder.name;
      folderSelect.appendChild(option);
    });

    folderField.hidden = false;
    if (saved.setupId === collectionSelect.value && [...folderSelect.options].some(opt => opt.value === saved.folderKey)) {
      folderSelect.value = saved.folderKey;
    }
    saveTarget();
    renderCurrentPreview();
    updateTargetLabel();
  }

  function populateSetups() {
    if (!collectionSelect || !collectionField) return;
    const saved = savedTarget();
    collectionSelect.innerHTML = '';

    if (!setups.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved collections found';
      collectionSelect.appendChild(option);
      collectionField.hidden = false;
      folderField.hidden = true;
      return;
    }

    setups.forEach((setup, index) => {
      const option = document.createElement('option');
      option.value = String(setup.id || index);
      option.textContent = setup.name || `Saved Collection ${index + 1}`;
      collectionSelect.appendChild(option);
    });

    if (saved.setupId && [...collectionSelect.options].some(opt => opt.value === saved.setupId)) collectionSelect.value = saved.setupId;
    collectionField.hidden = false;
    populateFolders();
  }

  async function waitForAuth(maxMs = 6500) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      if (window.KollectionNuvioAuth?.getSession) return true;
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    return false;
  }

  async function loadCollections() {
    setStatus('Checking for saved collection setups…');
    try {
      await waitForAuth();
      const session = await window.KollectionNuvioAuth?.getSession?.();
      if (!session?.authenticated) {
        setups = [];
        populateSetups();
        setStatus('Sign in to choose one of your saved collections. You can still create a standalone backdrop.', '');
        return;
      }

      const response = await fetch('/api/account/collections', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Could not load saved collections (${response.status}).`);
      setups = Array.isArray(body.collections) ? body.collections : [];
      populateSetups();
      setStatus(setups.length ? 'Choose the saved collection or folder this backdrop is for.' : 'No saved collections found yet.', setups.length ? 'ok' : '');
    } catch (error) {
      setups = [];
      populateSetups();
      setStatus(error?.message || 'Could not load saved collections.', 'error');
    }
  }

  modeSelect.value = readStored(MODE_KEY, 'provided') === 'custom' ? 'custom' : 'provided';
  modeSelect.addEventListener('change', applyMode);
  collectionSelect?.addEventListener('change', () => { populateFolders(); applyMode(); });
  folderSelect?.addEventListener('change', () => { saveTarget(); renderCurrentPreview(); updateTargetLabel(); });

  window.addEventListener('kollection:nuvio-signed-in', loadCollections);
  window.addEventListener('kollection:nuvio-signed-out', loadCollections);
  window.addEventListener('kollection:setup-synced', loadCollections);

  applyMode();
  loadCollections();
})();
