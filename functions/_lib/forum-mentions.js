import { IssueError } from './issues.js';

export const notificationSchema = [
  `CREATE TABLE IF NOT EXISTS forum_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id TEXT NOT NULL REFERENCES forum_members(id), actor_id TEXT NOT NULL REFERENCES forum_members(id), kind TEXT NOT NULL CHECK(kind IN ('topic','reply')), post_id INTEGER NOT NULL, topic_id INTEGER NOT NULL REFERENCES forum_topics(id), reply_id INTEGER REFERENCES forum_replies(id), created_at TEXT NOT NULL, read_at TEXT, active INTEGER NOT NULL DEFAULT 1, UNIQUE(recipient_id,kind,post_id))`,
  'CREATE INDEX IF NOT EXISTS forum_notifications_inbox ON forum_notifications(recipient_id,active,id DESC)',
  'CREATE INDEX IF NOT EXISTS forum_notifications_unread ON forum_notifications(recipient_id,read_at,active)',
  'CREATE INDEX IF NOT EXISTS forum_notifications_topic ON forum_notifications(topic_id)',
  'CREATE INDEX IF NOT EXISTS forum_notifications_post ON forum_notifications(kind,post_id)',
];

// Match the editor's mention tokens, but never notify from copied quotes or code.
export function mentionedMembers(body, enforceLimit = true) {
  let fence = null;
  const prose = String(body).replace(/\r\n?/g, '\n').split('\n').map(line => {
    if (/^\s*>/.test(line)) return '';
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return '';
    }
    if (marker) { fence = marker[1]; return ''; }
    return line;
  }).join('\n');
  const token = /@\[((?:\\[^\r\n]|[^\]\\\r\n]){1,160})\]\(member:([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\)/gi;
  const matches = new Map([...prose.matchAll(token)].filter(match => match[1].length <= 160).map(match => [match.index, match]));
  const escaped = index => {
    let slashes = 0;
    while (index > 0 && prose[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  const ids = new Set();
  let cursor = 0;
  while (cursor < prose.length) {
    const mention = matches.get(cursor);
    if (mention) {
      if (!escaped(cursor)) {
        ids.add(mention[2].toLowerCase());
        if (enforceLimit && ids.size > 10) throw new IssueError('Mention up to 10 different members in one post.');
      }
      // Display labels are opaque: a backtick in a name is not a code delimiter.
      cursor += mention[0].length;
      continue;
    }
    if (prose[cursor] !== '`' || escaped(cursor)) { cursor++; continue; }
    let end = cursor;
    while (prose[end] === '`') end++;
    const delimiter = prose.slice(cursor, end);
    let close = end, found = -1;
    while ((close = prose.indexOf(delimiter, close)) !== -1) {
      if (prose[close - 1] !== '`' && prose[close + delimiter.length] !== '`') { found = close; break; }
      close += delimiter.length;
    }
    cursor = found < 0 ? end : found + delimiter.length;
  }
  return [...ids];
}

export function mentionInsert(db, { kind, postId, actorId, recipients, createdAt, newPost = false }) {
  if (!recipients.length) return null;
  const isReply = kind === 'reply', source = isReply ? 'r' : 't';
  // For creation this immediately follows the post INSERT in the same D1 batch.
  // One INSERT handles every recipient; its row IDs cannot affect post lookup.
  return db.prepare(`INSERT OR IGNORE INTO forum_notifications(recipient_id,actor_id,kind,post_id,topic_id,reply_id,created_at)
    SELECT recipient.id,?,'${kind}',${source}.id,t.id,${isReply ? 'r.id' : 'NULL'},?
    FROM ${isReply ? 'forum_replies r JOIN forum_topics t ON t.id=r.topic_id' : 'forum_topics t'}
    JOIN forum_members recipient ON recipient.id IN (${recipients.map(() => '?').join(',')})
    WHERE ${source}.id=${newPost ? 'last_insert_rowid()' : '?'} AND t.hidden=0 ${isReply ? 'AND r.hidden=0' : ''}
    AND recipient.banned=0 AND recipient.id!=? ${newPost ? 'AND changes()>0' : ''}`)
    .bind(actorId, createdAt, ...recipients, ...(newPost ? [] : [postId]), actorId);
}

export function syncMentionVisibility(db, kind, postId, recipients) {
  return db.prepare(`UPDATE forum_notifications SET active=CASE WHEN recipient_id IN (${recipients.length ? recipients.map(() => '?').join(',') : 'NULL'}) THEN 1 ELSE 0 END WHERE kind=? AND post_id=?`)
    .bind(...recipients, kind, postId);
}

const visibleJoins = `FROM forum_notifications n
  JOIN forum_topics t ON t.id=n.topic_id AND t.hidden=0
  JOIN forum_members m ON m.id=n.actor_id AND m.banned=0
  LEFT JOIN forum_replies r ON n.kind='reply' AND r.id=n.reply_id AND r.topic_id=t.id`;
const visibleWhere = `n.recipient_id=? AND n.active=1 AND ((n.kind='topic' AND n.post_id=t.id) OR (n.kind='reply' AND r.id=n.post_id AND r.hidden=0))`;

export async function unreadNotifications(db, member) {
  if (!member || member.banned) return 0;
  return (await db.prepare(`SELECT COUNT(*) AS n ${visibleJoins} WHERE ${visibleWhere} AND n.read_at IS NULL`).bind(member.id).first()).n;
}

export async function notifications(db, member, cursor) {
  const unreadCount = await unreadNotifications(db, member);
  if (!member || member.banned) return { notifications: [], unreadCount, hasMore: false, nextCursor: null };
  const rows = (await db.prepare(`SELECT n.id,n.topic_id,n.reply_id,n.created_at,n.read_at,t.title AS topic_title,
    m.id AS member_id,COALESCE(NULLIF(p.display_name,''),m.author) AS author,
    COALESCE(CASE WHEN a.url!='' THEN a.url WHEN a.id IS NOT NULL THEN '/api/avatars/'||a.id END,m.avatar_url) AS avatar_url,m.avatar_color
    ${visibleJoins} LEFT JOIN account_preferences p ON p.user_id=m.user_id LEFT JOIN account_avatars a ON a.user_id=m.user_id
    WHERE ${visibleWhere} ${cursor ? 'AND n.id<?' : ''} ORDER BY n.id DESC LIMIT 21`)
    .bind(member.id, ...(cursor ? [cursor] : [])).all()).results;
  const page = rows.slice(0, 20);
  return {
    notifications: page.map(row => ({ id: row.id, actor: { member_id: row.member_id, author: row.author, avatar_url: row.avatar_url, avatar_color: row.avatar_color }, topicId: row.topic_id, replyId: row.reply_id, topicTitle: row.topic_title, createdAt: row.created_at, readAt: row.read_at, url: `/discussions#topic/${row.topic_id}${row.reply_id ? '?reply=' + row.reply_id : ''}` })),
    unreadCount, hasMore: rows.length > 20, nextCursor: rows.length > 20 ? page.at(-1).id : null,
  };
}
