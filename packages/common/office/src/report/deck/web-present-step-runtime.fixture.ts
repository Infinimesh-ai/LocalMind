// Frozen trusted runtime from before the presentation-title fix.
export const WEB_PRESENT_STEP_RUNTIME_SCRIPT = String.raw`(function(){'use strict';
var d=document,root=d.documentElement,stage=d.getElementById('deck-stage');
if(!stage||stage.getAttribute('data-content-root')!=='rd-custom-v4')return;
function all(sel,ctx){return Array.prototype.slice.call((ctx||d).querySelectorAll(sel));}
function fail(){root.classList.remove('rd-motion');root.setAttribute('data-rd-failed','');all('[data-rd-reveal]').forEach(function(el){el.setAttribute('data-rd-in','');});}
try{
var reduceQ=window.matchMedia?matchMedia('(prefers-reduced-motion: reduce)'):null;
var chapters=all(':scope>section[data-slide]',stage),current=0,ratios=new Map();
function present(){return root.getAttribute('data-mode')==='present';}
function motionOk(){return !(reduceQ&&reduceQ.matches)&&!root.hasAttribute('data-static')&&!root.hasAttribute('data-rd-failed');}
function ms(v,f){v=String(v||'').trim();var n=parseFloat(v);if(!isFinite(n))return f;return /ms$/.test(v)?n:(/s$/.test(v)?n*1000:n);}
function tok(){var s=getComputedStyle(stage);return {stagger:ms(s.getPropertyValue('--rd-stagger'),70),long:ms(s.getPropertyValue('--rd-dur-long'),900)};}
function chapterOf(el){return el.closest('section[data-slide]');}
function seq(el){var n=parseInt(el.getAttribute('data-rd-seq'),10);return isFinite(n)?n:-1;}
function stepHidden(el){var s=el.closest('[data-rd-step]');return !!(present()&&s&&!s.hasAttribute('data-rd-shown'));}
function viewHidden(el){var v=el.closest('[data-rd-view]');return !!(v&&v.parentElement&&v.parentElement.classList.contains('rd-ready')&&!v.hasAttribute('data-rd-current'));}
function count(el,delay){
 if(!motionOk()||el.children.length||el.hasAttribute('data-rd-counted'))return;
 var raw=el.textContent,m=/-?\d[\d,]*(?:\.\d+)?/.exec(raw);if(!m)return;
 var pre=raw.slice(0,m.index),suf=raw.slice(m.index+m[0].length),clean=m[0].replace(/,/g,''),target=parseFloat(clean),dec=(clean.split('.')[1]||'').length,comma=m[0].indexOf(',')>=0;
 if(!isFinite(target))return;el.setAttribute('data-rd-counted','');if(!el.hasAttribute('aria-label'))el.setAttribute('aria-label',raw.trim());
 var dur=tok().long,start=0;
 function fmt(v){var s=v.toFixed(dec);if(comma){var p=s.split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');s=p.join('.');}return s;}
 function step(now){if(!start)start=now;var k=Math.min(1,(now-start)/dur),e=1-Math.pow(1-k,3);el.textContent=k<1?pre+fmt(target*e)+suf:raw;if(k<1)requestAnimationFrame(step);}
 el.textContent=pre+fmt(0)+suf;setTimeout(function(){requestAnimationFrame(step);},delay);
}
function show(el,delay){if(el.hasAttribute('data-rd-in'))return;el.style.setProperty('--rd-delay',Math.round(delay||0)+'ms');el.setAttribute('data-rd-in','');if(el.hasAttribute('data-rd-count')||el.getAttribute('data-rd-reveal')==='count')count(el,delay||0);}
function hide(el){el.removeAttribute('data-rd-in');el.style.removeProperty('--rd-delay');}
var queue=[],queued=false;
function enqueue(el){queue.push(el);if(!queued){queued=true;requestAnimationFrame(flush);}}
function flush(){queued=false;var t=tok(),groups=new Map();
 queue.splice(0).forEach(function(el){if(el.hasAttribute('data-rd-in')||stepHidden(el)||viewHidden(el))return;var g=el.closest('[data-rd-beat]')||chapterOf(el)||stage;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(el);});
 groups.forEach(function(list){
  var order=list.map(function(el,i){return {el:el,s:seq(el),i:i};});
  order.sort(function(a,b){return (a.s<0?999:a.s)-(b.s<0?999:b.s)||a.i-b.i;});
  var rank=-1,last=null,inRank=0,sizes={},beat=t.stagger*2.5;
  order.forEach(function(o){var k=o.s<0?'u'+o.i:'s'+o.s;sizes[k]=(sizes[k]||0)+1;});
  order.forEach(function(o){var k=o.s<0?'u'+o.i:'s'+o.s;if(k!==last){rank++;last=k;inRank=0;}else inRank++;
   var base=o.s<0?rank*t.stagger:o.s*beat,sub=inRank*Math.min(t.stagger*.5,360/Math.max(1,sizes[k]));show(o.el,Math.min(1800,base+sub));});
 });
}
function revealAll(ctx){all('[data-rd-reveal],[data-rd-count]',ctx).forEach(function(el){if(!stepHidden(el)&&!viewHidden(el))show(el,0);});}
var rio='IntersectionObserver' in window?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)enqueue(e.target);});},{rootMargin:'0px 0px -8% 0px',threshold:0}):null;
if(rio)all('[data-rd-reveal],[data-rd-count]').forEach(function(el){rio.observe(el);});else revealAll();
function steps(ch){return all('[data-rd-step]',ch);}
function stepMax(ch){var m=0;steps(ch).forEach(function(el){m=Math.max(m,parseInt(el.getAttribute('data-rd-step'),10)||0);});return m;}
function stepAt(ch){return parseInt(ch.getAttribute('data-rd-step-at')||'0',10)||0;}
function setStep(ch,k){ch.setAttribute('data-rd-step-at',String(k));steps(ch).forEach(function(el){var n=parseInt(el.getAttribute('data-rd-step'),10)||0;
 if(n<=k){if(!el.hasAttribute('data-rd-shown')){el.setAttribute('data-rd-shown','');if(!present()||!motionOk())return;var rs=(el.hasAttribute('data-rd-reveal')?[el]:[]).concat(all('[data-rd-reveal]',el));rs.forEach(hide);requestAnimationFrame(function(){requestAnimationFrame(function(){rs.forEach(function(x,i){show(x,i*tok().stagger);});});});}}
 else el.removeAttribute('data-rd-shown');});}
function reset(ch){if(!motionOk())return;all('[data-rd-reveal],[data-rd-count]',ch).forEach(function(el){hide(el);el.removeAttribute('data-rd-counted');if(rio){rio.unobserve(el);rio.observe(el);}});setStep(ch,0);}
function pick(){var best=-1,bi=current;chapters.forEach(function(ch,i){var v=ratios.get(ch)||0;if(v>best+0.001){best=v;bi=i;}});current=bi;}
var cio='IntersectionObserver' in window?new IntersectionObserver(function(es){es.forEach(function(e){var ch=e.target;ratios.set(ch,e.isIntersecting?e.intersectionRatio:0);
 if(e.isIntersecting){if(ch.getAttribute('data-rd-state')!=='on')ch.setAttribute('data-rd-state','on');}
 else if(ch.getAttribute('data-rd-state')==='on'){if(present()){ch.setAttribute('data-rd-state','idle');reset(ch);}else ch.setAttribute('data-rd-state','past');}});pick();},{threshold:[0,.2,.4,.6,.8,1]}):null;
chapters.forEach(function(ch){if(cio)cio.observe(ch);else ch.setAttribute('data-rd-state','on');});
chapters.forEach(function(ch){setStep(ch,present()?0:stepMax(ch));});
function advance(dir){if(!present())return false;var ch=chapters[current];if(!ch)return false;var at=stepAt(ch);
 if(dir>0&&at<stepMax(ch)){setStep(ch,at+1);return true;}if(dir<0&&at>0){setStep(ch,at-1);return true;}return false;}
window.addEventListener('keydown',function(e){if(e.ctrlKey||e.metaKey||e.altKey)return;var t=e.target;if(t&&t.closest&&t.closest('input,textarea,select,button,a,summary,[contenteditable="true"],[role="tab"],[data-rd-control]'))return;
 var k=e.key,dir=(k==='ArrowRight'||k==='PageDown')?1:(k==='ArrowLeft'||k==='PageUp')?-1:0;if(dir&&advance(dir)){e.preventDefault();e.stopImmediatePropagation();}},true);
d.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('#deck-next,#deck-prev');if(!b)return;if(advance(b.id==='deck-next'?1:-1)){e.preventDefault();e.stopImmediatePropagation();}},true);
var lastMode=root.getAttribute('data-mode');new MutationObserver(function(){var mode=root.getAttribute('data-mode');if(mode===lastMode)return;lastMode=mode;chapters.forEach(function(ch){setStep(ch,present()?0:stepMax(ch));});if(!present())revealAll();}).observe(root,{attributes:true,attributeFilter:['data-mode']});
all('[data-rd-switch]').forEach(function(box){
 var views=Array.prototype.filter.call(box.children,function(c){return c.hasAttribute('data-rd-view');});if(views.length<2)return;
 var list=d.createElement('div');list.className='rd-tabs';list.setAttribute('role','tablist');var name=box.getAttribute('data-rd-switch');if(name)list.setAttribute('aria-label',name);
 var buttons=views.map(function(v,i){var b=d.createElement('button');b.type='button';b.className='rd-tab';b.setAttribute('role','tab');b.textContent=v.getAttribute('data-rd-view');v.setAttribute('role','tabpanel');
  if(v.id){b.setAttribute('aria-controls',v.id);}
  b.addEventListener('click',function(){select(i,true);});
  b.addEventListener('keydown',function(e){var n=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:e.key==='Home'?0:e.key==='End'?views.length-1:null;if(n===null)return;e.preventDefault();e.stopPropagation();n=(n+views.length)%views.length;select(n,true);buttons[n].focus();});
  list.appendChild(b);return b;});
 function select(i,user){views.forEach(function(v,j){var on=i===j;if(on)v.setAttribute('data-rd-current','');else v.removeAttribute('data-rd-current');buttons[j].setAttribute('aria-selected',String(on));buttons[j].tabIndex=on?0:-1;});
  box.setAttribute('data-rd-active',String(i));
  if(user&&motionOk()){var rs=all('[data-rd-reveal]',views[i]);rs.forEach(hide);requestAnimationFrame(function(){requestAnimationFrame(function(){rs.forEach(function(x,k){show(x,k*tok().stagger*.6);});});});}
  else revealAll(views[i]);}
 box.parentNode.insertBefore(list,box);box.classList.add('rd-ready');
 var def=0;views.forEach(function(v,j){if(v.hasAttribute('data-rd-default'))def=j;});select(def,false);});
all('[data-rd-linked]').forEach(function(box){
 var items=all('[data-rd-key]',box).filter(function(it){return it.closest('[data-rd-linked]')===box;});if(items.length<2)return;box.classList.add('rd-ready');var pinned=null;
 function set(k){if(k)box.setAttribute('data-rd-focus',k);else box.removeAttribute('data-rd-focus');
  items.forEach(function(it){var m=!!k&&it.getAttribute('data-rd-key')===k;if(m)it.setAttribute('data-rd-match','');else it.removeAttribute('data-rd-match');if(it.hasAttribute('data-rd-control'))it.setAttribute('aria-pressed',String(m&&pinned===k));});}
 function toggle(key){pinned=pinned===key?null:key;set(pinned);}
 items.forEach(function(it){var key=it.getAttribute('data-rd-key'),html=!(it instanceof SVGElement)&&!it.closest('svg');
  if(html){it.setAttribute('data-rd-control','');if(!it.hasAttribute('tabindex'))it.tabIndex=0;if(!it.hasAttribute('role'))it.setAttribute('role','button');it.setAttribute('aria-pressed','false');}
  it.addEventListener('pointerenter',function(e){if(e.pointerType==='mouse'&&!pinned)set(key);});
  it.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse'&&!pinned)set(null);});
  it.addEventListener('click',function(e){if(e.target.closest('summary,details'))return;toggle(key);});
  if(html){it.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggle(key);}else if(e.key==='Escape'&&pinned){e.preventDefault();e.stopPropagation();pinned=null;set(null);}});
   it.addEventListener('focus',function(){if(!pinned)set(key);});it.addEventListener('blur',function(){if(!pinned)set(null);});}});});
all('[data-rd-scrolly]').forEach(function(box){
 var stages=Array.prototype.filter.call(box.children,function(c){return c.hasAttribute('data-rd-stage');});var fig=Array.prototype.filter.call(box.children,function(c){return c.hasAttribute('data-rd-figure');})[0];
 if(!fig||stages.length<2||!('IntersectionObserver' in window))return;box.classList.add('rd-ready');
 var sio=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;stages.forEach(function(s){s.removeAttribute('data-rd-current');});e.target.setAttribute('data-rd-current','');box.setAttribute('data-rd-at',e.target.getAttribute('data-rd-stage'));});},{rootMargin:'-42% 0px -42% 0px'});
 stages.forEach(function(s){sio.observe(s);});});
if(reduceQ&&reduceQ.addEventListener)reduceQ.addEventListener('change',function(){if(reduceQ.matches){root.classList.remove('rd-motion');revealAll();}});
window.addEventListener('beforeprint',function(){root.classList.remove('rd-motion');revealAll();});
root.setAttribute('data-rd-ready','');
}catch(err){fail();}
})();`;
