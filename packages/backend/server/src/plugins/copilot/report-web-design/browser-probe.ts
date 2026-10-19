/** Trusted, read-only browser code. No model-supplied JavaScript is evaluated. */
export const REPORT_BROWSER_PROBE = String.raw`(() => {
  const chapters = [...document.querySelectorAll('#deck-stage > section[data-slide]')];
  const issues = [];
  const add = (chapter, category, severity, element, evidence, suggestedFix) => {
    if (issues.length < 80) issues.push({id:'dom-'+issues.length, category, severity,
      chapterId:chapter?.dataset.chapterId || '', viewport:'', elementId:element?.id || '', evidence, suggestedFix});
  };
  if (document.documentElement.scrollWidth > innerWidth + 2)
    add(null,'overflow','error',null,'Document is wider than the viewport.','Reflow the content; use a local scrolling wrapper for wide tables.');
  for (const chapter of chapters) {
    const box=chapter.getBoundingClientRect();
    if (box.height < 24) add(chapter,'visibility','error',chapter,'Chapter has no usable height.','Restore its visible content in normal flow.');
    const nodes=[...chapter.querySelectorAll('h1,h2,h3,h4,p,li,td,th,figcaption,svg text,[id]')].slice(0,2500);
    for(const el of nodes){
      const text=el.textContent.trim(); if (!text || el.closest('svg title,svg desc,defs,clipPath,mask,pattern,linearGradient,radialGradient')) continue;
      const style=getComputedStyle(el); const rect=el.getBoundingClientRect();
      const closed=el.closest('details:not([open])');
      if(closed && !el.closest('summary')) continue;
      if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.1||rect.width<1||rect.height<1){
        add(chapter,'visibility','error',el,'A text element is invisible or has zero size.','Keep evidence visible without animation.'); continue;
      }
      if(/^(P|LI|TD|TH)$/.test(el.tagName) && parseFloat(style.fontSize)<14)
        add(chapter,'typography','warning',el,'Body/table text is smaller than 14 CSS pixels.','Increase readable text size and reflow the layout.');
      if (rect.right > innerWidth+2 || rect.left < -2) {
        let local=false; for(let p=el.parentElement;p&&p!==chapter;p=p.parentElement){if(['auto','scroll'].includes(getComputedStyle(p).overflowX))local=true;}
        if(!local)add(chapter,'overflow','error',el,'Text extends beyond the viewport.','Repair the grid, min-width, wrapping or breakpoint.');
      }
      for(let p=el.parentElement;p&&p!==chapter.parentElement;p=p.parentElement){
        const ps=getComputedStyle(p), pb=p.getBoundingClientRect();
        if(ps.display==='none'||ps.visibility==='hidden'||Number(ps.opacity)<.1){add(chapter,'visibility','error',el,'A text ancestor hides the evidence.','Keep evidence visible in the base state.');break;}
        if(['hidden','clip'].includes(ps.overflowY) && (rect.bottom>pb.bottom+3 || rect.top<pb.top-3)){
          add(chapter,'visibility','error',el,'Text is clipped by an ancestor.','Remove fixed content height or clipping; retain all facts.');break;
        }
      }
    }
    for(const image of chapter.querySelectorAll('img')) if(!image.complete || image.naturalWidth===0)
      add(chapter,'visibility','error',image,'Image did not decode.','Use a supported valid asset or an inline data diagram.');
  }
  return {issues, chapters:chapters.map(el=>({id:el.dataset.chapterId,top:el.getBoundingClientRect().top+scrollY,height:el.getBoundingClientRect().height})),
    typography:chapters.flatMap(ch=>[...ch.querySelectorAll('h1,h2,h3,p,figcaption')].slice(0,8).map(el=>{const s=getComputedStyle(el);return {
      chapterId:ch.dataset.chapterId,elementId:el.id,tag:el.tagName,text:el.textContent.trim().slice(0,80),
      fontSize:parseFloat(s.fontSize),fontWeight:s.fontWeight,lineHeight:s.lineHeight,fontFamily:s.fontFamily};})),
    fonts:document.fonts.status, fontFamily:getComputedStyle(document.body).fontFamily,
    navigationCount:document.querySelectorAll('#deck-chapters option').length};
})()`;
