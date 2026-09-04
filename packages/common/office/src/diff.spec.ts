import { describe, expect, test } from 'vitest';

import { diffOfficeSemanticStates } from './diff';
import type { DocxSemanticState } from './docx';

function state(kind: 'document' | 'workbook' | 'presentation' | 'pdf') {
  if (kind === 'document') {
    return {
      schemaVersion: 'localmind-office-docx-state/v1',
      body: [],
      sections: [],
      stories: [],
      styles: [],
      references: {},
      review: { trackRevisions: false, comments: [] },
    };
  }
  if (kind === 'workbook') {
    return {
      schemaVersion: 'localmind-office-xlsx-state/v1',
      activeSheetIndex: 0,
      definedNames: [],
      styles: {},
      sheets: [],
    };
  }
  if (kind === 'presentation') {
    return {
      schemaVersion: 'localmind-office-pptx-state/v1',
      slideSize: { widthPt: 720, heightPt: 405 },
      slides: [],
      masters: [],
    };
  }
  return {
    schemaVersion: 'localmind-office-pdf-state/v1',
    pdfVersion: '1.7',
    metadata: { keywords: [] },
    pages: [],
    formFields: [],
  };
}

describe('Office revision diff', () => {
  test('reports stable document text modifications', () => {
    const before = state('document') as unknown as DocxSemanticState;
    const after = structuredClone(before);
    before.body = [
      {
        type: 'paragraph',
        id: 'p1',
        text: 'Before',
        runs: [],
        fields: [],
        bookmarks: [],
      },
    ];
    after.body = [
      {
        type: 'paragraph',
        id: 'p1',
        text: 'After',
        runs: [],
        fields: [],
        bookmarks: [],
      },
    ];
    const result = diffOfficeSemanticStates('document', before, after);
    expect(result.summary.modified).toBe(1);
    expect(result.changes[0]).toMatchObject({
      entity: 'paragraph',
      id: 'p1',
      before: 'Before',
      after: 'After',
    });
  });

  test.each(['workbook', 'presentation', 'pdf'] as const)(
    'accepts and compares %s semantic states',
    kind => {
      const value = state(kind);
      const result = diffOfficeSemanticStates(kind, value, value);
      expect(result.changed).toBe(false);
      expect(result.summary.modified).toBe(0);
    }
  );

  test('rejects a state from another Office resource kind', () => {
    expect(() =>
      diffOfficeSemanticStates('document', state('pdf'), state('pdf'))
    ).toThrow(/semantic state is invalid/);
  });
});
