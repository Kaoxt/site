(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const folderTitle = params.get('folderTitle') || '';
  const folderKey = params.get('folder') || '';
  const groupTitle = params.get('groupTitle') || '';
  const groupKey = params.get('group') || '';
  if (!folderTitle && !folderKey) return;

  const STORAGE_PREFIX = 'kollection-folder-backdrop-v1:';
  const targetStorageKey = `${STORAGE_PREFIX}${encodeURIComponent(groupKey || groupTitle || 'collection')}:${encodeURIComponent(folderKey || folderTitle || 'folder')}`;
  const canvas = document.getElementById('backdropCanvas');
  const emptyState = document.getElementById('emptyState');
  const previewTitle = document.getElementById('previewTitle');
  const previewMeta = document.getElementById('previewMeta');
  const mdblistResults = document.getElementById('mdblistTitleResults');
  const workspaceFooter = document.querySelector('.workspace-footer');
  const originalDownload = document.getElementById('downloadBackdrop');
  const renderBusy = document.getElementById('renderBusy');
  const imageCache = new Map();
  let activeItems = [];

  function targetLabel() {
    return `${groupTitle ? `${groupTitle} · ` : ''}${folderTitle || 'Folder'}`;
  }

  function status(message, type='') {
    let el = document.getElementById('folderBackdropStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'folderBackdropStatus';
      el.className = 'status-line folder-backdrop-status';
      document.querySelector('.backdrop-source-card .control-card-body')?.appendChild(el);
    }
    el.textContent = message;
    el.classList.remove('ok','error');
    if (type) el.classList.add(type);
  }

  function updateCopy() {
    const pageSubtitle = document.querySelector('[data-page-subtitle]');
    if (pageSubtitle) pageSubtitle.textContent = `Create one backdrop for the ${folderTitle || 'selected'} folder. The backdrop can be built from TMDB titles or an MDBList list, and is saved separately for this folder.`;
    const chip = document.querySelector('[data-page-chip]');
    if (chip) chip.textContent = 'Folder Backdrop Builder';
    const heading = document.querySelector('.backdrop-source-card .control-card-heading strong');
    if (heading) heading.textContent = 'Create this folder backdrop';
    const modeLabel = document.querySelector('label[for="backdropSourceMode"]');
    if (modeLabel) modeLabel.textContent = 'Folder backdrop';
    const sourceSelect = document.getElementById('backdropSourceMode');
    if (sourceSelect) {
      sourceSelect.innerHTML = '<option value="original">Use default folder backdrop</option><option value="custom">Generate custom folder backdrop</option>';
      sourceSelect.value = 'custom';
      sourceSelect.dispatchEvent(new Event('change', { bubbles:true }));
    }
    if (previewTitle) previewTitle.textContent = folderTitle ? `${folderTitle} folder backdrop` : 'Folder backdrop';
    if (previewMeta) previewMeta.textContent = targetLabel();
    const explainer = document.querySelector('.per-title-explainer');
    if (explainer) explainer.innerHTML = `<strong>One backdrop for this folder</strong><span>This image belongs to the ${escapeHtml(folderTitle || 'selected')} folder only. Other folders keep their own default or custom backdrop.</span>`;
    if (emptyState) emptyState.innerHTML = `<div class="empty-icon" aria-hidden="true">▧</div><strong>Build ${escapeHtml(folderTitle || 'this folder')}'s backdrop</strong><span>Load an MDBList list or choose TMDB titles, then use them as the artwork source for this folder.</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve,reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    imageCache.set(url, promise);
    return promise;
  }

  async function resolveButton(button) {
    const id = Number(button.dataset.id);
    const media = button.dataset.media;
    if (!id || !media || !window.KollectionBackdrops?.tmdbFetch) return null;
    const data = await window.KollectionBackdrops.tmdbFetch(`/${media}/${id}`, { language:'en-US' });
    if (!data?.backdrop_path) return null;
    return {
      id,
      media,
      title: data.title || data.name || 'Untitled',
      backdropPath: data.backdrop_path,
      posterPath: data.poster_path || ''
    };
  }

  function drawCover(ctx, image, x, y, w, h) {
    const scale = Math.max(w/image.width, h/image.height);
    const sw = w/scale, sh = h/scale;
    const sx = (image.width-sw)/2, sy = (image.height-sh)/2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  async function renderCollage(items) {
    if (!canvas || !items.length) return;
    renderBusy && (renderBusy.hidden = false);
    try {
      const chosen = items.slice(0, 18);
      const images = (await Promise.allSettled(chosen.map(item => loadImage(`https://image.tmdb.org/t/p/original${item.backdropPath}`))))
        .filter(result => result.status === 'fulfilled').map(result => result.value);
      if (!images.length) throw new Error('No backdrop images could be loaded.');

      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#050608';
      ctx.fillRect(0,0,canvas.width,canvas.height);

      const cols = images.length <= 6 ? 3 : 4;
      const rows = Math.ceil(images.length / cols);
      const gap = 8;
      const cellW = (canvas.width - gap*(cols-1)) / cols;
      const cellH = (canvas.height - gap*(rows-1)) / rows;
      images.forEach((image,index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        drawCover(ctx,image,col*(cellW+gap),row*(cellH+gap),cellW,cellH);
      });

      const gradient = ctx.createLinearGradient(0,0,canvas.width,0);
      gradient.addColorStop(0,'rgba(0,0,0,.72)');
      gradient.addColorStop(.45,'rgba(0,0,0,.18)');
      gradient.addColorStop(1,'rgba(0,0,0,.08)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,canvas.width,canvas.height);

      activeItems = chosen;
      if (emptyState) emptyState.hidden = true;
      if (previewTitle) previewTitle.textContent = `${folderTitle || 'Folder'} backdrop`;
      if (previewMeta) previewMeta.textContent = `${chosen.length} title${chosen.length===1?'':'s'} · ${targetLabel()}`;
      if (originalDownload) originalDownload.disabled = false;
      status(`Built a backdrop for ${folderTitle || 'this folder'} from ${chosen.length} title${chosen.length===1?'':'s'}.`, 'ok');
    } finally {
      if (renderBusy) renderBusy.hidden = true;
    }
  }

  async function useLoadedMDBList() {
    const buttons = [...(mdblistResults?.querySelectorAll('.title-result') || [])];
    if (!buttons.length) return status('Load an MDBList list first.', 'error');
    status('Building this folder backdrop from the loaded MDBList…');
    const resolved = [];
    for (let i=0;i<buttons.length && resolved.length<18;i+=6) {
      const batch = buttons.slice(i,i+6);
      const results = await Promise.allSettled(batch.map(resolveButton));
      results.forEach(result => { if (result.status === 'fulfilled' && result.value) resolved.push(result.value); });
    }
    await renderCollage(resolved);
  }

  function injectListButton() {
    const source = document.getElementById('mdblistTitleSource');
    if (!source || source.querySelector('#useMdblistForFolder')) return;
    const button = document.createElement('button');
    button.id = 'useMdblistForFolder';
    button.type = 'button';
    button.className = 'primary-button full folder-list-build-button';
    button.textContent = 'Use loaded list for folder backdrop';
    button.addEventListener('click', useLoadedMDBList);
    mdblistResults?.insertAdjacentElement('beforebegin', button);
  }

  function injectActions() {
    if (!workspaceFooter || document.getElementById('saveFolderBackdrop')) return;
    const actions = document.createElement('div');
    actions.className = 'folder-builder-actions';

    const save = document.createElement('button');
    save.id = 'saveFolderBackdrop';
    save.className = 'secondary-button';
    save.type = 'button';
    save.textContent = 'Save for this folder';
    save.addEventListener('click', () => {
      if (!activeItems.length) return status('Build a folder backdrop first.', 'error');
      const recipe = {
        version:1,
        groupKey, groupTitle, folderKey, folderTitle,
        source: document.getElementById('titleSource')?.value || 'tmdb',
        mdblistMode: document.getElementById('mdblistMode')?.value || '',
        mdblistList: document.getElementById('mdblistList')?.value || '',
        mdblistUrl: document.getElementById('mdblistUrl')?.value || '',
        items: activeItems.map(item => ({ id:item.id, media:item.media, title:item.title, backdropPath:item.backdropPath })),
        savedAt: Date.now()
      };
      try { localStorage.setItem(targetStorageKey, JSON.stringify(recipe)); } catch {}
      status(`Saved this backdrop recipe for ${folderTitle || 'the folder'}.`, 'ok');
      save.textContent = 'Saved';
    });

    const download = document.createElement('button');
    download.className = 'primary-button';
    download.type = 'button';
    download.textContent = 'Download folder backdrop';
    download.addEventListener('click', () => {
      if (!activeItems.length || !canvas) return status('Build a folder backdrop first.', 'error');
      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${(folderTitle || 'folder').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'folder'}-backdrop.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url),1500);
      }, 'image/png');
    });

    actions.append(save,download);
    workspaceFooter.appendChild(actions);
    if (originalDownload) originalDownload.closest('.export-panel')?.setAttribute('hidden','');
  }

  function restoreSaved() {
    try {
      const raw = localStorage.getItem(targetStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.items) && saved.items.length) {
        activeItems = saved.items;
        renderCollage(saved.items);
        status(`Loaded the saved custom backdrop for ${folderTitle || 'this folder'}.`, 'ok');
      }
    } catch {}
  }

  updateCopy();
  injectListButton();
  injectActions();
  restoreSaved();

  const observer = new MutationObserver(() => injectListButton());
  if (mdblistResults) observer.observe(mdblistResults.parentElement || mdblistResults, { childList:true, subtree:true });
})();