import {
  CalloutBlockSchemaExtension,
  ListBlockSchemaExtension,
  NoteBlockSchemaExtension,
  type ParagraphBlockModel,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import type * as RichText from '@blocksuite/affine-rich-text';
import { asyncSetInlineRange } from '@blocksuite/affine-rich-text';
import { Container } from '@blocksuite/global/di';
import {
  type BlockStdScope,
  CommandManager,
  KeymapIdentifier,
  TextSelection,
  TextSelectionExtension,
  UIEventState,
  UIEventStateContext,
} from '@blocksuite/std';
import { StoreSelectionExtension, Text } from '@blocksuite/store';
import {
  createAutoIncrementIdGenerator,
  TestWorkspace,
} from '@blocksuite/store/test';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { addParagraphCommand } from '../../../blocks/paragraph/src/commands/add-paragraph.js';
import { ParagraphKeymapExtension } from '../../../blocks/paragraph/src/paragraph-keymap.js';

// Only the DOM range update is stubbed; keymaps, commands, the block tree,
// text merging and undo/redo all use their production implementations.
vi.mock('@blocksuite/affine-rich-text', async importOriginal => ({
  ...(await importOriginal<typeof RichText>()),
  asyncSetInlineRange: vi.fn().mockResolvedValue(undefined),
}));

const dispose: Array<() => void> = [];
afterEach(() => {
  dispose.splice(0).forEach(cleanup => cleanup());
  vi.clearAllMocks();
});

function fixture() {
  const workspace = new TestWorkspace({
    id: 'paragraph-backspace',
    idGenerator: createAutoIncrementIdGenerator(),
  });
  workspace.meta.initialize();
  const doc = workspace.createDoc('doc');
  doc.load();
  const store = doc.getStore({
    extensions: [
      RootBlockSchemaExtension,
      NoteBlockSchemaExtension,
      ParagraphBlockSchemaExtension,
      ListBlockSchemaExtension,
      CalloutBlockSchemaExtension,
      TextSelectionExtension,
    ],
  });
  dispose.push(() => {
    store.dispose();
    workspace.dispose();
  });
  const root = store.addBlock('affine:page', {});
  const note = store.addBlock('affine:note', {}, root);
  const add = (text: string, parent = note) =>
    store.addBlock('affine:paragraph', { text: new Text(text) }, parent);
  const selection = store.provider.get(StoreSelectionExtension);
  const syncRange = vi.fn();
  const std = {
    store,
    selection,
    range: { syncTextSelectionToRange: syncRange },
    event: { active: true },
    get: () => ({ getEditorMode: () => 'page' }),
  } as unknown as BlockStdScope;
  Object.assign(std, {
    command: new CommandManager(std),
    host: { std, updateComplete: Promise.resolve(), selection },
  });
  const container = new Container();
  ParagraphKeymapExtension.setup(container);
  const keymap = [
    ...container.provider().getAll(KeymapIdentifier).values(),
  ][0].getter(std);
  const select = (blockId: string, index = 0, length = 0) => {
    const text = new TextSelection({
      from: { blockId, index, length },
      to: null,
    });
    selection.setGroup('note', [text]);
    return text;
  };
  const backspace = async () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      cancelable: true,
    });
    const handled = keymap.Backspace(
      UIEventStateContext.from(new UIEventState(event))
    );
    await Promise.resolve();
    return { handled, event };
  };
  const children = (id: string) =>
    store.getModelById(id)!.children.map(model => model.id);
  return { store, std, note, add, select, backspace, children, syncRange };
}

describe('paragraph Backspace at the start', () => {
  for (const position of ['first', 'middle', 'last'] as const) {
    test.each(['', '正文'])(
      'outdents a %s paragraph at the ' + position + ' child position',
      async text => {
        const f = fixture();
        const parent = f.add('parent');
        const before = position === 'first' ? [] : [f.add('before', parent)];
        const current = f.add(text, parent);
        const after = position === 'last' ? [] : [f.add('after', parent)];
        const child = f.add('child', current);
        const selected = f.select(current);
        f.store.resetHistory();

        const result = await f.backspace();
        expect(result.handled).toBe(true);
        expect(result.event.defaultPrevented).toBe(true);
        expect(f.children(f.note)).toEqual([parent, current]);
        expect(f.children(parent)).toEqual(before);
        expect(f.children(current)).toEqual([child, ...after]);
        expect(f.store.getModelById(current)?.text?.toString()).toBe(text);
        expect(f.std.selection.find(TextSelection)).toEqual(selected);
        expect(f.syncRange).toHaveBeenCalledWith(selected);
        expect(asyncSetInlineRange).not.toHaveBeenCalled();

        f.store.undo();
        expect(f.children(f.note)).toEqual([parent]);
        expect(f.children(parent)).toEqual([...before, current, ...after]);
        expect(f.children(current)).toEqual([child]);
        f.store.redo();
        expect(f.children(f.note)).toEqual([parent, current]);
        expect(f.children(current)).toEqual([child, ...after]);
      }
    );
  }

  test('preserves the new empty paragraph after Enter before a following sibling', async () => {
    const f = fixture();
    const parent = f.add('A');
    const previous = f.add('B', parent);
    const following = f.add('C', parent);
    f.select(previous, 1);
    const [added, result] = f.std.command.exec(addParagraphCommand);
    expect(added).toBe(true);
    const current = result.paragraphConvertedId!;
    expect(f.children(parent)).toEqual([previous, current, following]);
    await f.backspace();
    expect(f.children(f.note)).toEqual([parent, current]);
    expect(f.children(parent)).toEqual([previous]);
    expect(f.children(current)).toEqual([following]);
    expect(f.store.getModelById(current)?.text?.length).toBe(0);
    expect(f.std.selection.find(TextSelection)?.from).toEqual({
      blockId: current,
      index: 0,
      length: 0,
    });
  });

  test('outdents one level per press and only merges once at the root level', async () => {
    const f = fixture();
    const parent = f.add('A');
    const nested = f.add('B', parent);
    const current = f.add('C', nested);
    f.select(current);
    await f.backspace();
    expect(f.children(parent)).toEqual([nested, current]);
    expect(f.store.getModelById(current)?.text?.toString()).toBe('C');
    await f.backspace();
    expect(f.children(f.note)).toEqual([parent, current]);
    await f.backspace();
    expect(f.store.getModelById(current)).toBeNull();
    expect(f.store.getModelById(nested)?.text?.toString()).toBe('BC');
    expect(asyncSetInlineRange).toHaveBeenCalledWith(
      f.std,
      f.store.getModelById(nested),
      { index: 1, length: 0 }
    );
  });

  test.each([
    { index: 1, length: 0 },
    { index: 0, length: 2 },
  ])(
    'leaves character and selection deletion to the text editor: %j',
    async ({ index, length }) => {
      const f = fixture();
      const parent = f.add('A');
      const current = f.add('text', parent);
      f.select(current, index, length);
      const result = await f.backspace();
      expect(result.handled).toBeUndefined();
      expect(result.event.defaultPrevented).toBe(false);
      expect(f.children(parent)).toEqual([current]);
      expect(f.store.getModelById(current)?.text?.toString()).toBe('text');
    }
  );

  test.each(['h1', 'quote'])(
    'preserves the first Backspace conversion of %s to plain text',
    async type => {
      const f = fixture();
      const parent = f.add('A');
      const current = f.add('text', parent);
      f.store.updateBlock(f.store.getModelById(current)!, { type });
      f.select(current);
      await f.backspace();
      expect(f.children(parent)).toEqual([current]);
      expect(
        f.store.getModelById<ParagraphBlockModel>(current)?.props.type
      ).toBe('text');
    }
  );

  test('leaves Callout paragraphs to their own keymap', async () => {
    const f = fixture();
    const callout = f.store.addBlock('affine:callout', {}, f.note);
    const current = f.add('text', callout);
    f.select(current);
    expect((await f.backspace()).handled).toBeUndefined();
    expect(f.children(callout)).toEqual([current]);
  });
});
