import { describe, expect, test } from 'vitest';

import { paginateDocxBlocks } from './docx-layout';
import type { DocxBlock, DocxSection } from './types';

const paragraph = (
  id: string,
  text: string,
  pageBreakBefore = false
): DocxBlock => ({
  type: 'paragraph',
  id,
  text,
  runs: [{ content: [{ type: 'text', text }] }],
  fields: [],
  bookmarks: [],
  properties: pageBreakBefore ? { pageBreakBefore: true } : undefined,
});

describe('paginateDocxBlocks', () => {
  const sections = (type?: string): DocxSection[] => [
    {
      index: 0,
      endParagraphId: 'p1',
      headerReferences: [],
      footerReferences: [],
    },
    {
      index: 1,
      endParagraphId: null,
      type,
      headerReferences: [],
      footerReferences: [],
    },
  ];
  test('starts the following section on a new page even without an explicit type', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'First'), paragraph('p2', 'Second')],
      sections()
    );
    expect(
      pages.map(page => [page.sectionIndex, page.blocks.map(block => block.id)])
    ).toEqual([
      [0, ['p1']],
      [1, ['p2']],
    ]);
  });
  test('keeps continuous sections on the same physical page', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'First'), paragraph('p2', 'Second')],
      sections('continuous')
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks.map(block => block.id)).toEqual(['p1', 'p2']);
  });
  test.each([
    ['oddPage', 3],
    ['evenPage', 2],
  ])('honors %s section parity', (type, count) => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'First'), paragraph('p2', 'Second')],
      sections(type as string)
    );
    expect(pages).toHaveLength(count as number);
    expect(pages.at(-1)?.blocks[0].id).toBe('p2');
    if (type === 'oddPage') expect(pages[1].blocks).toEqual([]);
  });
  test('keeps each section paper size and margins without double breaking', () => {
    const values = sections('nextPage');
    values[1].pageSize = {
      widthPt: 842,
      heightPt: 595,
      orientation: 'landscape',
    };
    values[1].margins = { leftPt: 36, rightPt: 40, topPt: 42, bottomPt: 48 };
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'First'), paragraph('p2', 'Second', true)],
      values
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].widthPt).toBe(612);
    expect(pages[1]).toMatchObject({
      widthPt: 842,
      heightPt: 595,
      margins: { leftPt: 36, rightPt: 40, topPt: 42, bottomPt: 48 },
    });
  });
  test('retains an empty final next-page section', () => {
    const pages = paginateDocxBlocks([paragraph('p1', 'First')], sections());
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks).toEqual([]);
  });
  test('uses measured paragraph height when fonts or wrapping make estimates inaccurate', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'Short text with large font'), paragraph('p2', 'Next')],
      [],
      new Map([
        ['p1', 900],
        ['p2', 60],
      ])
    );
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks[0].id).toBe('p2');
  });
  test('keeps short content on one page', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'Alpha'), paragraph('p2', 'Beta')],
      []
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toHaveLength(2);
  });

  test('honors explicit paragraph page breaks', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'Alpha'), paragraph('p2', 'Beta', true)],
      []
    );
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks[0]).toMatchObject({ id: 'p2' });
  });

  test('uses section page geometry', () => {
    const pages = paginateDocxBlocks(
      [paragraph('p1', 'Alpha')],
      [
        {
          index: 0,
          pageSize: {
            widthPt: 841.8,
            heightPt: 595.2,
            orientation: 'landscape',
          },
          margins: { topPt: 36, rightPt: 40, bottomPt: 44, leftPt: 48 },
          headerReferences: [],
          footerReferences: [],
        },
      ]
    );
    expect(pages[0]).toMatchObject({
      widthPt: 841.8,
      heightPt: 595.2,
      margins: { topPt: 36, rightPt: 40, bottomPt: 44, leftPt: 48 },
    });
  });
});
