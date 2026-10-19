import { strToU8, zipSync } from 'fflate';

import { reportChartShapes, reportChartSvg } from './chart';
import {
  reportChapterLayouts,
  type ReportLayout,
  reportSlideBackgroundAssetId,
} from './layout';
import {
  escapeReportXml as html,
  type ReportRenderInput,
} from './render-types';

export function exportReportOffline(
  input: ReportRenderInput,
  layout: ReportLayout
) {
  const files: Record<string, Uint8Array> = {
    'fonts/report.otf': input.font.bytes,
    'fonts/LICENSE.txt': strToU8(input.font.license),
  };
  const assetPaths = new Map<string, string>();
  for (const [id, asset] of input.assets) {
    const path = `assets/${assetPaths.size + 1}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    assetPaths.set(id, path);
    files[path] = asset.bytes;
  }
  const chapterLayouts = reportChapterLayouts(input.projection);
  const backgroundImage = (chapterId: string) => {
    const id = reportSlideBackgroundAssetId(
      input.projection.theme,
      chapterLayouts.get(chapterId)
    );
    return id
      ? `<img class="background" src="${assetPaths.get(id)}" alt="">`
      : '';
  };
  const pages = layout.slides
    .map(
      (slide, index) =>
        `<section class="slide" id="page-${index + 1}" aria-label="${html(slide.title)}" ${index ? 'hidden' : ''}>${backgroundImage(slide.chapterId)}<h1>${html(slide.title)}</h1>${slide.elements
          .map(element => {
            const style = `left:${element.x}px;top:${element.y}px;width:${element.width}px;height:${element.height}px;`;
            if (element.type === 'text')
              return `<div class="element text" style="${style}font-size:${element.size}px;${element.emphasis ? 'font-weight:600;' : ''}">${html(element.text)}</div>`;
            if (element.type === 'table')
              return `<table class="element" style="${style}font-size:${element.size}px"><thead><tr>${element.columns.map(cell => `<th>${html(cell)}</th>`).join('')}</tr></thead><tbody>${element.rows.map(row => `<tr>${row.map(cell => `<td>${html(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            if (element.type === 'image')
              return `<img class="element" style="${style}object-fit:contain" src="${assetPaths.get(element.assetId)}" alt="${html(element.alt)}">`;
            return `<div class="element" style="${style}">${reportChartSvg(reportChartShapes(element.node, element.width, element.height, input.projection.theme.foreground), element.width, element.height)}</div>`;
          })
          .join(
            ''
          )}<span class="page-number">${index + 1} / ${layout.slides.length}</span>${input.projection.theme.logoAssetId ? `<img class="logo" src="${assetPaths.get(input.projection.theme.logoAssetId)}" alt="">` : ''}${slide.notes ? `<aside class="notes" hidden>${html(slide.notes)}</aside>` : ''}</section>`
    )
    .join('');
  const labels =
    input.projection.language === 'en'
      ? [
          'Previous',
          'Next',
          'Contents',
          'Fullscreen',
          'Notes',
          'Downloaded copies are not affected by online revocation.',
        ]
      : [
          '上一页',
          '下一页',
          '目录',
          '全屏',
          '讲稿',
          '已下载的副本不受后续在线撤销控制。',
        ];
  files['index.html'] = strToU8(
    `<!doctype html><html lang="${input.projection.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${html(input.projection.title)}</title><link rel="stylesheet" href="report.css"></head><body><main tabindex="-1" id="stage">${pages}</main><nav aria-label="Presentation controls"><button id="previous">${labels[0]}</button><button id="next">${labels[1]}</button><select id="contents" aria-label="${labels[2]}">${layout.slides.map((slide, index) => `<option value="${index}">${index + 1}. ${html(slide.title)}</option>`).join('')}</select><button id="fullscreen">${labels[3]}</button>${layout.slides.some(slide => slide.notes) ? `<button id="notes">${labels[4]}</button>` : ''}<output id="status" aria-live="polite"></output></nav><footer>${labels[5]}</footer><script src="report.js"></script></body></html>`
  );
  files['report.css'] = strToU8(
    `@font-face{font-family:Report;src:url('fonts/report.otf')}*{box-sizing:border-box}body{margin:0;background:#171719;color:#eee;font-family:Report,sans-serif}#stage{width:${layout.width}px;height:${layout.height}px;transform-origin:top left;position:relative}.slide{position:absolute;inset:0;background:${input.projection.theme.background};color:${input.projection.theme.foreground};overflow:hidden}.slide[hidden]{display:none}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}h1{position:absolute;top:28px;left:48px;margin:0;font-size:26px;width:${layout.width - 144}px;line-height:1.45}.element{position:absolute}.text{white-space:pre-wrap;line-height:1.45}table{border-collapse:collapse;table-layout:fixed}th,td{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;padding:7px 8px;line-height:20px;vertical-align:top}th{background:${input.projection.theme.accent};color:white}svg{width:100%;height:100%;font-family:Report,sans-serif}.page-number{position:absolute;bottom:12px;right:26px;font-size:12px}.logo{position:absolute;right:40px;top:24px;width:40px;height:40px;object-fit:contain}nav{position:fixed;bottom:24px;left:12px;right:12px;display:flex;gap:8px;background:#27272a;padding:8px;border-radius:8px}button,select{font:inherit;color:#eee;background:#3f3f46;border:1px solid #71717a;border-radius:4px;padding:6px 10px}select{max-width:40vw}button:focus-visible,select:focus-visible{outline:3px solid #7dd3fc}footer{position:fixed;bottom:2px;left:12px;font-size:11px}.notes:not([hidden]){position:fixed;z-index:3;inset:80px;background:#fff;color:#18181b;padding:24px;overflow:auto;white-space:pre-wrap}body.black #stage{visibility:hidden}@media print{nav,footer{display:none}#stage{transform:none!important;width:auto;height:auto}.slide{position:relative;display:block!important;break-after:page;width:${layout.width}px;height:${layout.height}px}}`
  );
  // Program code is constant. No source strings, credentials, JSON or dynamic code evaluation.
  files['report.js'] = strToU8(
    `'use strict';const pages=Array.from(document.querySelectorAll('.slide'));const stage=document.getElementById('stage');const contents=document.getElementById('contents');let current=0;function show(i){current=Math.max(0,Math.min(pages.length-1,i));pages.forEach((p,n)=>p.hidden=n!==current);contents.value=String(current);document.getElementById('status').textContent=(current+1)+' / '+pages.length;document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===pages.length-1;}function resize(){const s=Math.min(innerWidth/${layout.width},(innerHeight-100)/${layout.height});stage.style.transform='scale('+Math.max(.1,s)+')';}document.getElementById('previous').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);contents.onchange=()=>show(Number(contents.value));document.getElementById('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{});const notes=document.getElementById('notes');if(notes)notes.onclick=()=>{const n=pages[current].querySelector('.notes');if(n)n.hidden=!n.hidden;};addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,button,[contenteditable]'))return;if(['ArrowRight',' ','PageDown'].includes(e.key)){e.preventDefault();show(current+1);}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(current-1);}if(e.key==='Home'){e.preventDefault();show(0);}if(e.key==='End'){e.preventDefault();show(pages.length-1);}if(e.key.toLowerCase()==='b')document.body.classList.toggle('black');if(e.key==='Escape')document.body.classList.remove('black');});addEventListener('resize',resize);show(0);resize();`
  );
  return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) });
}
