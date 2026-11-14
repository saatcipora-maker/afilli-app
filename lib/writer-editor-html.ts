import { randomUUID } from 'expo-crypto';

/**
 * Self-contained offline rich-text engine (no CDN). Runs inside a native WebView
 * or a web iframe srcDoc. Messages are JSON strings in both directions.
 */
const ENGINE = String.raw`
(function(){
var ed=document.getElementById('ed');
var cur=null, stacks={}, lru=[], snapT=null, emitT=null, lastRange=null, gen=0, spellSug={}, selT=null;
function post(m){var s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else if(window.parent!==window)window.parent.postMessage({__afilli:1,payload:s},'*');}
try{document.execCommand('styleWithCSS',false,true);document.execCommand('defaultParagraphSeparator',false,'p');}catch(e){}
function clean(){
  var c=ed.cloneNode(true);
  c.querySelectorAll('span.sp').forEach(function(s){var p=s.parentNode;while(s.firstChild)p.insertBefore(s.firstChild,s);p.removeChild(s);});
  c.querySelectorAll('[data-voice]').forEach(function(s){s.parentNode.removeChild(s);});
  c.querySelectorAll('img').forEach(function(i){var k=i.getAttribute('data-canon');if(k){i.setAttribute('src',k);i.removeAttribute('data-canon');}});
  var FS={'x-small':'12px','small':'14px','medium':'16px','large':'20px','x-large':'22px','xx-large':'28px','xxx-large':'32px'},FN={'1':'12px','2':'14px','3':'16px','4':'18px','5':'22px','6':'28px','7':'32px'};
  c.querySelectorAll('font').forEach(function(f){var sp=document.createElement('span');if(f.getAttribute('size'))sp.style.fontSize=FN[f.getAttribute('size')]||'16px';if(f.getAttribute('color'))sp.style.color=f.getAttribute('color');while(f.firstChild)sp.appendChild(f.firstChild);f.parentNode.replaceChild(sp,f);});
  c.querySelectorAll('[style]').forEach(function(e){var v=e.style.fontSize;if(v&&FS[v])e.style.fontSize=FS[v];});
  c.querySelectorAll('script,style,iframe,object,embed').forEach(function(x){x.parentNode.removeChild(x);});
  var h=c.innerHTML.replace(/\u200b/g,'');
  if(h==='<p><br></p>'||h==='<br>')h='';
  return h;
}
function textOf(){return (ed.innerText||'').replace(/\u200b/g,'');}
function ph(){ed.classList.toggle('empty',textOf().trim()===''&&!ed.querySelector('img'));}
function emitNow(){clearTimeout(emitT);emitT=null;if(cur)post({t:'change',id:cur,html:clean()});}
function st(){return stacks[cur]||(stacks[cur]={u:[],r:[]});}
var MAXSTEPS=60,MAXCH=4,BUDGET=3000000;
function stackSize(s){var n=0,i;for(i=0;i<s.u.length;i++)n+=s.u[i].length;for(i=0;i<s.r.length;i++)n+=s.r[i].length;return n;}
function touchLru(id){var i=lru.indexOf(id);if(i>=0)lru.splice(i,1);lru.push(id);while(lru.length>MAXCH){delete stacks[lru.shift()];}}
function trim(){var total=0,k;for(k in stacks)total+=stackSize(stacks[k]);
  for(var i=0;total>BUDGET&&i<lru.length;){var id=lru[i];if(id===cur||!stacks[id]){i++;continue;}total-=stackSize(stacks[id]);delete stacks[id];lru.splice(i,1);}
  var s=stacks[cur];if(!s)return;while(total>BUDGET&&s.r.length){total-=s.r.shift().length;}while(total>BUDGET&&s.u.length>1){total-=s.u.shift().length;}}
function snap(){clearTimeout(snapT);snapT=null;if(!cur)return;var s=st(),h=ed.innerHTML;if(s.u[s.u.length-1]!==h){s.u.push(h);if(s.u.length>MAXSTEPS)s.u.shift();s.r=[];trim();}}
function snapSoon(){clearTimeout(snapT);snapT=setTimeout(snap,450);}
function changed(){gen++;ph();snapSoon();emitNow();}
function prepImgs(root){var need=[];root.querySelectorAll('img').forEach(function(i){var s=i.getAttribute('data-canon')||i.getAttribute('src')||'';if(/^\/api\/writer-media\//.test(s)){i.setAttribute('data-canon',s);if(!/^https?:/.test(i.getAttribute('src')||''))i.removeAttribute('src');need.push(s);}else if(!/^https?:/.test(s)){i.parentNode.removeChild(i);}});if(need.length)post({t:'needImgs',list:need});}
function restoreSel(){ed.focus();if(lastRange){var s=window.getSelection();s.removeAllRanges();s.addRange(lastRange);}}
function block(){var s=window.getSelection();if(!s.rangeCount)return '';var n=s.anchorNode;while(n&&n!==ed){if(n.nodeType===1&&/^(H1|H2|H3|BLOCKQUOTE|P|LI)$/.test(n.nodeName))return n.nodeName.toLowerCase();n=n.parentNode;}return '';}
function state(){var q=function(c){try{return document.queryCommandState(c);}catch(e){return false;}};
  post({t:'sel',s:{bold:q('bold'),italic:q('italic'),underline:q('underline'),strike:q('strikeThrough'),ul:q('insertUnorderedList'),ol:q('insertOrderedList'),center:q('justifyCenter'),right:q('justifyRight'),block:block()}});}
document.addEventListener('selectionchange',function(){var s=window.getSelection();if(s.rangeCount&&ed.contains(s.anchorNode)){lastRange=s.getRangeAt(0).cloneRange();clearTimeout(selT);selT=setTimeout(state,120);}});
ed.addEventListener('input',function(e){var s=window.getSelection();if(s.anchorNode){var n=s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentNode;var sp=n&&n.closest&&n.closest('span.sp');if(sp){var p=sp.parentNode;while(sp.firstChild)p.insertBefore(sp.firstChild,sp);p.removeChild(sp);}}changed();});
ed.addEventListener('beforeinput',function(e){if(e.inputType==='historyUndo'){e.preventDefault();undo();}else if(e.inputType==='historyRedo'){e.preventDefault();redo();}});
ed.addEventListener('keydown',function(e){var k=(e.key||'').toLowerCase();if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo();}});
ed.addEventListener('paste',function(e){e.preventDefault();var t=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,t);});
ed.addEventListener('drop',function(e){e.preventDefault();});
ed.addEventListener('blur',function(){emitNow();});
window.addEventListener('blur',function(){emitNow();});window.addEventListener('pagehide',function(){emitNow();});document.addEventListener('visibilitychange',function(){emitNow();});
ed.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(a)e.preventDefault();var sp=e.target.closest&&e.target.closest('span.sp');if(sp){var i=sp.getAttribute('data-i');post({t:'spell',i:i,word:sp.textContent,suggestions:spellSug[i]||[]});}});
function undo(){snap();var s=st();if(s.u.length<2)return;s.r.push(s.u.pop());ed.innerHTML=s.u[s.u.length-1];prepImgs(ed);gen++;ph();emitNow();}
function redo(){var s=st();if(!s.r.length)return;var h=s.r.pop();s.u.push(h);ed.innerHTML=h;prepImgs(ed);gen++;ph();emitNow();}
function fmtBlock(tag){var b=block();document.execCommand('formatBlock',false,'<'+(b===tag?'p':tag)+'>');}
function walk(){var out='',map=[];var w=document.createTreeWalker(ed,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,null);var n;
  while((n=w.nextNode())){if(n.nodeType===1){if(/^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE|BR)$/.test(n.nodeName)&&out&&out[out.length-1]!=='\n')out+='\n';continue;}
    if(n.parentNode&&n.parentNode.hasAttribute&&n.parentNode.hasAttribute('data-voice'))continue;map.push({n:n,s:out.length});out+=n.data;}
  return {text:out,map:map};}
function unmark(){ed.querySelectorAll('span.sp').forEach(function(s){var p=s.parentNode;while(s.firstChild)p.insertBefore(s.firstChild,s);p.removeChild(s);});ed.normalize();spellSug={};}
function spellReq(){unmark();var w=walk(),t=w.text,chunks=[],i=0;while(i<t.length){var end=Math.min(t.length,i+9500);if(end<t.length){var j=t.lastIndexOf(' ',end);var k=t.lastIndexOf('\n',end);j=Math.max(j,k);if(j>i)end=j;}chunks.push({start:i,text:t.slice(i,end)});i=end;}post({t:'spellText',gen:gen,chunks:chunks});}
function spellMarks(g,issues){if(g!==gen){post({t:'spellStale'});return;}unmark();var w=walk();issues.sort(function(a,b){return b.offset-a.offset;});var c=0;
  issues.forEach(function(is,idx){for(var m=w.map.length-1;m>=0;m--){var e=w.map[m];if(e.s<=is.offset){var lo=is.offset-e.s;if(lo+is.length>e.n.data.length)return;var r=document.createRange();r.setStart(e.n,lo);r.setEnd(e.n,lo+is.length);var sp=document.createElement('span');sp.className='sp';sp.setAttribute('data-i',String(idx));spellSug[idx]=is.suggestions;try{r.surroundContents(sp);c++;}catch(x){}return;}}});
  post({t:'spellDone',count:c});}
function spellApply(i,v){var sp=ed.querySelector('span.sp[data-i="'+i+'"]');if(!sp)return;snap();var t=document.createTextNode(v);sp.parentNode.replaceChild(t,sp);ed.normalize();changed();snap();emitNow();}
function marker(id){restoreSel();var s=window.getSelection();var sp=document.createElement('span');sp.setAttribute('data-voice',id);sp.textContent='\u200b';if(s.rangeCount&&ed.contains(s.anchorNode)){var r=s.getRangeAt(0);r.collapse(false);r.insertNode(sp);}else{var p=ed.lastElementChild||ed;p.appendChild(sp);}}
function voiceInsert(id,text){var sp=ed.querySelector('[data-voice="'+id+'"]');snap();var tn=document.createTextNode(text);if(sp){sp.parentNode.replaceChild(tn,sp);}else{var p=document.createElement('p');p.appendChild(tn);ed.appendChild(p);}ed.normalize();changed();snap();emitNow();}
function voiceCancel(id){var sp=ed.querySelector('[data-voice="'+id+'"]');if(sp)sp.parentNode.removeChild(sp);}
function cmd(n,v){restoreSel();snap();
  switch(n){case 'bold':case 'italic':case 'underline':case 'strikeThrough':case 'insertUnorderedList':case 'insertOrderedList':case 'justifyLeft':case 'justifyCenter':case 'justifyRight':document.execCommand(n,false,null);break;
  case 'h1':case 'h2':case 'h3':case 'blockquote':fmtBlock(n);break;
  case 'size':document.execCommand('fontSize',false,v==='small'?'2':v==='large'?'5':'3');break;
  case 'color':document.execCommand('foreColor',false,v);break;
  case 'link':var s=window.getSelection();if(s.isCollapsed){var a=document.createElement('a');a.href=v.url;a.textContent=v.text||v.url;var r=s.getRangeAt(0);r.insertNode(a);r.setStartAfter(a);s.removeAllRanges();s.addRange(r);}else document.execCommand('createLink',false,v.url);break;
  case 'unlink':document.execCommand('unlink',false,null);break;
  case 'image':var im=document.createElement('img');im.setAttribute('data-canon',v.canon);im.setAttribute('src',v.url);im.setAttribute('alt','');var p=document.createElement('p');p.appendChild(im);var b=window.getSelection();var bl=b.anchorNode;while(bl&&bl.parentNode!==ed)bl=bl.parentNode;if(bl&&bl.nextSibling)ed.insertBefore(p,bl.nextSibling);else ed.appendChild(p);break;
  case 'undo':undo();return;case 'redo':redo();return;}
  changed();snap();emitNow();state();}
function recv(raw){var m=typeof raw==='string'?JSON.parse(raw):raw;
  switch(m.t){case 'load':if(cur)emitNow();cur=m.id;touchLru(cur);ed.innerHTML=m.html||'<p><br></p>';prepImgs(ed);var s=st();if(!s.u.length)s.u.push(ed.innerHTML);gen++;ph();lastRange=null;break;
  case 'cmd':cmd(m.name,m.value);break;case 'night':document.body.classList.toggle('night',!!m.on);break;
  case 'imgUrl':ed.querySelectorAll('img').forEach(function(i){if(i.getAttribute('data-canon')===m.canon)i.setAttribute('src',m.url);});break;
  case 'flush':emitNow();post({t:'flushed',req:m.req});break;case 'spellReq':spellReq();break;case 'spellMarks':spellMarks(m.gen,m.issues);break;case 'spellClear':unmark();break;
  case 'spellApply':spellApply(m.i,m.value);break;case 'voiceMark':marker(m.id);break;case 'voiceInsert':voiceInsert(m.id,m.text);break;case 'voiceCancel':voiceCancel(m.id);break;
  case 'focus':restoreSel();break;case 'readonly':ed.setAttribute('contenteditable',m.on?'false':'true');break;}}
window.__recv=function(s){try{recv(s);}catch(e){post({t:'err',m:String(e)});}};
window.addEventListener('message',function(e){if(e.source===window.parent&&typeof e.data==='string'){window.__recv(e.data);}});
post({t:'ready'});
})();`;

export function editorHtml(placeholder: string): string {
  const nonce = randomUUID().replace(/-/g, '');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'">
<style>
html,body{margin:0;padding:0;background:#FFF8EC;color:#3E2A1A;height:100%}
body{font-family:Georgia,'Times New Roman',serif;-webkit-text-size-adjust:100%;transition:background .25s,color .25s}
body.night{background:#211810;color:#EADBC4}
#ed{min-height:100%;box-sizing:border-box;padding:18px 18px 80px;outline:none;font-size:18px;line-height:1.7;word-wrap:break-word;caret-color:#C9A24B}
#ed.empty:before{content:${JSON.stringify(placeholder)};color:#A08C76;font-style:italic;position:absolute;pointer-events:none}
#ed p{margin:0 0 .7em}#ed h1{font-size:1.6em;margin:.6em 0 .4em;line-height:1.25}#ed h2{font-size:1.35em;margin:.6em 0 .4em}#ed h3{font-size:1.15em;margin:.6em 0 .4em}
#ed blockquote{margin:.8em 0;padding:.2em 0 .2em 1em;border-left:3px solid #C9A24B;font-style:italic;color:inherit;opacity:.88}
#ed a{color:#9A7430;text-decoration:underline}body.night #ed a{color:#E3C47A}
#ed img{max-width:100%;border-radius:10px;display:block;margin:.6em auto;min-height:40px;background:rgba(201,162,75,.15)}
#ed img:not([src]){min-height:120px;border:1px dashed #C9A24B}
#ed span.sp{text-decoration:underline wavy #C0392B;text-decoration-skip-ink:none;text-underline-offset:3px;cursor:pointer}
::selection{background:rgba(201,162,75,.35)}
</style></head><body><div id="ed" contenteditable="true" spellcheck="false" autocapitalize="sentences" role="textbox" aria-multiline="true" aria-label="Bölüm metni"></div><script nonce="${nonce}">${ENGINE}</script></body></html>`;
}

export type EditorSel = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; ul: boolean; ol: boolean; center: boolean; right: boolean; block: string };
export type EditorEvent =
  | { t: 'ready' } | { t: 'change'; id: string; html: string } | { t: 'sel'; s: EditorSel }
  | { t: 'needImgs'; list: string[] } | { t: 'spell'; i: string; word: string; suggestions: string[] }
  | { t: 'spellText'; gen: number; chunks: { start: number; text: string }[] } | { t: 'spellStale' } | { t: 'spellDone'; count: number } | { t: 'err'; m: string } | { t: 'flushed'; req: string };

export type EditorHandle = {
  send: (msg: Record<string, unknown>) => void;
  /** Resolves after the engine emitted its final content (correlated ACK); rejects on timeout/not ready/unmount. */
  flush: (timeoutMs?: number) => Promise<void>;
};
