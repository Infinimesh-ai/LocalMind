import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { renderReportChart } from './charts';
import {
  applyPlanOps,
  lintExperiencePlan,
  parseReportBundle,
  ReportExperiencePlanSchema,
} from './design-v4';
import { computeDerivations, numberTokens } from './evidence';
import { renderReportWeb } from './render-v4';
import {
  REPORT_RUNTIME_HASH,
  REPORT_RUNTIME_HEAD_HASH,
  REPORT_RUNTIME_SCRIPT,
} from './runtime';
import { V4_DATASETS, V4_FACTS, V4_PLAN, v4Artifact } from './web-v4.fixture';

const evidence = () => {
  const { values } = computeDerivations(V4_DATASETS, V4_PLAN.derivations);
  return { facts: V4_FACTS, datasets: V4_DATASETS, derived: values };
};

describe('report web v4 evidence', () => {
  it('computes derived values deterministically with formulas and provenance', () => {
    const { values, rejected } = computeDerivations(V4_DATASETS, [
      ...V4_PLAN.derivations,
      { id: 'd-share', op: 'share', dataset: 'ds-checks', inputs: ['待修复'] },
      {
        id: 'd-bad',
        op: 'change_pct',
        dataset: 'ds-revenue',
        inputs: ['四季度', '一季度'],
      },
    ]);
    expect(values.find(v => v.id === 'd-growth')?.display).toBe('+28.6%');
    expect(values.find(v => v.id === 'd-share')?.display).toBe('25%');
    expect(values.find(v => v.id === 'd-growth')?.factIds).toEqual([
      'f-q1',
      'f-q3',
    ]);
    expect(rejected.map(r => r.id)).toEqual(['d-bad']);
    expect(numberTokens('1,234 万元，增长 12.5％')).toEqual(['1234', '12.5%']);
  });
});

describe('report web v4 plan lint', () => {
  it('accepts the fixture and rejects padding, repetition and monotone motion', () => {
    expect(ReportExperiencePlanSchema.parse(V4_PLAN)).toBeTruthy();
    const ok = lintExperiencePlan(V4_PLAN, {
      facts: V4_FACTS,
      datasets: V4_DATASETS,
      maxChapters: 9,
    });
    expect(ok.errors).toEqual([]);
    const bad = structuredClone(V4_PLAN);
    bad.chapters[2].layout.archetype = 'figure-dominant';
    bad.chapters.forEach(ch => {
      ch.motion.entrance = 'fade';
    });
    bad.chapters.push({
      ...structuredClone(bad.chapters[2]),
      id: 'rd-c-pad',
      beat: 'risk',
      factIds: ['f-risk'],
      datasets: [],
      charts: [],
      layout: { ...bad.chapters[2].layout, archetype: 'ledger' },
    });
    const result = lintExperiencePlan(bad, {
      facts: V4_FACTS,
      datasets: V4_DATASETS,
      maxChapters: 9,
    });
    expect(result.errors.join('\n')).toContain(
      'repeats the figure-dominant layout'
    );
    expect(result.errors.join('\n')).toContain('same entrance effect');
    expect(result.errors.join('\n')).toContain(
      'rd-c-pad carries a single fact'
    );
  });
  it('applies structural repair operations', () => {
    const { plan, errors } = applyPlanOps(V4_PLAN, [
      { op: 'mergeChapters', into: 'rd-c-trend', from: 'rd-c-checks' },
      { op: 'swapChartMark', chartId: 'rd-c-trend-line', mark: 'column' },
    ]);
    expect(errors).toEqual([]);
    expect(plan.chapters.map(ch => ch.id)).toEqual(['rd-c-open', 'rd-c-trend']);
    expect(plan.chapters[1].charts.map(c => [c.id, c.mark])).toEqual([
      ['rd-c-trend-line', 'column'],
      ['rd-c-trend-units', 'unit'],
    ]);
  });
});

describe('report web v4 rendering', () => {
  it('assembles charts, behaviours, layered CSS and the hashed runtime', () => {
    const out = renderReportWeb({
      artifact: v4Artifact(),
      plan: V4_PLAN,
      evidence: evidence(),
      language: 'zh-CN',
    });
    expect(out.issues.filter(i => i.severity === 'error')).toEqual([]);
    // Infinite iteration and layout keyframes are neutralised with warnings.
    expect(out.issues.map(i => i.evidence).join('\n')).toContain(
      'Infinite animation'
    );
    expect(out.issues.map(i => i.evidence).join('\n')).toContain(
      'layout property width'
    );
    expect(out.html).toContain('data-content-root="rd-custom-v4"');
    expect(out.html).toContain(`'sha256-${REPORT_RUNTIME_HASH}'`);
    expect(out.html).toContain(`'sha256-${REPORT_RUNTIME_HEAD_HASH}'`);
    expect(out.html).toContain(REPORT_RUNTIME_SCRIPT);
    expect(out.html).toContain('@layer rd-chapter{');
    expect(out.html).toContain('class="rd-chart rd-chart--line"');
    expect(out.html).toContain('data-rd-generated="chart"');
    expect(out.html).toContain('--rd-accent:#c34d18');
    expect(out.charts.map(c => c.mark)).toEqual(['line', 'unit']);
    expect(out.behaviors.map(b => b.kind).sort()).toEqual(
      [
        'count',
        'disclosure',
        'linked',
        'reveal',
        'reveal',
        'reveal',
        'steps',
        'switch',
      ].sort()
    );
    expect(out.hash).toBe(createHash('sha256').update(out.html).digest('hex'));
  });
  it('rejects untraceable numbers, unbound planned facts and forged runtime state', () => {
    const artifact = v4Artifact();
    artifact.chapters[0].html = artifact.chapters[0].html
      .replace('9 项通过', '11 项通过')
      .replace(
        'data-rd-fact="f-next" data-rd-step="1"',
        'data-rd-step="1" data-rd-in data-rd-generated="chart"'
      );
    const out = renderReportWeb({
      artifact,
      plan: V4_PLAN,
      evidence: evidence(),
      language: 'zh-CN',
    });
    const facts = out.issues
      .filter(i => i.category === 'facts')
      .map(i => i.evidence)
      .join('\n');
    expect(facts).toContain('Numbers not traceable');
    expect(facts).toContain('11');
    expect(facts).toContain('f-next');
    expect(out.html).not.toMatch(/data-rd-step="1" data-rd-in/);
  });
  it('flattens malformed behaviours instead of shipping broken interaction', () => {
    const artifact = v4Artifact();
    artifact.chapters[1].html = artifact.chapters[1].html.replace(
      '<div data-rd-view="增幅">',
      '<div>'
    );
    const out = renderReportWeb({
      artifact,
      plan: V4_PLAN,
      evidence: evidence(),
      language: 'zh-CN',
    });
    expect(out.behaviors.some(b => b.kind === 'switch')).toBe(false);
    expect(out.issues.some(i => i.evidence.includes('data-rd-switch'))).toBe(
      true
    );
  });
  it('renders compact and desktop chart variants with data tables and fallbacks', () => {
    const chart = renderReportChart(
      {
        id: 'rd-c-x-u',
        dataset: 'ds-revenue',
        mark: 'unit',
        highlight: [],
        sort: 'none',
        valueLabels: 'all',
        takeaway: 'x',
      },
      V4_DATASETS[0],
      'zh-CN'
    );
    expect(chart.mark).toBe('bar');
    expect(chart.fallback).toContain('unit needs');
    expect(chart.html).toContain('rd-chart-d');
    expect(chart.html).toContain('rd-chart-m');
    expect(chart.html).toContain('<summary>查看数据</summary>');
  });
});

describe('report web v4 bundle', () => {
  it('parses shared CSS, chapters and repair headers', () => {
    const bundle = parseReportBundle(
      '```html\n<rd-shared>.rd-a{color:red}</rd-shared>\n<rd-chapter id="rd-c-a"><section data-chapter-id="rd-c-a"><p>x</p></section><style>.rd-b{color:blue}</style></rd-chapter>\n<rd-repair>{"ops":[],"addressed":["m1"],"unresolved":[]}</rd-repair>\n```'
    );
    expect(bundle.errors).toEqual([]);
    expect(bundle.sharedCss).toBe('.rd-a{color:red}');
    expect(bundle.chapters).toEqual([
      {
        id: 'rd-c-a',
        html: '<section data-chapter-id="rd-c-a"><p>x</p></section>',
        css: '.rd-b{color:blue}',
      },
    ]);
    expect(bundle.repair).toEqual({
      ops: [],
      addressed: ['m1'],
      unresolved: [],
    });
  });
});
