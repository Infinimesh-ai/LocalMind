/**
 * Trusted, read-only browser code for v4 inspection. No model-supplied
 * JavaScript is evaluated. Returns visibility/overflow issues plus the
 * typography, contrast and composition measurements used by review.
 */
export const REPORT_WEB_PROBE_V4 = String.raw`(() => {
  const chapters = [...document.querySelectorAll('#deck-stage > section[data-slide]')];
  const issues = [];
  const add = (chapter, category, severity, element, evidence, suggestedFix) => {
    if (issues.length < 120) issues.push({id:'dom-'+issues.length, category, severity,
      chapterId:chapter?.dataset.chapterId || '', viewport:'', elementId:element?.id || '', evidence, suggestedFix});
  };
  const intentionallyHidden = el => {
    if (el.closest('details:not([open])') && !el.closest('summary')) return true;
    const variant = el.closest('svg[data-rd-variant]');
    if (variant && getComputedStyle(variant).display === 'none') return true;
    const view = el.closest('[data-rd-view]');
    if (view && view.parentElement?.classList.contains('rd-ready') && !view.hasAttribute('data-rd-current')) return true;
    return false;
  };
  const parseColor = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
  const lum = c => { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const background = el => { for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = parseColor(s.backgroundColor); if (c && c.a > 0.95) return c; } return {r:255,g:255,b:255,a:1}; };
  if (document.documentElement.scrollWidth > innerWidth + 2)
    add(null,'overflow','error',null,'Document is wider than the viewport.','Reflow the content; use a local scrolling wrapper for wide tables.');
  const typography = [], contrast = [], lines = [];
  for (const chapter of chapters) {
    const box = chapter.getBoundingClientRect();
    if (box.height < 24) add(chapter,'visibility','error',chapter,'Chapter has no usable height.','Restore its visible content in normal flow.');
    const nodes = [...chapter.querySelectorAll('h1,h2,h3,h4,p,li,td,th,dt,dd,figcaption,blockquote,svg text,[data-rd-fact]')].slice(0,2500);
    let checkedContrast = 0;
    for (const el of nodes) {
      const text = el.textContent.trim();
      if (!text || el.closest('svg title,svg desc,defs,clipPath,mask,pattern,linearGradient,radialGradient')) continue;
      if (intentionallyHidden(el)) continue;
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.1||rect.width<1||rect.height<1){
        add(chapter,'visibility','error',el,'A text element is invisible or has zero size: "'+text.slice(0,40)+'".','Keep evidence visible without animation or script.'); continue;
      }
      if(/^(P|LI|TD|TH|DD)$/.test(el.tagName) && parseFloat(style.fontSize)<14)
        add(chapter,'typography','warning',el,'Body/table text is '+parseFloat(style.fontSize)+'px, smaller than 14px: "'+text.slice(0,30)+'".','Increase readable text size and reflow the layout.');
      if (rect.right > innerWidth+2 || rect.left < -2) {
        let local=false; for(let p=el.parentElement;p&&p!==chapter;p=p.parentElement){if(['auto','scroll'].includes(getComputedStyle(p).overflowX))local=true;}
        if(!local)add(chapter,'overflow','error',el,'Text extends beyond the viewport: "'+text.slice(0,30)+'".','Repair the grid, min-width, wrapping or breakpoint.');
      }
      for(let p=el.parentElement;p&&p!==chapter.parentElement;p=p.parentElement){
        const ps=getComputedStyle(p), pb=p.getBoundingClientRect();
        if(ps.display==='none'||ps.visibility==='hidden'||Number(ps.opacity)<.1){add(chapter,'visibility','error',el,'A text ancestor hides the evidence: "'+text.slice(0,30)+'".','Keep evidence visible in the base state.');break;}
        if(['hidden','clip'].includes(ps.overflowY) && (rect.bottom>pb.bottom+3 || rect.top<pb.top-3)){
          add(chapter,'visibility','error',el,'Text is clipped by an ancestor: "'+text.slice(0,30)+'".','Remove fixed content height or clipping; retain all facts.');break;
        }
      }
      if (checkedContrast < 60 && !el.closest('svg') && el.childElementCount === 0) {
        checkedContrast++;
        const fg = parseColor(style.color), bg = background(el);
        if (fg && bg) {
          const a = lum(fg), b = lum(bg), ratio = (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
          const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 600;
          const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
          if (ratio * Math.min(1, fg.a) < need) contrast.push({chapterId:chapter.dataset.chapterId, text:text.slice(0,40), ratio:Math.round(ratio*100)/100, need, fontSize:size});
        }
      }
    }
    for (const el of [...chapter.querySelectorAll('h1,h2,h3,p,li,figcaption,dd,blockquote')].slice(0,14)) {
      if (intentionallyHidden(el) || el.closest('[data-rd-generated]')) continue;
      const s = getComputedStyle(el), text = el.textContent.replace(/\s+/g,' ').trim();
      if (!text) continue;
      const size = parseFloat(s.fontSize), lh = parseFloat(s.lineHeight) || size*1.5;
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 1);
      const rows = []; for (const r of rects) { const row = rows.find(x => Math.abs(x.top - r.top) < lh*0.5); if (row) { row.width += r.width; } else rows.push({top:r.top,width:r.width}); }
      const count = Math.max(1, rows.length);
      const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
      const perLine = Math.round(text.length / count);
      const last = rows.length > 1 ? rows[rows.length-1].width / size : null;
      typography.push({chapterId:chapter.dataset.chapterId, elementId:el.id, tag:el.tagName, text:text.slice(0,60), fontSize:size, fontWeight:s.fontWeight, lineHeight:s.lineHeight, fontFamily:s.fontFamily.split(',')[0], lines:count, charsPerLine:perLine});
      if (rows.length > 1 && last !== null && last < 1.6 && cjk > 4)
        add(chapter,'typography','warning',el,'A single character is orphaned on the last line of "'+text.slice(0,30)+'".','Rebalance the line break (semantic <br>, text-wrap, or wording).');
      if (/^(P|LI|DD)$/.test(el.tagName) && cjk > 40 && perLine > 42)
        lines.push({chapterId:chapter.dataset.chapterId, text:text.slice(0,30), charsPerLine:perLine});
    }
    for(const image of chapter.querySelectorAll('img')) if(!image.complete || image.naturalWidth===0)
      add(chapter,'visibility','error',image,'Image did not decode.','Use a supported valid asset or an inline data diagram.');
  }
  let hero = null;
  if (chapters[0]) {
    const items = [...chapters[0].querySelectorAll('h1,h2,p,span,figure,[data-rd-fact]')].map(el => ({el, r:el.getBoundingClientRect(), size:parseFloat(getComputedStyle(el).fontSize)})).filter(x => x.r.width>0 && x.el.textContent.trim());
    const top = items.sort((a,b) => b.size - a.size)[0];
    if (top) hero = {text: top.el.textContent.trim().slice(0,60), fontSize: top.size, visible: top.r.top >= 0 && top.r.bottom <= innerHeight};
  }
  return {issues, chapters:chapters.map(el=>({id:el.dataset.chapterId,top:el.getBoundingClientRect().top+scrollY,height:el.getBoundingClientRect().height, background:getComputedStyle(el).backgroundColor})),
    typography: typography.slice(0,160), contrast: contrast.slice(0,40), longLines: lines.slice(0,30), hero,
    fonts:document.fonts.status, fontFamily:getComputedStyle(document.body).fontFamily,
    navigationCount:document.querySelectorAll('#deck-chapters option').length};
})()`;

/** Reveals everything a static capture must show (steps, motion end states). */
export const REPORT_WEB_STATIC_PREP = String.raw`(() => {
  document.querySelectorAll('[data-rd-step]').forEach(el => el.setAttribute('data-rd-shown',''));
  document.querySelectorAll('[data-rd-reveal],[data-rd-count]').forEach(el => el.setAttribute('data-rd-in',''));
  document.getAnimations().forEach(a => { try { a.finish(); } catch { a.cancel(); } });
  return true;
})()`;

/** Snapshot of animations affecting one chapter, then seek them to `t`. */
export const reportMotionSeek = (chapterId: string, t: number | 'end') =>
  String.raw`(() => {
  const chapter = document.querySelector('[data-chapter-id="${chapterId}"]');
  if (!chapter) return null;
  const anims = document.getAnimations().filter(a => { const el = a.effect && a.effect.target; return el && chapter.contains(el); });
  let maxEnd = 0, concurrent = 0, infinite = 0;
  for (const a of anims) {
    const t = a.effect.getComputedTiming();
    if (!isFinite(t.endTime)) { infinite++; continue; }
    maxEnd = Math.max(maxEnd, t.endTime);
    const start = t.delay || 0, end = (t.delay || 0) + (t.activeDuration || 0);
    if (start <= 300 && end > 300) concurrent++;
  }
  for (const a of anims) { try { a.pause(); const end = a.effect.getComputedTiming().endTime; a.currentTime = ${t === 'end' ? 'isFinite(end) ? end : 0' : `Math.min(${t}, isFinite(end) ? end : ${t})`}; } catch {} }
  return { animations: anims.length, maxEnd: Math.round(maxEnd), concurrentAt300: concurrent, infinite };
})()`;
