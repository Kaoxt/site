(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const folderTitle = params.get('folderTitle') || '';
  const folderKey = params.get('folder') || '';
  const groupTitle = params.get('groupTitle') || '';
  const groupKey = params.get('group') || '';
  if (!folderTitle && !folderKey) return;
  const api = window.KollectionBackdrops;
  const storageKey = `kollection-folder-backdrop-v1:${encodeURIComponent(groupKey || groupTitle || 'collection')}:${encodeURIComponent(folderKey || folderTitle || 'folder')}`;
  const $ = id => document.getElementById(id);
  const label = folderTitle || 'this folder';
  const status = document.createElement('div');
  status.className = 'status-line folder-backdrop-status';
  status.setAttribute('aria-live', 'polite');
  document.querySelector('.backdrop-source-card .control-card-body').appendChild(status);
  function report(message, error=false) {
    status.textContent = message;
    status.className = `status-line folder-backdrop-status ${error ? 'error' : 'ok'}`;
  }
  document.querySelector('.backdrop-app').classList.add('folder-target');
  document.querySelector('[data-page-subtitle]').textContent = `Build a backdrop for ${label}. Save the design in this browser or download the image to use as the folder artwork.`;
  document.querySelector('.backdrop-source-note').textContent = 'Default clears this folder’s saved design. Custom lets you select a title or build a collage from an MDBList.';
  document.querySelector('.per-title-explainer strong').textContent = 'Saved designs stay in this browser';
  document.querySelector('.per-title-explainer span').textContent = 'Download the finished image and use it as your folder artwork. Saving a design does not upload or install the image in Nuvio.';
  const mode = $('backdropSourceMode');
  mode.options[0].textContent = 'Use default folder backdrop';
  mode.options[1].textContent = 'Custom folder backdrop';
  // A different folder must never inherit the last title or design.
  let initial = { mode:'original', selected:null };
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const saved = JSON.parse(raw);
      initial = saved.state || { mode:'custom', selected:{ title:label, items:saved.items } };
    }
  } catch { report('Could not restore this folder’s saved design.', true); }
  api.restore(initial);

  const build = document.createElement('button');
  build.type = 'button';
  build.className = 'secondary-button full folder-list-build-button';
  build.textContent = 'Build collage from loaded list';
  $('mdblistTitleResults').before(build);
  build.addEventListener('click', async () => {
    const items = Array.from($('mdblistTitleResults').querySelectorAll('.title-result')).map(button => button.backdropItem).filter(Boolean).slice(0,18);
    if (!items.length) return report('Load a list with backdrop artwork first.', true);
    build.disabled = true;
    try {
      mode.value = 'custom'; mode.dispatchEvent(new Event('change'));
      await api.selectTitle({ title:label, items });
      report('Collage ready. Adjust its appearance, then save or download.');
    } catch (error) { report(error.message || 'Could not build this collage.', true); }
    finally { build.disabled = false; }
  });
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'secondary-button';
  save.textContent = 'Save for this folder';
  document.querySelector('.workspace-footer').appendChild(save);
  save.addEventListener('click', () => {
    const state = api.getState();
    try {
      if (state.mode === 'original') {
        localStorage.removeItem(storageKey);
        api.restore({ mode:'original', selected:null });
        return report(`Default backdrop selected for ${label}.`);
      }
      if ($('downloadBackdrop').disabled) return report('Choose artwork and wait for its preview before saving.', true);
      localStorage.setItem(storageKey, JSON.stringify({ version:2, groupKey, groupTitle, folderKey, folderTitle, state, items:state.selected.items || [state.selected], savedAt:Date.now() }));
      report(`Saved the design for ${label} in this browser.`);
    } catch { report('Could not save the design. Browser storage may be full or unavailable. You can still download it.', true); }
  });
})();
