(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    session: null,
    images: [],
    filtered: [],
    visible: 60,
    loading: false,
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

    libraryShell: $('libraryShell'),
    libraryMessage: $('libraryMessage'),
    librarySummary: $('librarySummary'),
    refreshButton: $('refreshButton'),

    uploadForm: $('uploadForm'),
    uploadMessage: $('uploadMessage'),
    uploadCategorySelect: $('uploadCategorySelect'),
    uploadNewCategory: $('uploadNewCategory'),
    newCategoryField: $('newCategoryField'),
    uploadFolder: $('uploadFolder'),
    coverFile: $('coverFile'),
    backdropFile: $('backdropFile'),
    logoFile: $('logoFile'),
    coverFileName: $('coverFileName'),
    backdropFileName: $('backdropFileName'),
    logoFileName: $('logoFileName'),
    uploadPathPreview: $('uploadPathPreview'),
    uploadButton: $('uploadButton'),
    uploadResult: $('uploadResult'),

    recentGrid: $('recentGrid'),

    searchInput: $('searchInput'),
    categoryFilter: $('categoryFilter'),
    typeFilter: $('typeFilter'),
    resultCount: $('resultCount'),
    imageGrid: $('imageGrid'),
    loadMoreButton: $('loadMoreButton'),
    copyVisibleButton: $('copyVisibleButton'),
  };

  function setMessage(target, text, kind = 'error') {
    target.hidden = false;
    target.className = `admin-message ${kind}`;
    target.textContent = text;
  }

  function clearMessage(target) {
    target.hidden = true;
    target.textContent = '';
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[c]));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function renderSession() {
    const s = state.session;
    const authenticated = Boolean(s?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;
    el.libraryShell.hidden = true;

    if (!authenticated) {
      el.authState.textContent = 'Signed out';
      el.authState.className = 'auth-state';
      return;
    }

    const email = s.user?.email || 'Nuvio account';
    el.signedInEmail.textContent = email;
    el.signedInAvatar.textContent = email.charAt(0).toUpperCase() || 'N';

    if (s.isAdmin) {
      el.authState.textContent = 'Administrator';
      el.authState.className = 'auth-state good';
      el.signedInRole.textContent = 'Authorized administrator';
      el.libraryShell.hidden = false;
      clearMessage(el.authMessage);

      if (!state.images.length && !state.loading) loadLibrary();
    } else {
      el.authState.textContent = 'Not authorized';
      el.authState.className = 'auth-state bad';
      el.signedInRole.textContent = 'Valid Nuvio account · not an administrator';
      setMessage(
        el.authMessage,
        'This Nuvio account is signed in, but it is not authorized to view the private Kollection image library.'
      );
    }
  }

  async function loadSession() {
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
        deviceName: 'The Kollection Image Library',
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
    try {
      await window.KollectionNuvioAuth.signOut();
    } finally {
      state.session = { authenticated: false, isAdmin: false };
      state.images = [];
      state.filtered = [];
      el.nuvioAdminStatus.textContent = '';
      renderSession();
    }
  });

  async function fetchPage(cursor = '') {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`/api/admin/images?${params.toString()}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || `Could not load image library (${res.status}).`);
    }

    return data;
  }

  async function loadLibrary() {
    state.loading = true;
    state.visible = 60;
    clearMessage(el.libraryMessage);
    el.imageGrid.innerHTML = '<div class="library-loading">Loading artwork from R2…</div>';
    el.recentGrid.innerHTML = '<div class="recent-empty">Loading recent uploads…</div>';
    el.refreshButton.disabled = true;

    try {
      const all = [];
      let cursor = '';

      do {
        const page = await fetchPage(cursor);
        all.push(...(page.images || []));
        cursor = page.cursor || '';
      } while (cursor);

      state.images = all.sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })
      );

      populateCategories();
      renderRecent();
      applyFilters();

      const folders = new Set(state.images.map((item) => item.folder).filter(Boolean));
      el.librarySummary.textContent =
        `${state.images.length.toLocaleString()} image files across ${folders.size.toLocaleString()} artwork folders.`;
    } catch (error) {
      state.images = [];
      state.filtered = [];
      el.imageGrid.innerHTML = '';
      el.recentGrid.innerHTML = '';
      setMessage(el.libraryMessage, error.message || 'Could not load the image library.');
      el.librarySummary.textContent = 'Image library unavailable.';
    } finally {
      state.loading = false;
      el.refreshButton.disabled = false;
    }
  }

  function populateCategories() {
    const currentFilter = el.categoryFilter.value;
    const currentUpload = el.uploadCategorySelect.value;

    const categories = [...new Set(
      state.images.map((item) => item.category).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    el.categoryFilter.innerHTML =
      '<option value="">All categories</option>' +
      categories.map((category) =>
        `<option value="${esc(category)}">${esc(category)}</option>`
      ).join('');

    el.uploadCategorySelect.innerHTML =
      '<option value="">Choose Category</option>' +
      categories.map((category) =>
        `<option value="${esc(category)}">${esc(category)}</option>`
      ).join('') +
      '<option value="__new__">+ Create New Category…</option>';

    if (categories.includes(currentFilter)) el.categoryFilter.value = currentFilter;

    if (currentUpload === '__new__') {
      el.uploadCategorySelect.value = '__new__';
    } else if (categories.includes(currentUpload)) {
      el.uploadCategorySelect.value = currentUpload;
    }

    syncNewCategoryField();
  }

  function labelFor(filename) {
    if (filename === 'cover.webp') return 'Cover';
    if (filename === 'backdrop.webp') return 'Backdrop';
    if (filename === 'logo.webp') return 'Logo';
    return filename.replace(/\.[^.]+$/, '');
  }

  function prettyDate(value) {
    if (!value) return 'Unknown upload time';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Unknown upload time';

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  }

  function renderRecent() {
    const recent = [...state.images]
      .filter((item) => item.uploaded)
      .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))
      .slice(0, 12);

    if (!recent.length) {
      el.recentGrid.innerHTML = '<div class="recent-empty">No recent R2 uploads found yet.</div>';
      return;
    }

    el.recentGrid.innerHTML = recent.map((item) => `
      <article class="recent-card">
        <a class="recent-thumb" href="${esc(item.url)}" target="_blank" rel="noopener">
          <img src="${esc(item.url)}" alt="${esc(item.folder || item.filename)}" loading="lazy" decoding="async" />
        </a>
        <div class="recent-copy">
          <strong>${esc(item.folder || item.filename)} · ${esc(labelFor(item.filename))}</strong>
          <small>${esc(item.path)}<br>${esc(prettyDate(item.uploaded))}</small>
          <div class="recent-actions">
            <button class="copy-url-button" type="button" data-url="${esc(item.url)}">Copy URL</button>
          </div>
        </div>
      </article>
    `).join('');

    bindCopyButtons(el.recentGrid);
  }

  function applyFilters() {
    const query = el.searchInput.value.trim().toLowerCase();
    const category = el.categoryFilter.value;
    const type = el.typeFilter.value;

    state.filtered = state.images.filter((item) => {
      if (category && item.category !== category) return false;
      if (type && item.filename !== type) return false;

      if (query) {
        const haystack =
          `${item.path} ${item.folder} ${item.category} ${item.filename}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    state.visible = Math.min(Math.max(state.visible, 60), state.filtered.length || 60);
    renderGrid();
  }

  function cardHtml(item) {
    const label = labelFor(item.filename);
    const previewClass = item.filename === 'logo.webp' ? ' logo-preview' : '';
    const title = item.folder || item.filename;

    return `
      <article class="image-card">
        <a class="image-preview${previewClass}" href="${esc(item.url)}" target="_blank" rel="noopener">
          <img src="${esc(item.url)}" alt="${esc(title)} ${esc(label)}" loading="lazy" decoding="async" />
          <span class="image-preview-badge">${esc(label)}</span>
        </a>
        <div class="image-card-body">
          <h3 class="image-card-title">${esc(title)}</h3>
          <span class="image-card-path">${esc(item.path)}</span>
          <div class="image-card-actions">
            <button class="copy-url-button" type="button" data-url="${esc(item.url)}">Copy URL</button>
            <a class="open-image-button" href="${esc(item.url)}" target="_blank" rel="noopener">Open</a>
          </div>
        </div>
      </article>
    `;
  }

  function bindCopyButtons(container) {
    container.querySelectorAll('.copy-url-button').forEach((button) => {
      button.addEventListener('click', async () => {
        const original = button.textContent;
        try {
          await copyText(button.dataset.url || '');
          button.textContent = 'Copied';
          button.classList.add('copied');
          setTimeout(() => {
            button.textContent = original;
            button.classList.remove('copied');
          }, 1300);
        } catch {
          setMessage(el.libraryMessage, 'Could not copy that URL. Open the image and copy the address manually.');
        }
      });
    });
  }

  function renderGrid() {
    const total = state.filtered.length;
    const shown = state.filtered.slice(0, state.visible);

    el.resultCount.textContent =
      `${total.toLocaleString()} image${total === 1 ? '' : 's'}`;

    if (!shown.length) {
      el.imageGrid.innerHTML = '<div class="library-empty">No artwork matches your filters.</div>';
      el.loadMoreButton.hidden = true;
      return;
    }

    el.imageGrid.innerHTML = shown.map(cardHtml).join('');
    el.loadMoreButton.hidden = shown.length >= total;
    el.loadMoreButton.textContent =
      `Load more (${Math.min(60, total - shown.length).toLocaleString()})`;

    bindCopyButtons(el.imageGrid);
  }

  function updateFileLabel(input, label) {
    const file = input.files?.[0];
    label.textContent = file ? file.name : 'Choose WebP';
    input.closest('.artwork-file-box')?.classList.toggle('has-file', Boolean(file));
  }

  function cleanDisplayPart(value) {
    return String(value || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function syncNewCategoryField() {
    const creating = el.uploadCategorySelect.value === '__new__';
    el.newCategoryField.hidden = !creating;
    el.uploadNewCategory.required = creating;

    if (!creating) {
      el.uploadNewCategory.value = '';
    }
  }

  function getUploadCategory() {
    if (el.uploadCategorySelect.value === '__new__') {
      return cleanDisplayPart(el.uploadNewCategory.value);
    }
    return cleanDisplayPart(el.uploadCategorySelect.value);
  }

  function updateUploadPreview() {
    const category = getUploadCategory() || 'Category';
    const folder = cleanDisplayPart(el.uploadFolder.value) || 'Folder';

    const names = [];
    if (el.coverFile.files?.[0]) names.push('cover.webp');
    if (el.backdropFile.files?.[0]) names.push('backdrop.webp');
    if (el.logoFile.files?.[0]) names.push('logo.webp');

    el.uploadPathPreview.textContent =
      `images/${category}/${folder}/${names.length ? names.join(', ') : '…'}`;
  }

  [
    [el.coverFile, el.coverFileName],
    [el.backdropFile, el.backdropFileName],
    [el.logoFile, el.logoFileName],
  ].forEach(([input, label]) => {
    input.addEventListener('change', () => {
      updateFileLabel(input, label);
      updateUploadPreview();
    });
  });

  el.uploadCategorySelect.addEventListener('change', () => {
    syncNewCategoryField();
    updateUploadPreview();
  });
  el.uploadNewCategory.addEventListener('input', updateUploadPreview);
  el.uploadFolder.addEventListener('input', updateUploadPreview);

  el.uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(el.uploadMessage);
    el.uploadResult.hidden = true;
    el.uploadResult.innerHTML = '';

    const category = getUploadCategory();
    const folder = cleanDisplayPart(el.uploadFolder.value);
    const selected = [
      ['cover.webp', el.coverFile.files?.[0]],
      ['backdrop.webp', el.backdropFile.files?.[0]],
      ['logo.webp', el.logoFile.files?.[0]],
    ].filter(([, file]) => Boolean(file));

    if (!category) {
      return setMessage(
        el.uploadMessage,
        el.uploadCategorySelect.value === '__new__'
          ? 'Enter a name for the new image category.'
          : 'Choose an image category or create a new one.'
      );
    }
    if (!folder) return setMessage(el.uploadMessage, 'Enter an artwork folder.');
    if (!selected.length) return setMessage(el.uploadMessage, 'Choose at least one WebP image.');

    for (const [, file] of selected) {
      if (!/\.webp$/i.test(file.name) && file.type !== 'image/webp') {
        return setMessage(el.uploadMessage, `${file.name} is not a WebP image.`);
      }
      if (file.size > 12_000_000) {
        return setMessage(el.uploadMessage, `${file.name} is larger than the 12 MB upload limit.`);
      }
    }

    const replacementPaths = selected
      .map(([filename]) => `images/${category}/${folder}/${filename}`)
      .filter((key) => state.images.some((item) => item.key === key));

    if (
      replacementPaths.length &&
      !window.confirm(
        `This will replace ${replacementPaths.length} existing image${replacementPaths.length === 1 ? '' : 's'}:\n\n` +
        replacementPaths.join('\n') +
        '\n\nContinue?'
      )
    ) {
      return;
    }

    const form = new FormData();
    form.set('category', category);
    form.set('folder', folder);
    if (el.coverFile.files?.[0]) form.set('cover', el.coverFile.files[0]);
    if (el.backdropFile.files?.[0]) form.set('backdrop', el.backdropFile.files[0]);
    if (el.logoFile.files?.[0]) form.set('logo', el.logoFile.files[0]);

    const oldText = el.uploadButton.textContent;
    el.uploadButton.disabled = true;
    el.uploadButton.textContent = 'Uploading…';

    try {
      const res = await fetch('/api/admin/upload-image', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `Upload failed (${res.status}).`);
      }

      const links = (data?.files || []).map((item) =>
        `<div><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.url)}</a></div>`
      ).join('');

      el.uploadResult.innerHTML =
        `<strong>${esc(data?.message || 'Artwork uploaded.')}</strong>` +
        (data?.warning ? `<div>${esc(data.warning)}</div>` : '') +
        links +
        (data?.githubCommitUrl
          ? `<div><a href="${esc(data.githubCommitUrl)}" target="_blank" rel="noopener">View GitHub commit</a></div>`
          : '');

      el.uploadResult.hidden = false;

      [el.coverFile, el.backdropFile, el.logoFile].forEach((input) => { input.value = ''; });
      [
        [el.coverFile, el.coverFileName],
        [el.backdropFile, el.backdropFileName],
        [el.logoFile, el.logoFileName],
      ].forEach(([input, label]) => updateFileLabel(input, label));

      const uploadedCategory = category;
      await loadLibrary();

      if ([...el.uploadCategorySelect.options].some((option) => option.value === uploadedCategory)) {
        el.uploadCategorySelect.value = uploadedCategory;
      }
      syncNewCategoryField();
      updateUploadPreview();
    } catch (error) {
      setMessage(el.uploadMessage, error.message || 'Could not upload the artwork.');
    } finally {
      el.uploadButton.disabled = false;
      el.uploadButton.textContent = oldText;
    }
  });

  let searchTimer = null;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.visible = 60;
      applyFilters();
    }, 100);
  });

  el.categoryFilter.addEventListener('change', () => {
    state.visible = 60;
    applyFilters();
  });

  el.typeFilter.addEventListener('change', () => {
    state.visible = 60;
    applyFilters();
  });

  el.loadMoreButton.addEventListener('click', () => {
    state.visible += 60;
    renderGrid();
  });

  el.refreshButton.addEventListener('click', loadLibrary);

  el.copyVisibleButton.addEventListener('click', async () => {
    const visible = state.filtered.slice(0, state.visible);
    if (!visible.length) return;

    try {
      await copyText(visible.map((item) => item.url).join('\n'));
      const old = el.copyVisibleButton.textContent;
      el.copyVisibleButton.textContent = 'Copied visible URLs';
      setTimeout(() => { el.copyVisibleButton.textContent = old; }, 1400);
    } catch {
      setMessage(el.libraryMessage, 'Could not copy the visible URLs.');
    }
  });

  syncNewCategoryField();
  updateUploadPreview();
  loadSession();
})();
