import { avatarDb } from '../../_lib/account-avatar.js';
export async function onRequestGet(context) {
  if(!/^[0-9a-f-]{36}$/.test(context.params.id)) return new Response('Not found',{status:404});
  const db=await avatarDb(context.env);
  const row=await db.prepare('SELECT image FROM account_avatars WHERE id = ?').bind(context.params.id).first();
  if(!row?.image) return new Response('Not found',{status:404});
  const [prefix,encoded]=row.image.split(',');
  return new Response(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),{headers:{'Content-Type':prefix.slice(5).split(';')[0],'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
