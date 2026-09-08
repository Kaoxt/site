(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    session: null,
    path: '',
    items: [],
    selected: null,
    selectedContent: '',
    uploadFiles: [],
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

    managerShell: $('managerShell'),
    managerMessage: $('managerMessage'),
    repoBreadcrumbs: $('repoBreadcrumbs'),
    newFileButton: $('newFileButton'),
    uploadButton: $('uploadButton'),
    refreshButton: $('refreshButton'),

    createPanel: $('createPanel'),
    newFileName: $('newFileName'),
    newFileMessage: $('newFileMessage'),
    newFileContent: $('newFileContent'),
    createFileButton: $('createFileButton'),

    uploadPanel: $('uploadPanel'),
    fileInput: $('fileInput'),
    folderInput: $('folderInput'),
    fileDropZone: $('fileDropZone'),
    chooseFilesButton: $('chooseFilesButton'),
    chooseFolderButton: $('chooseFolderButton'),
    uploadQueue: $('uploadQueue'),
    uploadMessage: $('uploadMessage'),
    commitUploadButton: $('commitUploadButton'),

    fileSearch: $('fileSearch'),
    fileList: $('fileList'),

    emptyEditor: $('emptyEditor'),
    fileEditor: $('fileEditor'),
    editorType: $('editorType'),
    editorHeading: $('editorHeading'),
    editorPath: $('editorPath'),
    githubFileLink: $('githubFileLink'),
    renameButton: $('renameButton'),
    deleteButton: $('deleteButton'),

    textEditorArea: $('textEditorArea'),
    editorContent: $('editorContent'),
    saveMessage: $('saveMessage'),
    saveButton: $('saveButton'),

    binaryEditorArea: $('binaryEditorArea'),
    rawFileLink: $('rawFileLink'),

    renamePanel: $('renamePanel'),
    renamePath: $('renamePath'),
    renameMessage: $('renameMessage'),
    cancelRenameButton: $('cancelRenameButton'),
    commitRenameButton: $('commitRenameButton'),

    metaSize: $('metaSize'),
    metaSha: $('metaSha'),
  };

  function setMessage(text, kind = 'error') {
    el.managerMessage.hidden = false;
    el.managerMessage.className = `admin-message manager-message ${kind}`;
    el.managerMessage.textContent = text;
  }

  function clearMessage() {
    el.managerMessage.hidden = true;
    el.managerMessage.textContent = '';
  }

  function setAuthMessage(text) {
    el.authMessage.hidden = false;
    el.authMessage.className = 'admin-message error';
    el.authMessage.textContent = text;
  }

  function clearAuthMessage() {
    el.authMessage.hidden = true;
    el.authMessage.textContent = '';
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[ch]));
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / (1024 ** order);
    return `${amount.toFixed(order === 0 ? 0 : amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[order]}`;
  }

  function parentPath(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  function joinPath(...parts) {
    return parts
      .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
  }

  function basename(path) {
    return String(path || '').split('/').filter(Boolean).at(-1) || '';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function postJson(payload) {
    return api('/api/admin/site-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  function renderSession() {
    const authenticated = Boolean(state.session?.authenticated);

    el.authLoading.hidden = true;
    el.loginPanel.hidden = authenticated;
    el.signedInCard.hidden = !authenticated;
    el.managerShell.hidden = true;

    if (!authenticated) {
      el.authState.textContent = 'Signed out';
      el.authState.className = 'auth-state';
      return;
    }

    const email = state.session.user?.email || 'Nuvio account';
    el.signedInEmail.textContent = email;
    el.signedInAvatar.textContent = email.charAt(0).toUpperCase() || 'N';

    if (state.session.isAdmin) {
      el.authState.textContent = 'Administrator';
      el.authState.className = 'auth-state good';
      el.signedInRole.textContent = 'Authorized administrator';
      el.managerShell.hidden = false;
      clearAuthMessage();

      if (!state.loading && !state.items.length) {
        loadDirectory('');
      }
    } else {
      el.authState.textContent = 'Not authorized';
      el.authState.className = 'auth-state bad';
      el.signedInRole.textContent = 'Valid Nuvio account · not an administrator';
      setAuthMessage('This Nuvio account is not authorized to manage the site repository.');
    }
  }

  async function loadSession() {
    try {
      state.session = await window.KollectionNuvioAuth.getSession();
    } catch (error) {
      state.session = { authenticated: false, isAdmin: false };
      setAuthMessage(error.message || 'Could not check your Kollection session.');
    }
    renderSession();
  }

  function renderBreadcrumbs() {
    const parts = state.path.split('/').filter(Boolean);

    let html = '<button type="button" data-repo-path="">site</button>';
    let built = '';

    for (const part of parts) {
      built = joinPath(built, part);
      html += `<span class="repo-separator">›</span><button type="button" data-repo-path="${esc(built)}">${esc(part)}</button>`;
    }

    el.repoBreadcrumbs.innerHTML = html;
    el.repoBreadcrumbs.querySelectorAll('[data-repo-path]').forEach((button) => {
      button.addEventListener('click', () => loadDirectory(button.dataset.repoPath || ''));
    });
  }

  function itemSubtitle(item) {
    if (item.type === 'dir') return item.path;
    const ext = item.name.includes('.') ? item.name.split('.').pop().toUpperCase() : 'FILE';
    return `${ext} · ${item.path}`;
  }

  function renderList() {
    const query = el.fileSearch.value.trim().toLowerCase();

    const items = state.items.filter((item) =>
      !query || item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
    );

    if (!items.length) {
      el.fileList.innerHTML = '<div class="manager-empty">No files match this folder/filter.</div>';
      return;
    }

    el.fileList.innerHTML = items.map((item) => {
      const selected = state.selected?.path === item.path;
      return `
        <button class="file-row ${item.type === 'dir' ? 'folder' : 'file'} ${selected ? 'selected' : ''}"
                type="button"
                data-item-path="${esc(item.path)}"
                data-item-type="${esc(item.type)}">
          <span class="file-row-icon" aria-hidden="true">${item.type === 'dir' ? '▰' : '•'}</span>
          <span class="file-row-copy">
            <strong>${esc(item.name)}</strong>
            <small>${esc(itemSubtitle(item))}</small>
          </span>
          <span class="file-row-size">${item.type === 'dir' ? '' : esc(formatBytes(item.size))}</span>
        </button>`;
    }).join('');

    el.fileList.querySelectorAll('[data-item-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        const item = state.items.find((row) => row.path === button.dataset.itemPath);
        if (!item) return;

        if (item.type === 'dir') {
          await loadDirectory(item.path);
        } else {
          await openFile(item);
        }
      });
    });
  }

  function clearEditor() {
    state.selected = null;
    state.selectedContent = '';
    el.emptyEditor.hidden = false;
    el.fileEditor.hidden = true;
    el.textEditorArea.hidden = true;
    el.binaryEditorArea.hidden = true;
    el.renamePanel.hidden = true;
    el.editorContent.value = '';
    el.saveMessage.value = '';
    renderList();
  }

  async function loadDirectory(path = state.path) {
    if (state.loading) return;
    state.loading = true;
    clearMessage();
    el.refreshButton.disabled = true;
    el.fileList.innerHTML = '<div class="manager-loading">Loading repository…</div>';

    try {
      const params = new URLSearchParams({ path });
      const data = await api(`/api/admin/site-files?${params.toString()}`);

      state.path = data.path || '';
      state.items = Array.isArray(data.items) ? data.items : [];
      state.selected = null;
      state.selectedContent = '';

      renderBreadcrumbs();
      renderList();
      clearEditor();
    } catch (error) {
      state.items = [];
      el.fileList.innerHTML = '';
      setMessage(error.message || 'Could not load the repository.');
    } finally {
      state.loading = false;
      el.refreshButton.disabled = false;
    }
  }

  async function openFile(item) {
    clearMessage();
    el.emptyEditor.hidden = true;
    el.fileEditor.hidden = false;
    el.textEditorArea.hidden = true;
    el.binaryEditorArea.hidden = true;
    el.renamePanel.hidden = true;

    el.editorType.textContent = 'LOADING';
    el.editorHeading.textContent = item.name;
    el.editorPath.textContent = item.path;

    try {
      const params = new URLSearchParams({ path: item.path, content: '1' });
      const data = await api(`/api/admin/site-files?${params.toString()}`);

      state.selected = data.file;
      state.selectedContent = data.file.content || '';

      el.editorType.textContent = data.file.editable ? 'TEXT FILE' : 'FILE';
      el.editorHeading.textContent = data.file.name;
      el.editorPath.textContent = data.file.path;
      el.githubFileLink.href = data.file.htmlUrl || `https://github.com/Kaoxt/site/blob/main/${encodeURI(data.file.path)}`;
      el.rawFileLink.href = data.file.downloadUrl || data.file.htmlUrl || '#';
      el.metaSize.textContent = formatBytes(data.file.size);
      el.metaSha.textContent = data.file.sha ? `${data.file.sha.slice(0, 10)}…` : '—';
      el.renamePath.value = data.file.path;
      el.renameMessage.value = '';
      el.saveMessage.value = '';

      if (data.file.editable) {
        el.editorContent.value = data.file.content || '';
        el.textEditorArea.hidden = false;
      } else {
        el.binaryEditorArea.hidden = false;
      }

      renderList();
    } catch (error) {
      setMessage(error.message || 'Could not open the file.');
      clearEditor();
    }
  }

  function showOnlyPanel(panel) {
    [el.createPanel, el.uploadPanel].forEach((candidate) => {
      candidate.hidden = candidate !== panel;
    });
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function uploadRelativePath(file, preserveRelativePath = false) {
    const relativePath = preserveRelativePath
      ? String(file.webkitRelativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      : '';

    return relativePath || file.name;
  }

  function renderUploadQueue() {
    if (!state.uploadFiles.length) {
      el.uploadQueue.hidden = true;
      el.uploadQueue.innerHTML = '';
      el.commitUploadButton.disabled = true;
      return;
    }

    el.uploadQueue.hidden = false;
    el.uploadQueue.innerHTML = state.uploadFiles.map(({ file, relativePath }) => `
      <div class="upload-item">
        <strong>${esc(relativePath)}</strong>
        <span>${esc(formatBytes(file.size))}</span>
      </div>
    `).join('');
    el.commitUploadButton.disabled = false;
  }

  function setUploadFiles(fileList, { preserveRelativePath = false } = {}) {
    const files = [...(fileList || [])].slice(0, 10);

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        setMessage(`${file.name} is larger than the 10 MB upload limit.`);
        return;
      }
    }

    state.uploadFiles = files.map((file) => ({
      file,
      relativePath: uploadRelativePath(file, preserveRelativePath),
    }));
    renderUploadQueue();
  }

  async function createTextFile() {
    clearMessage();

    const name = el.newFileName.value.trim();
    if (!name) return setMessage('Enter a file name.');

    if (name.includes('/') || name.includes('\\')) {
      return setMessage('Enter only a file name here. Use the repository browser to choose the folder first.');
    }

    const path = joinPath(state.path, name);
    const existing = state.items.find((item) => item.path === path);

    if (existing) {
      return setMessage(`${path} already exists. Open it from the file list instead.`);
    }

    const old = el.createFileButton.textContent;
    el.createFileButton.disabled = true;
    el.createFileButton.textContent = 'Creating…';

    try {
      const result = await postJson({
        action: 'save',
        path,
        content: el.newFileContent.value,
        message: el.newFileMessage.value.trim() || `Add ${path}`,
      });

      setMessage(`Created ${path}. Cloudflare Pages can now deploy commit ${result.commitSha.slice(0, 7)}.`, 'success');
      el.newFileName.value = '';
      el.newFileMessage.value = '';
      el.newFileContent.value = '';
      el.createPanel.hidden = true;

      await loadDirectory(state.path);
      const item = state.items.find((row) => row.path === path);
      if (item) await openFile(item);
    } catch (error) {
      setMessage(error.message || 'Could not create the file.');
    } finally {
      el.createFileButton.disabled = false;
      el.createFileButton.textContent = old;
    }
  }

  async function saveCurrentFile() {
    if (!state.selected?.editable) return;

    clearMessage();

    if (el.editorContent.value === state.selectedContent) {
      return setMessage('There are no changes to save.', 'info');
    }

    const old = el.saveButton.textContent;
    el.saveButton.disabled = true;
    el.saveButton.textContent = 'Saving…';

    try {
      const result = await postJson({
        action: 'save',
        path: state.selected.path,
        sha: state.selected.sha,
        content: el.editorContent.value,
        message: el.saveMessage.value.trim() || `Update ${state.selected.path}`,
      });

      setMessage(`Saved ${state.selected.path}. Commit ${result.commitSha.slice(0, 7)} was pushed to main.`, 'success');

      const currentPath = state.selected.path;
      await loadDirectory(parentPath(currentPath));
      const item = state.items.find((row) => row.path === currentPath);
      if (item) await openFile(item);
    } catch (error) {
      if (error.status === 409) {
        setMessage('This file changed in GitHub after you opened it. Refresh it before saving so you do not overwrite newer work.');
      } else {
        setMessage(error.message || 'Could not save the file.');
      }
    } finally {
      el.saveButton.disabled = false;
      el.saveButton.textContent = old;
    }
  }

  async function renameCurrentFile() {
    if (!state.selected) return;

    clearMessage();

    const destinationPath = el.renamePath.value.trim().replace(/^\/+|\/+$/g, '');
    if (!destinationPath) return setMessage('Enter the new repository path.');
    if (destinationPath === state.selected.path) return setMessage('The new path is the same as the current path.');

    const old = el.commitRenameButton.textContent;
    el.commitRenameButton.disabled = true;
    el.commitRenameButton.textContent = 'Moving…';

    try {
      const result = await postJson({
        action: 'rename',
        sourcePath: state.selected.path,
        destinationPath,
        sha: state.selected.sha,
        message: el.renameMessage.value.trim() || `Move ${state.selected.path} to ${destinationPath}`,
      });

      setMessage(`Moved the file to ${destinationPath}. Commit ${result.commitSha.slice(0, 7)} was pushed to main.`, 'success');

      el.renamePanel.hidden = true;
      await loadDirectory(parentPath(destinationPath));
      const item = state.items.find((row) => row.path === destinationPath);
      if (item) await openFile(item);
    } catch (error) {
      setMessage(error.message || 'Could not rename/move the file.');
    } finally {
      el.commitRenameButton.disabled = false;
      el.commitRenameButton.textContent = old;
    }
  }

  async function deleteCurrentFile() {
    if (!state.selected) return;

    const fileName = state.selected.path;
    const confirmed = window.confirm(
      `Delete ${fileName} from Kaoxt/site?\n\nThis creates a GitHub commit on main and can trigger a Cloudflare Pages deployment.`
    );

    if (!confirmed) return;

    const second = window.prompt(
      `Type DELETE to permanently remove:\n${fileName}`
    );

    if (second !== 'DELETE') return;

    clearMessage();
    el.deleteButton.disabled = true;
    const old = el.deleteButton.textContent;
    el.deleteButton.textContent = 'Deleting…';

    try {
      const result = await postJson({
        action: 'delete',
        path: state.selected.path,
        sha: state.selected.sha,
        message: `Delete ${state.selected.path}`,
      });

      setMessage(`Deleted ${fileName}. Commit ${result.commitSha.slice(0, 7)} was pushed to main.`, 'success');
      await loadDirectory(parentPath(fileName));
    } catch (error) {
      setMessage(error.message || 'Could not delete the file.');
    } finally {
      el.deleteButton.disabled = false;
      el.deleteButton.textContent = old;
    }
  }

  async function uploadFiles() {
    if (!state.uploadFiles.length) return;

    const existingFiles = new Set(
      state.items.filter((item) => item.type === 'file').map((item) => item.name.toLowerCase())
    );
    const existingFolders = new Set(
      state.items.filter((item) => item.type === 'dir').map((item) => item.name.toLowerCase())
    );

    const replacements = state.uploadFiles.filter(({ relativePath }) =>
      !relativePath.includes('/') && existingFiles.has(relativePath.toLowerCase())
    );

    const folderRoots = [...new Set(
      state.uploadFiles
        .map(({ relativePath }) => relativePath.split('/')[0])
        .filter((root, index) =>
          state.uploadFiles[index].relativePath.includes('/') &&
          existingFolders.has(root.toLowerCase())
        )
    )];

    if (replacements.length || folderRoots.length) {
      const details = [
        ...replacements.map(({ relativePath }) => relativePath),
        ...folderRoots.map((name) => `${name}/ (existing folder)`),
      ];

      const okay = window.confirm(
        `This upload can replace existing content in ${state.path || 'the repository root'}:\n\n` +
        details.join('\n') +
        '\n\nContinue?'
      );
      if (!okay) return;
    }

    clearMessage();

    const form = new FormData();
    form.set('action', 'upload');
    form.set('directory', state.path);
    form.set('message', el.uploadMessage.value.trim() || `Upload files to ${state.path || 'site root'}`);
    state.uploadFiles.forEach(({ file, relativePath }) => {
      form.append('files', file, file.name);
      form.append('paths', relativePath);
    });

    const old = el.commitUploadButton.textContent;
    el.commitUploadButton.disabled = true;
    el.commitUploadButton.textContent = 'Uploading…';

    try {
      const result = await api('/api/admin/site-files', {
        method: 'POST',
        body: form,
      });

      const commitText = result.commitSha
        ? ` Commit ${result.commitSha.slice(0, 7)} was pushed to main.`
        : '';

      setMessage(
        `Uploaded ${result.files.length} file${result.files.length === 1 ? '' : 's'}.${commitText}`,
        'success'
      );

      state.uploadFiles = [];
      el.fileInput.value = '';
      el.folderInput.value = '';
      el.uploadMessage.value = '';
      renderUploadQueue();
      el.uploadPanel.hidden = true;
      await loadDirectory(state.path);
    } catch (error) {
      setMessage(error.message || 'Could not upload the files.');
    } finally {
      el.commitUploadButton.disabled = false;
      el.commitUploadButton.textContent = old;
    }
  }

  el.continueNuvioButton.addEventListener('click', async () => {
    clearAuthMessage();
    const old = el.continueNuvioButton.textContent;
    el.continueNuvioButton.disabled = true;
    el.continueNuvioButton.textContent = 'Opening Nuvio…';

    try {
      await window.KollectionNuvioAuth.continueWithNuvio({
        deviceName: 'The Kollection Site File Manager',
        onStatus(message) {
          el.nuvioAdminStatus.textContent = message;
        },
      });
      state.session = await window.KollectionNuvioAuth.getSession();
      renderSession();
    } catch (error) {
      setAuthMessage(error.message || 'Could not sign in with Nuvio.');
    } finally {
      el.continueNuvioButton.disabled = false;
      el.continueNuvioButton.textContent = old;
    }
  });

  el.signOutButton.addEventListener('click', async () => {
    try {
      await window.KollectionNuvioAuth.signOut();
    } finally {
      state.session = { authenticated: false, isAdmin: false };
      state.items = [];
      clearEditor();
      renderSession();
    }
  });

  el.refreshButton.addEventListener('click', () => loadDirectory(state.path));
  el.fileSearch.addEventListener('input', renderList);

  el.newFileButton.addEventListener('click', () => {
    showOnlyPanel(el.createPanel);
    el.newFileName.focus();
  });

  el.uploadButton.addEventListener('click', () => {
    showOnlyPanel(el.uploadPanel);
  });

  document.querySelectorAll('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.dataset.closePanel);
      if (panel) panel.hidden = true;
    });
  });

  el.createFileButton.addEventListener('click', createTextFile);
  el.saveButton.addEventListener('click', saveCurrentFile);

  el.renameButton.addEventListener('click', () => {
    if (!state.selected) return;
    el.renamePath.value = state.selected.path;
    el.renameMessage.value = '';
    el.renamePanel.hidden = !el.renamePanel.hidden;
  });

  el.cancelRenameButton.addEventListener('click', () => {
    el.renamePanel.hidden = true;
  });

  el.commitRenameButton.addEventListener('click', renameCurrentFile);
  el.deleteButton.addEventListener('click', deleteCurrentFile);

  const chooseFiles = () => el.fileInput.click();
  const chooseFolder = () => el.folderInput.click();

  el.chooseFilesButton.addEventListener('click', (event) => {
    event.stopPropagation();
    chooseFiles();
  });

  el.chooseFolderButton.addEventListener('click', (event) => {
    event.stopPropagation();
    chooseFolder();
  });

  el.fileDropZone.addEventListener('click', (event) => {
    if (!event.target.closest('button')) chooseFiles();
  });

  el.fileDropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseFiles();
    }
  });

  ['dragenter', 'dragover'].forEach((name) => {
    el.fileDropZone.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.fileDropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((name) => {
    el.fileDropZone.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.fileDropZone.classList.remove('dragging');
    });
  });

  el.fileDropZone.addEventListener('drop', (event) => {
    setUploadFiles(event.dataTransfer?.files);
  });

  el.fileInput.addEventListener('change', () => {
    setUploadFiles(el.fileInput.files);
  });

  el.folderInput.addEventListener('change', () => {
    setUploadFiles(el.folderInput.files, { preserveRelativePath: true });
  });

  el.commitUploadButton.addEventListener('click', uploadFiles);

  loadSession();
})();
1