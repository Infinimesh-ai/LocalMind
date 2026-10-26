import type { DocxBlock, DocxSection, DocxSemanticState } from './semantic';

/** Section properties terminate a section; their type governs its start. */
export function docxSectionRanges(
  blocks: readonly DocxBlock[],
  sections: readonly DocxSection[]
) {
  const ranges: Array<{ sectionIndex: number; blocks: DocxBlock[] }> = [];
  let sectionIndex = 0;
  let current: DocxBlock[] = [];
  for (const block of blocks) {
    current.push(block);
    if (block.id === sections[sectionIndex]?.endParagraphId) {
      ranges.push({ sectionIndex, blocks: current });
      current = [];
      sectionIndex++;
    }
  }
  if (current.length || !ranges.length || sectionIndex < sections.length) {
    ranges.push({ sectionIndex, blocks: current });
  }
  return ranges;
}

export function docxPageGeometry(section?: DocxSection) {
  const widthPt = section?.pageSize?.widthPt ?? 612;
  const heightPt = section?.pageSize?.heightPt ?? 792;
  const landscape = section?.pageSize?.orientation === 'landscape';
  return {
    widthPt: landscape ? Math.max(widthPt, heightPt) : widthPt,
    heightPt: landscape ? Math.min(widthPt, heightPt) : heightPt,
    margins: {
      topPt: section?.margins?.topPt ?? 72,
      rightPt: section?.margins?.rightPt ?? 72,
      bottomPt: section?.margins?.bottomPt ?? 72,
      leftPt: section?.margins?.leftPt ?? 72,
    },
  };
}

export function docxSectionNeedsPage(section?: DocxSection) {
  return section?.type !== 'continuous' && section?.type !== 'nextColumn';
}

export function docxSectionNeedsParityPage(
  section: DocxSection | undefined,
  nextPageNumber: number
) {
  return (
    (section?.type === 'oddPage' && nextPageNumber % 2 === 0) ||
    (section?.type === 'evenPage' && nextPageNumber % 2 === 1)
  );
}

export function docxSectionStory(
  state: DocxSemanticState,
  sectionIndex: number,
  kind: 'header' | 'footer',
  firstPage = false
) {
  const type =
    firstPage && state.sections[sectionIndex]?.titlePage ? 'first' : 'default';
  for (let index = sectionIndex; index >= 0; index--) {
    const section = state.sections[index];
    const reference = (
      kind === 'header' ? section?.headerReferences : section?.footerReferences
    )?.find(item => (item.type ?? 'default') === type);
    if (reference)
      return state.stories.find(
        story => story.kind === kind && story.part === reference.part
      );
  }
  return undefined;
}
