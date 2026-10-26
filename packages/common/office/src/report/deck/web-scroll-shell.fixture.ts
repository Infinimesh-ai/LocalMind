// Exact trusted shell before the chapter navigation race fix.
export const WEB_SCROLL_SHELL_SCRIPT = String.raw`(function(){'use strict';
var d=document,root=d.documentElement,stage=d.getElementById('deck-stage');
if(!stage)return;
var slides=Array.prototype.slice.call(stage.querySelectorAll(':scope>[data-slide]'));
var total=slides.length,cur=0,reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var nav=d.getElementById('deck-nav'),select=d.getElementById('deck-chapters'),num=d.getElementById('deck-num'),bar=d.getElementById('deck-bar');
var modeButton=d.getElementById('deck-mode'),fullButton=d.getElementById('deck-fullscreen'),status=d.getElementById('deck-status');
var zh=root.lang.indexOf('zh')===0,timer=0,frame=0,managedFullscreen=false,hostFullscreen=false,beforeImmersive='read';
function present(){return root.getAttribute('data-mode')==='present';}
function post(){if(window.parent!==window)window.parent.postMessage({type:'localmind-deck',slide:cur,total:total,mode:present()?'present':'read'},'*');}
function countUp(slide){
 if(reduce||root.hasAttribute('data-static')||slide.hasAttribute('data-counted'))return;
 slide.setAttribute('data-counted','');
 Array.prototype.forEach.call(slide.querySelectorAll('[data-count]'),function(el){
  var raw=el.getAttribute('data-count')||'',m=/-?\d[\d,]*(?:\.\d+)?/.exec(raw);if(!m)return;
  var pre=raw.slice(0,m.index),suf=raw.slice(m.index+m[0].length),clean=m[0].replace(/,/g,''),target=parseFloat(clean),dec=(clean.split('.')[1]||'').length,start=0;
  if(!isFinite(target))return;
  function step(now){if(!start)start=now;var t=Math.min(1,(now-start)/900),v=(target*(1-Math.pow(1-t,3))).toFixed(dec);if(m[0].indexOf(',')>=0){var p=v.split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');v=p.join('.');}el.textContent=t<1?pre+v+suf:raw;if(t<1)window.requestAnimationFrame(step);}
  window.requestAnimationFrame(step);
 });
}
function chrome(){
 if(num)num.textContent=total?(cur+1)+' / '+total:'';
 if(select)select.value=String(cur);
 if(bar)bar.style.transform='scaleX('+(total?(cur+1)/total:0)+')';
 if(modeButton){modeButton.textContent=present()?(zh?'阅读':'Read'):(zh?'演示':'Present');modeButton.setAttribute('aria-pressed',String(present()));}
 var prev=d.getElementById('deck-prev'),next=d.getElementById('deck-next');if(prev)prev.disabled=cur===0;if(next)next.disabled=cur>=total-1;
 post();
}
function activate(i){var s=slides[i];if(!s)return;s.classList.add('is-active');countUp(s);if(i!==cur){cur=i;chrome();}}
function observe(){frame=0;var nearest=0;slides.forEach(function(s,i){var r=s.getBoundingClientRect();if(r.top<=window.innerHeight*.32)nearest=i;if(r.top<window.innerHeight&&r.bottom>0){s.classList.add('is-active');countUp(s);}});activate(nearest);}
function go(n,focus){if(!total)return;n=Math.max(0,Math.min(total-1,n|0));activate(n);chrome();slides[n].scrollIntoView({block:'start',behavior:reduce?'instant':'smooth'});if(focus)slides[n].focus({preventScroll:true});reveal();}
function reveal(){if(!nav)return;root.removeAttribute('data-controls-hidden');window.clearTimeout(timer);if(present())timer=window.setTimeout(function(){if(!nav.contains(d.activeElement))root.setAttribute('data-controls-hidden','');},2600);}
function setMode(mode){root.setAttribute('data-mode',mode==='present'?'present':'read');chrome();slides[cur]&&slides[cur].scrollIntoView({block:'start',behavior:'instant'});reveal();}
function setImmersive(value){if(value===root.hasAttribute('data-immersive'))return;if(value){beforeImmersive=present()?'present':'read';root.setAttribute('data-immersive','');setMode('present');if(slides[cur])slides[cur].focus({preventScroll:true});}else{root.removeAttribute('data-immersive');setMode(beforeImmersive);var b=d.getElementById('deck-black');if(b){b.hidden=true;b.setAttribute('aria-hidden','true');}}}
function fullscreen(){
 if(managedFullscreen){window.parent.postMessage({type:'localmind-deck-fullscreen-toggle'},'*');return;}
 if(!root.requestFullscreen){unavailable('unsupported');return;}
 var p;try{p=d.fullscreenElement?d.exitFullscreen():root.requestFullscreen();}catch(e){unavailable();return;}
 if(p&&p.catch)p.catch(function(){unavailable();});
}
function fullscreenState(){if(!managedFullscreen)setImmersive(!!d.fullscreenElement);if(fullButton)fullButton.textContent=(hostFullscreen||d.fullscreenElement)?(zh?'退出全屏':'Exit fullscreen'):(zh?'全屏':'Fullscreen');if(status)status.textContent='';}
function unavailable(reason){setMode('present');if(status)status.textContent=reason==='unsupported'?(zh?'当前浏览器或嵌入环境不支持网页全屏。可在独立浏览器中打开后重试；当前为窗口演示。':'This browser or embedded view does not support fullscreen. Open the page in a standalone browser to retry; window presentation remains available.'):(zh?'未能切换系统全屏。请再次点击全屏按钮；若仍失败，可在独立浏览器中打开后重试。当前为窗口演示。':'Could not switch fullscreen. Click the fullscreen button again, or open this page in a standalone browser. Window presentation remains available.');}
function toggleBlack(){var b=d.getElementById('deck-black');if(b){b.hidden=!b.hidden;b.setAttribute('aria-hidden',String(b.hidden));}}
function command(c){if(c==='next')go(cur+1);else if(c==='prev')go(cur-1);else if(c==='first')go(0);else if(c==='last')go(total-1);else if(c==='fullscreen')fullscreen();else if(c==='black'&&present())toggleBlack();}
slides.forEach(function(s,i){s.removeAttribute('aria-hidden');s.classList.remove('is-active','is-past');s.tabIndex=-1;s.id=root.getAttribute('data-deck-version')==='3'?(s.getAttribute('data-chapter-id')||'chapter-'+(i+1)):'chapter-'+(i+1);if(select){var o=d.createElement('option'),h=s.querySelector('h1,h2,h3');o.value=String(i);o.textContent=(i+1)+'. '+(h?h.textContent:(zh?'章节':'Chapter'));select.appendChild(o);}});
if(select)select.addEventListener('change',function(){go(Number(select.value),true);});
if(nav)nav.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var c=b.getAttribute('data-command');if(c)command(c);else if(b===modeButton)setMode(present()?'read':'present');});
d.addEventListener('keydown',function(e){
 if(e.key==='Escape'&&(root.hasAttribute('data-immersive')||present())){e.preventDefault();setImmersive(false);setMode('read');if(d.fullscreenElement)d.exitFullscreen().catch(function(){});if(window.parent!==window||managedFullscreen)window.parent.postMessage({type:'localmind-deck-exit'},'*');return;}
 if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,button,a,summary,[contenteditable="true"]'))return;
 var k=e.key,handled=true;
 if(k==='ArrowRight')go(cur+1);else if(k==='ArrowLeft')go(cur-1);
 else if(k==='Home'&&present())go(0);else if(k==='End'&&present())go(total-1);
 else if(k==='f'||k==='F')fullscreen();else if((k==='b'||k==='B')&&present())toggleBlack();
 else handled=false;if(handled)e.preventDefault();
});
window.addEventListener('message',function(e){if(e.source!==window.parent)return;var m=e.data;if(!m||typeof m!=='object')return;if(m.type==='localmind-deck-goto'&&typeof m.slide==='number')go(m.slide);else if(m.type==='localmind-deck-command'&&typeof m.command==='string')command(m.command);else if(m.type==='localmind-deck-fullscreen-state'&&typeof m.active==='boolean'){managedFullscreen=true;hostFullscreen=m.active;if(typeof m.immersive==='boolean')setImmersive(m.immersive);fullscreenState();if(m.error)unavailable(m.error);}});
window.addEventListener('scroll',function(){if(!frame)frame=window.requestAnimationFrame(observe);},{passive:true});
window.addEventListener('resize',observe);
window.addEventListener('load',observe);
if(d.fonts&&d.fonts.ready)d.fonts.ready.then(observe);
d.addEventListener('pointermove',reveal,{passive:true});d.addEventListener('focusin',reveal);d.addEventListener('touchstart',reveal,{passive:true});
d.addEventListener('fullscreenchange',fullscreenState);
if(root.hasAttribute('data-static')){root.setAttribute('data-mode','present');slides.forEach(function(s){s.classList.add('is-active');});}
chrome();observe();reveal();root.classList.add('deck-ready');if(window.parent!==window)window.parent.postMessage({type:'localmind-deck-ready'},'*');
})();`;
