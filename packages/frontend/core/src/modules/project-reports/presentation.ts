import {
  type PublicReportNode,
  type ReportChapter,
  type ReportDocument,
  type ReportNode,
  type ReportProjection,
} from '@localmind/office/report';

export type RenderReportNode = ReportNode | PublicReportNode;
export type ReportPage = {
  id: string;
  chapterId: string;
  title: string;
  notes: string;
  nodes: RenderReportNode[];
  layout: ReportChapter['layout'];
};

/** Semantic pagination preserves node IDs and readable density, including long tables. */
export function paginateReport(
  document: ReportDocument | ReportProjection
): ReportPage[] {
  const pages: ReportPage[] = [];
  for (const chapter of document.chapters.filter(
    chapter => !('hidden' in chapter && chapter.hidden)
  )) {
    let nodes: RenderReportNode[] = [];
    let weight = 0;
    let index = 0;
    const flush = () => {
      if (!nodes.length) return;
      pages.push({
        id: `${chapter.id}:${index++}`,
        chapterId: chapter.id,
        title: chapter.title,
        notes: chapter.notes,
        nodes,
        layout: chapter.layout,
      });
      nodes = [];
      weight = 0;
    };
    const add = (node: RenderReportNode, cost: number) => {
      if (weight + cost > 850) flush();
      nodes.push(node);
      weight += cost;
    };
    for (const node of chapter.nodes) {
      if (node.type === 'pageBreak') {
        flush();
        continue;
      }
      if (node.type === 'table') {
        for (let row = 0; row < node.rows.length || row === 0; row += 8) {
          flush();
          add({ ...node, rows: node.rows.slice(row, row + 8) }, 800);
          flush();
        }
      } else if (node.type === 'list' && node.items.join('').length > 600) {
        let items: string[] = [];
        let size = 0;
        for (const item of node.items) {
          if (size + item.length > 600 && items.length) {
            add({ ...node, items }, 850);
            flush();
            items = [];
            size = 0;
          }
          items.push(item);
          size += item.length;
        }
        if (items.length) add({ ...node, items }, Math.max(120, size));
      } else if (
        (node.type === 'paragraph' || node.type === 'callout') &&
        node.text.length > 650
      ) {
        for (let offset = 0; offset < node.text.length; offset += 650) {
          add({ ...node, text: node.text.slice(offset, offset + 650) }, 850);
          flush();
        }
      } else
        add(
          node,
          ['image', 'chart', 'timeline'].includes(node.type)
            ? 650
            : 'text' in node
              ? Math.max(100, node.text.length)
              : 250
        );
    }
    flush();
    // Match the export layout: every visible chapter owns at least one page.
    if (index === 0)
      pages.push({
        id: `${chapter.id}:0`,
        chapterId: chapter.id,
        title: chapter.title,
        notes: chapter.notes,
        nodes: [],
        layout: chapter.layout,
      });
  }
  return pages;
}

export type PresentationMessage = {
  kind: 'report-present';
  reportId: string;
  revisionId: string;
  nonce: string;
  page: number;
  black: boolean;
  laser?: boolean;
  pointer?: { x: number; y: number };
};
export function readPresentationMessage(
  value: unknown,
  expected: Pick<PresentationMessage, 'reportId' | 'revisionId' | 'nonce'>,
  pageCount: number
): PresentationMessage | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<PresentationMessage>;
  if (
    data.kind !== 'report-present' ||
    data.reportId !== expected.reportId ||
    data.revisionId !== expected.revisionId ||
    data.nonce !== expected.nonce ||
    typeof data.page !== 'number' ||
    !Number.isInteger(data.page) ||
    data.page < 0 ||
    data.page >= pageCount ||
    typeof data.black !== 'boolean' ||
    (data.laser !== undefined && typeof data.laser !== 'boolean') ||
    (data.pointer !== undefined &&
      (!data.pointer ||
        typeof data.pointer !== 'object' ||
        !Number.isFinite(data.pointer.x) ||
        !Number.isFinite(data.pointer.y) ||
        data.pointer.x < 0 ||
        data.pointer.x > 100 ||
        data.pointer.y < 0 ||
        data.pointer.y > 100))
  )
    return null;
  return {
    kind: 'report-present',
    ...expected,
    page: data.page,
    black: data.black,
    ...(data.laser !== undefined ? { laser: data.laser } : {}),
    ...(data.pointer
      ? { pointer: { x: data.pointer.x, y: data.pointer.y } }
      : {}),
  };
}

export function presentationKey(key: string, current: number, count: number) {
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(key))
    return Math.min(count - 1, current + 1);
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(key))
    return Math.max(0, current - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return Math.max(0, count - 1);
  return current;
}
