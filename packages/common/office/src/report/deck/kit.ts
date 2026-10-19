import { REPORT_WEB_V4_ROOT_VALUE } from './runtime';

/**
 * rd-kit: trusted layout and component primitives for v4 web reports. They
 * read the plan tokens, so chapters generated in parallel share one visual
 * system while each chapter still composes its own layout. Lives in
 * `@layer rd-runtime`; generated shared/chapter CSS can override any rule.
 */
const R = `[data-content-root="${REPORT_WEB_V4_ROOT_VALUE}"]`;
const line = 'color-mix(in srgb,currentColor 18%,transparent)';

export const REPORT_KIT_CSS = `@layer rd-runtime{
${R} .rd-wrap{max-width:1200px;margin-inline:auto;width:100%}
${R} .rd-stack>*+*{margin-top:var(--rd-gap,clamp(14px,1.6vw,24px))}
${R} .rd-stack-lg>*+*{margin-top:clamp(28px,4vw,56px)}
${R} .rd-tall{min-height:min(88svh,980px);display:flex;flex-direction:column;justify-content:center}
${R} .rd-surface-alt{background:var(--rd-alt);color:var(--rd-alt-ink)}
${R} .rd-surface-accent{background:var(--rd-accent);color:var(--rd-accent-ink)}
${R} .rd-surface-canvas{background:var(--rd-canvas);color:var(--rd-ink)}
${R} .rd-surface-alt{--rd-series-2:var(--rd-alt-ink);--rd-series-4:color-mix(in srgb,var(--rd-alt-ink) 55%,transparent);--rd-chart-ink:var(--rd-alt-ink);--rd-chart-muted:color-mix(in srgb,var(--rd-alt-ink) 38%,transparent);--rd-chart-surface:var(--rd-alt)}
${R} .rd-surface-accent{--rd-series-1:var(--rd-accent-ink);--rd-series-2:color-mix(in srgb,var(--rd-accent-ink) 60%,transparent);--rd-chart-mark:var(--rd-accent-ink);--rd-chart-hl:var(--rd-accent-ink);--rd-chart-ink:var(--rd-accent-ink);--rd-chart-muted:color-mix(in srgb,var(--rd-accent-ink) 40%,transparent);--rd-chart-surface:var(--rd-accent)}
${R} .rd-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:clamp(16px,2.6vw,40px);align-items:start}
${Array.from({ length: 10 }, (_, i) => i + 3)
  .map(n => `${R} .rd-span-${n}{grid-column:span ${n}}`)
  .join('')}
${R} .rd-split{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:clamp(24px,4vw,72px);align-items:start}
${R} .rd-split-rev{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(24px,4vw,72px);align-items:start}
${R} .rd-split-even{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(24px,4vw,64px);align-items:start}
${R} .rd-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--rd-col,220px)),1fr));gap:clamp(16px,2.2vw,32px)}
${R} .rd-row{display:flex;flex-wrap:wrap;gap:clamp(12px,2vw,32px);align-items:baseline}
${R} .rd-center{align-items:center}
${R} .rd-kicker{font:600 var(--rd-size-label)/1.4 var(--rd-font-body);letter-spacing:.08em;color:var(--rd-muted);margin:0}
${R} .rd-display{font-family:var(--rd-font-display);font-size:var(--rd-size-display);font-weight:var(--rd-weight-display);line-height:1.1;letter-spacing:-.01em;margin:0}
${R} .rd-h2{font-family:var(--rd-font-display);font-size:var(--rd-size-section);font-weight:700;line-height:1.2;margin:0}
${R} .rd-h3{font-size:calc(var(--rd-size-body)*1.22);font-weight:650;line-height:1.4;margin:0}
${R} .rd-lede{font-size:calc(var(--rd-size-body)*1.18);line-height:1.65;max-width:var(--rd-measure);margin:0}
${R} .rd-body{line-height:1.78;max-width:var(--rd-measure);margin:0}
${R} .rd-label{font-size:var(--rd-size-label);line-height:1.5;color:var(--rd-muted);margin:0}
${R} .rd-caption{font-size:max(14px,calc(var(--rd-size-body)*.86));line-height:1.6;color:var(--rd-muted);max-width:var(--rd-measure);margin:0}
${R} .rd-footnote{font-size:13px;line-height:1.6;color:var(--rd-muted);margin:0}
${R} .rd-surface-alt :is(.rd-kicker,.rd-label,.rd-caption,.rd-footnote){color:color-mix(in srgb,var(--rd-alt-ink) 72%,transparent)}
${R} .rd-surface-accent :is(.rd-kicker,.rd-label,.rd-caption,.rd-footnote){color:color-mix(in srgb,var(--rd-accent-ink) 78%,transparent)}
${R} .rd-num{font-family:var(--rd-font-numeral);font-variant-numeric:tabular-nums;font-weight:700;font-size:clamp(44px,6.4vw,104px);line-height:1;letter-spacing:-.02em;margin:0}
${R} .rd-num-md{font-family:var(--rd-font-numeral);font-variant-numeric:tabular-nums;font-weight:700;font-size:clamp(30px,3.6vw,52px);line-height:1.05;margin:0}
${R} .rd-unit{font-size:.42em;font-weight:500;margin-left:.15em;letter-spacing:0}
${R} .rd-accent{color:var(--rd-accent)}
${R} .rd-surface-accent .rd-accent{color:inherit}
${R} .rd-muted{color:var(--rd-muted)}
${R} .rd-stat{display:flex;flex-direction:column;gap:8px;padding-top:14px;border-top:2px solid currentColor}
${R} .rd-callout{border-left:4px solid var(--rd-accent);padding:10px 0 10px 20px}
${R} .rd-card{background:color-mix(in srgb,currentColor 5%,transparent);border-radius:12px;padding:clamp(18px,2.2vw,32px)}
${R} .rd-rule{border:0;border-top:1px solid ${line};margin:clamp(20px,3vw,40px) 0}
${R} .rd-tag{display:inline-block;padding:2px 10px;border-radius:999px;font-size:var(--rd-size-label);line-height:1.6;background:color-mix(in srgb,currentColor 10%,transparent)}
${R} .rd-tag-accent{background:var(--rd-accent);color:var(--rd-accent-ink)}
${R} .rd-quote{font-family:var(--rd-font-display);font-size:calc(var(--rd-size-section)*.82);line-height:1.45;margin:0;padding-left:.9em;border-left:3px solid var(--rd-accent)}
${R} .rd-rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);list-style:none;margin:0;padding:0;gap:12px}
${R} .rd-rail>li{position:relative;padding-top:30px}
${R} .rd-rail>li::before{content:"";position:absolute;top:6px;left:0;width:14px;height:14px;border-radius:50%;border:2px solid currentColor;background:var(--rd-canvas);box-sizing:border-box;z-index:1}
${R} .rd-rail>li::after{content:"";position:absolute;top:12px;left:14px;right:-12px;border-top:2px solid ${line}}
${R} .rd-rail>li:last-child::after{display:none}
${R} .rd-rail>li[data-state="done"]::before{background:currentColor}
${R} .rd-rail>li[data-state="now"]::before{border-color:var(--rd-accent);background:var(--rd-accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--rd-accent) 25%,transparent)}
${R} .rd-rail>li[data-state="now"]{font-weight:650}
${R} .rd-rail>li[data-state="next"]{color:var(--rd-muted)}
${R} .rd-compare{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:clamp(16px,3vw,48px);align-items:center}
${R} .rd-vs{font-size:var(--rd-size-label);color:var(--rd-muted)}
${R} .rd-ledger{list-style:none;margin:0;padding:0;border-top:1px solid ${line}}
${R} .rd-ledger>li,${R} .rd-ledger>div{display:grid;grid-template-columns:minmax(0,12em) minmax(0,1fr) auto;gap:clamp(12px,2vw,32px);padding:16px 0;border-bottom:1px solid ${line};align-items:baseline}
${R} .rd-matrix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;background:${line}}
${R} .rd-matrix>*{background:var(--rd-canvas);padding:clamp(16px,2vw,28px)}
${R} .rd-surface-alt .rd-matrix>*{background:var(--rd-alt)}
${R} .rd-flow{display:flex;flex-wrap:wrap;gap:12px 36px;align-items:stretch;list-style:none;margin:0;padding:0}
${R} .rd-flow>*{position:relative;flex:1 1 160px}
${R} .rd-flow>*+*::before{content:"→";position:absolute;left:-26px;top:50%;translate:0 -50%;color:var(--rd-muted)}
${R} .rd-notes{margin-top:clamp(28px,4vw,56px);padding-top:16px;border-top:1px solid ${line}}
${R} figure{margin:0}
@media (max-width:720px){
${R} :is(.rd-split,.rd-split-rev,.rd-split-even,.rd-compare){grid-template-columns:minmax(0,1fr)}
${R} .rd-grid>[class*="rd-span-"]{grid-column:1/-1}
${R} .rd-vs{justify-self:start}
${R} .rd-rail{grid-auto-flow:row;grid-auto-columns:auto}
${R} .rd-rail>li{padding:0 0 18px 30px}
${R} .rd-rail>li::before{top:4px}
${R} .rd-rail>li::after{top:20px;left:6px;right:auto;bottom:-2px;border-top:0;border-left:2px solid ${line}}
${R} .rd-ledger>li,${R} .rd-ledger>div{grid-template-columns:minmax(0,1fr);gap:6px}
${R} .rd-matrix{grid-template-columns:minmax(0,1fr)}
${R} .rd-flow{flex-direction:column}
${R} .rd-flow>*+*::before{content:"↓";left:0;top:-22px;translate:none}
${R} .rd-tall{min-height:auto}
}}`;

/** Model-facing description of the kit (kept next to the CSS it describes). */
export const REPORT_KIT_GUIDE =
  'Layout: .rd-wrap .rd-stack .rd-stack-lg .rd-tall(section fills the screen) .rd-grid + .rd-span-3…12, .rd-split(7:5) .rd-split-rev(5:7) .rd-split-even .rd-cols(auto-fit, --rd-col) .rd-row. Surfaces on <section>: .rd-surface-canvas/.rd-surface-alt/.rd-surface-accent. Type roles: .rd-kicker .rd-display .rd-h2 .rd-h3 .rd-lede .rd-body .rd-label .rd-caption .rd-footnote; numbers .rd-num(hero) .rd-num-md + .rd-unit, .rd-accent .rd-muted. Components: .rd-stat(number+label) .rd-callout .rd-card .rd-rule .rd-tag(.rd-tag-accent) .rd-quote; ol.rd-rail>li[data-state=done|now|next] (stages/timeline, vertical on phones); .rd-compare(A .rd-vs B); ul.rd-ledger>li (label | content | value rows); .rd-matrix (2×2); ul.rd-flow (steps with arrows); .rd-notes (bottom area for scope notes). All read the plan tokens and reflow on phones; add chapter CSS only for what the kit does not cover.';
