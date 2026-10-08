(() => {
  'use strict';

  const { esc } = window.KollectionForum;
  const MEMBER_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const memberIdPattern = new RegExp('^' + MEMBER_ID + '$', 'i');
  // A selected display name may contain brackets or backslashes. Its member ID,
  // rather than the editable display label, identifies the tagged account.
  const MENTION = '@\\[((?:\\\\[^\\r\\n]|[^\\]\\\\\\r\\n]){1,160})\\]\\(member:(' + MEMBER_ID + ')\\)';
  const mentionLabel = label => label.replace(/\\([^\r\n])/g, '$1');
  const escapedAt = (value, index) => {
    let slashes = 0;
    while (index > 0 && value[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  const plainMentions = value => String(value ?? '').replace(new RegExp(MENTION, 'gi'), (token, label, id, index, text) => escapedAt(text, index) || label.length > 160 ? token : '@' + mentionLabel(label));

  // Protect whole code spans, selected mentions and links before formatting.
  // The scan can cross lines and requires matching backtick-run lengths.
  function tokenizeInline(value) {
    const original = String(value).replace(/\u0000/g, '');
    const tokens = [];
    const keep = html => '\u0000' + (tokens.push(html) - 1) + '\u0000';
    const pattern = new RegExp('(`+)|' + MENTION + '|\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s<>]+)\\)', 'gi');
    let text = '', cursor = 0, match;
    while ((match = pattern.exec(original))) {
      text += original.slice(cursor, match.index);
      const [token, ticks, label, memberId, linkLabel, url] = match;
      let replacement = token;
      if (ticks && !escapedAt(original, match.index)) {
        const runs = /`+/g;
        runs.lastIndex = pattern.lastIndex;
        let closing;
        while ((closing = runs.exec(original)) && closing[0].length !== ticks.length) {}
        if (closing) {
          replacement = keep('<code>' + esc(original.slice(pattern.lastIndex, closing.index)) + '</code>');
          pattern.lastIndex = closing.index + closing[0].length;
        }
      } else if (memberId) {
        replacement = label.length <= 160 && !escapedAt(original, match.index)
          ? keep('<a class="forum-mention" href="/discussions#member/' + memberId.toLowerCase() + '">@' + esc(mentionLabel(label)) + '</a>')
          : keep(esc(token));
      } else if (url) {
        try {
          const parsed = new URL(url);
          replacement = keep('<a href="' + esc(parsed.href) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(linkLabel) + '</a>');
        } catch { replacement = linkLabel; }
      }
      text += replacement;
      cursor = pattern.lastIndex;
    }
    return { text: text + original.slice(cursor), tokens };
  }

  const formatInline = (text, tokens) => esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => tokens[Number(n)] || '');

  function renderText(lines) {
    let html = '', group = [], quote = false;
    const flush = () => {
      if (!group.length) return;
      const { text, tokens } = tokenizeInline(group.join('\n'));
      let list = '';
      const close = () => { if (list) { html += '</' + list + '>'; list = ''; } };
      for (const line of text.split('\n')) {
        if (quote) { html += '<blockquote>' + formatInline(line, tokens) + '</blockquote>'; continue; }
        const bullet = line.match(/^\s*[-*] (.*)$/), number = line.match(/^\s*\d+\. (.*)$/), kind = bullet ? 'ul' : number ? 'ol' : '';
        if (kind) {
          if (list !== kind) { close(); list = kind; html += '<' + kind + '>'; }
          html += '<li>' + formatInline((bullet || number)[1], tokens) + '</li>';
        } else {
          close();
          html += line ? '<div>' + formatInline(line, tokens) + '</div>' : '<br>';
        }
      }
      close();
      group = [];
    };
    for (const line of lines) {
      const quoted = /^\s*>/.test(line);
      if (quoted !== quote) { flush(); quote = quoted; }
      group.push(quoted ? line.replace(/^\s*> ?/, '') : line);
    }
    flush();
    return html;
  }

  function render(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    let html = '', pending = [], code = null, fence = '', fenceLength = 0;
    for (const line of lines) {
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (code !== null) {
        if (marker && marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) {
          html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
          code = null;
        } else code.push(line);
      } else if (marker) {
        html += renderText(pending);
        pending = [];
        code = [];
        fence = marker[1][0];
        fenceLength = marker[1].length;
      } else pending.push(line);
    }
    if (code !== null) html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
    return html + renderText(pending);
  }

  function canMentionAt(value, caret) {
    // Ignore backticks inside an already selected display name.
    const before = value.slice(0, caret).replace(new RegExp(MENTION, 'gi'), token => ' '.repeat(token.length));
    const lines = before.split('\n');
    let fence = '', fenceLength = 0, inlineLength = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], last = index === lines.length - 1;
      if (/^\s*>/.test(line)) { if (last) return false; continue; }
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (marker) {
        if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
        else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = '';
        if (last) return false;
        continue;
      }
      if (fence) { if (last) return false; continue; }
      for (const run of line.matchAll(/`+/g)) {
        if (!inlineLength && !escapedAt(line, run.index)) inlineLength = run[0].length;
        else if (inlineLength === run[0].length) inlineLength = 0;
      }
    }
    return !fence && !inlineLength;
  }

  const insideMention = (value, caret) => [...value.matchAll(new RegExp(MENTION, 'gi'))].some(match =>
    match[1].length <= 160 && caret > match.index && caret < match.index + match[0].length);

  function mentionQuery(input) {
    const start = input.selectionStart, end = input.selectionEnd, value = input.value;
    if (start !== end || input.disabled || input.readOnly || input.form?.dataset.busy || insideMention(value, end) || !canMentionAt(value, end)) return null;
    const at = value.lastIndexOf('@', end - 1);
    if (at < 0 || at >= end || escapedAt(value, at) || (at && !/[\s([{,:;!?]/.test(value[at - 1]))) return null;
    const query = value.slice(at + 1, end);
    if (query.length > 50 || /[\r\n@\[\]<>`\\]/.test(query)) return null;
    return { start: at, end, query: query.trim(), value };
  }

  const fits = (input, start, end, replacement) => input.maxLength < 0 || input.value.length - (end - start) + replacement.length <= input.maxLength;
  const memberToken = member => '@[' + member.author.replace(/[\\[\]]/g, '\\$&') + '](member:' + member.member_id + ')';

  function attachMentions(input, editor, bar) {
    const picker = document.createElement('div');
    picker.className = 'forum-mention-picker';
    picker.hidden = true;
    const status = document.createElement('p');
    status.className = 'forum-mention-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const list = document.createElement('div');
    list.id = input.id + '-mentions';
    list.className = 'forum-mention-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Members to tag');
    picker.append(status, list);
    input.after(picker);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '@';
    button.title = 'Tag a member';
    button.setAttribute('aria-label', 'Tag a member');
    button.setAttribute('aria-controls', list.id);
    button.setAttribute('aria-expanded', 'false');
    button.onmousedown = event => event.preventDefault();
    bar.append(button);

    let current = null, generation = 0, timer = null, members = [], active = -1, composing = false;
    const clear = () => {
      clearTimeout(timer);
      timer = null;
      generation++;
      current = null;
      members = [];
      active = -1;
      picker.hidden = true;
      list.replaceChildren();
      status.textContent = '';
      input.removeAttribute('aria-controls');
      input.removeAttribute('aria-activedescendant');
      button.setAttribute('aria-expanded', 'false');
    };
    const showStatus = message => {
      picker.hidden = false;
      status.textContent = message;
      input.setAttribute('aria-controls', list.id);
      button.setAttribute('aria-expanded', 'true');
    };
    const unchanged = (snapshot, version) => generation === version && current === snapshot && input.isConnected !== false &&
      !input.disabled && !input.readOnly && !input.form?.dataset.busy && input.value === snapshot.value &&
      input.selectionStart === snapshot.end && input.selectionEnd === snapshot.end;
    const setActive = index => {
      active = index;
      [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
      const option = list.children[active];
      if (option) {
        input.setAttribute('aria-activedescendant', option.id);
        const top = option.offsetTop, bottom = top + option.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      } else input.removeAttribute('aria-activedescendant');
    };
    const choose = (index, snapshot = current, version = generation) => {
      const member = members[index];
      if (!snapshot || !member || !unchanged(snapshot, version)) {
        if (snapshot === current && version === generation) clear();
        return;
      }
      const following = input.value.slice(snapshot.end);
      const token = memberToken(member);
      let replacement = token + (/^[\s.,!?;:)\]}]/.test(following) ? '' : ' ');
      if (!fits(input, snapshot.start, snapshot.end, replacement) && fits(input, snapshot.start, snapshot.end, token)) replacement = token;
      if (!fits(input, snapshot.start, snapshot.end, replacement)) {
        showStatus('This tag does not fit in your post. Shorten your message first.');
        return;
      }
      clear();
      input.setRangeText(replacement, snapshot.start, snapshot.end, 'end');
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const showMembers = rows => {
      const seen = new Set();
      members = (Array.isArray(rows) ? rows : []).filter(member => {
        const id = String(member?.member_id || '').toLowerCase();
        const name = String(member?.author || '').replace(/[\u0000\r\n\t]/g, ' ').trim();
        if (!memberIdPattern.test(id) || !name || name.length > 80 || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 8).map(member => ({
        ...member,
        member_id: String(member.member_id).toLowerCase(),
        author: String(member.author).replace(/[\u0000\r\n\t]/g, ' ').trim(),
      }));
      list.replaceChildren();
      const snapshot = current, version = generation;
      members.forEach((member, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'forum-mention-option';
        option.id = list.id + '-' + index;
        option.tabIndex = -1;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const avatar = document.createElement('span');
        avatar.className = 'forum-mention-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        if (window.KollectionIssueMedia?.avatar) avatar.innerHTML = window.KollectionIssueMedia.avatar(member.author, member.avatar_url, member.avatar_color);
        else avatar.textContent = member.author[0].toUpperCase();
        const label = document.createElement('span');
        label.textContent = member.author;
        option.append(avatar, label);
        // Prevent the compatibility mouse event from moving the text caret.
        // Touch scrolling remains native because no touch/pointer start is cancelled.
        option.onmousedown = event => event.preventDefault();
        option.onclick = () => choose(index, snapshot, version);
        list.append(option);
      });
      showStatus(members.length ? 'Choose a member to tag. Use ↑ and ↓, then Enter, or tap a name.' : 'No matching members. Try another name.');
      setActive(members.length ? 0 : -1);
    };
    const update = () => {
      if (composing || input.isConnected === false || document.activeElement !== input) { clear(); return; }
      const next = mentionQuery(input);
      if (!next) { clear(); return; }
      if (current && current.value === next.value && current.start === next.start && current.end === next.end) return;
      clear();
      current = next;
      const version = generation;
      // Coalesce typing and discard in-flight results after caret, query or page changes.
      timer = setTimeout(async () => {
        timer = null;
        if (!unchanged(next, version) || document.activeElement !== input) return;
        showStatus('Searching members…');
        try {
          const result = await window.KollectionForum.api({ view: 'mentionMembers', q: next.query });
          if (!unchanged(next, version) || document.activeElement !== input) return;
          showMembers(result.members);
        } catch (error) {
          if (unchanged(next, version) && document.activeElement === input) showStatus(error?.message || 'Could not load members. Try typing again.');
        }
      }, 180);
    };
    button.onclick = () => {
      input.focus();
      const start = input.selectionStart, end = input.selectionEnd;
      if (insideMention(input.value, start) || insideMention(input.value, end)) {
        clear();
        showStatus('Move outside the existing tag to add another member.');
        return;
      }
      if (!canMentionAt(input.value, start)) {
        clear();
        showStatus('Move outside quoted text or code to tag a member.');
        return;
      }
      const prefix = start && !/[\s([{,:;!?]/.test(input.value[start - 1]) ? ' ' : '';
      const replacement = prefix + '@';
      if (!fits(input, start, end, replacement)) {
        clear();
        showStatus('Your post is at its character limit. Shorten it before adding a tag.');
        return;
      }
      input.setRangeText(replacement, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    input.addEventListener('input', update);
    input.addEventListener('focus', update);
    input.addEventListener('click', update);
    input.addEventListener('select', update);
    input.addEventListener('compositionstart', () => { composing = true; clear(); });
    input.addEventListener('compositionend', () => { composing = false; update(); });
    input.addEventListener('blur', event => {
      if (!picker.contains(event.relatedTarget)) clear();
    });
    picker.addEventListener('focusout', event => {
      if (event.relatedTarget !== input && !picker.contains(event.relatedTarget)) clear();
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing || composing) return;
      if (event.key === 'Escape' && (current || !picker.hidden)) { event.preventDefault(); clear(); return; }
      if (event.key === 'Tab') { clear(); return; }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !current || !members.length) return;
      if (!unchanged(current, generation)) { clear(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + members.length) % members.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(active);
      }
    });
    input.addEventListener('keyup', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update();
    });
    input.form?.addEventListener('reset', clear);
    input.form?.addEventListener('submit', clear);
  }

  function attach(scope) {
    scope.querySelectorAll('textarea[name="body"]').forEach(input => {
      if (input.dataset.editor) return;
      input.dataset.editor = '1';
      input.id ||= 'message-' + Math.random().toString(36).slice(2);
      // Keep the real textarea for native validation, mobile selection and FormData.
      const label = input.closest('label');
      if (label) {
        const caption = document.createElement('span');
        caption.textContent = label.firstChild.textContent;
        const name = document.createElement('label');
        name.htmlFor = input.id;
        name.append(caption);
        label.before(name);
        label.replaceWith(input);
      }
      const editor = document.createElement('div');
      editor.className = 'forum-editor';
      input.before(editor);
      editor.append(input);
      const bar = document.createElement('div');
      bar.className = 'forum-editor-tools';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Message formatting');
      editor.prepend(bar);
      const preview = document.createElement('div');
      preview.className = 'forum-rich forum-editor-preview';
      preview.hidden = true;
      editor.append(preview);
      const items = [['Bold', 'B', '**', '**'], ['Italic', 'I', '*', '*'], ['Underline', 'U', '++', '++'], ['Link', 'Link', '[', '](https://example.com)'], ['Quote', 'Quote', '> ', ''], ['Bulleted list', '• List', '- ', ''], ['Numbered list', '1. List', '1. ', ''], ['Code', '</>', '`', '`']];
      items.forEach(([name, caption, before, after]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = caption;
        button.title = name;
        button.setAttribute('aria-label', name);
        bar.append(button);
        button.onmousedown = event => event.preventDefault();
        button.onclick = () => {
          const start = input.selectionStart, end = input.selectionEnd, selected = input.value.slice(start, end) || 'text';
          let replacement = before + selected + after;
          if (['Quote', 'Bulleted list', 'Numbered list'].includes(name)) {
            replacement = (start && input.value[start - 1] !== '\n' ? '\n' : '') + selected.split('\n').map((line, i) => (name === 'Numbered list' ? (i + 1) + '. ' : before) + line).join('\n');
          }
          if (!fits(input, start, end, replacement)) return;
          input.setRangeText(replacement, start, end, 'select');
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
      });
      attachMentions(input, editor, bar);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = 'Preview';
      toggle.setAttribute('aria-pressed', 'false');
      bar.append(toggle);
      toggle.onclick = () => {
        const show = preview.hidden;
        preview.hidden = !show;
        preview.innerHTML = render(input.value) || '<p>Nothing to preview yet.</p>';
        toggle.textContent = show ? 'Close preview' : 'Preview';
        toggle.setAttribute('aria-pressed', String(show));
      };
      input.addEventListener('input', () => { if (!preview.hidden) preview.innerHTML = render(input.value); });
      const hint = document.createElement('p');
      hint.id = input.id + '-hint';
      hint.className = 'issue-note forum-editor-hint';
      hint.textContent = 'Select text to format it. Type @ and choose a member to tag them (up to 10 per post). Preview shows how your post will look.';
      editor.append(hint);
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '));
    });
  }

  window.KollectionForumEditor = { render, attach, plainMentions };
})();
