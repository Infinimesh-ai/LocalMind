import { describe, expect, test } from 'vitest';

import type { OfficeDocumentEditCommand } from './command';
import { createNativeFile } from './create';
import { diffOfficeSemanticStates } from './diff';
import type { DocxSemanticState } from './docx';
import {
  applyDocxCommand,
  openDocxPackage,
  readDocxSemanticState,
} from './docx';

function firstEdit(
  texts: string[],
  patches: OfficeDocumentEditCommand['patches']
) {
  const pkg = openDocxPackage(
    createNativeFile({
      format: 'docx',
      paragraphs: texts.map(text => ({ text })),
    }).bytes
  );
  const before = readDocxSemanticState(pkg);
  const after = applyDocxCommand(pkg, {
    version: 'localmind-office-command/v1',
    commandId: 'edit',
    idempotencyKey: 'edit',
    artifactId: 'artifact',
    expectedRevisionId: 'revision',
    source: 'user',
    operation: 'office.document.edit',
    identities: before.body.map((p, i) => ({
      blockId: p.id,
      id: `paragraph:${(i + 1).toString(16).padStart(8, '0').toUpperCase()}`,
    })),
    patches,
  }).state;
  return { before, after };
}

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
  test('matches the first saved DOCX edit across paragraph ID stabilization without rewriting either revision', () => {
    const { before, after } = firstEdit(
      ['Title', 'Before', 'Third', 'Fourth', 'Fifth'],
      [
        {
          targets: ['paragraph:00000002'],
          paragraphs: [{ id: 'paragraph:00000002', runs: [{ text: 'After' }] }],
        },
      ]
    );
    const original = JSON.stringify({ before, after });
    const result = diffOfficeSemanticStates('document', before, after);
    expect(result.summary).toMatchObject({ added: 0, removed: 0, modified: 1 });
    expect(result.changes[0]).toMatchObject({
      entity: 'paragraph',
      before: 'Before',
      after: 'After',
    });
    expect(JSON.stringify({ before, after })).toBe(original);
    expect(
      diffOfficeSemanticStates('document', after, before).summary
    ).toMatchObject({ added: 0, removed: 0, modified: 1 });
  });

  test('keeps an inserted paragraph separate when legacy identities stabilize', () => {
    const { before, after } = firstEdit(
      ['First', 'Second', 'Third'],
      [
        {
          targets: ['paragraph:00000001'],
          paragraphs: [
            { id: 'paragraph:00000009', runs: [{ text: 'Inserted' }] },
            { id: 'paragraph:00000001', runs: [{ text: 'First' }] },
          ],
        },
      ]
    );
    const result = diffOfficeSemanticStates('document', before, after);
    expect(result.summary).toMatchObject({ added: 1, removed: 0, modified: 0 });
    expect(result.changes[0].after).toBe('Inserted');
  });

  test('keeps a removed paragraph separate when legacy identities stabilize', () => {
    const { before, after } = firstEdit(
      ['First', 'Second', 'Third'],
      [{ targets: ['paragraph:00000002'], paragraphs: [] }]
    );
    const result = diffOfficeSemanticStates('document', before, after);
    expect(result.summary).toMatchObject({ added: 0, removed: 1, modified: 0 });
    expect(result.changes[0].before).toBe('Second');
  });

  test('aligns repeated unchanged paragraphs in order around a single edit', () => {
    const { before, after } = firstEdit(
      ['Same', 'Same', 'Same'],
      [
        {
          targets: ['paragraph:00000002'],
          paragraphs: [
            { id: 'paragraph:00000002', runs: [{ text: 'Changed' }] },
          ],
        },
      ]
    );
    expect(
      diffOfficeSemanticStates('document', before, after).summary
    ).toMatchObject({ added: 0, removed: 0, modified: 1 });
  });

  test('does not merge different stable paragraph IDs even when content is identical', () => {
    const { after: before } = firstEdit(
      ['Same'],
      [
        {
          targets: ['paragraph:00000001'],
          paragraphs: [{ id: 'paragraph:00000001', runs: [{ text: 'Same' }] }],
        },
      ]
    );
    const after = structuredClone(before);
    after.body[0].id = 'paragraph:00000009';
    expect(
      diffOfficeSemanticStates('document', before, after).summary
    ).toMatchObject({ added: 1, removed: 1, modified: 0 });
  });

  test('uses unchanged interior paragraphs to align separated edits', () => {
    const { before, after } = firstEdit(
      ['A', 'B', 'C', 'D', 'E'],
      [
        {
          targets: ['paragraph:00000001'],
          paragraphs: [
            { id: 'paragraph:00000001', runs: [{ text: 'Changed A' }] },
          ],
        },
        {
          targets: ['paragraph:00000005'],
          paragraphs: [
            { id: 'paragraph:00000005', runs: [{ text: 'Changed E' }] },
          ],
        },
      ]
    );
    expect(
      diffOfficeSemanticStates('document', before, after).summary
    ).toMatchObject({ added: 0, removed: 0, modified: 2 });
  });

  test('does not match paragraphs across table cells just because their text matches', () => {
    const { before, after } = firstEdit(
      ['A', 'B'],
      [
        {
          targets: ['paragraph:00000001'],
          paragraphs: [{ id: 'paragraph:00000001', runs: [{ text: 'B' }] }],
        },
        {
          targets: ['paragraph:00000002'],
          paragraphs: [{ id: 'paragraph:00000002', runs: [{ text: 'A' }] }],
        },
      ]
    );
    for (const value of [before, after])
      value.body = [
        {
          type: 'table',
          id: 'table:root',
          rows: [{ cells: value.body.map(block => ({ blocks: [block] })) }],
        },
      ];
    expect(
      diffOfficeSemanticStates('document', before, after).summary
    ).toMatchObject({ added: 0, removed: 0, modified: 2 });
  });

  test('bounds ambiguous alignment work and reports the incomplete comparison', () => {
    const before = state('document') as unknown as DocxSemanticState;
    const after = structuredClone(before);
    for (let i = 0; i < 1000; i++) {
      const paragraph = {
        type: 'paragraph' as const,
        id: `paragraph:${i + 1}`,
        text: `Before ${i}`,
        runs: [],
        fields: [],
        bookmarks: [],
      };
      before.body.push(paragraph);
      after.body.push({
        ...paragraph,
        id: `paragraph:${(i + 1).toString(16).padStart(8, '0').toUpperCase()}`,
        text: `After ${i}`,
      });
    }
    const result = diffOfficeSemanticStates('document', before, after, {
      maxChanges: 2000,
    });
    expect(result.truncated).toBe(true);
    expect(result.summary.returnedChanges).toBe(2000);
    expect(result.summary.modified).toBe(0);
  });

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
