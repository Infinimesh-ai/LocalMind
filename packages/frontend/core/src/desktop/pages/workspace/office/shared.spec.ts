import type { OfficeSelection } from '@localmind/office';
import { describe, expect, test } from 'vitest';

import {
  isHistoricalOfficeRevision,
  isOfficeSelectionAvailable,
  newestOfficeRevision,
} from './shared';

describe('isHistoricalOfficeRevision', () => {
  test('uses revision order instead of a temporarily stale current id', () => {
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 1 })).toBe(
      true
    );
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 2 })).toBe(
      false
    );
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 3 })).toBe(
      false
    );
  });
});

describe('newestOfficeRevision', () => {
  test('never lets a history query move the latest pointer backwards', () => {
    const latest = { id: 'revision-7', sequence: 7 };
    expect(newestOfficeRevision(null, latest)).toBe(latest);
    expect(
      newestOfficeRevision(latest, { id: 'revision-6', sequence: 6 })
    ).toBe(latest);
    expect(
      newestOfficeRevision(latest, { id: 'revision-8', sequence: 8 })
    ).toEqual({ id: 'revision-8', sequence: 8 });
  });
});

describe('isOfficeSelectionAvailable', () => {
  test('keeps document text selections only while stable blocks and offsets exist', () => {
    const state = {
      schemaVersion: 'localmind-office-docx-state/v1',
      body: [
        {
          type: 'paragraph',
          id: 'paragraph-1',
          text: 'LocalMind',
          runs: [{ content: [{ type: 'text', text: 'LocalMind' }] }],
          fields: [],
          bookmarks: [],
        },
      ],
      stories: [],
      sections: [],
    } as never;
    const selection = {
      kind: 'document',
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 0 },
        end: { blockId: 'paragraph-1', offset: 5 },
      },
    } satisfies OfficeSelection;

    expect(isOfficeSelectionAvailable(state, selection)).toBe(true);
    expect(
      isOfficeSelectionAvailable(state, {
        ...selection,
        target: {
          ...selection.target,
          end: { blockId: 'paragraph-1', offset: 50 },
        },
      })
    ).toBe(false);
  });

  test('checks stable workbook, presentation, and PDF targets', () => {
    const workbook = {
      schemaVersion: 'localmind-office-xlsx-state/v1',
      sheets: [
        {
          id: 'sheet-1',
          tables: [{ id: 'table-1' }],
          charts: [{ id: 'chart-1' }],
        },
      ],
    } as never;
    expect(
      isOfficeSelectionAvailable(workbook, {
        kind: 'workbook',
        target: { type: 'cell', sheetId: 'sheet-1', address: 'B2' },
      })
    ).toBe(true);

    const presentation = {
      schemaVersion: 'localmind-office-pptx-state/v1',
      slides: [
        {
          id: 'slide-1',
          shapes: [
            {
              id: 'group-1',
              children: [{ id: 'shape-1', placeholder: { type: 'title' } }],
            },
          ],
        },
      ],
    } as never;
    expect(
      isOfficeSelectionAvailable(presentation, {
        kind: 'presentation',
        target: { type: 'shape', slideId: 'slide-1', shapeId: 'shape-1' },
      })
    ).toBe(true);

    const pdf = {
      schemaVersion: 'localmind-office-pdf-state/v1',
      pages: [{ annotations: [{ id: 'annotation-1' }] }],
      formFields: [{ name: 'CustomerName' }],
    } as never;
    expect(
      isOfficeSelectionAvailable(pdf, {
        kind: 'pdf',
        target: {
          type: 'annotation',
          pageIndex: 0,
          annotationId: 'annotation-1',
        },
      })
    ).toBe(true);
    expect(
      isOfficeSelectionAvailable(pdf, {
        kind: 'pdf',
        target: { type: 'page', pageIndex: 5 },
      })
    ).toBe(false);
  });
});
