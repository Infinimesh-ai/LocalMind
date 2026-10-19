import { sha256Base64 } from './sha256';

/**
 * Trusted behaviour runtime for web reports (v4). Generated content never
 * ships script; it declares intent with `data-rd-*` attributes and this
 * constant, hash-authorised code turns them into motion and interaction.
 *
 * Invariants:
 * - Every hidden initial state is scoped to `.rd-motion`, which is only set
 *   when script runs, motion is allowed and the page is not static/print.
 * - A head watchdog removes `.rd-motion` if the runtime never reports ready.
 * - Interactions are enhancements: without script every view, note and step
 *   is visible in document order.
 *
 * Vocabulary (validated by `render-v4.ts`):
 * - `data-rd-reveal="fade|rise|slide-left|slide-right|scale|wipe|mask-up|blur-in|grow|draw|count"`
 *   with optional `data-rd-seq` (order inside its chapter or `data-rd-beat`
 *   group) and `data-rd-dur="short|base|long"`.
 * - `data-rd-count` on a text-only element: counts up to its own final text.
 * - `data-rd-step="1..6"`: progressive build in presentation mode.
 * - `data-rd-switch` container with `data-rd-view="label"` children: tabs.
 * - `data-rd-linked` container with `data-rd-key` items: linked highlight.
 * - `data-rd-scrolly` container with one `data-rd-figure` and
 *   `data-rd-stage="k"` children: sticky figure driven by reading position.
 * - Chapter state: `data-rd-state="on|past|idle"`; steps: `data-rd-step-at`.
 */

export const REPORT_RUNTIME_HEAD_SCRIPT = String.raw`(function(){var r=document.documentElement;r.classList.add('rd-js');var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;if(!reduce&&!r.hasAttribute('data-static'))r.classList.add('rd-motion');setTimeout(function(){if(!r.hasAttribute('data-rd-ready')){r.classList.remove('rd-motion');r.setAttribute('data-rd-failed','');}},3000);})();`;

export const REPORT_RUNTIME_SCRIPT = String.raw`(function(){'use strict';
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
var lastMode=root.getAttribute('data-mode');new MutationObserver(function(){var mode=root.getAttribute('data-mode');if(mode===lastMode)return;lastMode=mode;chapters.forEach(function(ch){setStep(ch,present()?0:stepMax(ch));});}).observe(root,{attributes:true,attributeFilter:['data-mode']});
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

export const REPORT_RUNTIME_HEAD_HASH = sha256Base64(
  REPORT_RUNTIME_HEAD_SCRIPT
);
export const REPORT_RUNTIME_HASH = sha256Base64(REPORT_RUNTIME_SCRIPT);

export const REPORT_WEB_V4_ROOT_VALUE = 'rd-custom-v4';
const R = `[data-content-root="${REPORT_WEB_V4_ROOT_VALUE}"]`;

/** Reveal effects the validator accepts; hidden states live in `@layer rd-runtime`. */
export const REPORT_REVEAL_EFFECTS = [
  'fade',
  'rise',
  'slide-left',
  'slide-right',
  'scale',
  'wipe',
  'mask-up',
  'blur-in',
  'grow',
  'draw',
  'count',
] as const;

const hidden = (effect: string, rule: string) =>
  `.rd-motion ${R} [data-rd-reveal="${effect}"]:not([data-rd-in]){${rule}}`;

/**
 * Runtime styles. Layer order lets generated shared/chapter CSS override the
 * presets; unlayered guards (print, failure, static) always win.
 */
export const REPORT_RUNTIME_CSS = `@layer rd-base,rd-runtime,rd-shared,rd-chapter;
@layer rd-runtime{
${R}{--rd-dur-short:180ms;--rd-dur-base:420ms;--rd-dur-long:900ms;--rd-ease:cubic-bezier(.2,.7,.1,1);--rd-stagger:70ms;--rd-series-1:var(--rd-accent,#c2410c);--rd-series-2:var(--rd-ink,#1f2937);--rd-series-3:color-mix(in srgb,var(--rd-accent,#c2410c) 45%,#fff);--rd-series-4:color-mix(in srgb,var(--rd-ink,#1f2937) 45%,#fff);--rd-series-5:color-mix(in srgb,var(--rd-accent,#c2410c) 60%,#000);--rd-series-6:#8a8f98}
.rd-motion ${R} [data-rd-reveal]{transition-property:opacity,translate,scale,clip-path,filter,stroke-dashoffset;transition-duration:var(--rd-dur,var(--rd-dur-base));transition-timing-function:var(--rd-ease);transition-delay:var(--rd-delay,0ms)}
${R} [data-rd-dur="short"]{--rd-dur:var(--rd-dur-short)}${R} [data-rd-dur="long"]{--rd-dur:var(--rd-dur-long)}
.rd-motion ${R} [data-rd-reveal]:not([data-rd-in]){opacity:0}
${hidden('rise', 'translate:0 28px')}
${hidden('slide-left', 'translate:-40px 0')}
${hidden('slide-right', 'translate:40px 0')}
${hidden('scale', 'scale:.9')}
${hidden('blur-in', 'filter:blur(12px)')}
${hidden('wipe', 'opacity:1;clip-path:inset(0 100% 0 0)')}
${hidden('mask-up', 'opacity:1;clip-path:inset(100% 0 0 0)')}
${hidden('count', 'opacity:1')}
${hidden('grow', 'opacity:1;scale:0 1')}
.rd-motion ${R} [data-rd-reveal="grow"][data-rd-axis^="y"]:not([data-rd-in]){scale:1 0}
${hidden('draw', 'opacity:1;stroke-dashoffset:1')}
${R} [data-rd-reveal="draw"]{stroke-dasharray:1}
${R} [data-rd-reveal="grow"],${R} [data-rd-reveal="scale"]{transform-box:fill-box;transform-origin:50% 50%}
${R} [data-rd-reveal="grow"][data-rd-axis="x"]{transform-origin:0 50%}${R} [data-rd-reveal="grow"][data-rd-axis="x-neg"]{transform-origin:100% 50%}
${R} [data-rd-reveal="grow"][data-rd-axis="y"]{transform-origin:50% 100%}${R} [data-rd-reveal="grow"][data-rd-axis="y-neg"]{transform-origin:50% 0}
html[data-mode="present"].rd-js ${R} [data-rd-step]:not([data-rd-shown]){opacity:0;translate:0 16px;pointer-events:none}
${R} [data-rd-step]{transition:opacity var(--rd-dur-base) var(--rd-ease),translate var(--rd-dur-base) var(--rd-ease)}
${R} [data-rd-switch].rd-ready>[data-rd-view]:not([data-rd-current]){display:none}
${R} .rd-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 20px;padding:4px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:999px;width:max-content;max-width:100%}
${R} .rd-tab{font:inherit;font-size:.92em;line-height:1.2;min-height:40px;border:0;border-radius:999px;padding:.5em 1.1em;background:transparent;color:inherit;opacity:.72;cursor:pointer}
${R} .rd-tab:hover{opacity:1}${R} .rd-tab[aria-selected="true"]{opacity:1;font-weight:650;background:color-mix(in srgb,currentColor 12%,transparent)}
${R} .rd-tab:focus-visible,${R} [data-rd-control]:focus-visible{outline:2px solid currentColor;outline-offset:3px}
${R} [data-rd-linked] [data-rd-control]{cursor:pointer}
${R} [data-rd-linked][data-rd-focus] [data-rd-key]:not([data-rd-match]){opacity:.28}
${R} [data-rd-linked] [data-rd-key]{transition:opacity var(--rd-dur-short) var(--rd-ease)}
${R} [data-rd-linked] [data-rd-control][aria-pressed="true"]{text-decoration:underline;text-underline-offset:.25em}
@media (min-width:900px){
html[data-mode="read"] ${R} [data-rd-scrolly].rd-ready{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);column-gap:clamp(24px,4vw,64px);align-items:start}
html[data-mode="read"] ${R} [data-rd-scrolly].rd-ready>[data-rd-figure]{position:sticky;top:max(24px,10vh);grid-column:1;grid-row:1/span 40}
html[data-mode="read"] ${R} [data-rd-scrolly].rd-ready>[data-rd-stage]{grid-column:2;min-height:52vh;display:flex;flex-direction:column;justify-content:center;opacity:.4;transition:opacity var(--rd-dur-base) var(--rd-ease)}
html[data-mode="read"] ${R} [data-rd-scrolly].rd-ready>[data-rd-stage][data-rd-current]{opacity:1}}
${R} .rd-chart{container-type:inline-size;width:100%;color:var(--rd-chart-ink,currentColor);--rd-chart-mark:var(--rd-accent,#c2410c)}
${R} .rd-chart-plot svg{display:block;width:100%;height:auto;overflow:visible}
${R} .rd-chart-m{display:none!important}
@container (max-width:560px){${R} .rd-chart-d{display:none!important}${R} .rd-chart-m{display:block!important}}
${R} .rd-chart text{fill:currentColor;font-family:var(--rd-font-numeral,inherit);font-variant-numeric:tabular-nums}
${R} .rd-chart-label{opacity:.78}${R} .rd-chart-tick{opacity:.6}${R} .rd-chart-value{font-weight:600}${R} .rd-chart-value-hl{fill:var(--rd-chart-hl,var(--rd-chart-mark))}
${R} .rd-mark{fill:var(--rd-chart-mark)}${R} .rd-mark-base{fill:var(--rd-chart-muted,color-mix(in srgb,currentColor 28%,transparent))}${R} .rd-mark-hl{fill:var(--rd-chart-hl,var(--rd-chart-mark))}
${R} .rd-chart-stem{stroke:color-mix(in srgb,currentColor 35%,transparent);stroke-width:2}
${R} .rd-chart-line{fill:none;stroke:var(--rd-chart-mark);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
${R} .rd-chart-point{stroke:var(--rd-chart-surface,#fff);stroke-width:2}
${R} .rd-chart-grid{stroke:var(--rd-chart-grid,color-mix(in srgb,currentColor 14%,transparent));stroke-width:1}
${R} .rd-chart-baseline{stroke:color-mix(in srgb,currentColor 55%,transparent);stroke-width:1.5}
${R} .rd-s1{fill:var(--rd-series-1);color:var(--rd-series-1)}${R} .rd-s2{fill:var(--rd-series-2);color:var(--rd-series-2)}${R} .rd-s3{fill:var(--rd-series-3);color:var(--rd-series-3)}${R} .rd-s4{fill:var(--rd-series-4);color:var(--rd-series-4)}${R} .rd-s5{fill:var(--rd-series-5);color:var(--rd-series-5)}${R} .rd-s6{fill:var(--rd-series-6);color:var(--rd-series-6)}
${R} .rd-chart-legend{display:flex;flex-wrap:wrap;gap:8px 20px;list-style:none;margin:14px 0 0;padding:0}
${R} .rd-chart-key{display:inline-flex;align-items:baseline;gap:8px}${R} .rd-chart-key .rd-chart-key-label,${R} .rd-chart-key .rd-chart-key-value{color:var(--rd-chart-ink,var(--rd-ink,currentColor))}
${R} .rd-chart-swatch{width:.8em;height:.8em;border-radius:2px;background:currentColor;align-self:center}
${R} .rd-chart-unit{margin:0 0 8px;font-size:.82em;opacity:.7}
${R} .rd-chart-data{margin-top:12px;font-size:.88em}${R} .rd-chart-data summary{cursor:pointer;opacity:.75;width:max-content}
${R} .rd-chart-data table{border-collapse:collapse;margin-top:8px;min-width:min(100%,320px)}${R} .rd-chart-data caption{text-align:left;padding:4px 0;opacity:.75}
${R} .rd-chart-data th,${R} .rd-chart-data td{border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent);padding:6px 16px 6px 0;text-align:left;font-variant-numeric:tabular-nums}
}
@media print{${R} [data-rd-reveal]{opacity:1!important;translate:none!important;scale:none!important;clip-path:none!important;filter:none!important;stroke-dashoffset:0!important}${R} [data-rd-step]{opacity:1!important;translate:none!important}${R} [data-rd-switch]>[data-rd-view]{display:block!important}}
[data-rd-failed] ${R} [data-rd-reveal],[data-static] ${R} [data-rd-reveal]{opacity:1!important;translate:none!important;scale:none!important;clip-path:none!important;filter:none!important;stroke-dashoffset:0!important}
`;
