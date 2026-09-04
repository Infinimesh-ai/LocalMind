import type {
  DocxBlock,
  DocxParagraph,
  DocxSection,
  OfficeDocxPage,
} from './types';

const DEFAULT_PAGE = {
  widthPt: 612,
  heightPt: 792,
  margins: {
    topPt: 72,
    rightPt: 72,
    bottomPt: 72,
    leftPt: 72,
  },
};

function paragraphUnits(paragraph: DocxParagraph) {
  const explicitLines = paragraph.text.split('\n').length;
  const wrappedLines = Math.max(1, Math.ceil(paragraph.text.length / 74));
  const heading = paragraph.properties?.outlineLevel !== undefined ? 0.7 : 0;
  return Math.max(explicitLines, wrappedLines) * 1.15 + heading;
}

function blockUnits(block: DocxBlock): number {
  switch (block.type) {
    case 'paragraph':
      return paragraphUnits(block);
    case 'table':
      return Math.max(
        2,
        block.rows.reduce(
          (sum, row) =>
            sum +
            Math.max(
              1.6,
              ...row.cells.map(cell =>
                cell.blocks.reduce(
                  (cellSum, cellBlock) => cellSum + blockUnits(cellBlock),
                  0
                )
              )
            ),
          0
        )
      );
    case 'contentControl':
      return Math.max(
        1,
        block.blocks.reduce((sum, child) => sum + blockUnits(child), 0)
      );
    case 'unsupported':
      return 2;
  }
}

function pageGeometry(section?: DocxSection) {
  const widthPt = section?.pageSize?.widthPt ?? DEFAULT_PAGE.widthPt;
  const heightPt = section?.pageSize?.heightPt ?? DEFAULT_PAGE.heightPt;
  const landscape = section?.pageSize?.orientation === 'landscape';
  return {
    widthPt: landscape ? Math.max(widthPt, heightPt) : widthPt,
    heightPt: landscape ? Math.min(widthPt, heightPt) : heightPt,
    margins: {
      topPt: section?.margins?.topPt ?? DEFAULT_PAGE.margins.topPt,
      rightPt: section?.margins?.rightPt ?? DEFAULT_PAGE.margins.rightPt,
      bottomPt: section?.margins?.bottomPt ?? DEFAULT_PAGE.margins.bottomPt,
      leftPt: section?.margins?.leftPt ?? DEFAULT_PAGE.margins.leftPt,
    },
  };
}

function pageCapacity(page: ReturnType<typeof pageGeometry>) {
  const usableHeight = Math.max(
    144,
    page.heightPt - page.margins.topPt - page.margins.bottomPt
  );
  return usableHeight / 13.8;
}

export function paginateDocxBlocks(
  blocks: readonly DocxBlock[],
  sections: readonly DocxSection[]
): OfficeDocxPage[] {
  const geometry = pageGeometry(sections[0]);
  const capacity = pageCapacity(geometry);
  const pages: OfficeDocxPage[] = [];
  let current: DocxBlock[] = [];
  let used = 0;

  const flush = () => {
    if (!current.length && pages.length) return;
    pages.push({ index: pages.length, blocks: current, ...geometry });
    current = [];
    used = 0;
  };

  for (const block of blocks) {
    const forceBreak =
      block.type === 'paragraph' && block.properties?.pageBreakBefore === true;
    const units = blockUnits(block);
    if ((forceBreak || used + units > capacity) && current.length) flush();
    current.push(block);
    used += units;
  }
  flush();
  return pages;
}
