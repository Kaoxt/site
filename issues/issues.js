(() => {
  'use strict';
  const media = window.KollectionIssueMedia;
  const $ = id => document.getElementById(id);
  const categories = { collection: 'Kollection in Nuvio', setup: 'Setup & updates', artwork: 'Artwork & posters', account: 'Account & profiles', website: 'Website', other: 'Other' };
  const statuses = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  let page = 1, authenticated = false, loadVersion = 0, displayName = '';
  const loginUrl = () => '/account?next=' + encodeURIComponent('/issues' + location.hash);
  function selectedProfile() { return window.KollectionNavAccount?.getSelectedProfile?.(); }
  function updatePostingProfile() {
    const profile = selectedProfile();
    document.querySelectorAll('[data-posting-profile]').forEach(node => {
      const name = displayName || profile?.name;
      const avatar = document.querySelector('.nuvio-desktop-profile-button img')?.src || profile?.avatarUrl || '';
      node.innerHTML = name ? `${media.avatar(name, avatar, profile?.avatarColor)}<span>Posting as ${esc(name)}</span>` : 'Your selected Nuvio profile will be used.';
    });
  }
  const badge = issue => `<span class="issue-badge">${esc(statuses[issue.status])}</span><span class="issue-badge">${esc(categories[issue.category])}</span>`;
  async function api(path = '', options = {}) {
    const response = await fetch('/api/issues' + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Unable to connect. Please try again.');
    return result;
  }
  function authState(result) {
    authenticated = result.authenticated;
    displayName = result.displayName || '';
    updatePostingProfile();
    $('new-issue').disabled = false;
    $('signin-note').hidden = authenticated;
  }
  async function load() {
    const version = ++loadVersion;
    $('issue-error').textContent = '';
    const id = location.hash.slice(1), detail = /^[1-9]\d*$/.test(id);
    $('issues-list-view').hidden = detail;
    $('issue-detail-view').hidden = !detail;
    if (detail) $('issue-detail').textContent = 'Loading issue…';
    else $('issue-results').innerHTML = '<div class="issue-empty">Loading issues…</div>';
    try {
      if (detail) {
        const result = await api('/' + id);
        if (version !== loadVersion) return;
        authState(result); renderDetail(result);
      } else {
        const params = new URLSearchParams({ q: $('issue-search').value, category: $('issue-category').value, status: $('issue-status').value, mine: $('issue-scope').value === 'mine' ? '1' : '0', page });
        const result = await api('?' + params);
        if (version !== loadVersion) return;
        authState(result);
        $('issue-results').innerHTML = result.issues.length ? result.issues.map(issue => `<article class="issue-row"><span class="issue-dot ${esc(issue.status)}" aria-hidden="true">${issue.status === 'closed' ? '✓' : '◉'}</span><div class="issue-row-main"><h3><a href="#${issue.id}">${esc(issue.title)}</a></h3><div class="issue-meta">${badge(issue)}${media.avatar(issue.author, issue.avatar_url, issue.avatar_color)}<span>#${issue.id} · ${esc(issue.author)} · ${esc(date(issue.created_at))}</span>${issue.isMine ? '<span>Your report</span>' : ''}</div></div><span class="issue-row-count issue-meta">${issue.comment_count} ${issue.comment_count === 1 ? 'comment' : 'comments'}</span></article>`).join('') : '<div class="issue-empty"><h3>No issues found</h3><p>Try another filter or be the first to report an issue.</p></div>';
        $('previous-page').hidden = page === 1; $('next-page').hidden = !result.hasMore;
        $('page-label').textContent = result.issues.length || page > 1 ? `Page ${page}` : '';
      }
    } catch (error) {
      if (version !== loadVersion) return;
      $('issue-error').textContent = error.message;
      const target = detail ? $('issue-detail') : $('issue-results');
      target.innerHTML = '<div class="issue-empty"><p>Unable to load issues.</p><button id="retry-issues">Try again</button></div>';
      $('retry-issues').onclick = load;
      $('previous-page').hidden = $('next-page').hidden = true; $('page-label').textContent = '';
    }
  }
  const commentHtml = c => `<article class="issue-card"><div class="issue-meta">${media.avatar(c.author, c.avatar_url, c.avatar_color)}<strong>${esc(c.author)}</strong>${c.is_admin ? '<span class="issue-badge">Admin</span>' : ''}<span>${esc(date(c.created_at))}</span></div><p class="issue-body">${esc(c.body)}</p>${media.gallery(c.attachments)}</article>`;
  function renderDetail(result) {
    const { issue, comments, isAdmin } = result;
    $('issue-detail').innerHTML = `<article class="issue-card"><div class="issue-meta">#${issue.id} ${badge(issue)}</div><h2 class="issue-detail-title">${esc(issue.title)}</h2><div class="issue-meta">${media.avatar(issue.author, issue.avatar_url, issue.avatar_color)}Reported by ${esc(issue.author)} · ${esc(date(issue.created_at))}</div><p class="issue-body">${esc(issue.body)}</p>${media.gallery(issue.attachments)}${isAdmin ? `<form id="status-form" class="issue-admin"><label for="admin-status">Status</label><select id="admin-status">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${key === issue.status ? 'selected' : ''}>${label}</option>`).join('')}</select><button>Update status</button></form>` : ''}</article><h2>Discussion</h2><div id="issue-comments">${comments.map(commentHtml).join('')}</div><button id="more-comments" ${result.hasMore ? '' : 'hidden'}>Load more comments</button>${authenticated && (issue.status !== 'closed' || isAdmin) ? `<form id="comment-form" class="issue-form issue-card" novalidate><p class="issue-note" data-posting-profile>Your selected Nuvio profile will be used.</p><label>Add a comment<textarea name="body" required minlength="2" maxlength="5000" rows="4" placeholder="Share more details or an update"></textarea></label><p class="issue-note">Comments are public. Keep passwords, API keys, and personal information private.</p><p id="comment-error" class="issue-error" role="alert" tabindex="-1"></p><div class="issue-form-actions"><button class="issue-primary">Post comment</button></div></form>` : `<p class="issue-note">${issue.status === 'closed' ? 'This issue is closed.' : `<a href="${esc(loginUrl())}">Sign in with Nuvio</a> to add a comment.`}</p>`}`;
    updatePostingProfile();
    media.attach($('comment-form'));
    let after = comments.at(-1)?.id || 0;
    $('more-comments').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try { const more = await api(`/${issue.id}?after=${after}`); $('issue-comments').insertAdjacentHTML('beforeend', more.comments.map(commentHtml).join('')); after = more.comments.at(-1)?.id || after; button.hidden = !more.hasMore; }
      catch (error) { $('issue-error').textContent = error.message; } finally { button.disabled = false; }
    };
    $('status-form')?.addEventListener('submit', event => submit(event, '/' + issue.id, { status: $('admin-status').value }, 'PATCH'));
    $('comment-form')?.addEventListener('submit', event => submit(event, '/' + issue.id, Object.fromEntries(new FormData(event.currentTarget)), 'POST'));
  }
  async function submit(event, path, data, method) {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type=submit],button:not([type])');
    if (button.disabled) return;
    const reporting = form.id === 'report-form', errorTarget = reporting ? $('report-error') : ($('comment-error') && form.id === 'comment-form' ? $('comment-error') : $('issue-error'));
    errorTarget.textContent = '';
    const problems = window.KollectionIssueForm.validate(data, form.id);
    form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    if (problems.length) {
      errorTarget.textContent = problems.map(p => p.message).join('\n');
      problems.forEach(p => form.elements[p.field]?.setAttribute('aria-invalid', 'true'));
      errorTarget.focus();
      errorTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Submitting…';
    try {
      if (method === 'POST') {
        let profile = selectedProfile();
        if (!profile) { await window.KollectionNavAccount?.refresh?.(); profile = selectedProfile(); }
        if (!profile && !displayName) throw new Error('Your Nuvio profile could not be loaded. Refresh the page or select a profile in Account, then try again.');
        data.profileId = profile?.id || null;
        data.attachments = media.collect(form);
      }
      const result = await api(path, { method, body: JSON.stringify(data) });
      if (reporting) { $('issue-dialog').close(); form.reset(); location.hash = result.id; }
      else await load();
    } catch (error) { errorTarget.textContent = error.message; errorTarget.focus(); errorTarget.scrollIntoView({ block: 'nearest' }); }
    finally { button.disabled = false; button.textContent = originalLabel; }
  }
  Object.entries(categories).forEach(([key, label]) => { for (const id of ['issue-category', 'report-category']) $(id).add(new Option(label, key)); });
  $('new-issue').onclick = () => {
    if (!authenticated) { location.href = loginUrl(); return; }
    updatePostingProfile(); $('report-error').textContent = ''; $('issue-dialog').showModal();
  };
  $('close-report').onclick = $('cancel-report').onclick = () => $('issue-dialog').close();
  $('report-form').onsubmit = event => submit(event, '', Object.fromEntries(new FormData(event.currentTarget)), 'POST');
  $('issue-filters').onsubmit = event => { event.preventDefault(); page = 1; load(); };
  ['issue-category', 'issue-status', 'issue-scope'].forEach(id => $(id).onchange = () => { page = 1; load(); });
  $('next-page').onclick = () => { page++; load(); }; $('previous-page').onclick = () => { page--; load(); };
  $('back-issues').onclick = event => { event.preventDefault(); location.hash = ''; };
  window.addEventListener('hashchange', load);
  window.addEventListener('kollection:display-name-changed', load);
  window.addEventListener('kollection:nuvio-profile-changed', updatePostingProfile);
  ['kollection:nuvio-signed-in', 'kollection:nuvio-signed-out', 'kollection:nuvio-session-changed'].forEach(event => window.addEventListener(event, () => { $('issue-dialog').close(); load(); }));
  media.attach($('report-form'));
  load();
})();
