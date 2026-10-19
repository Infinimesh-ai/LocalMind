import {
  type DefaultTreeAdapterTypes,
  html as parse5Html,
  parseFragment,
  serializeOuter,
} from 'parse5';

import { deckMotionCss } from './motion';
import { DECK_LIMITS } from './schema';
import { DECK_FONT_SANS, DECK_FONT_SERIF, wrapDeckHtml } from './shell';
import { DECK_DEFAULT_CUSTOM_THEME, type DeckTemplateTheme } from './templates';

/**
 * Whitelist sanitizer for custom-mode decks (plan §7). The AI writes slide
 * markup and CSS; neither may carry script, event handlers or any external
 * reference. Animation is CSS-only, triggered by the shell's `.is-active`.
 */

type Node = DefaultTreeAdapterTypes.Node;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const NS = parse5Html.NS;

const HTML_TAGS = new Set([
  'section',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'br',
  'hr',
  'blockquote',
  'figure',
  'figcaption',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'svg',
]);

const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'title',
]);

/** Derived from the actual sanitizer, never a second prompt-only allowlist. */
export const deckMarkupCapabilities = () => ({
  html: [...HTML_TAGS],
  svg: [...SVG_TAGS],
  script: false,
  externalResources: false,
});

/** Removed together with their content. Anything else unknown is unwrapped. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'math',
  'audio',
  'video',
  'source',
  'track',
  'picture',
  'canvas',
  'portal',
  'dialog',
  'foreignobject',
  'use',
  'image',
  'feimage',
  'filter',
  'mask',
  'pattern',
  'clippath',
  'marker',
  'symbol',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'set',
  'discard',
  'mpath',
  'handler',
  'listener',
]);

const COMMON_ATTRS = new Set([
  'class',
  'style',
  'role',
  'title',
  'lang',
  'dir',
]);
const HTML_ATTRS = new Set(['alt', 'width', 'height', 'colspan', 'rowspan']);
const SVG_ATTRS = new Set(
  [
    'viewbox',
    'preserveaspectratio',
    'd',
    'x',
    'y',
    'dx',
    'dy',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'width',
    'height',
    'fill',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-miterlimit',
    'opacity',
    'transform',
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'pathlength',
    'id',
    'font-size',
    'font-weight',
    'font-family',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'dominant-baseline',
    'alignment-baseline',
    'vector-effect',
  ].map(name => name.toLowerCase())
);

const IMG_SRC = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i;
/** Shell element ids are reserved so content cannot clobber them. */
const RESERVED_ID = /^deck-/i;
const DANGEROUS_VALUE =
  /(?:javascript|vbscript|livescript|data\s*:\s*text\/html)\s*:|expression\s*\(|-moz-binding|behavior\s*:|@import|https?:|\/\/|\\/i;

/* ---------------------------------------------------------------- css */

/** Undo CSS escapes that encode ASCII letters (used to hide `url(` etc.). */
function decodeLetterEscapes(css: string) {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (match, code: string) => {
      const char = String.fromCodePoint(parseInt(code, 16) || 0xfffd);
      return /[A-Za-z]/.test(char) ? char : match;
    })
    .replace(/\\([g-zG-Z])/g, '$1')
    .replace(/\\\r?\n/g, '');
}

const CSS_DATA_URL =
  /^data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff2?|x-font-woff|font-sfnt|x-font-ttf|x-font-opentype))[;,]/i;

/**
 * Sanitizes a stylesheet or a declaration list. Strips `@import`,
 * non-`data:` URLs, `expression()`, `behavior`, `-moz-binding`, script
 * schemes and anything that could close the surrounding `<style>`.
 */
export function sanitizeDeckCss(css: string): string {
  let out = String(css ?? '');
  // Comments can hide tokens from the checks below.
  out = out.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
  out = out.replace(/<!--|-->/g, '');
  out = decodeLetterEscapes(out);
  out = out.replace(/<\/?(?:style|script)\b/gi, '');
  out = out.replace(/</g, '\\3C ');
  // @import / @namespace / @charset (with or without a trailing semicolon).
  out = out.replace(/@(?:import|namespace|charset)\b[^;{}]*;?/gi, '');
  // url(...) — only data: images/fonts and same-document fragments survive.
  // Accepted URLs are parked behind placeholders while the rest is checked.
  const kept: string[] = [];
  const park = (value: string) => `\uE000${kept.push(value) - 1}\uE000`;
  out = out.replace(/\uE000/g, '');
  out = out.replace(
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
    (_match, dq?: string, sq?: string, bare?: string) => {
      const value = (dq ?? sq ?? bare ?? '').trim();
      if (/^#[A-Za-z_][\w-]*$/.test(value)) return park(`url(${value})`);
      if (CSS_DATA_URL.test(value) && !/["'()\\\s]/.test(value))
        return park(`url("${value}")`);
      return 'none';
    }
  );
  // Quoted strings that look like external URLs (image-set, src(), …).
  out = out.replace(
    /(["'])\s*(?:(?:https?|ftp|wss?|file|javascript|vbscript|livescript):|\/\/)[^"']*\1/gi,
    '""'
  );
  // Any url( left over is malformed (e.g. unterminated); neutralize it.
  out = out.replace(/url\s*\(/gi, 'x-blocked(');
  out = out.replace(/(?:-webkit-)?image-set\s*\(/gi, 'x-blocked(');
  out = out.replace(/\bsrc\s*\(/gi, 'x-blocked(');
  out = out.replace(/expression\s*\(/gi, 'x-blocked(');
  out = out.replace(/-moz-binding/gi, 'x-blocked');
  out = out.replace(/\bbehavior\s*:/gi, 'x-blocked:');
  out = out.replace(/(?:javascript|vbscript|livescript)\s*:/gi, 'x-blocked:');
  out = out.replace(/https?:|\/\//gi, '');
  out = out.replace(
    /\uE000(\d+)\uE000/g,
    (_m, index: string) => kept[Number(index)] ?? ''
  );
  return out;
}

/* ---------------------------------------------------------------- html */

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is DefaultTreeAdapterTypes.TextNode =>
  node.nodeName === '#text';

function setChildren(parent: ParentNode, children: ChildNode[]) {
  parent.childNodes = children;
  children.forEach(child => {
    child.parentNode = parent;
  });
}

type State = { removed: number };

function sanitizeAttrs(element: Element, svg: boolean, state: State) {
  const tag = element.tagName.toLowerCase();
  element.attrs = element.attrs.filter(attr => {
    const name = attr.name.toLowerCase();
    let ok = false;
    if (attr.namespace || attr.prefix) ok = false;
    else if (/^on/i.test(name)) ok = false;
    else if (name === 'id' && /^rd-c-[a-z0-9-]{1,94}$/.test(attr.value))
      ok = true;
    else if (COMMON_ATTRS.has(name)) ok = true;
    else if (/^data-[a-z0-9_.-]+$/.test(name)) ok = true;
    else if (/^aria-[a-z]+$/.test(name)) ok = true;
    else if (svg) ok = SVG_ATTRS.has(name);
    else if (tag === 'img' && name === 'src') ok = IMG_SRC.test(attr.value);
    else ok = HTML_ATTRS.has(name);
    if (ok && name === 'id' && RESERVED_ID.test(attr.value)) ok = false;
    if (ok && name === 'style') {
      const clean = sanitizeDeckCss(attr.value);
      if (clean !== attr.value) state.removed++;
      attr.value = clean;
      return true;
    }
    if (ok && name !== 'src') {
      // Same-document paint servers (`url(#id)`) are the only url() allowed.
      const value = attr.value.replace(/url\(\s*#[A-Za-z_][\w-]*\s*\)/g, '');
      if (DANGEROUS_VALUE.test(value) || /url\s*\(/i.test(value)) ok = false;
    }
    if (!ok) state.removed++;
    return ok;
  });
}

function sanitizeChildren(parent: ParentNode, state: State) {
  const out: ChildNode[] = [];
  for (const child of parent.childNodes) {
    if (isText(child)) {
      out.push(child);
      continue;
    }
    if (!isElement(child)) {
      // Comments, doctypes, processing instructions.
      state.removed++;
      continue;
    }
    const tag = child.tagName.toLowerCase();
    const svg = child.namespaceURI === NS.SVG;
    const allowed =
      (child.namespaceURI === NS.HTML && HTML_TAGS.has(tag) && tag !== 'svg') ||
      (svg && SVG_TAGS.has(tag));
    if (DROP_TAGS.has(tag) && !allowed) {
      state.removed++;
      continue;
    }
    if (child.namespaceURI === NS.MATHML) {
      state.removed++;
      continue;
    }
    if (!allowed) {
      // Unknown but harmless wrapper (a, font, center, …): keep its content.
      state.removed++;
      sanitizeChildren(child, state);
      for (const grandchild of child.childNodes) {
        grandchild.parentNode = parent;
        out.push(grandchild);
      }
      continue;
    }
    if (
      tag === 'img' &&
      !child.attrs.some(a => a.name === 'src' && IMG_SRC.test(a.value))
    ) {
      state.removed++;
      continue;
    }
    sanitizeAttrs(child, svg, state);
    sanitizeChildren(child, state);
    out.push(child);
  }
  setChildren(parent, out);
}

const isBlank = (node: ChildNode) => isText(node) && node.value.trim() === '';

function makeSection(parent: ParentNode, children: ChildNode[]): Element {
  const section: Element = {
    nodeName: 'section',
    tagName: 'section',
    attrs: [],
    namespaceURI: NS.HTML,
    childNodes: [],
    parentNode: parent,
  };
  setChildren(section, children);
  return section;
}

function markSlide(section: Element) {
  const existing = section.attrs.find(attr => attr.name === 'class')?.value;
  const classes = (existing ?? '')
    .split(/\s+/)
    .filter(
      name =>
        name && name !== 'slide' && name !== 'is-active' && name !== 'is-past'
    );
  section.attrs = [
    { name: 'class', value: ['slide', ...classes].join(' ') },
    ...section.attrs.filter(
      attr => attr.name !== 'class' && attr.name !== 'data-slide'
    ),
    { name: 'data-slide', value: '' },
  ];
}

export type SanitizedDeckFragment = {
  html: string;
  slideCount: number;
  removed: number;
};

/**
 * Sanitizes AI-written slide markup. The result is a sequence of
 * `<section class="slide" data-slide>` elements; stray top-level content is
 * wrapped into a section, extra slides beyond the deck limit are dropped.
 */
export function sanitizeDeckFragment(htmlInput: string): SanitizedDeckFragment {
  const first = sanitizeOnce(String(htmlInput ?? ''));
  // Re-parse the serialized output: a second pass must be a no-op, which
  // guards against parser round-trip (mutation XSS) surprises.
  const second = sanitizeOnce(first.html);
  return { ...second, removed: first.removed + second.removed };
}

function sanitizeOnce(htmlInput: string): SanitizedDeckFragment {
  const state: State = { removed: 0 };
  const fragment = parseFragment(htmlInput);
  sanitizeChildren(fragment, state);

  // Hoist sections out of top-level wrappers (e.g. <div class="deck">).
  let top = fragment.childNodes;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const next: ChildNode[] = [];
    for (const node of top) {
      if (
        isElement(node) &&
        node.tagName !== 'section' &&
        node.childNodes.some(
          child => isElement(child) && child.tagName === 'section'
        )
      ) {
        changed = true;
        next.push(...node.childNodes);
      } else next.push(node);
    }
    top = next;
    if (!changed) break;
  }

  const slides: Element[] = [];
  let stray: ChildNode[] = [];
  const flush = () => {
    if (stray.some(node => !isBlank(node))) {
      slides.push(makeSection(fragment, stray));
      state.removed++;
    }
    stray = [];
  };
  for (const node of top) {
    if (
      isElement(node) &&
      node.tagName === 'section' &&
      node.namespaceURI === NS.HTML
    ) {
      flush();
      slides.push(node);
    } else stray.push(node);
  }
  flush();

  if (slides.length > DECK_LIMITS.maxSlides) {
    state.removed += slides.length - DECK_LIMITS.maxSlides;
    slides.length = DECK_LIMITS.maxSlides;
  }
  slides.forEach(markSlide);
  setChildren(fragment, slides);
  return {
    html: slides.map(slide => serializeOuter(slide)).join('\n'),
    slideCount: slides.length,
    removed: state.removed,
  };
}

/* ---------------------------------------------------------------- custom deck */

export type CustomDeckInput = {
  title: string;
  /** AI-written `<section>` slides. */
  html: string;
  /** AI-written CSS. */
  css: string;
  language: 'zh-CN' | 'en';
  accentColor?: string;
  theme?: DeckTemplateTheme;
};

/**
 * Sanitizes and wraps a custom-mode deck. Exposes theme variables
 * (`--bg --fg --accent …`) and the steady motion language so AI markup can
 * use `data-intent` just like templates.
 */
export function renderCustomDeckHtml(input: CustomDeckInput) {
  const fragment = sanitizeDeckFragment(input.html);
  const theme = input.theme ?? DECK_DEFAULT_CUSTOM_THEME;
  const accent =
    input.accentColor && /^#[0-9a-fA-F]{6}$/.test(input.accentColor)
      ? input.accentColor
      : theme.accent;
  const font = theme.fontStyle === 'serif' ? DECK_FONT_SERIF : DECK_FONT_SANS;
  const vars = `:root{--bg:${theme.background};--surface:${theme.surface};--fg:${theme.foreground};--muted:${theme.muted};--accent:${accent};--accent2:${theme.accent2};--font:${font};--deck-font:${font}}.slide{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:22px;line-height:1.5}`;
  const css = `${vars}${deckMotionCss('steady')}${sanitizeDeckCss(input.css)}`;
  return {
    html: wrapDeckHtml({
      title: input.title,
      lang: input.language,
      css,
      slidesHtml: fragment.html.replace(
        /^<section class="slide/,
        '<section class="slide is-active'
      ),
      transition: 'slide',
    }),
    slideCount: fragment.slideCount,
    removed: fragment.removed,
  };
}
