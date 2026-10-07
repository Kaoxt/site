(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(params={},data){
    const response=await fetch('/api/forum?'+new URLSearchParams(params),{credentials:'same-origin',cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,profileId:window.KollectionNavAccount?.getSelectedProfile?.()?.id||null})}:{})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'Unable to connect. Please try again.');return result;
  }
  const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const author=m=>`<a class="forum-author" href="/discussions#member/${encodeURIComponent(m.member_id)}">${window.KollectionIssueMedia.avatar(m.author,m.avatar_url,m.avatar_color)}<span>${esc(m.author)}</span></a>`;
  const flags=t=>`${t.pinned?'<span class="issue-badge">Pinned</span>':''}${t.locked?'<span class="issue-badge">Locked</span>':''}${t.hidden?'<span class="issue-badge">Hidden</span>':''}`;
  const rows=topics=>topics.length?topics.map(t=>`<article class="issue-row"><div class="issue-row-main"><div class="issue-meta">${flags(t)}<span>${esc(t.category_name)}</span></div><h3><a href="/discussions#topic/${t.id}">${esc(t.title)}</a></h3><div class="issue-meta">${author(t)}<span>${date(t.updated_at)} · ${t.reply_count} ${t.reply_count===1?'reply':'replies'}</span></div></div></article>`).join(''):'<div class="issue-empty">No discussions yet.</div>';
  async function submit(form,fn){
    if(form.dataset.busy)return;form.dataset.busy='1';const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    const status=form.querySelector('[data-status]');if(status)status.textContent='';
    try{await fn();}catch(e){if(status){status.textContent=e.message;status.focus();}else throw e;}finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);}
  }
  window.KollectionForum={esc,api,date,author,flags,rows,submit};
})();
