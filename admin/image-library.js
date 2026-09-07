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

      if (!state.images.length && !state.loading) {
        loadLibrary();
      }
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
    el.refreshButton.disabled = true;

    try {
      const all = [];
      let cursor = '';

      do {
        const page = await fetchPage(cursor);
        all.push(...(page.images || []));
        cursor = page.cursor || '';
      } while (cursor);

      state.images = all.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));

      populateCategories();
      applyFilters();

      const folders = new Set(state.images.map((item) => item.folder).filter(Boolean));
      el.librarySummary.textContent =
        `${state.images.length.toLocaleString()} image files across ${folders.size.toLocaleString()} artwork folders.`;
    } catch (error) {
      state.images = [];
      state.filtered = [];
      el.imageGrid.innerHTML = '';
      setMessage(el.libraryMessage, error.message || 'Could not load the image library.');
      el.librarySummary.textContent = 'Image library unavailable.';
    } finally {
      state.loading = false;
      el.refreshButton.disabled = false;
    }
  }

  function populateCategories() {
    const current = el.categoryFilter.value;
    const categories = [...new Set(
      state.images.map((item) => item.category).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    el.categoryFilter.innerHTML =
      '<option value="">All categories</option>' +
      categories.map((category) =>
        `<option value="${esc(category)}">${esc(category)}</option>`
      ).join('');

    if (categories.includes(current)) el.categoryFilter.value = current;
  }

  function applyFilters() {
    const query = el.searchInput.value.trim().toLowerCase();
    const category = el.categoryFilter.value;
    const type = el.typeFilter.value;

    state.filtered = state.images.filter((item) => {
      if (category && item.category !== category) return false;
      if (type && item.filename !== type) return false;

      if (query) {
        const haystack = `${item.path} ${item.folder} ${item.category} ${item.filename}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    state.visible = Math.min(Math.max(state.visible, 60), state.filtered.length || 60);
    renderGrid();
  }

  function labelFor(filename) {
    if (filename === 'cover.webp') return 'Cover';
    if (filename === 'backdrop.webp') return 'Backdrop';
    if (filename === 'logo.webp') return 'Logo';
    return filename.replace(/\.[^.]+$/, '');
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

    el.imageGrid.querySelectorAll('.copy-url-button').forEach((button) => {
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

  loadSession();
})();
