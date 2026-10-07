(() => {
  'use strict';
  const drafts = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function avatar(author, url, color) {
    let safe = /^\/api\/avatars\/[0-9a-f-]{36}$/.test(url || '') ? url : ''; try { const u = new URL(url); if(u.protocol === 'https:') safe = u.href; } catch {}
    const shade = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#6568e8';
    return `<span class="issue-avatar" style="background:${shade}" aria-hidden="true"><span>${esc((author || 'N')[0].toUpperCase())}</span>${safe ? `<img src="${esc(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
  }
  document.addEventListener('error', event => { if(event.target.matches?.('.issue-avatar img')) event.target.remove(); }, true);
  function gallery(images) {
    return `<div class="issue-images">${(images || []).filter(url => /^\/api\/issues\/\d+\/images\/[0-2](\?comment=\d+)?$/.test(url)).map((url,i) => `<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="Open attached image ${i+1}"><img src="${esc(url)}" alt="Attached error screenshot ${i+1}" loading="lazy"></a>`).join('')}</div>`;
  }
  async function compress(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPG, PNG, or WebP images.');
    if(file.size > 15 * 1024 * 1024) throw new Error('Choose images smaller than 15 MB.');
    const url = URL.createObjectURL(file), image = new Image();
    try {
      await new Promise((resolve,reject) => { image.onload=resolve;image.onerror=()=>reject(new Error('This image could not be read.'));image.src=url; });
      if(image.naturalWidth * image.naturalHeight > 50000000) throw new Error('This image is too large. Crop or resize it first.');
      const canvas=document.createElement('canvas');
      let scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
      for(let attempt=0;attempt<5;attempt++) {
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
        const encoded=canvas.toDataURL('image/jpeg',.86-attempt*.08);
        if(encoded.length<=530000) return encoded;
        scale*=.8;
      }
      throw new Error('This image could not be compressed. Try a smaller screenshot.');
    } finally { URL.revokeObjectURL(url); }
  }
  function attach(form) {
    if(!form || drafts.has(form)) return;
    const state={images:[],pending:false};drafts.set(form,state);
    const box=document.createElement('div');box.className='issue-attachments';
    box.innerHTML='<label>Images (optional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="issue-note">Up to 3 images · JPG, PNG, WebP · 15 MB each. Images are compressed and posted publicly.</p><div class="issue-image-previews"></div><p class="issue-error" role="alert"></p>';
    form.querySelector('.issue-form-actions').before(box);
    const input=box.querySelector('input'),previews=box.querySelector('.issue-image-previews'),error=box.querySelector('[role=alert]');
    function draw(){previews.replaceChildren();state.images.forEach((image,index)=>{const tile=document.createElement('div'),img=document.createElement('img'),button=document.createElement('button');img.src=image;img.alt=`Attachment ${index+1}`;button.type='button';button.textContent='Remove';button.setAttribute('aria-label',`Remove attachment ${index+1}`);button.onclick=()=>{state.images.splice(index,1);draw();};tile.append(img,button);previews.append(tile);});}
    input.addEventListener('change',async()=>{
      error.textContent='';const files=[...input.files];input.value='';
      if(state.images.length+files.length>3){error.textContent='Attach up to 3 images. Remove an image before adding another.';return;}
      state.pending=true;input.disabled=true;
      try {for(const file of files){state.images.push(await compress(file));draw();}}
      catch(e){error.textContent=e.message;}
      finally {state.pending=false;input.disabled=false;}
    });
    form.addEventListener('reset',()=>{state.images=[];draw();error.textContent='';});
  }
  window.KollectionIssueMedia=Object.freeze({avatar,gallery,attach,collect:form=>{const draft=drafts.get(form);if(draft?.pending)throw new Error('Please wait for your images to finish processing.');return draft?.images || [];}});
})();
