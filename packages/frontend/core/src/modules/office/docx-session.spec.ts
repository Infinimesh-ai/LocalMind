import { createNativeFile } from '@localmind/office';
import {
  applyDocxCommand,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import { describe, expect, test } from 'vitest';

import {
  docxEditPatches,
  formatDocxRange,
  isEditableParagraph,
  prepareDocxEditing,
  replaceDocxRange,
} from './docx-session';
function setup() {
  const pkg = openDocxPackage(
    createNativeFile({
      format: 'docx',
      paragraphs: [{ text: '你好😀世界' }, { text: '第二段' }],
    }).bytes
  );
  return { pkg, ...prepareDocxEditing(readDocxSemanticState(pkg)) };
}
describe('DOCX editing model', () => {
  test('toolbar page breaks stay editable and survive typing, formatting and persistence', () => {
    const { pkg } = setup();
    const before = readDocxSemanticState(pkg);
    const broken = applyDocxCommand(pkg, {
      version: 'localmind-office-command/v1',
      commandId: 'page',
      idempotencyKey: 'page',
      source: 'user',
      artifactId: 'a',
      expectedRevisionId: 'r',
      operation: 'office.document.break.insert',
      target: { blockId: before.body[0].id, offset: 2 },
      breakType: 'page',
    });
    const { state, identities } = prepareDocxEditing(broken.state);
    const first = state.body[0];
    if (first.type !== 'paragraph') throw new Error('expected paragraph');
    expect(first.text).toBe('你好\f😀世界');
    expect(isEditableParagraph(first)).toBe(true);
    const pos = { blockId: first.id, offset: first.text.length };
    const next = replaceDocxRange(
      state,
      { type: 'text_range', start: pos, end: pos },
      '尾'
    );
    const formatted = formatDocxRange(
      next.state,
      {
        type: 'text_range',
        start: { blockId: first.id, offset: 3 },
        end: { blockId: first.id, offset: 5 },
      },
      { bold: true }
    );
    const result = applyDocxCommand(openDocxPackage(broken.packageBytes), {
      version: 'localmind-office-command/v1',
      commandId: 'edit-page',
      idempotencyKey: 'edit-page',
      source: 'user',
      artifactId: 'a',
      expectedRevisionId: 'r',
      operation: 'office.document.edit',
      identities,
      patches: docxEditPatches(state, formatted),
    });
    expect(result.state.body[0]).toMatchObject({
      text: '你好\f😀世界尾',
      editingSupported: true,
    });
    const xml = new TextDecoder().decode(
      openDocxPackage(result.packageBytes).requirePart(pkg.documentPart)
    );
    expect(xml).toContain('type="page"');
    expect(xml).not.toContain('\f');
  });
  test('typing does not create an unbounded run for every keystroke', () => {
    let { state } = setup();
    for (let i = 0; i < 100; i++) {
      const p = state.body[0];
      if (p.type !== 'paragraph') throw new Error('expected paragraph');
      const pos = { blockId: p.id, offset: p.text.length };
      state = replaceDocxRange(
        state,
        { type: 'text_range', start: pos, end: pos },
        '字'
      ).state;
    }
    const p = state.body[0];
    if (p.type !== 'paragraph') throw new Error('expected paragraph');
    expect(p.runs.length).toBeLessThanOrEqual(2);
  });
  test('independent edits on either side of an opaque paragraph stay separate', () => {
    const { state } = setup();
    const middle = structuredClone(state.body[0]);
    if (middle.type !== 'paragraph') throw new Error('expected paragraph');
    middle.id = 'paragraph:ABCDEF12';
    middle.editingSupported = false;
    state.body.splice(1, 0, middle);
    let next = state;
    for (const index of [0, 2]) {
      const pos = { blockId: state.body[index].id, offset: 0 };
      next = replaceDocxRange(
        next,
        { type: 'text_range', start: pos, end: pos },
        '甲'
      ).state;
    }
    const patches = docxEditPatches(state, next);
    expect(patches).toHaveLength(2);
    expect(patches.flatMap(p => p.targets)).not.toContain(middle.id);
    expect(next.body[1]).toEqual(middle);
  });
  test('replaces across paragraphs, then persists the exact local result', () => {
    const { pkg, state, identities } = setup();
    const range = {
      type: 'text_range' as const,
      start: { blockId: state.body[0].id, offset: 2 },
      end: { blockId: state.body[1].id, offset: 1 },
    };
    const next = replaceDocxRange(state, range, '甲\n乙', { italic: true });
    const result = applyDocxCommand(pkg, {
      version: 'localmind-office-command/v1',
      commandId: 'a',
      idempotencyKey: 'a',
      source: 'user',
      artifactId: 'a',
      expectedRevisionId: 'r',
      operation: 'office.document.edit',
      identities,
      patches: docxEditPatches(state, next.state),
    });
    expect(result.state.body).toMatchObject([
      { text: '你好甲' },
      { text: '乙二段' },
    ]);
    expect(next.bookmark.focus.offset).toBe(1);
  });
  test('soft breaks remain in one paragraph and ordinary Enter creates two', () => {
    const { state } = setup();
    const range = {
      type: 'text_range' as const,
      start: { blockId: state.body[0].id, offset: 2 },
      end: { blockId: state.body[0].id, offset: 2 },
    };
    expect(
      replaceDocxRange(state, range, '\n', undefined, true).state.body
    ).toHaveLength(2);
    expect(replaceDocxRange(state, range, '\n').state.body).toHaveLength(3);
  });
  test('multiple format operations preserve text and combine on the selected range', () => {
    const { state } = setup();
    const range = {
      type: 'text_range' as const,
      start: { blockId: state.body[0].id, offset: 2 },
      end: { blockId: state.body[0].id, offset: 4 },
    };
    const next = formatDocxRange(
      formatDocxRange(state, range, { bold: true }),
      range,
      { italic: true }
    );
    expect(next.body[0]).toMatchObject({
      text: '你好😀世界',
      runs: [
        { content: [{ text: '你好' }] },
        { content: [{ text: '😀' }], format: { bold: true, italic: true } },
        { content: [{ text: '世界' }] },
      ],
    });
  });
  test('undo snapshots generate a valid reverse patch after saving a split', () => {
    const { state } = setup();
    const pos = { blockId: state.body[0].id, offset: 2 };
    const next = replaceDocxRange(
      state,
      { type: 'text_range', start: pos, end: pos },
      '\n'
    );
    expect(docxEditPatches(next.state, state)[0]).toMatchObject({
      targets: [state.body[0].id, next.state.body[1].id],
      paragraphs: [{ id: state.body[0].id }],
    });
  });
});
