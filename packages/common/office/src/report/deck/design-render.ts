import { type DefaultTreeAdapterTypes, parseFragment, serialize } from 'parse5';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

import {
  REPORT_WEB_ROOT,
  REPORT_WEB_VERSION,
  type ReportArtifact,
  type ReportIssue,
} from './design';
import {
  deckMarkupCapabilities,
  sanitizeDeckCss,
  sanitizeDeckFragment,
} from './sanitize';
import { sha256 } from './sha256';
import { wrapDeckHtml } from './shell';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const isElement = (node: Node): node is Element => 'tagName' in node;
const attribute = (node: Element, name: string) =>
  node.attrs.find(a => a.name === name)?.value;
const contents = (node: Node): string =>
  isElement(node) &&
  node.namespaceURI === 'http://www.w3.org/2000/svg' &&
  ['title', 'desc'].includes(node.tagName)
    ? ''
    : 'value' in node
      ? node.value
      : 'childNodes' in node
        ? node.childNodes.map(contents).join('')
        : '';
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function reportRenderCapabilities() {
  return {
    version: REPORT_WEB_VERSION,
    ...deckMarkupCapabilities(),
    root: REPORT_WEB_ROOT,
    cssAtRules: ['media', 'supports', 'keyframes'],
    cssNaming:
      'Classes, variables and animation names use rd-. Chapter IDs use rd-c-. No fixed positioning, !important, external URLs or CSS nesting.',
    structure:
      'Exactly one section.slide[data-slide][data-chapter-id] per chapter. Normal document flow; no fixed chapter height or whole-page scaling.',
    images:
      'No external or generated raster assets. Use supported inline SVG with viewBox for factual diagrams.',
    animation:
      'Visible base state; optional .is-active entrance, reduced motion is enforced by the shell.',
  };
}

export type ReportRenderResult = {
  html: string;
  hash: string;
  issues: ReportIssue[];
  slideCount: number;
};

/** Validate and scope model CSS using parsers; no regex prefixing of selectors. */
export type ScopeCssOptions = {
  /** Root attribute value, e.g. `rd-custom-v3`. */
  rootValue?: string;
  atRules?: readonly string[];
  /** v4: keyframes may only animate compositor-friendly properties. */
  motionRules?: boolean;
};

const MOTION_PROPS =
  /^(opacity|transform|translate|scale|rotate|clip-path|filter|stroke-dashoffset|stroke-dasharray|color|background-color|fill|stroke|offset-distance|letter-spacing)$/;

export function scopeReportCss(
  css: string,
  chapterId: string | null,
  issues: ReportIssue[],
  options: ScopeCssOptions = {}
) {
  const rootValue = options.rootValue ?? 'rd-custom-v3';
  const atRules = options.atRules ?? ['media', 'supports', 'keyframes'];
  const warn = (evidence: string) =>
    issues.push({
      id: `css-${issues.length}`,
      category: 'composition',
      severity: 'warning',
      chapterId: chapterId ?? '',
      viewport: '',
      elementId: '',
      evidence,
      suggestedFix:
        'Animate only opacity/transform/clip-path/filter/stroke properties, finitely.',
    });
  const issue = (evidence: string) =>
    issues.push({
      id: `css-${issues.length}`,
      category: 'security',
      severity: 'error',
      chapterId: chapterId ?? '',
      viewport: '',
      elementId: '',
      evidence,
      suggestedFix:
        'Use scoped static CSS from renderCapabilities; replace the rejected rule.',
    });
  // Comments do not affect layout. Removing one is not evidence of an unsafe
  // resource; token obfuscation is still exposed to the sanitizer afterward.
  const authored = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
  const clean = sanitizeDeckCss(authored);
  if (clean !== authored)
    issue('CSS sanitizer removed an unsupported resource or expression.');
  let root;
  try {
    root = postcss.parse(clean);
  } catch {
    issue('CSS could not be parsed.');
    return '';
  }
  const scope = `[data-content-root="${rootValue}"]`;
  const animations = new Map<string, string>();
  if (chapterId)
    root.walkAtRules('keyframes', rule => {
      animations.set(rule.params, `${chapterId}-${rule.params}`);
    });
  root.walkAtRules(rule => {
    if (
      !atRules.includes(rule.name.toLowerCase()) ||
      (rule.name === 'keyframes' && !/^rd-[a-z0-9-]+$/.test(rule.params))
    ) {
      issue(`Unsupported CSS at-rule: ${rule.name.slice(0, 30)}.`);
      rule.remove();
    }
  });
  root.walkAtRules('keyframes', rule => {
    rule.params = animations.get(rule.params) ?? rule.params;
  });
  root.walkDecls(decl => {
    if (options.motionRules) {
      const inKeyframes =
        decl.parent?.parent?.type === 'atrule' &&
        (decl.parent.parent as postcss.AtRule).name === 'keyframes';
      if (inKeyframes && !MOTION_PROPS.test(decl.prop.toLowerCase())) {
        warn(
          `Keyframes may not animate layout property ${decl.prop.slice(0, 40)}.`
        );
        decl.remove();
        return;
      }
      if (
        /^animation(-iteration-count)?$/.test(decl.prop) &&
        /\binfinite\b/i.test(decl.value)
      ) {
        warn('Infinite animation replaced by a single iteration.');
        decl.value = decl.value.replace(/\binfinite\b/gi, '1');
      }
    }
    if (/^(animation|animation-name)$/.test(decl.prop))
      decl.value = decl.value.replace(
        /\brd-[a-z0-9-]+\b/g,
        name => animations.get(name) ?? name
      );
    if (
      decl.important ||
      (decl.prop === 'position' && /fixed|sticky/i.test(decl.value)) ||
      (decl.prop.startsWith('--') && !decl.prop.startsWith('--rd-'))
    ) {
      issue(`Unsupported CSS declaration: ${decl.prop.slice(0, 40)}.`);
      decl.remove();
    }
  });
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes')
      return;
    if (rule.parent?.type === 'rule') {
      issue('Nested CSS rules are unsupported.');
      rule.remove();
      return;
    }
    try {
      rule.selector = selectorParser(selectors => {
        selectors.each(selector => {
          selector.walk(node => {
            if (
              (node.type === 'tag' && /^(html|body)$/i.test(node.value)) ||
              (node.type === 'pseudo' && node.value === ':root') ||
              (node.type === 'id' && node.value.startsWith('deck-')) ||
              (node.type === 'class' && node.value.startsWith('deck-'))
            ) {
              throw new Error('shell selector');
            }
          });
          // Remove only an exact leading root, then anchor every selector.
          if (
            selector.first?.type === 'attribute' &&
            selector.first.attribute === 'data-content-root'
          ) {
            if (selector.first.value !== rootValue) throw new Error('root');
            selector.first.remove();
            if (
              selector.nodes[0]?.type === 'combinator' &&
              selector.nodes[0].value.trim() === ''
            )
              selector.nodes[0].remove();
          }
          if (
            chapterId &&
            selector.first?.type === 'attribute' &&
            selector.first.attribute === 'data-chapter-id' &&
            selector.first.value === chapterId
          ) {
            selector.first.remove();
            if (
              selector.nodes[0]?.type === 'combinator' &&
              selector.nodes[0].value.trim() === ''
            )
              selector.nodes[0].remove();
          }
          if (chapterId) {
            const guard = selectorParser().astSync(
              `:where([data-chapter-id="${chapterId}"],[data-chapter-id="${chapterId}"] *)`
            ).first.first;
            const pseudoElement = selector.nodes.find(
              n => n.type === 'pseudo' && n.value.startsWith('::')
            );
            if (pseudoElement)
              selector.insertBefore(pseudoElement, guard.clone());
            else selector.append(guard.clone());
          }
          const prefix = selectorParser().astSync(scope).first;
          if (selector.first?.type === 'combinator')
            throw new Error('relative selector');
          if (selector.nodes.length)
            selector.prepend(selectorParser.combinator({ value: ' ' }));
          for (const node of [...prefix.nodes].reverse())
            selector.prepend(node.clone());
        });
      }).processSync(rule.selector);
    } catch {
      issue('CSS selector escapes the content contract or cannot be parsed.');
      rule.remove();
    }
  });
  return root.toString();
}

export function renderReportArtifact(
  artifact: ReportArtifact,
  language: 'zh-CN' | 'en'
): ReportRenderResult {
  const issues: ReportIssue[] = [];
  const seen = new Set<string>();
  const add = (
    chapterId: string,
    evidence: string,
    category: ReportIssue['category'] = 'structure'
  ) =>
    issues.push({
      id: `markup-${issues.length}`,
      category,
      severity: 'error',
      chapterId,
      viewport: '',
      elementId: '',
      evidence,
      suggestedFix:
        'Repair this chapter while preserving its required facts and stable IDs.',
    });
  const css = [scopeReportCss(artifact.sharedCss, null, issues)];
  const html: string[] = [];
  for (const chapter of artifact.chapters) {
    const raw = parseFragment(chapter.html);
    const top = raw.childNodes.filter(
      n => isElement(n) || ('value' in n && n.value.trim())
    );
    if (
      top.length !== 1 ||
      !isElement(top[0]) ||
      top[0].tagName !== 'section' ||
      attribute(top[0], 'data-chapter-id') !== chapter.id
    ) {
      add(
        chapter.id,
        'Expected exactly one section with the requested chapter ID.'
      );
    }
    const sanitized = sanitizeDeckFragment(chapter.html);
    if (sanitized.removed)
      add(
        chapter.id,
        `Sanitizer removed ${sanitized.removed} unsupported elements or attributes.`,
        'security'
      );
    if (sanitized.slideCount !== 1)
      add(chapter.id, 'Chapter must contain exactly one section.');
    const doc = parseFragment(sanitized.html);
    const elements: Element[] = [];
    const visit = (node: Node) => {
      if (elements.length > 12000) return;
      if (isElement(node)) elements.push(node);
      if ('childNodes' in node) node.childNodes.forEach(visit);
    };
    visit(doc);
    if (elements.length > 12000)
      add(chapter.id, 'Chapter DOM exceeds the node budget.');
    if (!normalize(contents(doc)))
      add(chapter.id, 'Chapter contains no readable text.');
    for (const el of elements) {
      const id = attribute(el, 'id');
      if (id) {
        if (
          seen.has(id) ||
          !(
            id.startsWith(`${chapter.id}-`) ||
            (el.tagName === 'section' && id === chapter.id)
          )
        )
          add(chapter.id, 'Duplicate or out-of-namespace element ID.');
        seen.add(id);
      }
      if (
        el.tagName === 'section' &&
        attribute(el, 'data-chapter-id') !== chapter.id
      )
        add(chapter.id, 'Nested sections are unsupported.');
      const inline = el.attrs.find(a => a.name === 'style');
      if (inline) {
        // The same declaration parser and capability rules apply to inline style.
        const checked = scopeReportCss(
          `.rd-inline{${inline.value}}`,
          chapter.id,
          issues
        );
        const parsed = postcss.parse(checked).first;
        inline.value =
          parsed?.type === 'rule'
            ? parsed.nodes.map(n => n.toString()).join(';')
            : '';
      }
    }
    for (const claim of chapter.claims) {
      const el = elements.find(e => attribute(e, 'id') === claim.elementId);
      if (
        !el ||
        !normalize(contents(el))
          .replaceAll(' ', '')
          .includes(normalize(claim.text).replaceAll(' ', ''))
      )
        add(
          chapter.id,
          'A factual claim is missing from its declared element.',
          'facts'
        );
      if (claim.factIds.some(id => !chapter.factIds.includes(id)))
        add(
          chapter.id,
          'Claim references a fact outside the chapter assignment.',
          'facts'
        );
    }
    html.push(serialize(doc));
    css.push(scopeReportCss(chapter.css, chapter.id, issues));
  }
  const rendered = wrapDeckHtml({
    title: artifact.title,
    lang: language,
    css: css.join('\n'),
    slidesHtml: html.join('\n'),
    contentVersion: 'custom-v3',
  });
  return {
    html: rendered,
    hash: Array.from(sha256(rendered), byte =>
      byte.toString(16).padStart(2, '0')
    ).join(''),
    issues,
    slideCount: artifact.chapters.length,
  };
}
