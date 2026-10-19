/**
 * Motion languages for report decks (plan §6.3). The AI only declares an
 * `intent` per block; each motion style maps intents to concrete CSS
 * keyframes. Everything is CSS-only, triggered by the shell adding
 * `.is-active` to the current slide, and disabled for reduced motion.
 *
 * Markup contract (produced by `render.ts`, also usable by custom decks):
 * - `[data-intent]` on blocks; `--b` = block order, `--i` = child order.
 * - hero: the element itself; `.hero-rule` underline.
 * - sequence: direct children (`> *`) and `tbody > tr`.
 * - number: the element itself; `.metric-num`, `.metric-delta` inside.
 * - grow: `.deck-bar` (`.is-neg`, `.is-max`), `.deck-line`, `.deck-area`,
 *   `.deck-dot`, `.deck-slice`, `.deck-value`, `.deck-legend > *`.
 * - progress: `.tl-track`, `.tl-fill`, `.tl-item`, `.tl-node`.
 */

export type DeckMotionStyle = 'steady' | 'launch' | 'minimal' | 'data';
export type DeckTransition = 'slide' | 'zoom' | 'fade' | 'none';

export const DECK_MOTION_STYLES: readonly DeckMotionStyle[] = [
  'steady',
  'launch',
  'minimal',
  'data',
];

/** Template key → motion style (plan §6.3 table). */
export const DECK_TEMPLATE_MOTION: Readonly<Record<string, DeckMotionStyle>> = {
  periodic: 'steady',
  closure: 'steady',
  management: 'steady',
  launch: 'launch',
  vivid: 'launch',
  minimal: 'minimal',
  customer: 'minimal',
  dashboard: 'data',
  milestone: 'data',
  retrospective: 'data',
};

export const deckMotionForTemplate = (key: string): DeckMotionStyle =>
  DECK_TEMPLATE_MOTION[key] ?? 'steady';

const TRANSITIONS: Record<DeckMotionStyle, DeckTransition> = {
  steady: 'slide',
  launch: 'zoom',
  minimal: 'fade',
  data: 'slide',
};

export const deckMotionTransition = (style: DeckMotionStyle): DeckTransition =>
  TRANSITIONS[style];

const A = '.slide.is-active';
const delay = (step: number, base = 150) =>
  `calc(var(--b, 0) * 120ms + var(--i, 0) * ${step}ms + ${base}ms)`;

/** Shared keyframes used by every style. */
const KEYFRAMES = `
@keyframes lm-fade{from{opacity:0}}
@keyframes lm-rise{from{opacity:0;transform:translateY(12px)}}
@keyframes lm-rise-sm{from{opacity:0;transform:translateY(8px)}}
@keyframes lm-zoom-in{from{opacity:0;transform:scale(.92)}}
@keyframes lm-fly{from{opacity:0;transform:translate3d(0,42px,0) rotate(-1.5deg) scale(.96)}}
@keyframes lm-slide-in{from{opacity:0;transform:translateX(-28px)}}
@keyframes lm-grow-y{from{transform:scaleY(0)}}
@keyframes lm-grow-x{from{transform:scaleX(0)}}
@keyframes lm-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes lm-slice{from{stroke-dasharray:0 100}}
@keyframes lm-punch{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes lm-glow{0%{filter:drop-shadow(0 0 0 transparent)}40%{filter:drop-shadow(0 0 26px var(--accent))}100%{filter:drop-shadow(0 0 10px color-mix(in srgb,var(--accent) 35%,transparent))}}
@keyframes lm-bar-glow{to{filter:drop-shadow(0 0 10px var(--accent))}}
@keyframes lm-node-on{from{background:var(--surface);box-shadow:none;transform:scale(.6)}}
@keyframes lm-arrow{from{opacity:0;transform:translateY(10px)}}
`;

/** Static helpers so SVG shapes scale from their own baseline. */
const BASE = `
.deck-bar{transform-box:fill-box;transform-origin:50% 100%}
.deck-bar.is-neg{transform-origin:50% 0}
.deck-line{stroke-dasharray:1;stroke-dashoffset:0}
.deck-slice{transform-box:view-box}
.tl-fill,.tl-track{transform-origin:0 50%}
.tl-vertical .tl-fill,.tl-vertical .tl-track{transform-origin:50% 0}
.hero-rule{transform-origin:0 50%}
${A} .slide-head{animation:lm-rise .7s var(--ease) both}
${A} [data-intent="none"],${A} [data-intent="none"] *{animation:none!important}
`;

const STYLE_CSS: Record<DeckMotionStyle, string> = {
  steady: `
${A} [data-intent="hero"]{animation:lm-rise .8s var(--ease) both;animation-delay:${delay(120, 80)}}
${A} [data-intent="sequence"]>*,${A} [data-intent="sequence"] tbody>tr{animation:lm-rise-sm .55s var(--ease) both;animation-delay:${delay(80)}}
${A} [data-intent="number"]{animation:lm-rise .7s var(--ease) both;animation-delay:${delay(90)}}
${A} [data-intent="grow"] .deck-bar{animation:lm-grow-y .8s var(--ease) both;animation-delay:${delay(50, 250)}}
${A} [data-intent="grow"] .deck-line{animation:lm-draw 1.3s var(--ease) both;animation-delay:${delay(150, 250)}}
${A} [data-intent="grow"] .deck-area,${A} [data-intent="grow"] .deck-dot,${A} [data-intent="grow"] .deck-value{animation:lm-fade .6s ease both;animation-delay:calc(var(--b,0) * 120ms + 1000ms)}
${A} [data-intent="grow"] .deck-slice{animation:lm-slice 1s var(--ease) both;animation-delay:${delay(120, 250)}}
${A} [data-intent="grow"] .deck-legend>*{animation:lm-fade .5s ease both;animation-delay:${delay(80, 400)}}
${A} [data-intent="progress"] .tl-track,${A} [data-intent="progress"] .tl-fill{animation:lm-grow-x 1.2s var(--ease) both;animation-delay:${delay(0, 200)}}
${A} [data-intent="progress"] .tl-vertical .tl-track,${A} [data-intent="progress"] .tl-vertical .tl-fill,${A} .tl-vertical[data-intent="progress"] .tl-track,${A} .tl-vertical[data-intent="progress"] .tl-fill{animation-name:lm-grow-y}
${A} [data-intent="progress"] .tl-item{animation:lm-rise-sm .6s var(--ease) both;animation-delay:${delay(160, 300)}}
`,
  launch: `
${A} [data-intent="hero"]{animation:lm-zoom-in 1s var(--ease) both,lm-glow 1.6s ease both;animation-delay:${delay(140, 80)}}
${A} [data-intent="sequence"]>*,${A} [data-intent="sequence"] tbody>tr{animation:lm-fly .7s var(--ease) both;animation-delay:${delay(90)}}
${A} [data-intent="sequence"]>*:nth-child(even){animation-delay:calc(var(--b,0) * 120ms + var(--i,0) * 90ms + 230ms)}
${A} [data-intent="number"]{animation:lm-fly .7s var(--ease) both;animation-delay:${delay(110)}}
${A} [data-intent="number"] .metric-num{display:inline-block;animation:lm-punch .7s var(--ease) both;animation-delay:calc(var(--b,0) * 120ms + var(--i,0) * 110ms + 1100ms)}
${A} [data-intent="grow"] .deck-bar{animation:lm-grow-y .9s var(--ease) both;animation-delay:${delay(60, 250)}}
${A} [data-intent="grow"] .deck-bar.is-max{animation:lm-grow-y .9s var(--ease) both,lm-bar-glow .8s ease 1.4s both}
${A} [data-intent="grow"] .deck-line{animation:lm-draw 1.4s var(--ease) both;animation-delay:${delay(150, 250)}}
${A} [data-intent="grow"] .deck-area,${A} [data-intent="grow"] .deck-dot,${A} [data-intent="grow"] .deck-value{animation:lm-fade .6s ease both;animation-delay:calc(var(--b,0) * 120ms + 1100ms)}
${A} [data-intent="grow"] .deck-slice{animation:lm-slice 1.1s var(--ease) both;animation-delay:${delay(140, 250)}}
${A} [data-intent="grow"] .deck-legend>*{animation:lm-fly .6s var(--ease) both;animation-delay:${delay(80, 500)}}
${A} [data-intent="progress"] .tl-track{animation:lm-fade .6s ease both;animation-delay:${delay(0, 150)}}
${A} [data-intent="progress"] .tl-fill{animation:lm-grow-x 1.4s var(--ease) both;animation-delay:${delay(0, 300)}}
${A} .tl-vertical[data-intent="progress"] .tl-fill{animation-name:lm-grow-y}
${A} [data-intent="progress"] .tl-node{animation:lm-node-on .5s var(--ease) both;animation-delay:${delay(220, 400)}}
${A} [data-intent="progress"] .tl-item{animation:lm-fly .6s var(--ease) both;animation-delay:${delay(220, 300)}}
`,
  minimal: `
${A} .slide-head{animation:lm-fade .9s ease both}
${A} [data-intent="hero"]{animation:lm-fade 1.1s ease both;animation-delay:${delay(160, 60)}}
${A} [data-intent="sequence"]>*,${A} [data-intent="sequence"] tbody>tr{animation:lm-fade .7s ease both;animation-delay:${delay(60)}}
${A} [data-intent="number"]{animation:lm-fade .8s ease both;animation-delay:${delay(80)}}
${A} [data-intent="grow"] .deck-bar{animation:lm-grow-y .8s var(--ease) both;animation-delay:${delay(40, 200)}}
${A} [data-intent="grow"] .deck-line{animation:lm-draw 1.2s var(--ease) both;animation-delay:${delay(120, 200)}}
${A} [data-intent="grow"] .deck-slice{animation:lm-slice 1s var(--ease) both;animation-delay:${delay(100, 200)}}
${A} [data-intent="grow"] .deck-area,${A} [data-intent="grow"] .deck-dot,${A} [data-intent="grow"] .deck-value,${A} [data-intent="grow"] .deck-legend>*{animation:lm-fade .8s ease both;animation-delay:calc(var(--b,0) * 120ms + 700ms)}
${A} [data-intent="progress"] .tl-item{animation:lm-fade .7s ease both;animation-delay:${delay(140, 200)}}
${A} [data-intent="progress"] .tl-track,${A} [data-intent="progress"] .tl-fill{animation:lm-fade .9s ease both;animation-delay:${delay(0, 100)}}
`,
  data: `
${A} [data-intent="hero"]{animation:lm-rise .7s var(--ease) both;animation-delay:${delay(110, 60)}}
${A} .hero-rule{animation:lm-grow-x .9s var(--ease) both;animation-delay:calc(var(--b,0) * 120ms + 450ms)}
${A} [data-intent="sequence"]>*,${A} [data-intent="sequence"] tbody>tr{animation:lm-slide-in .55s var(--ease) both;animation-delay:${delay(70)}}
${A} [data-intent="number"]{animation:lm-rise-sm .6s var(--ease) both;animation-delay:${delay(80)}}
${A} [data-intent="number"] .metric-delta{animation:lm-arrow .5s var(--ease) both;animation-delay:calc(var(--b,0) * 120ms + var(--i,0) * 80ms + 1150ms)}
${A} [data-intent="grow"] .deck-bar{animation:lm-grow-y .75s var(--ease) both;animation-delay:${delay(45, 200)}}
${A} [data-intent="grow"] .deck-line{animation:lm-draw 1.2s var(--ease) both;animation-delay:${delay(140, 200)}}
${A} [data-intent="grow"] .deck-slice{animation:lm-slice 1s var(--ease) both;animation-delay:${delay(110, 200)}}
${A} [data-intent="grow"] .deck-area,${A} [data-intent="grow"] .deck-dot{animation:lm-fade .5s ease both;animation-delay:calc(var(--b,0) * 120ms + 900ms)}
${A} [data-intent="grow"] .deck-value{animation:lm-rise-sm .5s var(--ease) both;animation-delay:calc(var(--b,0) * 120ms + var(--i,0) * 45ms + 1050ms)}
${A} [data-intent="grow"] .deck-legend>*{animation:lm-slide-in .5s var(--ease) both;animation-delay:${delay(70, 300)}}
${A} [data-intent="progress"] .tl-track{animation:lm-fade .5s ease both;animation-delay:${delay(0, 100)}}
${A} [data-intent="progress"] .tl-fill{animation:lm-grow-x 1.3s var(--ease) both;animation-delay:${delay(0, 350)}}
${A} .tl-vertical[data-intent="progress"] .tl-fill{animation-name:lm-grow-y}
${A} [data-intent="progress"] .tl-item{animation:lm-slide-in .5s var(--ease) both;animation-delay:${delay(130, 250)}}
`,
};

/** Reduced motion and static (thumbnail/print) rendering disable everything. */
export const DECK_REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce){
.slide,.slide *,.slide *::before,.slide *::after{animation:none!important;transition:none!important}
}
[data-static] .slide,[data-static] .slide *,[data-static] .slide *::before,[data-static] .slide *::after{animation:none!important;transition:none!important}
`;

export function deckMotionCss(style: DeckMotionStyle): string {
  return `:root{--ease:cubic-bezier(.2,.8,.2,1)}${KEYFRAMES}${BASE}${STYLE_CSS[style] ?? STYLE_CSS.steady}${DECK_REDUCED_MOTION_CSS}`;
}
