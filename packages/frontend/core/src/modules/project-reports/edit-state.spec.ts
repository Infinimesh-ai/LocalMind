import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  projectReportAudience,
  ReportNodeSchema,
} from '@localmind/office/report';
import { describe, expect, it } from 'vitest';

import {
  mergeLocalReportDocument,
  newReportNode,
  ReportEditHistory,
} from './edit-state';
import {
  paginateReport,
  presentationKey,
  readPresentationMessage,
} from './presentation';

function fixture() {
  const doc = createReportDocument({
    title: '报告',
    creator: { actorId: 'creator', label: '创建者' },
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'Asia/Shanghai',
      weekStartsOn: 1,
    },
    template: BUILTIN_REPORT_TEMPLATES[0].content,
    now: '2026-10-08T00:00:00Z',
  });
  doc.chapters = [
    {
      id: 'chapter',
      title: '成果',
      hidden: false,
      locked: false,
      layout: 'content',
      notes: 'PRIVATE NOTES',
      nodes: [
        ReportNodeSchema.parse({
          id: 'one',
          type: 'paragraph',
          text: 'original',
        }),
        ReportNodeSchema.parse({
          id: 'two',
          type: 'paragraph',
          text: 'second',
        }),
      ],
    },
  ];
  return doc;
}
describe('report editing and reconnect', () => {
  it('creates every supported editable node and leaves missing metric values unknown', () => {
    for (const type of [
      'heading',
      'paragraph',
      'list',
      'table',
      'metric',
      'timeline',
      'image',
      'chart',
      'callout',
      'pageBreak',
    ] as const)
      expect(ReportNodeSchema.safeParse(newReportNode(type)).success).toBe(
        true
      );
    expect(newReportNode('metric')).toMatchObject({
      value: null,
      claimKind: 'manual',
    });
  });
  it('keeps independent remote and unsaved local changes', () => {
    const base = fixture(),
      current = structuredClone(base),
      local = structuredClone(base);
    current.title = 'Remote title';
    local.chapters[0].title = 'Local chapter';
    const result = mergeLocalReportDocument(base, current, local);
    expect(result.conflicts).toEqual([]);
    expect(result.document.title).toBe('Remote title');
    expect(result.document.chapters[0].title).toBe('Local chapter');
  });
  it('requires an explicit choice for overlapping edits and deletion against an edit', () => {
    const base = fixture(),
      current = structuredClone(base),
      local = structuredClone(base);
    current.chapters[0].nodes = [];
    local.chapters[0].nodes[0] = ReportNodeSchema.parse({
      id: 'one',
      type: 'paragraph',
      text: 'unsaved text',
    });
    const conflict = mergeLocalReportDocument(base, current, local);
    expect(conflict.conflicts).toContain('chapters[chapter].nodes[one]');
    const resolved = mergeLocalReportDocument(base, current, local, {
      'chapters[chapter].nodes[one]': 'local',
    });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.document.chapters[0].nodes).toMatchObject([
      { id: 'one', text: 'unsaved text' },
    ]);
  });
  it('detects conflicting order without duplicating identities', () => {
    const base = fixture();
    base.chapters[0].nodes.push(
      ReportNodeSchema.parse({ id: 'three', type: 'paragraph', text: 'third' })
    );
    const current = structuredClone(base),
      local = structuredClone(base);
    current.chapters[0].nodes.reverse();
    local.chapters[0].nodes = [
      local.chapters[0].nodes[1],
      local.chapters[0].nodes[0],
      local.chapters[0].nodes[2],
    ];
    const result = mergeLocalReportDocument(base, current, local);
    expect(result.conflicts).toContain('chapters[chapter].nodes.$order');
    expect(
      new Set(result.document.chapters[0].nodes.map(node => node.id)).size
    ).toBe(3);
  });
  it('undoes, redoes and discards redo after a new edit', () => {
    const doc = fixture(),
      history = new ReportEditHistory(doc);
    history.change({ ...doc, title: 'changed' });
    expect(history.undo().title).toBe(doc.title);
    expect(history.redo().title).toBe('changed');
    history.undo();
    history.change({ ...doc, title: 'new' });
    expect(history.canRedo).toBe(false);
  });
});
describe('fixed revision presentation', () => {
  it('keeps long table rows and node anchors while splitting pages', () => {
    const doc = fixture();
    doc.chapters[0].nodes = [
      ReportNodeSchema.parse({
        id: 'table',
        type: 'table',
        columns: ['value'],
        rows: Array.from({ length: 25 }, (_, index) => [String(index)]),
      }),
    ];
    const pages = paginateReport(doc);
    expect(pages).toHaveLength(4);
    expect(
      pages.flatMap(page =>
        page.nodes.flatMap(node => (node.type === 'table' ? node.rows : []))
      )
    ).toHaveLength(25);
    expect(pages.every(page => page.nodes[0].id === 'table')).toBe(true);
  });
  it('gives every visible chapter a page even before it has content', () => {
    const doc = fixture();
    doc.chapters = [
      { ...doc.chapters[0], id: 'empty', title: '空章节', nodes: [] },
      { ...doc.chapters[0], id: 'hidden', hidden: true, nodes: [] },
    ];
    const pages = paginateReport(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ chapterId: 'empty', nodes: [] });
  });
  it('does not put speaker notes in audience data or messages', () => {
    const doc = fixture();
    const projection = projectReportAudience(doc, {
      kind: 'external',
      chapterIds: ['chapter'],
      includeNotes: true,
      includeSources: false,
    });
    expect(JSON.stringify(paginateReport(projection))).not.toContain(
      'PRIVATE NOTES'
    );
    const identity = {
      reportId: 'report',
      revisionId: 'fixed',
      nonce: 'secret',
    };
    const value = {
      kind: 'report-present',
      ...identity,
      page: 0,
      black: false,
      notes: 'PRIVATE NOTES',
    };
    expect(
      JSON.stringify(readPresentationMessage(value, identity, 2))
    ).not.toContain('PRIVATE NOTES');
    expect(
      readPresentationMessage({ ...value, revisionId: 'new' }, identity, 2)
    ).toBeNull();
    expect(
      readPresentationMessage({ ...value, page: 2 }, identity, 2)
    ).toBeNull();
    expect(
      readPresentationMessage({ ...value, nonce: 'other' }, identity, 2)
    ).toBeNull();
  });
  it('bounds keyboard navigation', () => {
    expect(presentationKey('ArrowRight', 1, 2)).toBe(1);
    expect(presentationKey('ArrowLeft', 0, 2)).toBe(0);
    expect(presentationKey('Home', 5, 10)).toBe(0);
    expect(presentationKey('End', 0, 10)).toBe(9);
  });
});
