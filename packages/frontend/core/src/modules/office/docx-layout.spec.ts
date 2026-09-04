import { describe, expect, test } from 'vitest';

import { paginateDocxBlocks } from './docx-layout';
import type { DocxBlock } from './types';

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
