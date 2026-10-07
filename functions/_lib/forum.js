import { avatarDb } from './account-avatar.js';
import { IssueError, profileIdentity, textField } from './issues.js';
import { assertSameOrigin, isAdminUser, readSession, refreshSessionIfNeeded } from './nuvio-session.js';
const schemas = new WeakMap();
export async function forumDb(env) {
  const db = await avatarDb(env);
  if (!schemas.has(db)) schemas.set(db, db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS forum_members (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '', avatar_color TEXT NOT NULL DEFAULT '#6568e8', about TEXT NOT NULL DEFAULT '', banned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS forum_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, read_only INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS forum_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL REFERENCES forum_members(id), category_id INTEGER NOT NULL REFERENCES forum_categories(id), title TEXT NOT NULL, body TEXT NOT NULL, github_release_url TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS forum_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER NOT NULL REFERENCES forum_topics(id), member_id TEXT NOT NULL REFERENCES forum_members(id), body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_topics_list ON forum_topics(hidden, pinned DESC, updated_at DESC, id DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_topics_category ON forum_topics(category_id, hidden, pinned DESC, updated_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_topics_news ON forum_topics(category_id,hidden,created_at DESC,id DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_topics_member ON forum_topics(member_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_replies_topic ON forum_replies(topic_id, hidden, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS forum_replies_member ON forum_replies(member_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS forum_settings (id INTEGER PRIMARY KEY CHECK(id=1), posting_open INTEGER NOT NULL DEFAULT 1)`),
    db.prepare('INSERT OR IGNORE INTO forum_settings(id) VALUES(1)'),
    // Seed only once; category edits and archives survive future deployments.
    db.prepare(`INSERT OR IGNORE INTO forum_categories(id,name,description,position,read_only) VALUES (1,'General','Talk about The Kollection and Nuvio.',10,0),(2,'Ideas & feedback','Share suggestions and improvements.',20,0),(3,'Show & tell','Share your collections and artwork.',30,0),(4,'Announcements','Updates from The Kollection.',0,1)`),
  ]).then(async()=>{
    const columns=await db.prepare('PRAGMA table_info(forum_topics)').all();
    if(!columns.results.some(c=>c.name==='github_release_url')){
      try{await db.prepare("ALTER TABLE forum_topics ADD COLUMN github_release_url TEXT NOT NULL DEFAULT ''").run();}
      catch(e){if(!(await db.prepare('PRAGMA table_info(forum_topics)').all()).results.some(c=>c.name==='github_release_url'))throw e;}
    }
  }).catch(e => { schemas.delete(db); throw e; }));
  await schemas.get(db); return db;
}
export async function forumHandle(context, write, run) {
  let cookie;
  const reply = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
  try {
    if(write && !assertSameOrigin(context.request)) throw new IssueError('Invalid request origin.',403);
    const auth=await refreshSessionIfNeeded(await readSession(context.request,context.env),context.env); cookie=auth.cookie;
    if(write && !auth.session) throw new IssueError('Sign in with Nuvio to continue.',401);
    return await run({session:auth.session,admin:isAdminUser(auth.session,context.env),reply,db:await forumDb(context.env)});
  } catch(e) {
    if(!(e instanceof IssueError)) console.error('Forum request failed',e);
    return reply({error:e instanceof IssueError?e.message:'Could not load or save this discussion. Please try again.'},e instanceof IssueError?e.status:503);
  }
}
export async function forumInput(request) {
  if(!request.headers.get('content-type')?.includes('application/json')) throw new IssueError('Send JSON.',415);
  // Limit the stream as well as the declared size; text-only forum requests stay small.
  if(Number(request.headers.get('content-length'))>32000) throw new IssueError('Post is too large.',413);
  const reader=request.body?.getReader(); let size=0,parts=[];
  if(!reader) throw new IssueError('Missing request.');
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32000){await reader.cancel();throw new IssueError('Post is too large.',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try {const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;} catch{throw new IssueError('Invalid JSON.');}
}
export function id(value){if(!/^[1-9]\d{0,14}$/.test(String(value)))throw new IssueError('Not found.',404);return Number(value);}
export function page(value){return Math.max(1,Math.min(10000,parseInt(value,10)||1));}
export function requireAdmin(admin){if(!admin)throw new IssueError('Administrator access required.',403);}
export const memberSelect = `m.id AS member_id, COALESCE(NULLIF(p.display_name,''),m.author) AS author, COALESCE(CASE WHEN a.url!='' THEN a.url WHEN a.id IS NOT NULL THEN '/api/avatars/'||a.id END,m.avatar_url) AS avatar_url, m.avatar_color`;
export const memberJoin = `JOIN forum_members m ON m.id=t.member_id LEFT JOIN account_preferences p ON p.user_id=m.user_id LEFT JOIN account_avatars a ON a.user_id=m.user_id`;
export const counts = `(SELECT COUNT(*) FROM forum_topics ft WHERE ft.member_id=m.id AND ft.hidden=0) AS topic_count, (SELECT COUNT(*) FROM forum_replies fr JOIN forum_topics ft ON ft.id=fr.topic_id WHERE fr.member_id=m.id AND fr.hidden=0 AND ft.hidden=0) AS reply_count`;
export async function selfMember(db,session){return session?db.prepare('SELECT * FROM forum_members WHERE user_id=?').bind(session.id).first():null;}
export async function ensureMember(db,session,env,profileId){
  let member=await selfMember(db,session);if(member)return member;
  const identity=await profileIdentity(profileId,session,env);
  await db.prepare('INSERT OR IGNORE INTO forum_members(id,user_id,author,avatar_url,avatar_color,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),session.id,identity.author,identity.avatar_url,identity.avatar_color,new Date().toISOString()).run();
  return selfMember(db,session);
}
export async function mayPost(db,member,admin){
  if(member.banned && !admin)throw new IssueError('Posting is disabled for this account.',403);
  if(!admin && !(await db.prepare('SELECT posting_open FROM forum_settings WHERE id=1').first()).posting_open)throw new IssueError('The forum is temporarily read-only.',409);
}
export async function validCategory(db,value,admin){
  const c=await db.prepare('SELECT * FROM forum_categories WHERE id=?').bind(id(value)).first();
  if(!c||c.archived)throw new IssueError('Choose an active category.');
  if((c.id===4||c.read_only)&&!admin)throw new IssueError('Only administrators can start topics in this category.',403);
  return c.id;
}
export { IssueError, textField };

export function releaseUrl(value){
  const text=textField(value??'','GitHub release URL',0,2048);
  if(!text)return '';
  try{const url=new URL(text);if(url.protocol==='https:'&&url.hostname==='github.com'&&!url.username&&!url.password&&!url.port&&/^\/[^/]+\/[^/]+\/releases(?:\/latest\/?|\/tag\/[^\s]+|\/?)$/.test(url.pathname))return url.href;}catch{}
  throw new IssueError('Enter a GitHub release URL such as https://github.com/owner/repo/releases/tag/v1.0.');
}
