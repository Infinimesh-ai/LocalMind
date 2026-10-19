import { type DefaultTreeAdapterTypes, parseFragment, serialize } from 'parse5';

import { ChartMarkSchema, renderReportChart } from './charts';
import type { ReportIssue } from './design';
import { type ScopeCssOptions, scopeReportCss } from './design-render';
import {
  REPORT_WEB_V4,
  type ReportExperiencePlan,
  reportTokenCss,
  type ReportWebArtifact,
  type ReportWebEvidence,
} from './design-v4';
import { numberTokens } from './evidence';
import { REPORT_KIT_CSS, REPORT_KIT_GUIDE } from './kit';
import {
  REPORT_REVEAL_EFFECTS,
  REPORT_RUNTIME_CSS,
  REPORT_WEB_V4_ROOT_VALUE,
} from './runtime';
import { deckMarkupCapabilities, sanitizeDeckFragment } from './sanitize';
import { sha256 } from './sha256';
import { wrapDeckHtml } from './shell';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
const isElement = (node: Node): node is Element => 'tagName' in node;
const attr = (el: Element, name: string) =>
  el.attrs.find(a => a.name === name)?.value;
const removeAttr = (el: Element, name: string) => {
  el.attrs = el.attrs.filter(a => a.name !== name);
};
const children = (el: ParentNode) => el.childNodes.filter(isElement);
const textOf = (node: Node): string =>
  isElement(node) &&
  node.namespaceURI === 'http://www.w3.org/2000/svg' &&
  ['title', 'desc'].includes(node.tagName)
    ? ''
    : 'value' in node
      ? node.value
      : 'childNodes' in node
        ? node.childNodes.map(textOf).join('')
        : '';

export const REPORT_WEB_V4_CSS_OPTIONS: ScopeCssOptions = {
  rootValue: REPORT_WEB_V4_ROOT_VALUE,
  atRules: ['media', 'supports', 'keyframes', 'container'],
  motionRules: true,
};

/** Runtime-owned attributes are never accepted from generated markup. */
const RESERVED = new Set([
  'data-rd-generated',
  'data-rd-in',
  'data-rd-shown',
  'data-rd-current',
  'data-rd-ready',
  'data-rd-control',
  'data-rd-match',
  'data-rd-focus',
  'data-rd-state',
  'data-rd-step-at',
  'data-rd-at',
  'data-rd-active',
  'data-rd-counted',
  'data-rd-failed',
  'data-rd-variant',
  'data-rd-chart-dataset',
  'data-rd-axis',
]);
const ORDINAL = /^(0?[1-9]|1[0-4])$/;

/** Capability contract given to models; derived from the real validators. */
export function reportWebCapabilities() {
  const markup = deckMarkupCapabilities('web-v4');
  return {
    version: REPORT_WEB_V4,
    root: `[data-content-root="${REPORT_WEB_V4_ROOT_VALUE}"]`,
    html: markup.html,
    svg: markup.svg,
    script: 'none — behaviour comes only from the data-rd-* vocabulary below',
    css: {
      atRules: REPORT_WEB_V4_CSS_OPTIONS.atRules,
      layers:
        'Write plain rules; the app wraps sharedCss in @layer rd-shared and chapter css in @layer rd-chapter. Never write @layer.',
      forbidden:
        'position:fixed/sticky, !important, url() to anything but #fragments, @import, CSS nesting, html/body/:root/deck-* selectors, custom properties not starting with --rd-',
      keyframes:
        'Prefix names with rd-. Animate only opacity, transform/translate/scale/rotate, clip-path, filter, stroke-dash*, color/fill/stroke. No infinite iteration.',
      tokens:
        '--rd-canvas --rd-ink --rd-muted --rd-accent --rd-accent-ink --rd-alt --rd-alt-ink --rd-font-display --rd-font-body --rd-font-numeral --rd-font-serif --rd-font-sans --rd-font-mono --rd-size-display --rd-size-section --rd-size-body --rd-size-label --rd-weight-display --rd-measure --rd-dur-short --rd-dur-base --rd-dur-long --rd-ease --rd-stagger --rd-series-1..6 (compiled from the plan; use them)',
      chartTheme:
        'Charts read --rd-chart-mark, --rd-chart-hl, --rd-chart-muted, --rd-chart-ink, --rd-chart-grid, --rd-chart-surface; classes .rd-chart .rd-mark .rd-mark-hl .rd-chart-value .rd-chart-label .rd-chart-legend can be styled.',
    },
    facts:
      'Every element that states evidence carries data-rd-fact="factId …" or "derived:d-id". Numbers inside it must appear in those quotes/derived values. Unbound text may only contain numbers from this chapter\'s evidence or ordinals 1–14.',
    behaviours: {
      reveal: {
        attribute: 'data-rd-reveal',
        values: REPORT_REVEAL_EFFECTS,
        modifiers:
          'data-rd-seq="0..20" orders reveals inside the chapter (or inside a data-rd-beat group); data-rd-dur="short|base|long". Content is visible without script, under reduced motion and in print.',
      },
      count:
        'data-rd-count on a text-only element counts up to its own final text once revealed.',
      steps:
        'data-rd-step="1..6": in presentation mode the element appears on the n-th forward key press; in reading mode it is always visible.',
      switch:
        'Container data-rd-switch="aria label" whose direct children carry data-rd-view="tab label" (≥2; optional data-rd-default). The runtime builds keyboard-accessible tabs; without script all views stack. Give every view its own heading or caption.',
      linked:
        'Container data-rd-linked with ≥2 descendants sharing data-rd-key values (chart marks and legend items already carry the row label as key). Hover/focus/tap highlights matching keys and dims others; HTML items become keyboard buttons.',
      scrolly:
        'Container data-rd-scrolly with exactly one direct child data-rd-figure and ≥2 direct children data-rd-stage="k". On wide reading screens the figure becomes sticky and the container gets data-rd-at="k"; style figure states with [data-rd-at="k"] selectors. Base (no attribute) must be the complete figure.',
      disclosure:
        'Native <details>/<summary> for optional supporting evidence; never hide the conclusion.',
      states:
        'Read-only runtime states for styling: section[data-rd-state="on|past|idle"], [data-rd-in], [data-rd-match], [data-rd-current], [data-rd-at], .rd-tabs/.rd-tab.',
    },
    charts: {
      placeholder:
        '<figure data-rd-chart="chart-id"> with your own <figcaption>; the app renders SVG + data table from the dataset.',
      motion:
        'Charts animate themselves when they enter the viewport: axis/baseline first, then marks grow or draw, then value labels. Do not add reveal attributes inside the figure; put data-rd-reveal on the figcaption or surrounding text to order them around the chart.',
      marks: ChartMarkSchema.options,
    },
    kit: REPORT_KIT_GUIDE,
    classes:
      'Use the rd-kit classes first; your own class names use the rd- prefix. Wrap number+unit in <span class="rd-nb"> to keep them together.',
  };
}

export type ReportBehavior = {
  id: string;
  chapterId: string;
  kind:
    | 'switch'
    | 'linked'
    | 'scrolly'
    | 'steps'
    | 'disclosure'
    | 'reveal'
    | 'count';
  count: number;
};

export type ReportWebRenderResult = {
  html: string;
  hash: string;
  issues: ReportIssue[];
  behaviors: ReportBehavior[];
  charts: Array<{
    id: string;
    chapterId: string;
    mark: string;
    fallback?: string;
  }>;
  slideCount: number;
};

export function renderReportWeb(input: {
  artifact: ReportWebArtifact;
  plan: ReportExperiencePlan;
  evidence: ReportWebEvidence;
  language: 'zh-CN' | 'en';
}): ReportWebRenderResult {
  const { artifact, plan, evidence, language } = input;
  const issues: ReportIssue[] = [];
  const behaviors: ReportBehavior[] = [];
  const charts: ReportWebRenderResult['charts'] = [];
  const add = (
    chapterId: string,
    evidenceText: string,
    category: ReportIssue['category'] = 'structure',
    severity: ReportIssue['severity'] = 'error',
    suggestedFix = 'Repair this chapter while preserving its facts.',
    elementId = ''
  ) =>
    issues.push({
      id: `markup-${issues.length}`,
      category,
      severity,
      chapterId,
      viewport: '',
      elementId,
      evidence: evidenceText.slice(0, 1200),
      suggestedFix: suggestedFix.slice(0, 1200),
    });
  const facts = new Map(evidence.facts.map(f => [f.id, f]));
  const derived = new Map(evidence.derived.map(d => [d.id, d]));
  const datasets = new Map(evidence.datasets.map(d => [d.id, d]));
  const seenIds = new Set<string>();
  const html: string[] = [];
  const css: string[] = [
    REPORT_RUNTIME_CSS,
    REPORT_KIT_CSS,
    reportTokenCss(plan),
    `@layer rd-shared{${scopeReportCss(artifact.sharedCss, null, issues, REPORT_WEB_V4_CSS_OPTIONS)}}`,
  ];
  for (const chapter of artifact.chapters) {
    const planned = plan.chapters.find(ch => ch.id === chapter.id);
    if (!planned) {
      add(chapter.id, 'Chapter is not in the plan.');
      continue;
    }
    const raw = parseFragment(chapter.html);
    const top = raw.childNodes.filter(
      n => isElement(n) || ('value' in n && n.value.trim())
    );
    if (
      top.length !== 1 ||
      !isElement(top[0]) ||
      top[0].tagName !== 'section' ||
      attr(top[0], 'data-chapter-id') !== chapter.id
    )
      add(
        chapter.id,
        'Expected exactly one <section data-chapter-id> for this chapter.'
      );
    const sanitized = sanitizeDeckFragment(chapter.html, 'web-v4');
    if (sanitized.removed)
      add(
        chapter.id,
        `Sanitizer removed ${sanitized.removed} unsupported elements or attributes: ${(sanitized.removedNames ?? []).join(', ')}. Use only the documented tags/attributes (no buttons, links, scripts or event handlers).`,
        'security'
      );
    if (sanitized.slideCount !== 1)
      add(chapter.id, 'Chapter must contain exactly one section.');
    const doc = parseFragment(sanitized.html);
    const section = children(doc)[0];
    if (!section) {
      add(chapter.id, 'Chapter contains no section.');
      continue;
    }
    const elements: Element[] = [];
    const visit = (node: Node) => {
      if (elements.length > 12000) return;
      if (isElement(node)) elements.push(node);
      if ('childNodes' in node) node.childNodes.forEach(visit);
    };
    visit(section);
    if (elements.length > 12000)
      add(chapter.id, 'Chapter DOM exceeds the node budget.');
    if (!textOf(section).trim())
      add(chapter.id, 'Chapter contains no readable text.');

    // Evidence that may appear in this chapter.
    const chapterFactIds = new Set(planned.factIds);
    for (const ds of planned.datasets)
      datasets.get(ds)?.rows.forEach(row => chapterFactIds.add(row.factId));
    const chapterDerived = new Set(planned.derivations);
    const numbersFor = (tokens: string[]) => {
      const out = new Set<string>();
      for (const token of tokens) {
        if (token.startsWith('derived:')) {
          const value = derived.get(token.slice(8));
          if (value) numberTokens(value.display).forEach(n => out.add(n));
        } else {
          const fact = facts.get(token);
          if (fact) numberTokens(fact.quote).forEach(n => out.add(n));
        }
      }
      return out;
    };
    const chapterNumbers = numbersFor([
      ...chapterFactIds,
      ...[...chapterDerived].map(id => `derived:${id}`),
    ]);
    for (const ds of planned.datasets)
      datasets
        .get(ds)
        ?.rows.forEach(row =>
          numberTokens(row.value).forEach(n => chapterNumbers.add(n))
        );
    const bound = new Set<string>();
    let reveals = 0;
    const badNumbers: string[] = [];
    const counts = {
      reveal: 0,
      count: 0,
      steps: new Set<number>(),
      switch: 0,
      scrolly: 0,
      disclosure: 0,
    };

    for (const el of elements) {
      for (const name of el.attrs.map(a => a.name))
        if (RESERVED.has(name)) removeAttr(el, name);
      const id = attr(el, 'id');
      if (id) {
        if (
          seenIds.has(id) ||
          !(
            id.startsWith(`${chapter.id}-`) ||
            (el === section && id === chapter.id)
          )
        )
          add(chapter.id, `Duplicate or out-of-namespace element ID ${id}.`);
        seenIds.add(id);
      }
      if (el !== section && el.tagName === 'section')
        add(chapter.id, 'Nested sections are unsupported.');
      const inline = el.attrs.find(a => a.name === 'style');
      if (inline) {
        const checked = scopeReportCss(
          `.rd-inline{${inline.value}}`,
          chapter.id,
          issues,
          REPORT_WEB_V4_CSS_OPTIONS
        );
        const match = /\{([\s\S]*)\}\s*$/.exec(checked);
        inline.value = match ? match[1].trim() : '';
      }
      const reveal = attr(el, 'data-rd-reveal');
      if (reveal !== undefined) {
        if (
          !(REPORT_REVEAL_EFFECTS as readonly string[]).includes(reveal) ||
          ++reveals > 40
        ) {
          removeAttr(el, 'data-rd-reveal');
          add(
            chapter.id,
            `Removed data-rd-reveal="${reveal}" (unknown effect or more than 40 reveals in a chapter).`,
            'composition',
            'warning'
          );
        } else counts.reveal++;
      }
      const seq = attr(el, 'data-rd-seq');
      if (seq !== undefined && !/^(1?\d|20)$/.test(seq))
        removeAttr(el, 'data-rd-seq');
      const dur = attr(el, 'data-rd-dur');
      if (dur !== undefined && !['short', 'base', 'long'].includes(dur))
        removeAttr(el, 'data-rd-dur');
      if (attr(el, 'data-rd-count') !== undefined || reveal === 'count') {
        if (children(el).length || !/\d/.test(textOf(el))) {
          removeAttr(el, 'data-rd-count');
          const effect = el.attrs.find(a => a.name === 'data-rd-reveal');
          if (reveal === 'count' && effect) effect.value = 'fade';
          add(
            chapter.id,
            'Count-up needs a text-only element containing a number.',
            'composition',
            'warning'
          );
        } else counts.count++;
      }
      const step = attr(el, 'data-rd-step');
      if (step !== undefined) {
        if (!/^[1-6]$/.test(step)) removeAttr(el, 'data-rd-step');
        else counts.steps.add(Number(step));
      }
      if (attr(el, 'data-rd-switch') !== undefined) {
        const views = children(el).filter(
          c => attr(c, 'data-rd-view') !== undefined
        );
        const labels = views.map(v => (attr(v, 'data-rd-view') ?? '').trim());
        if (views.length < 2 || labels.some(l => !l || l.length > 24)) {
          removeAttr(el, 'data-rd-switch');
          views.forEach(v => removeAttr(v, 'data-rd-view'));
          add(
            chapter.id,
            'data-rd-switch needs ≥2 direct children with short data-rd-view labels; it was flattened.',
            'composition',
            'warning'
          );
        } else {
          counts.switch++;
          const label = labels.join(' ');
          for (const n of numberTokens(label))
            if (!chapterNumbers.has(n) && !ORDINAL.test(n)) badNumbers.push(n);
        }
      }
      if (attr(el, 'data-rd-scrolly') !== undefined) {
        const direct = children(el);
        const figures = direct.filter(
          c => attr(c, 'data-rd-figure') !== undefined
        );
        const stages = direct.filter(
          c => attr(c, 'data-rd-stage') !== undefined
        );
        if (figures.length !== 1 || stages.length < 2) {
          removeAttr(el, 'data-rd-scrolly');
          add(
            chapter.id,
            'data-rd-scrolly needs one direct data-rd-figure child and ≥2 data-rd-stage children; it was flattened.',
            'composition',
            'warning'
          );
        } else counts.scrolly++;
      }
      if (el.tagName === 'details') counts.disclosure++;
      for (const name of ['title', 'aria-label'])
        for (const n of numberTokens(attr(el, name) ?? ''))
          if (!chapterNumbers.has(n) && !ORDINAL.test(n)) badNumbers.push(n);
    }

    // Fact bindings and the traceable-number gate.
    const walk = (node: Node, allowed: Set<string> | null) => {
      if (isElement(node)) {
        if (
          node.namespaceURI === 'http://www.w3.org/2000/svg' &&
          ['title', 'desc'].includes(node.tagName)
        )
          return;
        const tokens = (attr(node, 'data-rd-fact') ?? '')
          .split(/\s+/)
          .filter(Boolean);
        if (tokens.length) {
          const valid = tokens.filter(token =>
            token.startsWith('derived:')
              ? chapterDerived.has(token.slice(8)) &&
                derived.has(token.slice(8))
              : chapterFactIds.has(token) && facts.has(token)
          );
          if (valid.length !== tokens.length)
            add(
              chapter.id,
              `data-rd-fact references evidence not planned for this chapter: ${tokens.filter(t => !valid.includes(t)).join(', ')}.`,
              'facts'
            );
          for (const token of valid) {
            if (token.startsWith('derived:'))
              derived.get(token.slice(8))?.factIds.forEach(f => bound.add(f));
            else bound.add(token);
          }
          allowed = numbersFor(valid);
        }
        node.childNodes.forEach(child => walk(child, allowed));
        return;
      }
      if ('value' in node && node.nodeName === '#text') {
        for (const n of numberTokens(node.value)) {
          // Inside a binding the evidence is exact; ordinals are only
          // tolerated in unbound labels such as list numbering.
          const ok = allowed
            ? allowed.has(n)
            : chapterNumbers.has(n) || ORDINAL.test(n);
          if (!ok) badNumbers.push(n);
        }
      }
    };
    walk(section, null);
    if (badNumbers.length)
      add(
        chapter.id,
        `Numbers not traceable to this chapter's evidence: ${[...new Set(badNumbers)].slice(0, 12).join(', ')}. Every number must appear in the quote of the fact bound with data-rd-fact (or a planned derived value); do not compute or invent values.`,
        'facts'
      );

    // Chart components.
    const placeholders = elements.filter(
      el => attr(el, 'data-rd-chart') !== undefined
    );
    const placed = new Set<string>();
    for (const el of placeholders) {
      const chartId = attr(el, 'data-rd-chart') ?? '';
      const spec = planned.charts.find(c => c.id === chartId);
      const dataset = spec && datasets.get(spec.dataset);
      if (!spec || !dataset || placed.has(chartId)) {
        add(
          chapter.id,
          `data-rd-chart="${chartId}" is not a planned chart of this chapter (or is duplicated).`
        );
        removeAttr(el, 'data-rd-chart');
        continue;
      }
      placed.add(chartId);
      const rendered = renderReportChart(spec, dataset, language);
      charts.push({
        id: chartId,
        chapterId: chapter.id,
        mark: rendered.mark,
        ...(rendered.fallback ? { fallback: rendered.fallback } : {}),
      });
      dataset.rows.forEach(row => bound.add(row.factId));
      const fragment = parseFragment(rendered.html);
      const nodes = fragment.childNodes;
      nodes.forEach(n => {
        (n as { parentNode: ParentNode }).parentNode = el;
      });
      const generatedRoot = nodes.find(isElement);
      if (
        generatedRoot &&
        attr(generatedRoot, 'data-rd-generated') === undefined
      )
        generatedRoot.attrs.push({ name: 'data-rd-generated', value: 'chart' });
      el.childNodes = [...nodes, ...el.childNodes];
      counts.reveal++;
    }
    for (const spec of planned.charts)
      if (!placed.has(spec.id))
        add(
          chapter.id,
          `Planned chart ${spec.id} has no <figure data-rd-chart="${spec.id}"> placeholder.`
        );

    // Linked groups are validated after charts contribute their keys.
    const all: Element[] = [];
    const collect = (node: Node) => {
      if (isElement(node)) all.push(node);
      if ('childNodes' in node) node.childNodes.forEach(collect);
    };
    collect(section);
    for (const el of all.filter(e => attr(e, 'data-rd-linked') !== undefined)) {
      const keys = new Map<string, number>();
      const count = (node: Node) => {
        if (!isElement(node)) return;
        const key = attr(node, 'data-rd-key');
        if (key) keys.set(key, (keys.get(key) ?? 0) + 1);
        node.childNodes.forEach(count);
      };
      el.childNodes.forEach(count);
      if (keys.size < 2 || ![...keys.values()].some(v => v >= 2)) {
        removeAttr(el, 'data-rd-linked');
        add(
          chapter.id,
          'data-rd-linked needs ≥2 keys and at least one key that appears on two linked elements (e.g. a legend item and a chart mark).',
          'composition',
          'warning'
        );
      } else
        behaviors.push({
          id: `${chapter.id}:linked:${behaviors.length}`,
          chapterId: chapter.id,
          kind: 'linked',
          count: keys.size,
        });
    }

    // Coverage: planned evidence must be visibly bound in the chapter.
    const missing = planned.factIds.filter(id => !bound.has(id));
    if (missing.length)
      add(
        chapter.id,
        `Planned facts are not bound to visible elements with data-rd-fact: ${missing.join(', ')}.`,
        'facts'
      );
    if (counts.switch)
      behaviors.push({
        id: `${chapter.id}:switch`,
        chapterId: chapter.id,
        kind: 'switch',
        count: counts.switch,
      });
    if (counts.scrolly)
      behaviors.push({
        id: `${chapter.id}:scrolly`,
        chapterId: chapter.id,
        kind: 'scrolly',
        count: counts.scrolly,
      });
    if (counts.steps.size)
      behaviors.push({
        id: `${chapter.id}:steps`,
        chapterId: chapter.id,
        kind: 'steps',
        count: Math.max(...counts.steps),
      });
    if (counts.disclosure)
      behaviors.push({
        id: `${chapter.id}:disclosure`,
        chapterId: chapter.id,
        kind: 'disclosure',
        count: counts.disclosure,
      });
    if (counts.reveal)
      behaviors.push({
        id: `${chapter.id}:reveal`,
        chapterId: chapter.id,
        kind: 'reveal',
        count: counts.reveal,
      });
    if (counts.count)
      behaviors.push({
        id: `${chapter.id}:count`,
        chapterId: chapter.id,
        kind: 'count',
        count: counts.count,
      });

    html.push(serialize(doc));
    css.push(
      `@layer rd-chapter{${scopeReportCss(chapter.css, chapter.id, issues, REPORT_WEB_V4_CSS_OPTIONS)}}`
    );
  }
  const rendered = wrapDeckHtml({
    title: artifact.title,
    lang: language,
    css: css.join('\n'),
    slidesHtml: html.join('\n'),
    contentVersion: 'custom-v4',
  });
  return {
    html: rendered,
    hash: Array.from(sha256(rendered), byte =>
      byte.toString(16).padStart(2, '0')
    ).join(''),
    issues,
    behaviors,
    charts,
    slideCount: artifact.chapters.length,
  };
}

const STRIP: Record<string, string[]> = {
  motion: [
    'data-rd-reveal',
    'data-rd-seq',
    'data-rd-dur',
    'data-rd-count',
    'data-rd-beat',
  ],
  switch: ['data-rd-switch', 'data-rd-view', 'data-rd-default'],
  linked: ['data-rd-linked'],
  scrolly: ['data-rd-scrolly', 'data-rd-figure', 'data-rd-stage'],
  steps: ['data-rd-step'],
  count: ['data-rd-count'],
};

/**
 * Deterministic degradation: removes behaviour declarations that failed
 * browser checks so the chapter ships as complete static content.
 */
export function stripBehaviors(
  html: string,
  kinds: ReadonlyArray<keyof typeof STRIP | string>
) {
  const names = new Set(kinds.flatMap(kind => STRIP[kind] ?? []));
  if (!names.size) return html;
  const doc = parseFragment(html);
  const visit = (node: Node) => {
    if (isElement(node))
      node.attrs = node.attrs.filter(a => !names.has(a.name));
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(doc);
  return serialize(doc);
}
