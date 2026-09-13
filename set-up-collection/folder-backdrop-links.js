(() => {
  'use strict';

  const STORAGE_PREFIX = 'kollection-folder-backdrop-v1:';

  function slug(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'folder';
  }

  function folderTarget(card) {
    const wrap = card.closest('.folder-edit-card-wrap');
    const folderKey = String(card.dataset.folderKey || wrap?.dataset.orderKey || '').trim();
    const folderTitle = String(card.querySelector('.folder-edit-meta b')?.textContent || 'Folder').trim();
    const heading = document.querySelector('#panelHost .panel-head h2');
    const headingText = String(heading?.textContent || '').replace(/^Edit\s+/i, '').trim();
    const groupTitle = headingText || 'Collection';
    const groupKey = slug(groupTitle);
    return { groupKey, groupTitle, folderKey: folderKey || slug(folderTitle), folderTitle };
  }

  function storageKey(target) {
    return `${STORAGE_PREFIX}${encodeURIComponent(target.groupKey)}:${encodeURIComponent(target.folderKey)}`;
  }

  function hasSavedBackdrop(target) {
    try { return Boolean(localStorage.getItem(storageKey(target))); } catch { return false; }
  }

  function buildUrl(target) {
    const params = new URLSearchParams({
      group: target.groupKey,
      groupTitle: target.groupTitle,
      folder: target.folderKey,
      folderTitle: target.folderTitle,
      return: '/set-up-collection?step=customize'
    });
    return `/backdrops?${params.toString()}`;
  }

  function enhanceCards() {
    document.querySelectorAll('#panelHost .folder-edit-card').forEach(card => {
      const wrap = card.closest('.folder-edit-card-wrap');
      if (!wrap || wrap.querySelector('.folder-backdrop-action')) return;
      const target = folderTarget(card);
      const meta = card.querySelector('.folder-edit-meta');
      if (!meta) return;

      const row = document.createElement('div');
      row.className = 'folder-backdrop-action';

      const link = document.createElement('a');
      link.className = 'folder-backdrop-button';
      link.href = buildUrl(target);
      link.textContent = hasSavedBackdrop(target) ? 'Edit backdrop' : 'Backdrop';
      link.setAttribute('aria-label', `${link.textContent} for ${target.folderTitle}`);
      link.addEventListener('click', event => event.stopPropagation());

      const badge = document.createElement('span');
      badge.className = 'folder-backdrop-badge';
      badge.textContent = hasSavedBackdrop(target) ? 'Custom' : 'Default';
      badge.dataset.state = hasSavedBackdrop(target) ? 'custom' : 'default';

      row.append(badge, link);
      meta.appendChild(row);
    });
  }

  const observer = new MutationObserver(enhanceCards);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('storage', enhanceCards);
  document.addEventListener('DOMContentLoaded', enhanceCards, { once: true });
  enhanceCards();
})();