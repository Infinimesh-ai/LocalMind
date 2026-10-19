import { escapeReportXml } from '../render-types';
import { DECK_REDUCED_MOTION_CSS, type DeckTransition } from './motion';
import { DECK_RESPONSIVE_CSS } from './responsive';
import { sha256Base64 } from './sha256';

/** Only gallery thumbnails retain a fixed canvas. Reports use the viewport. */
export const DECK_STAGE = { width: 1280, height: 720 } as const;
export const DECK_FONT_SANS =
  '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif';
export const DECK_FONT_SERIF =
  '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",Georgia,"Times New Roman",serif';
export type DeckDisplayMode = 'read' | 'present';

/** Constant, hash-authorized runtime. Generated content never supplies script. */
export const DECK_SHELL_SCRIPT = String.raw`(function(){'use strict';
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
export const DECK_SHELL_SCRIPT_HASH = sha256Base64(DECK_SHELL_SCRIPT);
export const DECK_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  `script-src 'sha256-${DECK_SHELL_SCRIPT_HASH}'`,
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const SHELL_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg,#fff);color:var(--fg,#16181d)}
html{scroll-behavior:smooth;scrollbar-color:var(--muted,#657184) var(--bg,#fff)}
body{font-family:var(--deck-font,${DECK_FONT_SANS});-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--accent,#90c0f4);color:var(--fg,#16181d)}
:focus-visible{outline:2px solid currentColor;outline-offset:5px}
.deck-stage{width:100%;min-width:0;overflow:clip}
.deck-stage>[data-slide]{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;min-height:0;overflow:visible!important;margin:0;opacity:1;visibility:visible;scroll-margin-top:0;isolation:isolate}
.deck-stage>[data-slide]:focus{outline:none}
html[data-mode="present"]{scroll-snap-type:y proximity}
html[data-mode="present"] .deck-stage>[data-slide]{min-height:100svh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center}
.slide-fit{position:relative;width:100%;height:auto;min-width:0;overflow:visible;flex:1}
.deck-chrome{position:fixed;inset:auto 0 0;pointer-events:none;z-index:50}
.deck-progress{height:3px;background:transparent}
.deck-progress>i{display:block;height:100%;background:var(--accent,#657184);transform-origin:0 50%;transition:transform .3s ease}
.deck-nav{display:flex;align-items:center;gap:4px;max-width:calc(100% - 32px);width:max-content;margin:0 auto 16px;padding:6px;border:1px solid #d8dde3;border-radius:12px;background:#fff;color:#192029;box-shadow:0 8px 24px #0002;pointer-events:auto;transition:opacity .2s ease,transform .2s ease;font:500 13px/1.4 ${DECK_FONT_SANS}}
.deck-nav button,.deck-nav select{font:inherit;min-height:36px;min-width:36px;border:0;border-radius:6px;background:transparent;color:inherit;padding:6px 10px;cursor:pointer}
.deck-nav button:hover,.deck-nav select:hover{background:#edf0f4}.deck-nav button:disabled{opacity:.35;cursor:default}
.deck-nav select{min-width:0;max-width:230px;flex:1;text-overflow:ellipsis}.deck-nav svg{display:block;width:18px;height:18px}.deck-num{font-variant-numeric:tabular-nums;padding:0 8px;white-space:nowrap;color:#596372}
.deck-status:empty{display:none}.deck-status{position:absolute;bottom:100%;left:16px;right:16px;background:#fff;color:#192029;padding:12px;border:1px solid #d8dde3;border-radius:8px;font-size:13px;text-align:center}
[data-mode="present"][data-controls-hidden] .deck-nav:not(:focus-within):not(:hover){opacity:0;transform:translateY(8px);pointer-events:none}
[data-chrome="off"] .deck-chrome,[data-immersive] .deck-chrome{display:none}.deck-black{position:fixed;inset:0;background:#000;z-index:100}.deck-black[hidden]{display:none}
@media(max-width:540px){.deck-nav{max-width:calc(100% - 16px);gap:0;margin-bottom:8px}.deck-nav select{max-width:140px}.deck-num{display:none}.deck-nav button{padding:6px 8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.deck-nav,.deck-progress>i{transition:none}}
@media print{html,body{height:auto;overflow:visible}.deck-chrome,.deck-black{display:none!important}.deck-stage>[data-slide]{break-inside:avoid;min-height:0!important}.slide *{animation:none!important}}
`;

export type DeckShellInput = {
  contentVersion?: 'custom-v3';
  title: string;
  lang: string;
  css: string;
  slidesHtml: string;
  transition?: DeckTransition;
  chrome?: boolean;
  static?: boolean;
  mode?: DeckDisplayMode;
};
const safeStyleText = (css: string) =>
  css.replace(/<\/?(style|script)/gi, '\\3C $1');
const arrow = (right: boolean) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${right ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'}"/></svg>`;

export function wrapDeckHtml(input: DeckShellInput): string {
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.lang)
    ? input.lang
    : 'zh-CN';
  const zh = lang.startsWith('zh');
  const attrs = [
    `lang="${lang}"`,
    `data-deck-version="${input.contentVersion ? '3' : '2'}"`,
    `data-mode="${input.mode === 'present' ? 'present' : 'read'}"`,
    `data-transition="${input.transition ?? 'slide'}"`,
    input.chrome === false ? 'data-chrome="off"' : '',
    input.static ? 'data-static=""' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<!DOCTYPE html>
<html ${attrs}><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DECK_CSP}">
<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeReportXml(input.title)}</title>
<style>${input.contentVersion ? customShellCss() : SHELL_CSS}${DECK_REDUCED_MOTION_CSS}</style>
<style data-deck-content>${safeStyleText(input.css)}</style>
${input.contentVersion ? '' : `<style>${DECK_RESPONSIVE_CSS}</style>`}</head><body>
<main id="deck-stage" class="deck-stage"${input.contentVersion ? ' data-content-root="rd-custom-v3"' : ''}>${input.slidesHtml}</main>
<div class="deck-chrome"><nav class="deck-nav" id="deck-nav" aria-label="${zh ? '汇报导航' : 'Report navigation'}">
<button id="deck-prev" data-command="prev" aria-label="${zh ? '上一章' : 'Previous chapter'}">${arrow(false)}</button>
<select id="deck-chapters" aria-label="${zh ? '选择章节' : 'Choose chapter'}"></select>
<button id="deck-next" data-command="next" aria-label="${zh ? '下一章' : 'Next chapter'}">${arrow(true)}</button>
<span id="deck-num" class="deck-num" aria-live="polite"></span>
<button id="deck-mode" aria-pressed="false">${zh ? '演示' : 'Present'}</button><button id="deck-fullscreen" data-command="fullscreen">${zh ? '全屏' : 'Fullscreen'}</button>
<span id="deck-status" class="deck-status" role="status"></span></nav><div class="deck-progress"><i id="deck-bar"></i></div></div>
<div id="deck-black" class="deck-black" hidden aria-hidden="true"></div>
<script>${DECK_SHELL_SCRIPT}</script></body></html>`;
}

/** Keep navigation identical without imposing a composition on custom content. */
function customShellCss() {
  return (
    SHELL_CSS.replace(
      '.deck-stage{width:100%;min-width:0;overflow:clip}',
      '.deck-stage{width:100%;min-width:0;isolation:isolate;padding-bottom:80px}'
    ).replace(
      'scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center',
      'scroll-snap-align:start'
    ) +
    `
  :where([data-content-root="rd-custom-v3"]){font:17px/1.75 ${DECK_FONT_SANS};color:#20252b;background:#fff}
  :where([data-content-root="rd-custom-v3"]>section){padding:clamp(24px,5vw,80px)}
  :where([data-content-root="rd-custom-v3"] img,[data-content-root="rd-custom-v3"] svg){max-width:100%;height:auto}
  :where([data-content-root="rd-custom-v3"] *){min-width:0}
  `
  );
}

/** Set the initial mode without granting the sandbox any additional capability. */
export function setDeckDisplayMode(
  html: string,
  mode: DeckDisplayMode
): string {
  return html.replace(/(<html\b[^>]*\bdata-mode=")[^"]*(")/, `$1${mode}$2`);
}
