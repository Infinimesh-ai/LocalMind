import { strToU8 } from 'fflate';
import { describe, expect, test } from 'vitest';

import {
  type OfficeDocumentEditCommand,
  OfficeDocumentEditCommandSchema,
} from '../command';
import { createNativeFile } from '../create';
import { applyDocxCommand } from './edit';
import { openDocxPackage } from './package';
import { readDocxSemanticState } from './semantic';

const base = {
  version: 'localmind-office-command/v1',
  commandId: 'edit',
  idempotencyKey: 'edit',
  artifactId: 'artifact',
  expectedRevisionId: 'revision',
  source: 'user',
  operation: 'office.document.edit',
} as const;
function fixture() {
  const pkg = openDocxPackage(
    createNativeFile({
      format: 'docx',
      paragraphs: [{ text: '你好😀世界' }, { text: '第二段' }],
    }).bytes
  );
  return { pkg, state: readDocxSemanticState(pkg) };
}
function command(): OfficeDocumentEditCommand {
  const { state } = fixture();
  return {
    ...base,
    identities: state.body.map((p, i) => ({
      blockId: p.id,
      id: `paragraph:0000000${i + 1}`,
    })),
    patches: [
      {
        targets: ['paragraph:00000001'],
        paragraphs: [
          {
            id: 'paragraph:00000001',
            runs: [
              {
                text: '你好😀',
                format: { bold: true, underline: { style: 'single' } },
              },
            ],
          },
          {
            id: 'paragraph:00000003',
            properties: { alignment: 'center' },
            runs: [{ text: '世界\n下一行\t内容', format: { italic: true } }],
          },
        ],
      },
    ],
  };
}
describe('atomic DOCX paragraph editing', () => {
  test.each(['00000000', '80000000', 'FFFFFFFF'])(
    'rejects paraId %s outside the MS-DOCX range',
    id => {
      const cmd = command();
      cmd.patches[0].paragraphs[1].id = `paragraph:${id}`;
      expect(OfficeDocumentEditCommandSchema.safeParse(cmd).success).toBe(
        false
      );
    }
  );
  test('splits paragraphs, preserves identities and formats, and round trips breaks and tabs', () => {
    const { pkg } = fixture();
    const result = applyDocxCommand(pkg, command());
    const state = readDocxSemanticState(openDocxPackage(result.packageBytes));
    expect(state.body.map(p => p.id)).toEqual([
      'paragraph:00000001',
      'paragraph:00000003',
      'paragraph:00000002',
    ]);
    expect(state.body).toMatchObject([
      {
        text: '你好😀',
        runs: [{ format: { bold: true, underline: { style: 'single' } } }],
      },
      { text: '世界\n下一行\t内容', properties: { alignment: 'center' } },
      { text: '第二段' },
    ]);
    for (const { path: name } of pkg.listParts())
      if (name !== pkg.documentPart)
        expect(openDocxPackage(result.packageBytes).requirePart(name)).toEqual(
          pkg.requirePart(name)
        );
  });
  test('merges adjacent paragraphs without reassigning a following identity', () => {
    const first = applyDocxCommand(fixture().pkg, command());
    const merged = applyDocxCommand(openDocxPackage(first.packageBytes), {
      ...base,
      identities: [],
      patches: [
        {
          targets: ['paragraph:00000001', 'paragraph:00000003'],
          paragraphs: [{ id: 'paragraph:00000001', runs: [{ text: '合并' }] }],
        },
      ],
    });
    expect(merged.state.body).toMatchObject([
      { id: 'paragraph:00000001', text: '合并' },
      { id: 'paragraph:00000002', text: '第二段' },
    ]);
  });
  test.each([
    'duplicate',
    'nonadjacent',
    'collision',
    'invalid-text',
    'empty-body',
    'reassign',
  ])('rejects %s atomically', kind => {
    const cmd = command();
    if (kind === 'duplicate') cmd.patches.push(cmd.patches[0]);
    if (kind === 'nonadjacent')
      cmd.patches[0].targets.reverse().push('paragraph:00000099');
    if (kind === 'collision')
      cmd.patches[0].paragraphs[1].id = 'paragraph:00000002';
    if (kind === 'invalid-text')
      cmd.patches[0].paragraphs[0].runs[0].text = 'bad\u0000';
    if (kind === 'empty-body')
      cmd.patches = [
        {
          targets: ['paragraph:00000001', 'paragraph:00000002'],
          paragraphs: [],
        },
      ];
    let pkg = fixture().pkg;
    if (kind === 'reassign') {
      pkg = openDocxPackage(applyDocxCommand(pkg, command()).packageBytes);
      cmd.identities = [
        { blockId: 'paragraph:00000001', id: 'paragraph:00000009' },
      ];
    }
    expect(() => applyDocxCommand(pkg, cmd)).toThrow();
    expect(readDocxSemanticState(pkg).body.length).toBe(
      kind === 'reassign' ? 3 : 2
    );
  });
  test('preserves opaque paragraphs and rejects edits that would drop bookmarks', () => {
    const { pkg } = fixture();
    const xml = new TextDecoder()
      .decode(pkg.requirePart(pkg.documentPart))
      .replace('<w:p>', '<w:p><w:bookmarkStart w:id="1" w:name="keep"/>');
    const changed = openDocxPackage(
      pkg.write(new Map([[pkg.documentPart, strToU8(xml)]]))
    );
    expect(readDocxSemanticState(changed).body[0]).toMatchObject({
      editingSupported: false,
    });
    expect(() => applyDocxCommand(changed, command())).toThrow(/unsupported/);
  });
  test('rejects unknown paragraph attributes instead of silently dropping extensions', () => {
    const { pkg } = fixture();
    const xml = new TextDecoder()
      .decode(pkg.requirePart(pkg.documentPart))
      .replace(
        '<w:p>',
        '<w:p xmlns:custom="urn:custom" custom:layout="retain">'
      );
    const changed = openDocxPackage(
      pkg.write(new Map([[pkg.documentPart, strToU8(xml)]]))
    );
    expect(readDocxSemanticState(changed).body[0]).toMatchObject({
      editingSupported: false,
    });
    expect(() => applyDocxCommand(changed, command())).toThrow(/unsupported/);
  });
  test('does not expand AI command privileges and rejects unknown fields', () => {
    expect(
      OfficeDocumentEditCommandSchema.safeParse({ ...command(), source: 'ai' })
        .success
    ).toBe(false);
    expect(
      OfficeDocumentEditCommandSchema.safeParse({ ...command(), xml: '<w:p/>' })
        .success
    ).toBe(false);
  });
});
