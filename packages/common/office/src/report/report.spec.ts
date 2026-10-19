/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { strFromU8, unzipSync } from 'fflate';
import { decodePDFRawStream, PDFDocument, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import {
  applyPptxCommand,
  openPptxPackage,
  readPptxSemanticState,
} from '../pptx';
import { projectReportAudience, reportAudienceAssetBindings } from './audience';
import { reportChartShapes } from './chart';
import {
  createReportDocument,
  creatorResponsibility,
  reportFinalizationIssues,
} from './document';
import { formatReportPeriod, layoutReport } from './layout';
import { mergeReportCandidate } from './merge';
import { renderProjectedReport } from './render';
import {
  type ReportDocument,
  ReportDocumentSchema,
  ReportNodeSchema,
  ReportTemplateSchema,
} from './schema';
import { BUILTIN_REPORT_TEMPLATES } from './templates';

const document = (): ReportDocument => {
  const report = createReportDocument({
    title: '项目汇报 / 專案進度',
    creator: { actorId: 'private-actor', label: '创建者' },
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'Asia/Shanghai',
      weekStartsOn: 1,
    },
    template: BUILTIN_REPORT_TEMPLATES[0].content,
    now: '2026-10-08T00:00:00Z',
  });
  report.chapters = [
    {
      id: 'private-chapter',
      title: '本期成果',
      layout: 'content',
      hidden: false,
      locked: false,
      notes: 'PRIVATE SPEAKER NOTES',
      nodes: ['甲', '乙', '丙'].map((text, index) =>
        ReportNodeSchema.parse({
          id: `private-node-${index}`,
          type: 'paragraph',
          text,
          responsibility: creatorResponsibility(report.creator),
        })
      ),
    },
  ];
  return report;
};
const audience = (
  report: ReportDocument,
  kind: 'external' | 'internal' = 'external'
) => ({
  kind,
  chapterIds: report.chapters.map(chapter => chapter.id),
  includeNotes: true,
  includeSources: false,
});

describe('Project report source and projection contracts', () => {
  it('formats report dates in the explicit project time zone across UTC day boundaries', () => {
    const period = {
      start: '2026-10-04T16:00:00Z',
      end: '2026-10-11T16:00:00Z',
      timeZone: 'Asia/Shanghai',
      weekStartsOn: 1,
    };
    const label = formatReportPeriod(period, 'zh-Hans');
    expect(label).toContain('2026年10月5日');
    expect(label).toContain('2026年10月12日');
    expect(label).toContain('Asia/Shanghai');
    expect(label).not.toContain('T16:00');
  });
  it('remaps public identities and rejects future fields even when passed by an untyped caller', () => {
    const report = document();
    Object.assign(report.chapters[0].nodes[0], {
      debug: 'SECRET-FUTURE',
      internalPath: '/private/path',
    });
    report.assets = [
      {
        id: 'private-asset',
        blobKey: 'private-blob',
        mimeType: 'image/png',
        alt: 'logo',
      },
    ];
    report.theme.logoAssetId = 'private-asset';
    const projection = projectReportAudience(report, audience(report));
    const serialized = JSON.stringify(projection);
    for (const secret of [
      'private-actor',
      'private-node',
      'private-chapter',
      'private-asset',
      'private-blob',
      '/private/path',
      'SECRET-FUTURE',
      'PRIVATE SPEAKER NOTES',
    ])
      expect(serialized).not.toContain(secret);
    expect(projection.theme.logoAssetId).toBe('asset-1');
    expect(reportAudienceAssetBindings(report, audience(report))[0]).toEqual({
      publicId: 'asset-1',
      asset: report.assets[0],
    });
  });
  it('never exports hidden chapters and restricts notes to an internal opt-in', () => {
    const report = document();
    report.chapters.push({
      ...report.chapters[0],
      id: 'hidden',
      hidden: true,
      title: 'SECRET-HIDDEN',
      nodes: [],
    });
    expect(
      JSON.stringify(projectReportAudience(report, audience(report)))
    ).not.toContain('SECRET-HIDDEN');
    expect(
      projectReportAudience(report, audience(report, 'internal')).chapters[0]
        .notes
    ).toBe('PRIVATE SPEAKER NOTES');
  });
  it('does not allow a default owner drift or a resolved hard error at finalization', () => {
    const report = document();
    report.responsibility.identity = {
      kind: 'member',
      actorId: 'editor',
      label: 'Editor',
    };
    expect(ReportDocumentSchema.safeParse(report).success).toBe(false);
    report.responsibility = creatorResponsibility(report.creator);
    report.issues.push({
      id: 'bad-ref',
      kind: 'invalid_reference',
      message: 'bad reference',
      nodeIds: [],
      sourceIds: [],
      resolution: {
        actorId: 'editor',
        note: 'ignore',
        resolvedAt: report.cutoffAt,
      },
    });
    expect(reportFinalizationIssues(report)).toContain('bad-ref');
  });
  it('requires authorized template assets and unique stable keys', () => {
    const template = structuredClone(BUILTIN_REPORT_TEMPLATES[0].content);
    template.theme.logoAssetId = 'missing';
    expect(ReportTemplateSchema.safeParse(template).success).toBe(false);
    delete template.theme.logoAssetId;
    template.chapters.push(template.chapters[0]);
    expect(ReportTemplateSchema.safeParse(template).success).toBe(false);
  });
  it('validates calculated values, denominator, source and duplicated ratio terms, including finite-input overflow', () => {
    const report = document();
    report.sources = [
      {
        id: 'evidence',
        resourceId: 'resource',
        title: 'Document evidence',
        kind: 'document',
        revision: 'revision',
        fingerprint: 'fingerprint',
        capturedAt: report.cutoffAt,
        locator: 'table',
        status: 'parsed',
      },
    ];
    const metric = ReportNodeSchema.parse({
      id: 'metric',
      type: 'metric',
      label: 'Completion',
      unit: '%',
      value: 75,
      claimKind: 'calculation',
      sourceIds: ['evidence'],
      numerator: 3,
      denominator: 4,
      formula: '3 / 4 × 100',
      calculation: { kind: 'ratio', numerator: 3, denominator: 4, scale: 100 },
    });
    report.chapters[0].nodes = [metric];
    expect(ReportDocumentSchema.safeParse(report).success).toBe(true);
    for (const patch of [
      { value: 74 },
      { value: null },
      { numerator: 2 },
      { denominator: 5 },
      { sourceIds: [] },
      { formula: '' },
      {
        calculation: {
          kind: 'ratio',
          numerator: 3,
          denominator: 0,
          scale: 100,
        },
      },
      {
        calculation: {
          kind: 'ratio',
          numerator: 1e308,
          denominator: 1e-308,
          scale: 100,
        },
      },
      { calculation: { kind: 'sum', values: [1e308, 1e308] } },
    ]) {
      const invalid = structuredClone(report);
      Object.assign(invalid.chapters[0].nodes[0], patch);
      expect(ReportDocumentSchema.safeParse(invalid).success).toBe(false);
    }
    report.sources[0].status = 'failed';
    expect(ReportDocumentSchema.safeParse(report).success).toBe(false);
  });
  it('keeps document and work-order business-state claims on their own evidence kinds', () => {
    const report = document();
    const source = (
      id: string,
      kind: 'document' | 'work_order' | 'memory'
    ) => ({
      id,
      resourceId: `${id}-resource`,
      title: id,
      kind,
      revision: kind === 'work_order' ? 'delivered:3:1' : '1',
      fingerprint: 'f'.repeat(64),
      capturedAt: report.cutoffAt,
      locator: kind === 'work_order' ? 'work-order:3' : 'revision:1',
      status: 'parsed' as const,
    });
    report.sources = [
      source('doc', 'document'),
      source('order', 'work_order'),
      source('memory', 'memory'),
    ];
    const claim = (claimKind: string, sourceIds: string[]) => {
      const candidate = structuredClone(report);
      candidate.chapters[0].nodes = [
        ReportNodeSchema.parse({
          id: 'claim',
          type: 'paragraph',
          text: '工单「验收」当前状态：已交付完成。',
          claimKind,
          sourceIds,
        }),
      ];
      return ReportDocumentSchema.safeParse(candidate).success;
    };
    expect(claim('business_state', ['order'])).toBe(true);
    expect(claim('document', ['doc'])).toBe(true);
    expect(claim('inference', ['doc', 'order'])).toBe(true);
    expect(claim('document', ['order'])).toBe(false);
    expect(claim('document', ['memory'])).toBe(false);
    expect(claim('business_state', ['doc'])).toBe(false);
    expect(claim('business_state', ['order', 'doc'])).toBe(false);
    expect(claim('business_state', ['memory'])).toBe(false);
    report.sources[1].status = 'omitted';
    expect(claim('business_state', ['order'])).toBe(false);
  });
});

describe('Project report three-way merge', () => {
  it('merges candidate inserts, deletions and reorders while preserving unrelated manual edits', () => {
    const base = document(),
      current = structuredClone(base),
      candidate = structuredClone(base);
    current.chapters[0].notes = 'MANUAL NOTES';
    candidate.chapters[0].nodes = [
      candidate.chapters[0].nodes[2],
      ReportNodeSchema.parse({ id: 'new', type: 'paragraph', text: 'new' }),
      candidate.chapters[0].nodes[0],
    ];
    const result = mergeReportCandidate(base, current, candidate);
    expect(result.conflicts).toEqual([]);
    expect(result.document.chapters[0].nodes.map(node => node.id)).toEqual([
      'private-node-2',
      'new',
      'private-node-0',
    ]);
    expect(result.document.chapters[0].notes).toBe('MANUAL NOTES');
  });
  it('detects content/delete conflicts and supports an explicit choice without losing current work', () => {
    const base = document(),
      current = structuredClone(base),
      candidate = structuredClone(base);
    Object.assign(current.chapters[0].nodes[0], { text: 'manual' });
    candidate.chapters[0].nodes.shift();
    const conflict = mergeReportCandidate(base, current, candidate);
    expect(conflict.conflicts).toContain('delete:private-node-0');
    expect(conflict.document.chapters[0].nodes[0]).toMatchObject({
      text: 'manual',
    });
    const resolved = mergeReportCandidate(base, current, candidate, {
      resolutions: { 'delete:private-node-0': 'candidate' },
    });
    expect(resolved.conflicts).toEqual([]);
    expect(
      resolved.document.chapters[0].nodes.map(node => node.id)
    ).not.toContain('private-node-0');
  });
  it('prevents delete, content and reorder changes from bypassing a locked node', () => {
    const base = document();
    base.chapters[0].nodes[0].locked = true;
    const candidate = structuredClone(base);
    candidate.chapters[0].nodes.shift();
    const result = mergeReportCandidate(base, base, candidate, {
      resolutions: { 'locked:private-node-0': 'candidate' },
    });
    expect(result.conflicts).toContain('locked:private-node-0');
    expect(result.document.chapters[0].nodes[0].id).toBe('private-node-0');
  });
  it('treats a rejected chapter deletion atomically and preserves all manually edited children', () => {
    const base = document(),
      current = structuredClone(base),
      candidate = structuredClone(base);
    current.chapters[0].notes = 'Manual context';
    candidate.chapters = [];
    const result = mergeReportCandidate(base, current, candidate);
    expect(result.conflicts).toContain('delete:private-chapter');
    expect(result.document.chapters[0]).toEqual(current.chapters[0]);
    const resolved = mergeReportCandidate(base, current, candidate, {
      resolutions: { 'delete:private-chapter': 'candidate' },
    });
    expect(resolved.document.chapters).toEqual([]);
  });
  it('moves nodes between chapters by stable identity and rejects moves outside scope', () => {
    const base = document();
    base.chapters.push({ ...base.chapters[0], id: 'other', nodes: [] });
    const candidate = structuredClone(base);
    candidate.chapters[1].nodes.push(candidate.chapters[0].nodes.shift()!);
    expect(
      mergeReportCandidate(base, base, candidate).document.chapters[1].nodes[0]
        .id
    ).toBe('private-node-0');
    const scoped = mergeReportCandidate(base, base, candidate, {
      chapterIds: ['private-chapter'],
    });
    expect(scoped.conflicts).toContain('outside_scope:private-node-0');
    expect(scoped.document.chapters[1].nodes).toEqual([]);
  });
});

const font = {
  bytes: readFileSync(
    new URL(
      '../../assets/report-fonts/NotoSansCJKsc-Regular.otf',
      import.meta.url
    )
  ),
  license: readFileSync(
    new URL('../../assets/report-fonts/LICENSE.txt', import.meta.url),
    'utf8'
  ),
};
const fixture = () => {
  const report = document();
  report.chapters[0].nodes = [
    ReportNodeSchema.parse({
      id: 'heading',
      type: 'heading',
      text: '中文正文 / 繁體匯報',
    }),
    ReportNodeSchema.parse({
      id: 'table',
      type: 'table',
      columns: ['成员', '状态'],
      rows: [
        ['张三', '已完成'],
        ['李四', '进行中'],
      ],
    }),
    ReportNodeSchema.parse({
      id: 'chart',
      type: 'chart',
      chartType: 'bar',
      title: '交付数量',
      labels: ['本期', '上期'],
      series: [{ label: '完成', values: [3, 2] }],
      unit: '项',
      methodology: '按文档记载统计',
    }),
  ];
  report.chapters.push({
    ...report.chapters[0],
    id: 'private-hidden',
    hidden: true,
    title: 'SECRET-HIDDEN-TITLE',
    notes: 'SECRET-HIDDEN-NOTES',
    nodes: [
      ReportNodeSchema.parse({
        id: 'hidden-node',
        type: 'paragraph',
        text: 'SECRET-HIDDEN-BODY',
      }),
    ],
  });
  return report;
};
describe('Project report native exports', () => {
  it('creates searchable CJK PDF with an embedded Unicode font', async () => {
    const report = fixture();
    const result = await renderProjectedReport({
      projection: projectReportAudience(report, audience(report)),
      format: 'pdf',
      assets: new Map(),
      font,
    });
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(result.pageCount);
    const streams = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, value]) =>
        value instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
          : []
      );
    expect(
      streams.some(
        value =>
          value.includes('begincmap') &&
          /4e2d/i.test(value) &&
          /7e41/i.test(value)
      )
    ).toBe(true);
    expect(new TextDecoder().decode(result.bytes).includes('/FontFile3')).toBe(
      true
    );
    const extracted = await getDocument({
      data: new Uint8Array(result.bytes),
      useSystemFonts: false,
    }).promise;
    const allText: string[] = [];
    for (let index = 1; index <= extracted.numPages; index++) {
      const page = await extracted.getPage(index);
      const content = await page.getTextContent();
      allText.push(
        content.items
          .flatMap(item => ('str' in item ? [item.str] : []))
          .join('')
      );
    }
    expect(allText.join('')).toContain('中文正文 / 繁體匯報');
    expect(allText.join('')).toContain('张三');
    expect(allText.join('')).not.toMatch(
      /SECRET-HIDDEN|PRIVATE SPEAKER NOTES|private-/
    );
    const metadata = await extracted.getMetadata();
    expect(JSON.stringify(metadata)).not.toMatch(
      /SECRET-HIDDEN|PRIVATE SPEAKER NOTES|private-/
    );
    await extracted.destroy();
    // The complete CJK font is deliberately embedded, including on slow Linux CI.
  }, 60000);
  it('emits native editable table/chart/text and only chart data in the embedded workbook', async () => {
    const report = fixture();
    const result = await renderProjectedReport({
      projection: projectReportAudience(report, audience(report, 'internal')),
      format: 'pptx',
      assets: new Map(),
      font,
    });
    const entries = unzipSync(result.bytes);
    const slides = Object.entries(entries)
      .filter(([key]) => /^ppt\/slides\/slide\d+\.xml$/.test(key))
      .map(([, bytes]) => strFromU8(bytes))
      .join('');
    expect(slides).toContain('<a:tbl>');
    expect(slides).toContain(
      'http://schemas.openxmlformats.org/drawingml/2006/table'
    );
    expect(slides).toContain('<c:chart');
    expect(slides).toContain('<a:t>中文正文 / 繁體匯報</a:t>');
    expect(slides).toContain('<a:t>交付数量</a:t>');
    expect(strFromU8(entries['ppt/charts/chart1.xml'])).toContain(
      '<c:barChart>'
    );
    const workbook = unzipSync(entries['ppt/embeddings/data1.xlsx']);
    expect(strFromU8(workbook['xl/worksheets/sheet1.xml'])).toContain('本期');
    expect(strFromU8(workbook['xl/worksheets/sheet1.xml'])).not.toContain(
      '张三'
    );
    expect(
      Object.entries(entries).some(
        ([path, bytes]) =>
          path.startsWith('ppt/notesSlides/') &&
          strFromU8(bytes).includes('PRIVATE SPEAKER NOTES')
      )
    ).toBe(true);
    const editable = openPptxPackage(result.bytes);
    const original = readPptxSemanticState(editable);
    const slide = original.slides[0];
    const shape = slide.shapes.find(item => item.text);
    expect(shape).toBeDefined();
    const edited = applyPptxCommand(editable, {
      version: 'localmind-office-command/v1',
      commandId: 'report-edit',
      idempotencyKey: 'report-edit',
      artifactId: 'report-artifact',
      expectedRevisionId: 'report-revision',
      source: 'ai',
      operation: 'office.presentation.shape.text.set',
      target: { type: 'shape', slideId: slide.id, shapeId: shape!.id },
      text: '已编辑并重新打开 / 已編輯',
    });
    const reopened = readPptxSemanticState(
      openPptxPackage(edited.packageBytes)
    );
    expect(
      reopened.slides[0].shapes.find(item => item.id === shape!.id)?.text
    ).toBe('已编辑并重新打开 / 已編輯');
    const savedEntries = unzipSync(edited.packageBytes);
    expect(savedEntries['ppt/charts/chart1.xml']).toEqual(
      entries['ppt/charts/chart1.xml']
    );
    expect(savedEntries['ppt/embeddings/data1.xlsx']).toEqual(
      entries['ppt/embeddings/data1.xlsx']
    );
  }, 15000);
  it('creates an offline package with bundled font, no excluded notes or internal IDs, and escaped hostile text', async () => {
    const report = fixture();
    Object.assign(report.chapters[0].nodes[0], {
      text: '</script><script>alert(1)</script>',
    });
    const result = await renderProjectedReport({
      projection: projectReportAudience(report, audience(report)),
      format: 'offline',
      assets: new Map(),
      font,
    });
    const entries = unzipSync(result.bytes);
    expect(entries['fonts/report.otf'].length).toBeGreaterThan(1_000_000);
    expect(entries['fonts/LICENSE.txt']).toBeDefined();
    const page = strFromU8(entries['index.html']);
    expect(page).toContain('&lt;/script&gt;');
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('PRIVATE SPEAKER NOTES');
    expect(page).not.toContain('private-');
    expect(
      Object.values(entries)
        .filter(bytes => bytes.length < 1_000_000)
        .map(bytes => strFromU8(bytes))
        .join('')
    ).not.toContain('SECRET-HIDDEN');
    expect(page).toContain("connect-src 'none'");
  }, 15000);
  it('preserves chart null gaps and negative values without inventing zeroes', async () => {
    const report = fixture();
    report.chapters[0].nodes = [
      ReportNodeSchema.parse({
        id: 'chart-null',
        type: 'chart',
        chartType: 'line',
        title: 'Observed values',
        labels: ['before', '=WEBSERVICE("https://invalid.example/")', 'after'],
        series: [{ label: 'Actual', values: [-2, null, 3] }],
        unit: 'items',
        methodology: 'Missing values remain unknown',
      }),
    ];
    const projection = projectReportAudience(report, audience(report));
    const chart = projection.chapters[0].nodes[0];
    if (chart.type !== 'chart') throw new Error('Expected chart');
    const line = reportChartShapes(chart, 500, 300, '#000000').find(
      shape => shape.type === 'path' && shape.stroke === '#315f8c'
    );
    expect(line?.type === 'path' && line.d.match(/M /g)).toHaveLength(2);
    expect(line?.type === 'path' && line.d).not.toContain(' L');
    const extreme = structuredClone(chart);
    extreme.series[0].values = [-1e308, null, 1e308];
    expect(
      JSON.stringify(reportChartShapes(extreme, 500, 300, '#000000'))
    ).not.toMatch(/NaN|Infinity/);
    extreme.chartType = 'pie';
    extreme.series[0].values = [1e308, null, 1e308];
    const pie = reportChartShapes(extreme, 500, 300, '#000000');
    expect(pie.filter(shape => shape.type === 'path')).toHaveLength(2);
    expect(JSON.stringify(pie)).not.toMatch(/NaN|Infinity/);
    const exported = await renderProjectedReport({
      projection,
      format: 'pptx',
      assets: new Map(),
      font,
    });
    const files = unzipSync(exported.bytes);
    const xml = strFromU8(files['ppt/charts/chart1.xml']);
    expect(xml).toContain('<c:v>-2</c:v>');
    expect(xml).toContain('<c:v>3</c:v>');
    expect(xml).not.toContain('<c:pt idx="1"><c:v>0</c:v>');
    expect(xml).toContain('<c:dispBlanksAs val="gap"/>');
    const workbook = unzipSync(files['ppt/embeddings/data1.xlsx']);
    const values = strFromU8(workbook['xl/worksheets/sheet1.xml']);
    expect(values).not.toMatch(/<c r="B3"[^>]*><v>0<\/v>/);
    expect(values).toContain(
      '=WEBSERVICE(&quot;https://invalid.example/&quot;)'
    );
    expect(values).not.toContain('<f>');
    expect(
      Object.values(workbook)
        .map(bytes => strFromU8(bytes))
        .join('')
    ).not.toContain('TargetMode="External"');
    expect(
      Object.values(files)
        .filter(bytes => bytes.length < 1_000_000)
        .map(bytes => strFromU8(bytes))
        .join('')
    ).not.toMatch(/SECRET-HIDDEN|PRIVATE SPEAKER NOTES|private-/);
  }, 15000);
  it('enforces the 100-page budget including its cover and preserves every dense-chart data value', () => {
    const report = document();
    report.chapters[0].nodes = Array.from({ length: 99 }, (_, index) => [
      ReportNodeSchema.parse({
        id: `p-${index}`,
        type: 'paragraph',
        text: `Page ${index}`,
      }),
      ...(index < 98
        ? [ReportNodeSchema.parse({ id: `break-${index}`, type: 'pageBreak' })]
        : []),
    ]).flat();
    expect(
      layoutReport(projectReportAudience(report, audience(report))).slides
    ).toHaveLength(100);
    report.chapters[0].nodes.push(
      ReportNodeSchema.parse({ id: 'extra-break', type: 'pageBreak' })
    );
    expect(() =>
      layoutReport(projectReportAudience(report, audience(report)))
    ).toThrow('REPORT_PAGE_LIMIT_EXCEEDED');
    const dense = fixture();
    const chart = dense.chapters[0].nodes.find(node => node.type === 'chart');
    if (!chart || chart.type !== 'chart')
      throw new Error('Missing chart fixture');
    chart.labels = Array.from(
      { length: 20 },
      (_, index) => `完整数据标签${index}`
    );
    chart.series[0].values = chart.labels.map((_, index) => index);
    const tables = layoutReport(projectReportAudience(dense, audience(dense)))
      .slides.flatMap(slide => slide.elements)
      .filter(element => element.type === 'table');
    expect(
      tables
        .flatMap(table => table.rows)
        .some(row => row.includes('完整数据标签19') && row.includes('19'))
    ).toBe(true);
  });
  it('splits long CJK text semantically and rejects excess pages without clipping', () => {
    const report = document();
    Object.assign(report.chapters[0].nodes[0], { text: '长内容'.repeat(600) });
    const layout = layoutReport(
      projectReportAudience(report, audience(report))
    );
    expect(layout.slides.length).toBeGreaterThan(1);
    expect(
      layout.slides
        .flatMap(slide => slide.elements)
        .every(element => element.y + element.height <= layout.height - 44)
    ).toBe(true);
  });
});
