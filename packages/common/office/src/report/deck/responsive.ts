/** Shared after template/custom CSS: structural rules are owned by the runtime. */
export const DECK_RESPONSIVE_CSS = `
html:not([data-static]) .deck-stage>.slide{padding:clamp(64px,8vw,120px) clamp(24px,6vw,112px);border-radius:0;max-width:none;min-width:0;font-size:clamp(17px,1.5vw,22px);overflow-wrap:anywhere}
html:not([data-static]) .deck-stage>.slide:first-child{min-height:85svh;display:flex;flex-direction:column;justify-content:center}
html[data-mode="present"] .deck-stage>.slide,html[data-mode="present"] .deck-stage>.slide:first-child{min-height:100svh;padding-top:clamp(72px,8vh,112px);padding-bottom:96px}
html:not([data-static]) .deck-stage>.slide:has(>.slide-fit){padding:0}
html:not([data-static]) .slide>.slide-fit{width:100%;height:auto;min-height:inherit;max-width:1600px;margin-inline:auto;padding:clamp(64px,8vw,120px) clamp(24px,6vw,112px);gap:clamp(24px,4vw,48px);transform:none!important}
html[data-mode="present"] .slide>.slide-fit{padding-top:80px;padding-bottom:96px;justify-content:center}
html:not([data-static]) .slide .slide-body{flex:0 1 auto;gap:32px;min-width:0}
html:not([data-static]) .slide .cover-title,html:not([data-static]) .slide .hero .title{font-size:clamp(36px,5.6vw,88px);line-height:1.12;max-width:16ch;text-wrap:balance}
html:not([data-static]) .slide .slide-title,html:not([data-static]) .slide .title,html:not([data-static]) .slide .section-title,html:not([data-static]) .slide .closing-title{font-size:clamp(28px,3.6vw,58px);line-height:1.2;text-wrap:balance}
html:not([data-static]) .slide .cover-sub,html:not([data-static]) .slide .subtitle{font-size:clamp(18px,2vw,26px);max-width:60ch}
html:not([data-static]) .slide .cover-main,html:not([data-static]) .slide .hero,html:not([data-static]) .slide .section-main,html:not([data-static]) .slide .closing-main{max-width:1200px;gap:28px}
html:not([data-static]) .slide .b-para,html:not([data-static]) .slide .b-list>li{font-size:clamp(17px,1.65vw,24px);max-width:72ch}
html:not([data-static]) .slide .cover-foot,html:not([data-static]) .slide .running,html:not([data-static]) .slide>.footer{position:relative;inset:auto;white-space:normal;margin-top:36px}
html:not([data-static]) .slide .running{max-width:1600px;margin:0 auto;padding:0 clamp(24px,6vw,112px) 24px}
html:not([data-static]) .slide .metric-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:36px}
html:not([data-static]) .slide .b-metric{padding:12px 0 24px;border:0;border-radius:0;background:transparent;overflow:visible}
html:not([data-static]) .slide .b-metric::before{display:none}
html:not([data-static]) .slide .metric-num{font-size:clamp(44px,5.6vw,88px)}
html:not([data-static]) .slide .b-table{overflow-x:auto;border-radius:0}
html:not([data-static]) .slide .b-table table{min-width:520px}
html:not([data-static]) .slide .b-chart{max-width:1100px;width:100%}
html:not([data-static]) .slide .deck-chart{width:100%;height:auto;max-height:65svh}
html:not([data-static]) .slide .compare-row{gap:32px}
html:not([data-static]) .slide .compare-card{border-radius:0;border:0;border-top:1px solid var(--line);background:transparent;padding:28px 0}
html:not([data-static]) .slide .kicker{display:none}
html:not([data-static]) .slide img,html:not([data-static]) .slide svg{max-width:100%}
html:not([data-static]) .slide details{border-block:1px solid var(--line,#d5dae1);padding:16px 0}
html:not([data-static]) .slide summary{cursor:pointer;font-weight:600;padding:8px 0}
@media(max-width:800px){
html:not([data-static]) .slide .topology{grid-template-columns:minmax(0,1fr)}
html:not([data-static]) .slide .topology-branches,html:not([data-static]) .slide .lane{min-width:0}
html:not([data-static]) .slide .flow{flex-direction:column}
html:not([data-static]) .slide .flow>.arrow{align-self:center;transform:rotate(90deg)}

html:not([data-static]) .slide .split,html:not([data-static]) .slide .row,html:not([data-static]) .slide .grid-2,html:not([data-static]) .slide .grid-3,html:not([data-static]) .slide .grid-4{grid-template-columns:minmax(0,1fr)!important}
html:not([data-static]) .slide .compare-row{flex-direction:column}
html:not([data-static]) .slide .compare-vs{margin:0}
html:not([data-static]) .slide .tl-horizontal .tl-list{grid-template-columns:minmax(0,1fr);gap:28px}
html:not([data-static]) .slide .tl-horizontal .tl-rail{display:none}
html:not([data-static]) .slide .tl-horizontal .tl-item{padding-left:34px}
html:not([data-static]) .slide .tl-horizontal .tl-node{position:absolute;left:0;top:0}
html:not([data-static]) .slide .tl-vertical .tl-item{display:flex;align-items:flex-start}
html:not([data-static]) .slide .legend-pie{min-width:0}
html:not([data-static]) .slide .chart-wrap{flex-wrap:wrap}
}
@media(max-width:540px){
html:not([data-static]) .slide .grid{grid-template-columns:minmax(0,1fr)!important}
html:not([data-static]) .slide .card{padding:20px;min-width:0}
html:not([data-static]) .slide .card h3{font-size:23px}
html:not([data-static]) .slide .card p{font-size:17px}
html:not([data-static]) .slide .metric-row{flex-wrap:wrap}
html:not([data-static]) .slide .cover-title,html:not([data-static]) .slide .hero .title{max-width:none}
html:not([data-static]) .slide .decor{opacity:.35}
}
html[data-static] .deck-stage{width:1280px;height:720px;overflow:hidden}
html[data-static] .deck-stage>.slide{width:1280px!important;height:720px!important;min-height:720px;overflow:hidden!important}
html[data-static] .slide-fit{height:100%}
@media(prefers-reduced-motion:reduce){html .slide,html .slide *,html .slide *::before,html .slide *::after{animation:none!important;transition:none!important}}
`;
