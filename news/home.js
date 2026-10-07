(() => {
  const card=document.querySelector('.latest-update');if(!card)return;
  fetch('/api/forum?view=latestNews',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
    if(!response.ok)throw Error('News unavailable');
    const {article}=await response.json();
    if(!article){card.hidden=true;return;}
    card.querySelector('.latest-update-title').textContent=article.title;
    card.querySelector('.version-badge').textContent='News';
    card.href='/news.html#topic/'+article.id;
    card.setAttribute('aria-label','Read the latest Kollection update: '+article.title);
  }).catch(()=>{/* Keep the generic News link if the feed is temporarily unavailable. */});
})();
