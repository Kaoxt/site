(() => {
  'use strict';
  if (window.KollectionNavNotifications) return;

  const POLL_MS = 120000;
  const REFRESH_GAP_MS = 10000;
  const controllers = new Set();
  const pendingReads = new Map();
  let userId = null;
  let generation = 0;
  let revision = 0;
  let requestNumber = 0;
  let countRequestNumber = 0;
  let unreadCount = 0;
  let timer = null;
  let lastSummaryAt = 0;
  let lastListAt = 0;
  let summaryPending = null;
  let listPending = null;
  let notifications = [];
  let nextCursor = null;
  let hasMore = false;
  let reconcileAfterReads = false;
  let dialog = null;
  let ui = null;
  let returnFocus = null;

  const visible = () => document.visibilityState !== 'hidden';
  const active = (value) => Boolean(userId) && generation === value;
  const positiveId = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  };

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function forumUrl(notification) {
    try {
      const url = new URL(String(notification.url || ''), window.location.origin);
      const match = /^#topic\/([1-9]\d*)(?:\?reply=([1-9]\d*))?$/.exec(url.hash);
      if (url.origin !== window.location.origin || url.pathname !== '/discussions' || url.search || !match) return '';
      const topic = positiveId(notification.topicId);
      if (!topic || positiveId(match[1]) !== topic) return '';
      if (notification.replyId != null && !positiveId(notification.replyId)) return '';
      if (positiveId(match[2]) !== positiveId(notification.replyId)) return '';
      return `${url.pathname}${url.hash}`;
    } catch { return ''; }
  }

  function avatarUrl(value) {
    try {
      if (!value) return '';
      const url = new URL(String(value), window.location.origin);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    stopTimer();
    if (!userId || !visible()) return;
    timer = setTimeout(() => { timer = null; void refresh(); }, POLL_MS);
  }

  function syncBadges() {
    const menu = document.getElementById('menuButton');
    if (userId && menu && !menu.querySelector('[data-nuvio-notification-count]')) {
      const badge = create('span', 'nuvio-notification-badge nuvio-menu-notification-badge');
      badge.dataset.nuvioNotificationCount = '';
      badge.hidden = true;
      menu.append(badge);
    }
    if (menu) {
      const descriptionId = 'nuvioMenuNotificationStatus';
      let description = document.getElementById(descriptionId);
      const describedBy = (menu.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== descriptionId);
      if (userId && unreadCount > 0) {
        if (!description) {
          description = create('span', 'nuvio-notification-description');
          description.id = descriptionId;
          menu.append(description);
        }
        description.textContent = `${unreadCount} unread ${unreadCount === 1 ? 'notification' : 'notifications'}`;
        describedBy.push(descriptionId);
      } else if (description) {
        description.textContent = '';
      }
      if (describedBy.length) menu.setAttribute('aria-describedby', describedBy.join(' '));
      else menu.removeAttribute('aria-describedby');
    }
    document.querySelectorAll('[data-nuvio-notification-count]').forEach((badge) => {
      const label = `${unreadCount} unread ${unreadCount === 1 ? 'notification' : 'notifications'}`;
      const text = unreadCount > 99 ? '99+' : String(unreadCount);
      if (badge.textContent !== text) badge.textContent = text;
      badge.hidden = !userId || unreadCount === 0;
      badge.setAttribute('aria-label', label);
      badge.setAttribute('title', label);
    });
    document.querySelectorAll('[data-nuvio-notifications]').forEach((button) => {
      button.hidden = !userId;
      button.setAttribute('aria-label', unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications');
    });
    if (ui) {
      ui.count.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';
      ui.readAll.disabled = !userId || unreadCount === 0 || pendingReads.size > 0 || Boolean(listPending);
    }
  }

  function updateCount(value, number, version) {
    if (version !== revision || number < countRequestNumber) return;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) return;
    countRequestNumber = number;
    unreadCount = count;
    syncBadges();
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== 'object') {
        const error = new Error('Notifications are unavailable.');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      controllers.delete(controller);
    }
  }

  function unauthorized(error, current) {
    if (active(current) && [401, 403].includes(error?.status)) {
      setSession(null);
      return true;
    }
    return false;
  }

  function refresh() {
    if (!userId || !visible()) return Promise.resolve();
    if (summaryPending) return summaryPending;
    if (listPending) return listPending;
    if (pendingReads.size) return Promise.all(pendingReads.values());
    if (lastSummaryAt && Date.now() - lastSummaryAt < REFRESH_GAP_MS) {
      schedule();
      return Promise.resolve();
    }
    lastSummaryAt = Date.now();
    const current = generation, version = revision, number = ++requestNumber;
    const pending = request('/api/forum?view=notifications&summary=1').then((data) => {
      if (active(current)) updateCount(data.unreadCount, number, version);
    }).catch((error) => { unauthorized(error, current); }).finally(() => {
      if (summaryPending === pending) summaryPending = null;
      if (active(current)) schedule();
    });
    summaryPending = pending;
    return pending;
  }

  function clearState() {
    generation += 1;
    revision += 1;
    stopTimer();
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    summaryPending = listPending = null;
    pendingReads.clear();
    notifications = [];
    unreadCount = 0;
    hasMore = false;
    reconcileAfterReads = false;
    nextCursor = null;
    lastSummaryAt = 0;
    lastListAt = 0;
    countRequestNumber = 0;
    returnFocus = null;
    if (dialog?.open) dialog.close();
    if (ui) {
      ui.list.replaceChildren();
      ui.status.textContent = '';
      ui.more.hidden = true;
      ui.retry.hidden = true;
    }
  }

  function setSession(session) {
    const next = session?.authenticated && session.user?.id ? String(session.user.id) : null;
    if (next !== userId) {
      clearState();
      userId = next;
      syncBadges();
      return next ? refresh() : Promise.resolve();
    }
    syncBadges();
    return Promise.resolve();
  }

  function displayTime(value) {
    const raw = String(value || '');
    const date = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
    if (!Number.isFinite(date.getTime())) return { text: '', iso: '', title: '' };
    const age = Math.max(0, Date.now() - date.getTime());
    const minutes = Math.floor(age / 60000), hours = Math.floor(age / 3600000), days = Math.floor(age / 86400000);
    const text = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : hours < 24 ? `${hours}h ago`
      : days < 7 ? `${days}d ago` : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return { text, iso: date.toISOString(), title: date.toLocaleString() };
  }

  function notificationRow(notification) {
    const row = create('li', `nuvio-notification-item${notification.readAt ? '' : ' unread'}`);
    const link = create('a', 'nuvio-notification-link');
    link.href = notification.url;
    link.dataset.notificationId = String(notification.id);
    const name = String(notification.actor?.author || 'A member');
    const avatar = create('span', 'nuvio-notification-avatar', (name.trim()[0] || 'N').toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const color = String(notification.actor?.avatar_color || '');
    if (/^#[0-9a-f]{6}$/i.test(color)) avatar.style.setProperty('--notification-avatar', color);
    const imageUrl = avatarUrl(notification.actor?.avatar_url);
    if (imageUrl) {
      const image = create('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    const copy = create('span', 'nuvio-notification-copy');
    const actor = create('span', 'nuvio-notification-actor');
    actor.append(create('strong', '', name), document.createTextNode(' tagged you'));
    const title = create('span', 'nuvio-notification-topic', String(notification.topicTitle || 'Forum topic'));
    const time = displayTime(notification.createdAt);
    const stamp = create('time', 'nuvio-notification-time', time.text);
    if (time.iso) stamp.dateTime = time.iso;
    stamp.title = time.title;
    copy.append(actor, title, stamp);
    const unread = create('span', 'nuvio-notification-unread-dot');
    unread.hidden = Boolean(notification.readAt);
    unread.setAttribute('aria-label', 'Unread');
    unread.setAttribute('role', 'img');
    link.append(avatar, copy, unread);
    row.append(link);
    return row;
  }

  function renderList() {
    if (!ui) return;
    ui.list.replaceChildren(...notifications.map(notificationRow));
    ui.empty.hidden = notifications.length > 0;
    ui.more.hidden = !hasMore;
    ui.more.disabled = Boolean(listPending) || pendingReads.size > 0;
    syncBadges();
  }

  function loadPage(append = false, force = false) {
    if (!userId || !dialog?.open || !visible()) return Promise.resolve();
    if (listPending) return listPending;
    if (pendingReads.size) return Promise.all(pendingReads.values());
    if (!append && !force && lastListAt && Date.now() - lastListAt < REFRESH_GAP_MS) return Promise.resolve();
    const cursor = append ? nextCursor : null;
    if (append && (!hasMore || !cursor)) return Promise.resolve();
    const current = generation, version = revision, number = ++requestNumber;
    lastListAt = Date.now();
    ui.status.textContent = 'Loading notifications…';
    ui.retry.hidden = true;
    ui.empty.hidden = true;
    const url = `/api/forum?view=notifications${cursor ? `&cursor=${cursor}` : ''}`;
    const pending = request(url).then((data) => {
      if (!active(current) || version !== revision) return;
      if (!Array.isArray(data.notifications)) throw new Error('Notifications are unavailable.');
      const seen = new Set(append ? notifications.map((item) => item.id) : []);
      const rows = [];
      for (const item of data.notifications) {
        const id = positiveId(item?.id);
        const url = item && forumUrl(item);
        if (!id || !url || seen.has(id)) continue;
        seen.add(id);
        rows.push({ ...item, id, url });
      }
      notifications = append ? [...notifications, ...rows] : rows;
      nextCursor = positiveId(data.nextCursor);
      hasMore = Boolean(data.hasMore && nextCursor && nextCursor !== cursor);
      updateCount(data.unreadCount, number, version);
      ui.status.textContent = '';
      renderList();
    }).catch((error) => {
      if (!active(current) || unauthorized(error, current)) return;
      lastListAt = 0;
      ui.status.textContent = 'Notifications couldn’t load. Please try again.';
      ui.retry.hidden = false;
    }).finally(() => {
      if (listPending === pending) listPending = null;
      if (active(current)) {
        ui.more.disabled = pendingReads.size > 0;
        syncBadges();
        schedule();
      }
    });
    listPending = pending;
    ui.more.disabled = true;
    syncBadges();
    return pending;
  }

  function markRead(ids, all = false) {
    if (!userId) return Promise.resolve(false);
    const key = all ? 'all' : ids.join(',');
    if (pendingReads.has('all')) return pendingReads.get('all');
    if (pendingReads.has(key)) return pendingReads.get(key);
    if (pendingReads.size) reconcileAfterReads = true;
    const current = generation;
    revision += 1;
    const version = revision, number = ++requestNumber;
    const body = all ? { action: 'notificationsRead', all: true } : { action: 'notificationsRead', ids };
    const pending = request('/api/forum', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true,
    }).then((data) => {
      if (!active(current)) return false;
      const now = new Date().toISOString();
      notifications = notifications.map((item) => all || ids.includes(item.id) ? { ...item, readAt: item.readAt || now } : item);
      updateCount(data.unreadCount, number, version);
      ui.status.textContent = '';
      renderList();
      return true;
    }).catch((error) => {
      if (active(current) && !unauthorized(error, current)) ui.status.textContent = 'Couldn’t update notifications. Please try again.';
      return false;
    }).finally(() => {
      if (pendingReads.get(key) === pending) pendingReads.delete(key);
      if (active(current)) {
        ui.more.disabled = Boolean(listPending) || pendingReads.size > 0;
        syncBadges();
        if (!pendingReads.size && reconcileAfterReads) {
          reconcileAfterReads = false;
          Promise.allSettled([summaryPending, listPending].filter(Boolean)).then(() => {
            if (!active(current)) return;
            lastSummaryAt = 0;
            void refresh();
          });
        } else {
          schedule();
        }
      }
    });
    pendingReads.set(key, pending);
    ui.more.disabled = true;
    syncBadges();
    return pending;
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = create('dialog', 'nuvio-notification-dialog');
    dialog.id = 'nuvioNotificationDialog';
    dialog.setAttribute('aria-labelledby', 'nuvio-notification-title');
    const heading = create('div', 'nuvio-notification-heading');
    const headingText = create('div');
    const title = create('h2', '', 'Notifications');
    title.id = 'nuvio-notification-title';
    const count = create('p', 'nuvio-notification-count-label');
    headingText.append(title, count);
    const close = create('button', 'nuvio-notification-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close notifications');
    close.addEventListener('click', () => dialog.close());
    heading.append(headingText, close);
    const actions = create('div', 'nuvio-notification-actions');
    const readAll = create('button', 'nuvio-notification-action', 'Mark all read');
    readAll.type = 'button';
    readAll.addEventListener('click', () => { void markRead([], true); });
    actions.append(readAll);
    const status = create('p', 'nuvio-notification-status');
    status.setAttribute('role', 'status');
    const retry = create('button', 'nuvio-notification-action nuvio-notification-retry', 'Try again');
    retry.type = 'button';
    retry.hidden = true;
    retry.addEventListener('click', () => { void loadPage(false, true); });
    const list = create('ul', 'nuvio-notification-list');
    const empty = create('div', 'nuvio-notification-empty');
    empty.append(create('strong', '', 'No notifications yet'), create('p', '', 'When someone tags you in a post, you’ll see it here.'));
    empty.hidden = true;
    const more = create('button', 'nuvio-notification-action nuvio-notification-more', 'Load more');
    more.type = 'button';
    more.hidden = true;
    more.addEventListener('click', () => { void loadPage(true); });
    dialog.append(heading, actions, status, retry, list, empty, more);
    document.body.append(dialog);
    ui = { count, readAll, status, retry, list, empty, more };
    list.addEventListener('click', (event) => {
      const link = event.target.closest('[data-notification-id]');
      if (!link || !list.contains(link) || !userId) return;
      const item = notifications.find((row) => row.id === positiveId(link.dataset.notificationId));
      if (!item) return;
      const current = generation;
      if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        if (!item.readAt) void markRead([item.id]);
        return;
      }
      event.preventDefault();
      if (!item.readAt) void markRead([item.id]);
      if (!active(current)) return;
      dialog.close();
      window.location.assign(item.url);
    });
    dialog.addEventListener('close', () => {
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    });
  }

  function open(trigger) {
    if (!userId) return Promise.resolve();
    ensureDialog();
    const mobile = trigger?.closest('#nuvioMobileAccount');
    returnFocus = mobile ? document.getElementById('menuButton') : document.querySelector('#nuvioDesktopAccount .nuvio-desktop-profile-button');
    document.querySelector('#nuvioDesktopAccount .nuvio-desktop-account-wrap')?.classList.remove('open');
    document.querySelector('#nuvioDesktopAccount .nuvio-desktop-profile-button')?.setAttribute('aria-expanded', 'false');
    document.getElementById('menuWrap')?.classList.remove('open');
    const menu = document.getElementById('menuButton');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation menu');
    syncBadges();
    if (!dialog.open) dialog.showModal();
    return loadPage();
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-nuvio-notifications]');
    if (trigger && userId) {
      event.preventDefault();
      void open(trigger);
    }
  });
  document.addEventListener('visibilitychange', () => {
    stopTimer();
    if (userId && visible()) {
      if (dialog?.open) void loadPage();
      else void refresh();
    }
  });
  window.addEventListener('focus', () => {
    if (dialog?.open) void loadPage();
    else void refresh();
  });
  window.addEventListener('kollection:nuvio-signed-out', () => { setSession(null); });
  window.addEventListener('kollection:nuvio-session-changed', () => { setSession(null); });
  window.addEventListener('kollection:nuvio-signed-in', () => { setSession(null); });

  window.KollectionNavNotifications = Object.freeze({ setSession, refresh, open });
  window.dispatchEvent(new CustomEvent('kollection:notifications-ready'));
})();
