// Frozen v1 runtime used to verify read-time compatibility with stored reports.
export const LEGACY_DECK_SHELL_SCRIPT = `(function(){'use strict';
var d=document,root=d.documentElement,W=1280,H=720;
var stage=d.getElementById('deck-stage');
if(!stage)return;
var slides=Array.prototype.slice.call(stage.querySelectorAll(':scope>[data-slide]'));
var total=slides.length,cur=0;
var bar=d.getElementById('deck-bar'),num=d.getElementById('deck-num'),black=d.getElementById('deck-black');
var reduce=false;
try{reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(e){}
function fitStage(){var s=Math.min(window.innerWidth/W,window.innerHeight/H);if(!(s>0)||!isFinite(s))s=1;root.style.setProperty('--deck-scale',String(s));}
function fitSlide(slide){
var t=slide.querySelector('.slide-fit');
if(t){t.style.transform='';t.style.width='';t.style.height='';
var sh=t.scrollHeight,ch=t.clientHeight,sw=t.scrollWidth,cw=t.clientWidth;
if(ch>0&&cw>0&&(sh>ch+1||sw>cw+1)){var r=Math.max(0.8,Math.min(ch/sh,cw/sw,1));t.style.transformOrigin='0 0';t.style.transform='scale('+r+')';t.style.width=(100/r)+'%';t.style.height=(100/r)+'%';}
return;}
var kids=Array.prototype.slice.call(slide.children);
kids.forEach(function(k){k.style.zoom='';});
var h=slide.scrollHeight,w=slide.scrollWidth;
if(h>H+1||w>W+1){var z=Math.max(0.8,Math.min(H/h,W/w,1));kids.forEach(function(k){k.style.zoom=String(z);});}
}
function fitAll(){slides.forEach(function(s){try{fitSlide(s);}catch(e){}});}
var tokens=0;
function fmt(v,dec,commas,pre,suf){var s=v.toFixed(dec);if(commas){var p=s.split('.');p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');s=p.join('.');}return pre+s+suf;}
function countUp(slide){
if(reduce||root.hasAttribute('data-static'))return;
var els=slide.querySelectorAll('[data-count]');
var tok=++tokens;
Array.prototype.forEach.call(els,function(el){
var raw=el.getAttribute('data-count')||'';
var m=/-?\\d[\\d,]*(?:\\.\\d+)?/.exec(raw);if(!m)return;
var pre=raw.slice(0,m.index),suf=raw.slice(m.index+m[0].length),commas=m[0].indexOf(',')>=0,clean=m[0].replace(/,/g,''),target=parseFloat(clean),dec=(clean.split('.')[1]||'').length;
if(!isFinite(target))return;
var start=0,dur=1200;
el.textContent=fmt(0,dec,commas,pre,suf);
function step(now){if(tok!==tokens){el.textContent=raw;return;}if(!start)start=now;var t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);el.textContent=t<1?fmt(target*e,dec,commas,pre,suf):raw;if(t<1)window.requestAnimationFrame(step);}
window.requestAnimationFrame(step);
});
}
function post(){try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:'localmind-deck',slide:cur,total:total},'*');}catch(e){}}
function chrome(){if(bar)bar.style.transform='scaleX('+(total?(cur+1)/total:0)+')';if(num)num.textContent=total?(cur+1)+' / '+total:'';}
function go(n,force){
if(!total)return;n=Math.max(0,Math.min(total-1,n|0));if(n===cur&&!force)return;cur=n;
slides.forEach(function(s,i){if(i<n)s.classList.add('is-past');else s.classList.remove('is-past');if(i!==n){s.classList.remove('is-active');s.setAttribute('aria-hidden','true');}});
var s=slides[n];s.classList.remove('is-active');void s.offsetWidth;s.classList.add('is-active');s.removeAttribute('aria-hidden');
chrome();countUp(s);post();
}
function next(){go(cur+1);}function prev(){go(cur-1);}
function fullscreen(){try{if(d.fullscreenElement){if(d.exitFullscreen){var q=d.exitFullscreen();if(q&&q.catch)q.catch(function(){});}}else if(root.requestFullscreen){var p=root.requestFullscreen();if(p&&p.catch)p.catch(function(){});}}catch(e){}}
function toggleBlack(force){if(!black)return;var on=typeof force==='boolean'?force:!black.classList.contains('is-on');if(on)black.classList.add('is-on');else black.classList.remove('is-on');}
function command(c){if(c==='next')next();else if(c==='prev')prev();else if(c==='first')go(0);else if(c==='last')go(total-1);else if(c==='fullscreen')fullscreen();else if(c==='black')toggleBlack();}
d.addEventListener('keydown',function(e){
if(e.ctrlKey||e.metaKey||e.altKey)return;
var k=e.key,handled=true;
if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Spacebar'||k==='Enter'){toggleBlack(false);next();}
else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){toggleBlack(false);prev();}
else if(k==='Home')go(0);else if(k==='End')go(total-1);
else if(k==='f'||k==='F')fullscreen();
else if(k==='b'||k==='B'||k==='.')toggleBlack();
else if(k==='Escape')toggleBlack(false);
else handled=false;
if(handled)e.preventDefault();
});
var touchX=null,touchY=0,swiped=false;
d.addEventListener('touchstart',function(e){if(e.touches.length===1){touchX=e.touches[0].clientX;touchY=e.touches[0].clientY;}},{passive:true});
d.addEventListener('touchend',function(e){if(touchX===null)return;var t=e.changedTouches[0],dx=t.clientX-touchX,dy=t.clientY-touchY;touchX=null;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)){swiped=true;if(dx<0)next();else prev();}},{passive:true});
d.addEventListener('click',function(e){
if(swiped){swiped=false;return;}
if(black&&black.classList.contains('is-on')){toggleBlack(false);return;}
var sel=window.getSelection?String(window.getSelection()):'';if(sel)return;
if(e.clientX<window.innerWidth*0.3)prev();else next();
});
window.addEventListener('message',function(e){var m=e.data;if(!m||typeof m!=='object')return;
if(m.type==='localmind-deck-goto'&&typeof m.slide==='number')go(m.slide);
else if(m.type==='localmind-deck-command'&&typeof m.command==='string')command(m.command);});
window.addEventListener('resize',function(){fitStage();});
window.addEventListener('load',function(){fitAll();});
fitStage();fitAll();
var initial=0;slides.forEach(function(s,i){if(s.classList.contains('is-active'))initial=i;});
cur=initial;
slides.forEach(function(s,i){if(i<initial)s.classList.add('is-past');if(i!==initial)s.setAttribute('aria-hidden','true');else s.classList.add('is-active');});
chrome();if(total)countUp(slides[cur]);post();
root.classList.add('deck-ready');
})();`;
