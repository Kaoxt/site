(() => {
  'use strict';
  const form=document.getElementById('accountAvatarForm');if(!form)return;
  const url=document.getElementById('accountAvatarUrl'),file=document.getElementById('accountAvatarFile'),preview=document.getElementById('accountAvatarPreview'),status=document.getElementById('accountAvatarStatus');
  let pendingImage='',busy=false,loaded=false;
  const controls=[...form.querySelectorAll('input,button')];
  function lock(value){busy=value;controls.forEach(c=>c.disabled=value||!loaded);}
  function show(source){preview.replaceChildren();if(!source){preview.textContent='N';return;}const img=document.createElement('img');img.alt='Account avatar';img.referrerPolicy='no-referrer';img.src=source;img.onerror=()=>{preview.textContent='N';status.textContent='Image could not load. Check that the URL is a publicly accessible image.';};preview.append(img);}
  async function request(options={}){const response=await fetch('/api/account/avatar',{credentials:'same-origin',cache:'no-store',...options});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save your avatar.');return data;}
  async function load(){loaded=false;lock(true);try{const data=await request();url.value=data.avatarUrl?.startsWith('https:')?data.avatarUrl:'';pendingImage='';show(data.avatarUrl);loaded=true;status.textContent='';}catch(e){status.textContent=e.message;}finally{lock(false);}}
  url.addEventListener('input',()=>{pendingImage='';file.value='';});
  file.addEventListener('change',async()=>{
    const imageFile=file.files[0];if(!imageFile)return;lock(true);status.textContent='Preparing avatar…';
    let objectUrl;
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(imageFile.type)||imageFile.size>10*1024*1024)throw new Error('Choose a JPG, PNG, or WebP image smaller than 10 MB.');
      objectUrl=URL.createObjectURL(imageFile);const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('This image could not be read.'));img.src=objectUrl;});
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d'),side=Math.min(img.naturalWidth,img.naturalHeight);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,256,256);ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,256,256);
      let encoded='';for(const quality of [.85,.7,.5,.3]){encoded=canvas.toDataURL('image/jpeg',quality);if(encoded.length<=66680)break;}
      if(encoded.length>66680)throw new Error('Please choose a simpler or smaller image.');
      pendingImage=encoded;url.value='';show(encoded);status.textContent='Preview ready. Choose Save avatar to use it.';
    }catch(e){status.textContent=e.message;}finally{if(objectUrl)URL.revokeObjectURL(objectUrl);file.value='';lock(false);}
  });
  async function save(data){lock(true);status.textContent='Saving…';try{const result=await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});pendingImage='';show(result.avatarUrl);if(data.remove)url.value='';status.textContent=result.avatarUrl?'Account avatar saved. It applies across all your profiles on The Kollection.':'Account avatar removed. Your Nuvio profile avatar will be used.';window.dispatchEvent(new CustomEvent('kollection:avatar-changed'));}catch(e){status.textContent=e.message;}finally{lock(false);}}
  form.addEventListener('submit',event=>{event.preventDefault();if(busy||!loaded)return;if(pendingImage)return save({image:pendingImage});try{const u=new URL(url.value.trim());if(u.protocol!=='https:'||u.username||u.password)throw new Error();save({url:u.href});}catch{status.textContent='Enter an HTTPS image URL or upload an image.';url.focus();}});
  document.getElementById('accountAvatarRemove').addEventListener('click',()=>{if(!busy&&loaded)save({remove:true});});
  window.addEventListener('kollection:nuvio-signed-in',load);
  window.addEventListener('kollection:nuvio-signed-out',()=>{loaded=false;pendingImage='';url.value='';show('');lock(false);});
  load();
})();
