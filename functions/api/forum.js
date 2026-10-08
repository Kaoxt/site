import { ANNOUNCEMENTS_ID, importLegacyNews } from '../_lib/forum-news.js';
import { mentionedMembers, mentionInsert, syncMentionVisibility, notifications, unreadNotifications } from '../_lib/forum-mentions.js';
import { forumHandle, forumInput, releaseUrl, IssueError, textField, id, page, requireAdmin, memberSelect, memberJoin, counts, selfMember, ensureMember, mayPost, validCategory } from '../_lib/forum.js';
const canEdit=(post,member,admin,now=Date.now())=>admin||!!member&&!member.banned&&!post.hidden&&member.id===post.member_id&&now-Date.parse(post.created_at)>=0&&now-Date.parse(post.created_at)<86400000;
const protectCategory=c=>({...c,read_only:c.id===ANNOUNCEMENTS_ID?1:c.read_only});
const categories = async db => (await db.prepare('SELECT * FROM forum_categories ORDER BY position,id').all()).results.map(protectCategory);
const categoryOverview = async db => (await db.prepare(`SELECT c.*,
 (SELECT COUNT(*) FROM forum_topics t WHERE t.category_id=c.id AND t.hidden=0) AS topic_count,
 (SELECT COUNT(*) FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE t.category_id=c.id AND t.hidden=0 AND r.hidden=0) AS reply_count,
 (SELECT t.id FROM forum_topics t WHERE t.category_id=c.id AND t.hidden=0 ORDER BY t.updated_at DESC,t.id DESC LIMIT 1) AS latest_id,
 (SELECT t.title FROM forum_topics t WHERE t.category_id=c.id AND t.hidden=0 ORDER BY t.updated_at DESC,t.id DESC LIMIT 1) AS latest_title,
 (SELECT t.updated_at FROM forum_topics t WHERE t.category_id=c.id AND t.hidden=0 ORDER BY t.updated_at DESC,t.id DESC LIMIT 1) AS latest_at
 FROM forum_categories c ORDER BY c.position,c.id`).all()).results.map(protectCategory);
const unreadSql=`(SELECT COUNT(*) FROM forum_replies ur WHERE ur.topic_id=t.id AND ur.hidden=0 AND ur.id>f.last_read_reply AND ur.member_id!=f.member_id)`;
const topicSelect = `SELECT t.*,c.name AS category_name,${memberSelect},((SELECT COUNT(*) FROM forum_topics ft WHERE ft.member_id=m.id AND ft.hidden=0)+(SELECT COUNT(*) FROM forum_replies fr JOIN forum_topics ft ON ft.id=fr.topic_id WHERE fr.member_id=m.id AND fr.hidden=0 AND ft.hidden=0)) AS post_count,(SELECT COUNT(*) FROM forum_replies r WHERE r.topic_id=t.id AND r.hidden=0) AS reply_count FROM forum_topics t JOIN forum_categories c ON c.id=t.category_id ${memberJoin}`;
export const onRequestGet = context => forumHandle(context,false,async({db,session,admin,reply})=>{
  const q=new URL(context.request.url).searchParams,view=q.get('view')||'list',current=page(q.get('page')),offset=(current-1)*20;
  // Only the public news surfaces need to run the idempotent historical import.
  const isNews=['news','latestNews','newsTopic','newsLegacy'].includes(view);
  const legacyId=isNews?await importLegacyNews(db):null;
  const me=await selfMember(db,session);
  if(view==='mentionMembers'){
    if(!session)throw new IssueError('Sign in to mention a member.',401);
    const members=(await db.prepare(`SELECT ${memberSelect} FROM forum_members m LEFT JOIN account_preferences p ON p.user_id=m.user_id LEFT JOIN account_avatars a ON a.user_id=m.user_id WHERE m.banned=0 AND instr(lower(COALESCE(NULLIF(p.display_name,''),m.author)),lower(?))>0 ORDER BY lower(COALESCE(NULLIF(p.display_name,''),m.author)),m.id LIMIT 8`).bind((q.get('q')||'').trim().slice(0,80)).all()).results;
    return reply({members});
  }
  if(view==='notifications'){
    if(!session)throw new IssueError('Sign in to view your notifications.',401);
    if(q.get('summary')==='1')return reply({unreadCount:await unreadNotifications(db,me)});
    return reply(await notifications(db,me,q.has('cursor')?id(q.get('cursor')):null));
  }
  const common={authenticated:!!session,isAdmin:admin,myMemberId:me?.id||null,canPost:!!session&&(!me?.banned||admin),announcementsCategoryId:ANNOUNCEMENTS_ID,postingOpen:!!(await db.prepare('SELECT posting_open FROM forum_settings WHERE id=1').first()).posting_open};
  if(view==='news'||view==='latestNews'){
    const limit=view==='latestNews'?1:11;
    const articles=(await db.prepare(`${topicSelect} WHERE t.category_id=? AND t.hidden=0 ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`).bind(ANNOUNCEMENTS_ID,limit,view==='latestNews'?0:(current-1)*10).all()).results;
    if(view==='latestNews')return reply({article:articles[0]?{id:articles[0].id,title:articles[0].title,created_at:articles[0].created_at}:null});
    return reply({...common,categories:await categories(db),articles:articles.slice(0,10),hasMore:articles.length>10,page:current});
  }
  if(view==='categories')return reply({...common,categories:await categoryOverview(db)});
  if(view==='self'){const stats=me?await db.prepare(`SELECT ${counts} FROM forum_members m WHERE m.id=?`).bind(me.id).first():{topic_count:0,reply_count:0,likes_received:0};const follows=me?await db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN ${unreadSql}>0 THEN 1 ELSE 0 END),0) AS unread FROM forum_follows f JOIN forum_topics t ON t.id=f.topic_id WHERE f.member_id=? AND t.hidden=0`).bind(me.id).first():{total:0,unread:0};return reply({...common,about:me?.about||'',stats,follows});}
  if(view==='member'){
    const member=await db.prepare(`SELECT ${memberSelect},m.about,m.created_at,${counts} FROM forum_members m LEFT JOIN account_preferences p ON p.user_id=m.user_id LEFT JOIN account_avatars a ON a.user_id=m.user_id WHERE m.id=?`).bind(q.get('id')||'').first();
    if(!member)throw new IssueError('Member not found.',404);
    const rows=(await db.prepare(`${topicSelect} WHERE t.member_id=? AND t.hidden=0 ORDER BY t.id DESC LIMIT 21 OFFSET ?`).bind(member.member_id,offset).all()).results;
    return reply({...common,member,topics:rows.slice(0,20),hasMore:rows.length>20,page:current});
  }
  if(view==='topic'||view==='newsTopic'||view==='newsLegacy'){
    const topic=await db.prepare(`${topicSelect} WHERE t.id=? ${admin?'':'AND t.hidden=0'} ${isNews?'AND t.category_id='+ANNOUNCEMENTS_ID:''}`).bind(view==='newsLegacy'?legacyId:id(q.get('id'))).first();
    if(!topic)throw new IssueError('Discussion not found.',404);
    const after=q.get('reply')?id(q.get('reply'))-1:Math.max(0,Number(q.get('after'))||0);
    const rows=(await db.prepare(`SELECT t.id,t.body,t.created_at,t.hidden,${memberSelect},((SELECT COUNT(*) FROM forum_topics ft WHERE ft.member_id=m.id AND ft.hidden=0)+(SELECT COUNT(*) FROM forum_replies fr JOIN forum_topics ft ON ft.id=fr.topic_id WHERE fr.member_id=m.id AND fr.hidden=0 AND ft.hidden=0)) AS post_count FROM forum_replies t ${memberJoin} WHERE t.topic_id=? AND t.id>? ${admin?'':'AND t.hidden=0'} ORDER BY t.id LIMIT 21`).bind(topic.id,after).all()).results;
    const visible=rows.slice(0,20);
    const follow=await db.prepare('SELECT COUNT(*) AS follower_count,COALESCE(MAX(CASE WHEN member_id=? THEN 1 ELSE 0 END),0) AS following FROM forum_follows WHERE topic_id=?').bind(me?.id||'',topic.id).first();
    if(me&&follow.following&&visible.length)await db.prepare('UPDATE forum_follows SET last_read_reply=MAX(last_read_reply,?) WHERE topic_id=? AND member_id=?').bind(visible.at(-1).id,topic.id,me.id).run();

    const likes=(await db.prepare(`SELECT kind,post_id,COUNT(*) AS n,MAX(CASE WHEN member_id=? THEN 1 ELSE 0 END) AS liked FROM forum_likes WHERE (kind='topic' AND post_id=?) OR (kind='reply' AND post_id IN (${visible.length?visible.map(()=>'?').join(','):'NULL'})) GROUP BY kind,post_id`).bind(me?.id||'',topic.id,...visible.map(r=>r.id)).all()).results;
    const reaction=(p,kind)=>{const l=likes.find(l=>l.kind===kind&&l.post_id===p.id);return {...p,like_count:l?.n||0,liked:!!l?.liked};};
    return reply({...common,topic:{...reaction(topic,'topic'),...follow,can_edit:canEdit(topic,me,admin)},replies:visible.map(r=>({...reaction(r,'reply'),can_edit:!topic.hidden&&canEdit(r,me,admin)||admin})),hasMore:rows.length>20,categories:await categories(db)});
  }
  if(view==='admin'){
    requireAdmin(admin);
    const members=(await db.prepare(`SELECT ${memberSelect},m.about,m.banned,m.created_at,${counts} FROM forum_members m LEFT JOIN account_preferences p ON p.user_id=m.user_id LEFT JOIN account_avatars a ON a.user_id=m.user_id WHERE instr(lower(COALESCE(NULLIF(p.display_name,''),m.author)),lower(?))>0 ORDER BY m.created_at DESC LIMIT 21 OFFSET ?`).bind((q.get('q')||'').slice(0,80),offset).all()).results;
    const stats=await db.prepare(`SELECT (SELECT COUNT(*) FROM forum_topics WHERE hidden=0) AS topics,(SELECT COUNT(*) FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.hidden=0 AND t.hidden=0) AS replies,(SELECT COUNT(*) FROM forum_members) AS members`).first();
    return reply({...common,stats,categories:await categories(db),members:members.slice(0,20),hasMore:members.length>20,page:current});
  }
  if(view==='followed'){
    if(!session)throw new IssueError('Sign in to view followed topics.',401);
    const topics=(await db.prepare(`${topicSelect} JOIN forum_follows f ON f.topic_id=t.id WHERE f.member_id=? AND t.hidden=0 ORDER BY t.updated_at DESC,t.id DESC LIMIT 21 OFFSET ?`).bind(me?.id||'',offset).all()).results;
    const unread=(await db.prepare(`SELECT t.id,${unreadSql} AS unread_count,(SELECT MIN(ur.id) FROM forum_replies ur WHERE ur.topic_id=t.id AND ur.hidden=0 AND ur.id>f.last_read_reply AND ur.member_id!=f.member_id) AS first_unread FROM forum_follows f JOIN forum_topics t ON t.id=f.topic_id WHERE f.member_id=? AND t.hidden=0 ORDER BY t.updated_at DESC,t.id DESC LIMIT 21 OFFSET ?`).bind(me?.id||'',offset).all()).results;
    return reply({...common,followingView:true,categories:await categories(db),topics:topics.slice(0,20).map(({body,...t})=>({...t,...unread.find(r=>r.id===t.id)})),hasMore:topics.length>20,page:current});
  }
  if(view!=='list')throw new IssueError('Not found.',404);
  const moderation=q.get('moderation')==='1';if(moderation)requireAdmin(admin);
  const filters=[],values=[];
  if(!moderation)filters.push('t.hidden=0');
  if(q.get('category')){filters.push('t.category_id=?');values.push(id(q.get('category')));}
  const search=(q.get('q')||'').trim().slice(0,100);
  if(search){filters.push('instr(lower(t.title),lower(?))>0');values.push(search);}
  const rows=(await db.prepare(`${topicSelect} ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY t.pinned DESC,t.updated_at DESC,t.id DESC LIMIT 21 OFFSET ?`).bind(...values,offset).all()).results;
  // Bodies are not needed on list pages.
  return reply({...common,categories:await categories(db),topics:rows.slice(0,20).map(({body,...t})=>t),hasMore:rows.length>20,page:current});
});
export const onRequestPost = context => forumHandle(context,true,async({db,session,admin,reply})=>{
  const data=await forumInput(context.request);
  if(data.action==='news'){requireAdmin(admin);data.categoryId=ANNOUNCEMENTS_ID;}
  const action=data.action==='news'?'topic':data.action;
  if(action==='notificationsRead'){
    const all=data.all===true;
    if(!all&&(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>100))throw new IssueError('Choose up to 100 notifications to mark as read.');
    const ids=all?[]:[...new Set(data.ids.map(value=>id(value)))];
    const member=await selfMember(db,session);
    if(member){
      const now=new Date().toISOString(),chunks=all?[[]]:[ids.slice(0,90),ids.slice(90)].filter(chunk=>chunk.length);
      // D1 permits 100 bound parameters per statement, including timestamp/owner.
      await db.batch(chunks.map(chunk=>db.prepare(`UPDATE forum_notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL ${all?'':`AND id IN (${chunk.map(()=>'?').join(',')})`}`).bind(now,member.id,...chunk)));
    }
    return reply({unreadCount:await unreadNotifications(db,member)});
  }
  if(action==='follow'){
    if(typeof data.following!=='boolean')throw new IssueError('Invalid follow setting.');
    const topicId=id(data.id),target=await db.prepare('SELECT hidden FROM forum_topics WHERE id=?').bind(topicId).first();
    if(!target||target.hidden)throw new IssueError('Discussion not found.',404);
    const member=await ensureMember(db,session,context.env,data.profileId);
    if(member.banned&&!admin)throw new IssueError('Posting is disabled for this account.',403);
    if(data.following)await db.prepare('INSERT OR IGNORE INTO forum_follows(topic_id,member_id,last_read_reply) SELECT ?,?,COALESCE(MAX(id),0) FROM forum_replies WHERE topic_id=?').bind(topicId,member.id,topicId).run();
    else await db.prepare('DELETE FROM forum_follows WHERE topic_id=? AND member_id=?').bind(topicId,member.id).run();
    const count=await db.prepare('SELECT COUNT(*) AS n FROM forum_follows WHERE topic_id=?').bind(topicId).first();
    return reply({following:data.following,follower_count:count.n});
  }
  if(action==='like'){
    if(!['topic','reply'].includes(data.kind)||typeof data.liked!=='boolean')throw new IssueError('Invalid like.');
    const postId=id(data.id),target=await db.prepare(data.kind==='topic'?'SELECT member_id,hidden FROM forum_topics WHERE id=?':'SELECT r.member_id,MAX(r.hidden,t.hidden) AS hidden FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?').bind(postId).first();
    if(!target||target.hidden)throw new IssueError('Post not found.',404);
    const member=await ensureMember(db,session,context.env,data.profileId);
    if(member.banned&&!admin)throw new IssueError('Posting is disabled for this account.',403);
    if(target.member_id===member.id)throw new IssueError('You cannot like your own post.',403);
    if(data.liked)await db.prepare('INSERT OR IGNORE INTO forum_likes(kind,post_id,member_id) VALUES(?,?,?)').bind(data.kind,postId,member.id).run();
    else await db.prepare('DELETE FROM forum_likes WHERE kind=? AND post_id=? AND member_id=?').bind(data.kind,postId,member.id).run();
    const count=await db.prepare('SELECT COUNT(*) AS n FROM forum_likes WHERE kind=? AND post_id=?').bind(data.kind,postId).first();
    return reply({liked:data.liked,like_count:count.n});
  }
  if(action==='topicEdit'||action==='replyEdit'){
    const targetId=id(data.id),isTopic=action==='topicEdit';
    const target=await db.prepare(isTopic?'SELECT * FROM forum_topics WHERE id=?':'SELECT * FROM forum_replies WHERE id=?').bind(targetId).first();
    if(!target)throw new IssueError(isTopic?'Discussion not found.':'Reply not found.',404);
    const member=await selfMember(db,session),now=Date.now();
    if(!canEdit(target,member,admin,now))throw new IssueError('You can edit your own posts for 24 hours after posting.',403);
    if(!isTopic&&!admin){const parent=await db.prepare('SELECT hidden FROM forum_topics WHERE id=?').bind(target.topic_id).first();if(!parent||parent.hidden)throw new IssueError('Discussion not found.',404);}
    const body=textField(data.body,'Message',2,10000);
    const recipients=mentionedMembers(body),previous=new Set(mentionedMembers(target.body,false));
    const added=recipients.filter(recipient=>!previous.has(recipient));
    const statements=[];
    // Keep the original publication/activity dates: edits never restart the window or reorder News.
    if(isTopic){
      const title=textField(data.title,'Title',5,160);
      const url=data.releaseUrl===undefined?target.github_release_url:releaseUrl(data.releaseUrl);
      if(data.releaseUrl!==undefined&&!admin)requireAdmin(admin);
      if(url&&target.category_id!==ANNOUNCEMENTS_ID)throw new IssueError('GitHub release links are only available for Announcements.');
      statements.push(db.prepare('UPDATE forum_topics SET title=?,body=?,github_release_url=? WHERE id=?').bind(title,body,url,targetId));
    }
    else statements.push(db.prepare('UPDATE forum_replies SET body=? WHERE id=?').bind(body,targetId));
    const kind=isTopic?'topic':'reply';
    statements.push(syncMentionVisibility(db,kind,targetId,recipients));
    if(added.length){
      const actor=member||await ensureMember(db,session,context.env,data.profileId);
      statements.push(mentionInsert(db,{kind,postId:targetId,actorId:actor.id,recipients:added,createdAt:new Date().toISOString()}));
    }
    await db.batch(statements);
    return reply({ok:true});
  }
  if(action==='topicDelete'||action==='replyDelete'){
    const targetId=id(data.id),isTopic=action==='topicDelete';
    const target=await db.prepare(isTopic?'SELECT * FROM forum_topics WHERE id=?':'SELECT * FROM forum_replies WHERE id=?').bind(targetId).first();
    if(!target)throw new IssueError(isTopic?'Discussion not found.':'Reply not found.',404);
    const member=await selfMember(db,session);
    if(!admin&&(!member||member.id!==target.member_id))throw new IssueError('You can only delete your own posts.',403);
    if(isTopic){
      await db.batch([db.prepare('DELETE FROM forum_notifications WHERE topic_id=?').bind(targetId),db.prepare("DELETE FROM forum_follows WHERE topic_id=?").bind(targetId),db.prepare("DELETE FROM forum_likes WHERE (kind='topic' AND post_id=?) OR (kind='reply' AND post_id IN (SELECT id FROM forum_replies WHERE topic_id=?))").bind(targetId,targetId),db.prepare('DELETE FROM forum_replies WHERE topic_id=?').bind(targetId),db.prepare('DELETE FROM forum_topics WHERE id=?').bind(targetId)]);
    }else{
      await db.batch([db.prepare("DELETE FROM forum_notifications WHERE kind='reply' AND post_id=?").bind(targetId),db.prepare("DELETE FROM forum_likes WHERE kind='reply' AND post_id=?").bind(targetId),db.prepare('DELETE FROM forum_replies WHERE id=?').bind(targetId),db.prepare('UPDATE forum_topics SET updated_at=MAX(created_at,COALESCE((SELECT MAX(created_at) FROM forum_replies WHERE topic_id=? AND hidden=0),created_at)) WHERE id=?').bind(target.topic_id,target.topic_id)]);
    }
    return reply({ok:true});
  }
  if(['category','topicModerate','replyModerate','memberModerate','settings'].includes(action)){
    requireAdmin(admin);
    if(action==='settings'){
      if(typeof data.postingOpen!=='boolean')throw new IssueError('Choose a valid posting setting.');
      await db.prepare('UPDATE forum_settings SET posting_open=? WHERE id=1').bind(+data.postingOpen).run();
    } else if(action==='category'){
      const name=textField(data.name,'Category name',1,60),description=textField(data.description??'','Description',0,240);
      if(!Number.isInteger(data.position)||Math.abs(data.position)>9999||typeof data.archived!=='boolean'||typeof data.readOnly!=='boolean')throw new IssueError('Invalid category settings.');
      const existing=data.id?id(data.id):null;
      if(existing&&!await db.prepare('SELECT id FROM forum_categories WHERE id=?').bind(existing).first())throw new IssueError('Category not found.',404);
      if(await db.prepare('SELECT id FROM forum_categories WHERE name=? AND id!=?').bind(name,existing||0).first())throw new IssueError('A category with this name already exists.');
      if(existing)await db.prepare('UPDATE forum_categories SET name=?,description=?,position=?,archived=?,read_only=? WHERE id=?').bind(name,description,data.position,+data.archived,existing===ANNOUNCEMENTS_ID?1:+data.readOnly,existing).run();
      else {
        const result=await db.prepare('INSERT INTO forum_categories(name,description,position,archived,read_only) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM forum_categories)<100').bind(name,description,data.position,+data.archived,+data.readOnly).run();
        if(!result.meta.changes)throw new IssueError('You can create up to 100 categories.');
      }
    } else if(action==='topicModerate'){
      for(const key of ['pinned','locked','hidden'])if(typeof data[key]!=='boolean')throw new IssueError('Invalid topic settings.');
      const category=id(data.categoryId);if(!await db.prepare('SELECT id FROM forum_categories WHERE id=?').bind(category).first())throw new IssueError('Category not found.');
      const r=await db.prepare("UPDATE forum_topics SET pinned=?,locked=?,hidden=?,category_id=?,github_release_url=CASE WHEN ?=4 THEN github_release_url ELSE '' END WHERE id=?").bind(+data.pinned,+data.locked,+data.hidden,category,category,id(data.id)).run();
      if(!r.meta.changes)throw new IssueError('Discussion not found.',404);
    } else if(action==='replyModerate'){
      if(typeof data.hidden!=='boolean')throw new IssueError('Invalid visibility.');
      const r=await db.prepare('UPDATE forum_replies SET hidden=? WHERE id=?').bind(+data.hidden,id(data.id)).run();if(!r.meta.changes)throw new IssueError('Reply not found.',404);
    } else {
      if(typeof data.banned!=='boolean'||typeof data.clearAbout!=='boolean')throw new IssueError('Invalid member settings.');
      const target=await db.prepare('SELECT user_id FROM forum_members WHERE id=?').bind(String(data.id||'')).first();
      if(!target)throw new IssueError('Member not found.',404);
      if(target.user_id===session.id&&data.banned)throw new IssueError('You cannot restrict your own account.');
      await db.prepare("UPDATE forum_members SET banned=?,about=CASE WHEN ?=1 THEN '' ELSE about END WHERE id=?").bind(+data.banned,+data.clearAbout,data.id).run();
    }
    return reply({ok:true});
  }
  if(!['profile','topic','reply'].includes(action))throw new IssueError('Unknown action.');
  // Validate before creating a member or contacting Nuvio.
  const body=action==='profile'?textField(data.about??'','About me',0,1000):textField(data.body,'Message',2,10000);
  const recipients=action==='profile'?[]:mentionedMembers(body);
  const title=action==='topic'?textField(data.title,'Title',5,160):'';
  const githubUrl=action==='topic'?releaseUrl(data.releaseUrl):'';
  if(githubUrl&&!admin)requireAdmin(admin);
  const member=await ensureMember(db,session,context.env,data.profileId);
  if(member.banned&&!admin)throw new IssueError('Posting is disabled for this account.',403);
  if(action==='profile'){
    await db.prepare('UPDATE forum_members SET about=? WHERE id=?').bind(body,member.id).run();return reply({memberId:member.id});
  }
  await mayPost(db,member,admin);
  const now=new Date().toISOString(),since=new Date(Date.now()-86400000).toISOString();
  if(action==='topic'){
    const category=await validCategory(db,data.categoryId,admin);
    if(githubUrl&&category!==ANNOUNCEMENTS_ID)throw new IssueError('GitHub release links are only available for Announcements.');
    const insert=db.prepare(`INSERT INTO forum_topics(member_id,category_id,title,body,created_at,updated_at,github_release_url) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM forum_topics WHERE member_id=? AND created_at>?)<10 AND EXISTS(SELECT 1 FROM forum_members WHERE id=? AND (banned=0 OR ?=1)) AND EXISTS(SELECT 1 FROM forum_settings WHERE posting_open=1 OR ?=1) AND EXISTS(SELECT 1 FROM forum_categories WHERE id=? AND archived=0 AND ((read_only=0 AND id!=4) OR ?=1))`).bind(member.id,category,title,body,now,now,githubUrl,member.id,since,member.id,+admin,+admin,category,+admin);
    const notification=mentionInsert(db,{kind:'topic',actorId:member.id,recipients,createdAt:now,newPost:true});
    const [result]=await db.batch([insert,...(notification?[notification]:[])]);
    if(!result.meta.changes)throw new IssueError('Unable to post: the forum settings changed or you reached the limit of 10 topics per day.',429);
    return reply({id:result.meta.last_row_id},201);
  }
  const topicId=id(data.id),topic=await db.prepare('SELECT * FROM forum_topics WHERE id=?').bind(topicId).first();
  if(!topic||topic.hidden)throw new IssueError('Discussion not found.',404);
  if(topic.locked&&!admin)throw new IssueError('This discussion is locked.',409);
  const insert=db.prepare(`INSERT INTO forum_replies(topic_id,member_id,body,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM forum_replies WHERE member_id=? AND created_at>?)<50 AND EXISTS(SELECT 1 FROM forum_topics WHERE id=? AND hidden=0 AND (locked=0 OR ?=1)) AND EXISTS(SELECT 1 FROM forum_members WHERE id=? AND (banned=0 OR ?=1)) AND EXISTS(SELECT 1 FROM forum_settings WHERE posting_open=1 OR ?=1)`).bind(topicId,member.id,body,now,member.id,since,topicId,+admin,member.id,+admin,+admin);
  const notification=mentionInsert(db,{kind:'reply',actorId:member.id,recipients,createdAt:now,newPost:true});
  const [result]=await db.batch([insert,...(notification?[notification]:[]),db.prepare('UPDATE forum_topics SET updated_at=(SELECT MAX(created_at) FROM forum_replies WHERE topic_id=? AND hidden=0) WHERE id=? AND updated_at<(SELECT MAX(created_at) FROM forum_replies WHERE topic_id=? AND hidden=0)').bind(topicId,topicId,topicId)]);
  if(!result.meta.changes)throw new IssueError('Unable to reply: the discussion settings changed or you reached the limit of 50 replies per day.',429);
  return reply({id:result.meta.last_row_id},201);
});
