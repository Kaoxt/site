import { handle, input, IssueError, imageAttachments } from '../../_lib/issues.js';
import { avatarDb, getAccountAvatar } from '../../_lib/account-avatar.js';
export const onRequestGet = context => handle(context, false, async ({session,reply}) => {
  if(!session) throw new IssueError('Sign in with Nuvio first.',401);
  return reply({avatarUrl:await getAccountAvatar(context.env,session.id)});
});
export const onRequestPost = context => handle(context, true, async ({session,reply}) => {
  const data=await input(context.request);
  const db=await avatarDb(context.env);
  if(data.remove === true) {await db.prepare('DELETE FROM account_avatars WHERE user_id = ?').bind(session.id).run();return reply({avatarUrl:''});}
  let url='',image='';
  if(typeof data.image === 'string' && data.image) {
    imageAttachments([data.image]);
    if(atob(data.image.split(',')[1]).length>50000) throw new IssueError('Avatar must be smaller than 50 KB after compression.');
    image=data.image;
  } else {
    try {const u=new URL(data.url);if(u.protocol!=='https:' || u.username || u.password || u.href.length>2048)throw new Error();url=u.href;}
    catch{throw new IssueError('Enter a valid HTTPS image URL or upload an image.');}
  }
  const existing=await db.prepare('SELECT updated_at FROM account_avatars WHERE user_id = ?').bind(session.id).first();
  if(existing && Date.now()-Date.parse(existing.updated_at)<10000) throw new IssueError('Please wait a few seconds before changing your avatar again.',429);
  const id=crypto.randomUUID();
  await db.prepare(`INSERT INTO account_avatars (user_id,id,url,image,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,url=excluded.url,image=excluded.image,updated_at=excluded.updated_at`)
    .bind(session.id,id,url,image,new Date().toISOString()).run();
  return reply({avatarUrl:url || `/api/avatars/${id}`});
});
