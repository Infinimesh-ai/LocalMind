import {
  docxPageGeometry,
  docxSectionNeedsPage,
  docxSectionNeedsParityPage,
  docxSectionRanges,
} from '@localmind/office/docx';

import type {
  DocxBlock,
  DocxParagraph,
  DocxSection,
  OfficeDocxPage,
} from './types';

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

function pageCapacity(page: ReturnType<typeof docxPageGeometry>) {
  const usableHeight = Math.max(
    144,
    page.heightPt - page.margins.topPt - page.margins.bottomPt
  );
  return usableHeight / 13.8;
}

export function paginateDocxBlocks(
  blocks: readonly DocxBlock[],
  sections: readonly DocxSection[],
  measuredHeights: ReadonlyMap<string, number> = new Map()
): OfficeDocxPage[] {
  const pages: OfficeDocxPage[] = [];
  let geometry = docxPageGeometry(sections[0]);
  let current: DocxBlock[] = [];
  let used = 0;
  let sectionIndex = 0;
  let pageSectionIndex = 0;
  let sectionPageIndex = 0;

  const flush = () => {
    pages.push({
      index: pages.length,
      sectionIndex: pageSectionIndex,
      sectionPageIndex,
      blocks: current,
      ...geometry,
    });
    current = [];
    used = 0;
    sectionPageIndex++;
    pageSectionIndex = sectionIndex;
    geometry = docxPageGeometry(sections[sectionIndex]);
  };

  for (const range of docxSectionRanges(blocks, sections)) {
    const section = sections[range.sectionIndex];
    if (range.sectionIndex !== sectionIndex) {
      const nextGeometry = docxPageGeometry(section);
      const requiresPage =
        docxSectionNeedsPage(section) ||
        nextGeometry.widthPt !== geometry.widthPt ||
        nextGeometry.heightPt !== geometry.heightPt;
      if (requiresPage) {
        flush();
        if (docxSectionNeedsParityPage(section, pages.length + 1)) flush();
        geometry = nextGeometry;
        pageSectionIndex = range.sectionIndex;
      }
      sectionIndex = range.sectionIndex;
      sectionPageIndex = 0;
    }
    for (const block of range.blocks) {
      const forceBreak =
        block.type === 'paragraph' &&
        block.properties?.pageBreakBefore === true;
      const measured = measuredHeights.get(block.id);
      const units = measured ? (measured * 0.75) / 13.8 : blockUnits(block);
      if (
        (forceBreak || used + units > pageCapacity(geometry)) &&
        current.length
      )
        flush();
      current.push(block);
      used += units;
    }
  }
  if (
    current.length ||
    !pages.length ||
    pages.at(-1)?.sectionIndex !== sectionIndex
  )
    flush();
  return pages;
}
