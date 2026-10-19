import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type ReportArtifact,
  ReportArtifactSchema,
  type ReportIssue,
} from './design';
import { renderReportArtifact, scopeReportCss } from './design-render';
import { wrapDeckHtml } from './shell';

const artifact = (): ReportArtifact => ({
  schemaVersion: 'report-web-v3',
  planHash: 'a'.repeat(64),
  title: '季度进展',
  sharedCss:
    '[data-content-root="rd-custom-v3"]{--rd-accent:#aa3311} .rd-title{font-size:42px} .rd-card{border-radius:8px;background:#efece8}',
  chapters: [
    {
      id: 'rd-c-01',
      html: '<section class="slide" data-slide data-chapter-id="rd-c-01"><h1 class="rd-title">季度进展</h1><p id="rd-c-01-revenue">收入增长 12%</p></section>',
      css: '.rd-title{line-height:1.2}',
      factIds: ['f1'],
      claims: [
        { elementId: 'rd-c-01-revenue', text: '收入增长 12%', factIds: ['f1'] },
      ],
    },
  ],
});

describe('custom report v3', () => {
  it('preserves custom visual rules without legacy blanket overrides and hashes the actual delivered bytes', () => {
    const output = renderReportArtifact(artifact(), 'zh-CN');
    expect(output.issues).toEqual([]);
    expect(output.html).toContain('data-deck-version="3"');
    expect(output.html).toContain('data-content-root="rd-custom-v3"');
    expect(output.html).toContain('font-size:42px');
    expect(output.html).not.toContain('.slide .kicker{display:none}');
    expect(output.html).not.toContain('.slide .card h3{font-size:23px}');
    expect(output.hash).toBe(
      createHash('sha256').update(output.html).digest('hex')
    );
    expect(
      wrapDeckHtml({ title: 'old', lang: 'en', css: '', slidesHtml: '' })
    ).toContain('.slide .kicker{display:none}');
  });
  it('scopes every selector in a comma list and media rule', () => {
    const issues: ReportIssue[] = [];
    const css = scopeReportCss(
      '.rd-a,.rd-b{color:red}@media(max-width:600px){.rd-c{display:grid}}',
      'rd-c-01',
      issues
    );
    expect(issues).toEqual([]);
    expect(css.match(/\[data-chapter-id="rd-c-01"\]/g)).toHaveLength(6);
  });
  it('does not allow shell selectors, unsafe declarations or unknown at-rules', () => {
    const issues: ReportIssue[] = [];
    const css = scopeReportCss(
      'body{display:none}#deck-nav{color:red}.rd-x{position:fixed;color:red!important}@font-face{font-family:x;src:url(https://evil.example/x)}',
      null,
      issues
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/body|deck-nav|fixed|important|evil\.example/);
  });
  it('accepts harmless repair comments while detecting comment-obfuscated external resources', () => {
    const issues: ReportIssue[] = [];
    expect(
      scopeReportCss(
        '/* Typography repair */ .rd-title{font-size:48px}',
        null,
        issues
      )
    ).toContain('font-size:48px');
    expect(issues).toEqual([]);
    const unsafe = scopeReportCss(
      '.rd-title{background:u/**/rl(https://evil.example/x)}',
      null,
      issues
    );
    expect(issues.some(i => i.category === 'security')).toBe(true);
    expect(unsafe).not.toContain('evil.example');
  });
  it('reports sanitizer removals rather than silently delivering a degraded diagram', () => {
    const draft = artifact();
    draft.chapters[0].html = draft.chapters[0].html.replace(
      '</section>',
      '<svg><foreignObject>lost</foreignObject></svg><script>alert(1)</script></section>'
    );
    const result = renderReportArtifact(draft, 'zh-CN');
    expect(result.issues.some(i => i.category === 'security')).toBe(true);
    expect(result.html).not.toContain('alert(1)');
    expect(result.html).not.toContain('foreignObject');
  });
  it('rejects claims missing from actual HTML, duplicate IDs and extra sections', () => {
    const draft = artifact();
    draft.chapters[0].html +=
      '<section data-slide><p id="rd-c-01-revenue">extra</p></section>';
    draft.chapters[0].claims[0].text = '收入增长 99%';
    const result = renderReportArtifact(draft, 'zh-CN');
    expect(result.issues.some(i => i.category === 'facts')).toBe(true);
    expect(
      result.issues.filter(i => i.category === 'structure').length
    ).toBeGreaterThan(0);
  });
  it('applies declaration restrictions to inline styles too', () => {
    const draft = artifact();
    draft.chapters[0].html = draft.chapters[0].html.replace(
      '<h1',
      '<h1 style="position:fixed;color:red"'
    );
    const result = renderReportArtifact(draft, 'zh-CN');
    expect(result.issues.some(i => i.evidence.includes('position'))).toBe(true);
    expect(result.html).not.toContain('style="position:fixed');
  });
  it('does not count SVG accessibility metadata as visible factual evidence', () => {
    for (const elementId of ['rd-c-01-revenue', 'rd-c-01-chart']) {
      const draft = artifact();
      draft.chapters[0].html =
        '<section class="slide" data-slide data-chapter-id="rd-c-01"><h1>季度进展</h1><svg id="rd-c-01-chart" viewBox="0 0 100 100"><title id="rd-c-01-revenue">收入增长 12%</title><rect width="50" height="50" /></svg></section>';
      draft.chapters[0].claims[0].elementId = elementId;
      const output = renderReportArtifact(draft, 'zh-CN');
      expect(output.issues.some(i => i.category === 'facts')).toBe(true);
      expect(output.html).toContain('<title id="rd-c-01-revenue">');
    }
  });
  it('bounds all model output and rejects extra protocol fields', () => {
    expect(
      ReportArtifactSchema.safeParse({ ...artifact(), script: 'x' }).success
    ).toBe(false);
    expect(
      ReportArtifactSchema.safeParse({
        ...artifact(),
        chapters: Array.from({ length: 15 }, () => artifact().chapters[0]),
      }).success
    ).toBe(false);
  });
});

it('rejects sibling escapes after an explicit content root', () => {
  const issues: ReportIssue[] = [];
  const css = scopeReportCss(
    '[data-content-root="rd-custom-v3"] + nav{display:none}',
    null,
    issues
  );
  expect(issues.some(i => i.severity === 'error')).toBe(true);
  expect(css).not.toContain('display:none');
});

it('namespaces chapter animations so later chapters cannot redefine earlier motion', () => {
  const issues: ReportIssue[] = [];
  const one = scopeReportCss(
    '@keyframes rd-enter{from{opacity:.9}to{opacity:1}}.rd-title{animation:rd-enter 1s}',
    'rd-c-one',
    issues
  );
  const two = scopeReportCss(
    '@keyframes rd-enter{from{opacity:.8}to{opacity:1}}.rd-title{animation:rd-enter 2s}',
    'rd-c-two',
    issues
  );
  expect(issues).toEqual([]);
  expect(one).toContain('rd-c-one-rd-enter');
  expect(two).not.toContain('rd-c-one-rd-enter');
});
