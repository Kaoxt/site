(() => {
  const {esc}=window.KollectionForum;
  // Escape all input before adding our small, fixed set of formatting elements.
  // Links are parsed separately so user text can never become an HTML attribute.
  function inline(value){
    const tokens=[];
    const keep=html=>'\u0000'+(tokens.push(html)-1)+'\u0000';
    let text=String(value).replace(/\u0000/g,'').replace(/`([^`\n]+)`/g,(_,code)=>keep('<code>'+esc(code)+'</code>'));
    text=text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/g,(_,label,url)=>{
      try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return esc(label);return keep('<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer nofollow">'+esc(label)+'</a>');}catch{return label;}
    });
    text=esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/\+\+([^+\n]+)\+\+/g,'<u>$1</u>');
    return text.replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]||'');
  }
  function render(value){
    const lines=String(value??'').replace(/\r\n?/g,'\n').split('\n');let html='',list='',code=null;
    const close=()=>{if(list){html+='</'+list+'>';list='';}};
    for(const line of lines){
      if(/^```\s*$/.test(line)){close();if(code!==null){html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';code=null;}else code=[];continue;}
      if(code!==null){code.push(line);continue;}
      const bullet=line.match(/^\s*[-*] (.*)$/),number=line.match(/^\s*\d+\. (.*)$/),kind=bullet?'ul':number?'ol':'';
      if(kind){if(list!==kind){close();list=kind;html+='<'+kind+'>';}html+='<li>'+inline((bullet||number)[1])+'</li>';continue;}
      close();if(/^> ?/.test(line))html+='<blockquote>'+inline(line.replace(/^> ?/,''))+'</blockquote>';
      else html+=line?'<div>'+inline(line)+'</div>':'<br>';
    }
    close();if(code!==null)html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';return html;
  }
  function attach(scope){scope.querySelectorAll('textarea[name="body"]').forEach(input=>{
    if(input.dataset.editor)return;input.dataset.editor='1';
    // Keep the real textarea for native validation, mobile selection and FormData.
    const label=input.closest('label');if(label){const caption=document.createElement('span');caption.textContent=label.firstChild.textContent;input.id=input.id||'message-'+Math.random().toString(36).slice(2);const name=document.createElement('label');name.htmlFor=input.id;name.append(caption);label.before(name);label.replaceWith(input);}
    const editor=document.createElement('div');editor.className='forum-editor';input.before(editor);editor.append(input);
    const bar=document.createElement('div');bar.className='forum-editor-tools';bar.setAttribute('role','group');bar.setAttribute('aria-label','Message formatting');editor.prepend(bar);
    const preview=document.createElement('div');preview.className='forum-rich forum-editor-preview';preview.hidden=true;editor.append(preview);
    const items=[['Bold','B','**','**'],['Italic','I','*','*'],['Underline','U','++','++'],['Link','Link','[','](https://example.com)'],['Quote','Quote','> ',''],['Bulleted list','• List','- ',''],['Numbered list','1. List','1. ',''],['Code','</>','`','`']];
    items.forEach(([name,caption,before,after])=>{const button=document.createElement('button');button.type='button';button.textContent=caption;button.title=name;button.setAttribute('aria-label',name);bar.append(button);button.onmousedown=e=>e.preventDefault();button.onclick=()=>{
      const start=input.selectionStart,end=input.selectionEnd,selected=input.value.slice(start,end)||'text';let replacement=before+selected+after;
      if(['Quote','Bulleted list','Numbered list'].includes(name)){replacement=(start&&input.value[start-1]!=='\n'?'\n':'')+selected.split('\n').map((line,i)=>(name==='Numbered list'?(i+1)+'. ':before)+line).join('\n');}
      if(input.value.length-(end-start)+replacement.length>input.maxLength)return;
      input.setRangeText(replacement,start,end,'select');input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));
    };});
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent='Preview';toggle.setAttribute('aria-pressed','false');bar.append(toggle);
    toggle.onclick=()=>{const show=preview.hidden;preview.hidden=!show;preview.innerHTML=render(input.value)||'<p>Nothing to preview yet.</p>';toggle.textContent=show?'Close preview':'Preview';toggle.setAttribute('aria-pressed',String(show));};
    input.addEventListener('input',()=>{if(!preview.hidden)preview.innerHTML=render(input.value);});
    const hint=document.createElement('p');hint.className='issue-note forum-editor-hint';hint.textContent='Select text to format it. Preview shows how your post will look.';editor.append(hint);
  });}
  window.KollectionForumEditor={render,attach};
})();
