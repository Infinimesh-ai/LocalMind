/** @vitest-environment happy-dom */
import type * as Components from '@affine/component';
import { UserFriendlyError } from '@affine/error';
import { createNativeFile } from '@localmind/office';
import {
  applyDocxCommand,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DocumentEditor } from './document-editor';
import type { OfficeEditorDraft } from './edit-draft';
import type * as Shared from './shared';
import { executeAndReloadOfficeCommand } from './shared';

vi.mock('@affine/component', async importOriginal => ({
  ...(await importOriginal<typeof Components>()),
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
}));
vi.mock('./shared', async importOriginal => ({
  ...(await importOriginal<typeof Shared>()),
  executeAndReloadOfficeCommand: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  cleanup();
  vi.resetAllMocks();
});
const paragraphs = () =>
  screen.getAllByLabelText('Editable document paragraph');
const texts = () => paragraphs().map(p => p.textContent);
function setup({
  readOnly = false,
  initial = ['Before'],
  initialHeading,
  initialBytes,
}: {
  readOnly?: boolean;
  initial?: string[];
  initialHeading?: number;
  initialBytes?: Uint8Array;
} = {}) {
  let pkg = openDocxPackage(
    initialBytes ??
      createNativeFile({
        format: 'docx',
        paragraphs: initial.map(text => ({ text, heading: initialHeading })),
      }).bytes
  );
  let sequence = 1;
  const guards = new Set<OfficeEditorDraft>();
  const onAnchor = vi.fn();
  const onAi = vi.fn();
  const execute = vi.mocked(executeAndReloadOfficeCommand);
  let remoteUpdate = () => {};
  const run: typeof executeAndReloadOfficeCommand = async input => {
    const result = applyDocxCommand(pkg, input.command);
    pkg = openDocxPackage(result.packageBytes);
    sequence++;
    return {
      revision: {
        id: `revision-${sequence}`,
        sequence,
        packageUrl: '/document.docx',
      } as Shared.OfficeRevision,
      state: result.state as never,
      preview: {} as never,
      summary: result.summary,
    };
  };
  execute.mockImplementation(run);
  function Harness() {
    const [current, setCurrent] = useState({
      state: readDocxSemanticState(pkg),
      revision: {
        id: 'revision-1',
        sequence: 1,
        packageUrl: '/document.docx',
      } as Shared.OfficeRevision,
    });
    useEffect(() => {
      remoteUpdate = () =>
        setCurrent({
          state: readDocxSemanticState(pkg),
          revision: {
            ...current.revision,
            id: 'foreign-revision',
            sequence: 100,
          },
        });
    }, [current]);
    return (
      <DocumentEditor
        {...current}
        artifactId="artifact"
        owner={{ kind: 'workspace', workspaceId: 'workspace' }}
        graphql={{} as never}
        readOnly={readOnly}
        onRevision={(revision, state) => setCurrent({ revision, state })}
        onAiSelectionChange={onAi}
        onCommentAnchorChange={onAnchor}
        registerDraft={guard => {
          guards.add(guard);
          return () => {
            guards.delete(guard);
          };
        }}
      />
    );
  }
  render(<Harness />);
  return {
    execute,
    run,
    onAnchor,
    onAi,
    remoteUpdate: () => remoteUpdate(),
    guard: () => [...guards][0],
    saved: () => readDocxSemanticState(pkg),
  };
}
async function select(p: HTMLElement, start: number, end = start) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node);
  const at = (offset: number) => {
    for (const node of nodes) {
      const length = node.textContent?.length ?? 0;
      if (offset <= length) return { node, offset };
      offset -= length;
    }
    return { node: p, offset: 0 };
  };
  const a = at(start),
    b = at(end);
  await act(async () => {
    p.focus();
    window.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    document.dispatchEvent(new Event('selectionchange'));
  });
}
function input(text: string) {
  const p = document.activeElement!;
  fireEvent(
    p,
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
  );
}
async function save(ctx: ReturnType<typeof setup>) {
  await act(async () => {
    await ctx.guard().save();
  });
}
function measurePaper(
  p: HTMLElement,
  { padding = 0, top = 0, scale = 1 } = {}
) {
  const content = p.closest('[data-office-page-content]') as HTMLElement;
  p.style.lineHeight = '20px';
  p.style.marginBottom = '0px';
  content.style.padding = `${padding}px`;
  vi.spyOn(content, 'offsetWidth', 'get').mockReturnValue(400);
  const rect = (left: number, top: number, width: number, height: number) => ({
    left: left * scale,
    right: (left + width) * scale,
    top: top * scale,
    bottom: (top + height) * scale,
    width: width * scale,
    height: height * scale,
    x: left * scale,
    y: top * scale,
    toJSON: () => ({}),
  });
  vi.spyOn(p, 'getBoundingClientRect').mockReturnValue(
    rect(padding, top, 400 - padding * 2, 20)
  );
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(
    rect(0, 0, 400, 600)
  );
  return content;
}

describe('continuous DOCX editing', () => {
  test('batches repeated pauses to keep autosave below the existing write rate limit', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('甲');
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    input('乙');
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(4200));
    expect(ctx.execute).toHaveBeenCalledTimes(2);
    expect(texts()).toEqual(['Before甲乙']);
  });
  test('a foreign revision preserves the local draft and blocks overwrites', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('本地草稿');
    await act(async () => ctx.remoteUpdate());
    expect(texts()).toEqual(['Before本地草稿']);
    expect(paragraphs()[0].getAttribute('contenteditable')).toBe('false');
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => {
      await expect(ctx.guard().save()).rejects.toThrow('document-conflict');
    });
    expect(ctx.execute).not.toHaveBeenCalled();
    expect(ctx.guard().hasUnsavedChanges).toBe(true);
  });
  test('manual save cannot report success during an unfinished composition', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    fireEvent.compositionStart(paragraphs()[0]);
    await act(async () => {
      await expect(ctx.guard().save()).rejects.toThrow('document-composing');
    });
    expect(ctx.execute).not.toHaveBeenCalled();
    fireEvent.compositionEnd(paragraphs()[0]);
  });
  test('double-clicking blank body creates real empty paragraphs and can be undone', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 0);
    fireEvent.change(screen.getByLabelText('Paragraph alignment'), {
      target: { value: 'center' },
    });
    const content = measurePaper(paragraphs()[0]);
    fireEvent.mouseDown(content, { clientX: 50, clientY: 100, detail: 2 });
    expect(paragraphs().length).toBe(5);
    expect(paragraphs().at(-1)?.style.textIndent).toBe('37.5pt');
    input('空白处输入');
    await save(ctx);
    expect(ctx.saved().body).toHaveLength(5);
    expect(ctx.saved().body[0]).toMatchObject({
      text: 'Before',
      properties: { alignment: 'center' },
    });
    expect(ctx.saved().body.at(-1)).toMatchObject({
      properties: { alignment: 'left', indent: { firstLinePt: 37.5 } },
    });
    expect(texts().at(-1)).toBe('空白处输入');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(texts()).toEqual(['Before']);
  });
  test.each([1, 1.5])(
    'positions an existing centered empty paragraph at scale %s and persists its indent',
    async scale => {
      const ctx = setup({ initial: ['Before', '', 'After'] });
      await select(paragraphs()[1], 0);
      fireEvent.change(screen.getByLabelText('Paragraph alignment'), {
        target: { value: 'center' },
      });
      const p = paragraphs()[1];
      measurePaper(p, { padding: 40, top: 80, scale });
      fireEvent.mouseDown(p, {
        clientX: 160 * scale,
        clientY: 90 * scale,
        detail: 2,
      });
      expect(texts()).toEqual(['Before', '', 'After']);
      expect(paragraphs()[1].style.textAlign).toBe('left');
      expect(paragraphs()[1].style.textIndent).toBe('90pt');
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(paragraphs()[1].style.textAlign).toBe('center');
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
      input('定位输入');
      await save(ctx);
      expect(ctx.saved().body).toMatchObject([
        { text: 'Before' },
        {
          text: '定位输入',
          properties: {
            alignment: 'left',
            indent: { leftPt: 0, rightPt: 0, firstLinePt: 90 },
          },
        },
        { text: 'After' },
      ]);
    }
  );
  test('single-clicking blank body positions the new line at the left margin and persists it', async () => {
    const ctx = setup();
    const content = measurePaper(paragraphs()[0], { padding: 40, top: 40 });
    fireEvent.mouseDown(content, { clientX: 240, clientY: 140, detail: 1 });
    expect(paragraphs()).toHaveLength(5);
    expect(paragraphs().at(-1)?.style.textAlign).toBe('left');
    expect(paragraphs().at(-1)?.style.textIndent).toBe('');
    input('行首输入');
    await save(ctx);
    expect(ctx.saved().body.at(-1)).toMatchObject({
      text: '行首输入',
      properties: { alignment: 'left', indent: { firstLinePt: 0, leftPt: 0 } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(texts()).toEqual(['Before']);
  });
  test('mouse-down places the caret at the left before mouse-up and cancels native centered placement', async () => {
    const ctx = setup({ initial: ['Before', '', 'After'] });
    await select(paragraphs()[1], 0);
    fireEvent.change(screen.getByLabelText('Paragraph alignment'), {
      target: { value: 'center' },
    });
    const p = paragraphs()[1];
    measurePaper(p, { padding: 40, top: 80 });
    expect(
      fireEvent.mouseDown(p, { clientX: 240, clientY: 90, detail: 1 })
    ).toBe(false);
    expect(texts()).toEqual(['Before', '', 'After']);
    expect(paragraphs()[1].style.textAlign).toBe('left');
    expect(document.activeElement).toBe(paragraphs()[1]);
    const aligned = paragraphs()[1];
    fireEvent.mouseUp(aligned);
    fireEvent.click(aligned, { clientX: 240, clientY: 90, detail: 1 });
    expect(paragraphs()[1]).toBe(aligned);
    expect(document.activeElement).toBe(aligned);
    // Repeated single clicks at the same empty line do not add undo entries.
    measurePaper(paragraphs()[1], { padding: 40, top: 80 });
    fireEvent.mouseDown(paragraphs()[1], {
      clientX: 240,
      clientY: 90,
      detail: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(paragraphs()[1].style.textAlign).toBe('center');
    await save(ctx);
  });
  test('blank-paper mouse-down replaces an old selection while modified clicks keep native selection', async () => {
    const ctx = setup({ initial: ['Before', ''] });
    const p = paragraphs()[1];
    measurePaper(p, { top: 40 });
    await select(paragraphs()[0], 0, 6);
    for (const modifiers of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { button: 2 },
    ]) {
      expect(
        fireEvent.mouseDown(p, {
          clientX: 240,
          clientY: 50,
          detail: 1,
          ...modifiers,
        })
      ).toBe(true);
    }
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
    expect(window.getSelection()?.toString()).toBe('Before');
    expect(
      fireEvent.mouseDown(p, { clientX: 240, clientY: 50, detail: 1 })
    ).toBe(false);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(document.activeElement).toBe(paragraphs()[1]);
    expect(paragraphs()[1].style.textAlign).toBe('left');
  });
  test.each(['trailing', 'empty'])(
    'the full %s double-click sequence creates one positioning undo entry',
    async location => {
      setup({ initial: location === 'empty' ? ['Before', ''] : ['Before'] });
      const p = paragraphs().at(-1)!;
      const content = measurePaper(p);
      const target = location === 'empty' ? p : content;
      const coords = { clientX: 160, clientY: location === 'empty' ? 10 : 100 };
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target, { ...coords, detail: 1 });
      const count = paragraphs().length;
      fireEvent.mouseUp(content);
      fireEvent.click(content, { ...coords, detail: 1 });
      fireEvent.pointerDown(content);
      fireEvent.mouseDown(content, { ...coords, detail: 2 });
      fireEvent.mouseUp(content);
      fireEvent.click(content, { ...coords, detail: 2 });
      fireEvent.doubleClick(content, { ...coords, detail: 2 });
      expect(paragraphs()).toHaveLength(count);
      expect(paragraphs().at(-1)?.style.textIndent).toBe('120pt');
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(texts()).toEqual(
        location === 'empty' ? ['Before', ''] : ['Before']
      );
      expect(
        screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')
      ).toBe(true);
    }
  );
  test('a drag selection ending on blank paper does not insert lines or collapse the selection', async () => {
    const ctx = setup();
    const p = paragraphs()[0];
    const content = measurePaper(p);
    expect(
      fireEvent.mouseDown(p, { clientX: 10, clientY: 10, detail: 1 })
    ).toBe(true);
    await select(p, 0, 6);
    fireEvent.mouseUp(content);
    fireEvent.click(content, { clientX: 240, clientY: 140, detail: 1 });
    expect(window.getSelection()?.toString()).toBe('Before');
    expect(texts()).toEqual(['Before']);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });
  test('clicking populated paragraphs and page margins does not change the document', () => {
    const ctx = setup();
    const p = paragraphs()[0];
    const content = measurePaper(p, { padding: 40, top: 40 });
    fireEvent.mouseDown(p, { clientX: 160, clientY: 50, detail: 1 });
    fireEvent.mouseDown(p, { clientX: 160, clientY: 50, detail: 2 });
    for (const [clientX, clientY] of [
      [20, 200],
      [380, 200],
      [160, 20],
      [160, 580],
    ]) {
      fireEvent.mouseDown(content, { clientX, clientY, detail: 1 });
      fireEvent.mouseDown(content, { clientX, clientY, detail: 2 });
    }
    expect(texts()).toEqual(['Before']);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });
  test('blank-space positioning respects read-only mode and revision conflicts', async () => {
    const ctx = setup({ initial: [''] });
    const content = measurePaper(paragraphs()[0]);
    await select(paragraphs()[0], 0);
    fireEvent.compositionStart(paragraphs()[0]);
    fireEvent.mouseDown(content, { clientX: 50, clientY: 100, detail: 1 });
    fireEvent.mouseDown(content, { clientX: 50, clientY: 100, detail: 2 });
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
    fireEvent.compositionEnd(paragraphs()[0]);
    input('draft');
    await act(async () => ctx.remoteUpdate());
    fireEvent.mouseDown(content, { clientX: 50, clientY: 100, detail: 1 });
    fireEvent.mouseDown(content, { clientX: 50, clientY: 100, detail: 2 });
    expect(texts()).toEqual(['draft']);
    expect(ctx.execute).not.toHaveBeenCalled();
    cleanup();
    const readOnly = setup({ readOnly: true, initial: [''] });
    const p = paragraphs()[0];
    const page = measurePaper(p);
    fireEvent.mouseDown(p, { clientX: 50, clientY: 10, detail: 1 });
    fireEvent.mouseDown(page, { clientX: 50, clientY: 100, detail: 1 });
    fireEvent.mouseDown(p, { clientX: 50, clientY: 10, detail: 2 });
    fireEvent.mouseDown(page, { clientX: 50, clientY: 100, detail: 2 });
    expect(readOnly.guard().hasUnsavedChanges).toBe(false);
    expect(texts()).toEqual(['']);
  });
  test('new empty paragraphs inherit the preceding character format', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 0, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    await select(paragraphs()[0], 6);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    input('继承');
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([
      {},
      { runs: [{ format: { italic: true } }] },
    ]);
  });
  test('duplicate manual saves share one in-flight transaction', async () => {
    const ctx = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>(r => (release = r));
    ctx.execute.mockImplementationOnce(async c => {
      await gate;
      return ctx.run(c);
    });
    await select(paragraphs()[0], 6);
    input('甲');
    let first: Promise<void> = Promise.resolve(),
      second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = ctx.guard().save();
      second = ctx.guard().save();
    });
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await Promise.all([first, second]);
    });
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });

  test('types, splits and merges paragraphs and persists real OOXML paragraphs', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 3);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(texts()).toEqual(['Bef', 'ore']);
    input('中文');
    expect(texts()).toEqual(['Bef', '中文ore']);
    fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    expect(texts()).toEqual(['Bef', '中ore']);
    await select(paragraphs()[1], 0);
    fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    expect(texts()).toEqual(['Bef中ore']);
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([{ text: 'Bef中ore' }]);
  });
  test('Shift+Enter is a soft break and Tab is retained', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    fireEvent.keyDown(document.activeElement!, {
      key: 'Enter',
      shiftKey: true,
    });
    input('下一行');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    input('结尾');
    expect(texts()).toEqual(['Before\n下一行\t结尾']);
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([{ text: 'Before\n下一行\t结尾' }]);
  });
  test('combines underline, italic and alignment while keeping a partial range selected', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 1, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(window.getSelection()?.toString()).toBe('efor');
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(window.getSelection()?.toString()).toBe('efor');
    const align = screen.getByLabelText('Paragraph alignment');
    await act(async () => {
      align.focus();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    fireEvent.change(align, { target: { value: 'center' } });
    expect(window.getSelection()?.toString()).toBe('efor');
    await save(ctx);
    expect(window.getSelection()?.toString()).toBe('efor');
    expect(ctx.saved().body).toMatchObject([
      {
        properties: { alignment: 'center' },
        runs: [
          { content: [{ text: 'B' }] },
          {
            format: { italic: true, underline: { style: 'single' } },
            content: [{ text: 'efor' }],
          },
          { content: [{ text: 'e' }] },
        ],
      },
    ]);
  });
  test.each([4, 5, 6])(
    'shows imported heading %s and saves a user change to normal body',
    async level => {
      const ctx = setup({ initialHeading: level });
      await select(paragraphs()[0], 0);
      const styles = screen.getByLabelText(
        'Paragraph style'
      ) as HTMLSelectElement;
      expect(styles.value).toBe(`Heading${level}`);
      expect(styles.selectedOptions[0]?.text).toBe(`Heading ${level}`);
      fireEvent.change(styles, { target: { value: 'Normal' } });
      await save(ctx);
      expect(ctx.saved().body).toMatchObject([
        { text: 'Before', properties: { styleId: 'Normal' } },
      ]);
      expect(styles.value).toBe('Normal');
    }
  );
  test.each(['Bold', 'Italic', 'Underline'])(
    'formats newly typed text with %s in one atomic save',
    async name => {
      const ctx = setup();
      await select(paragraphs()[0], 0, 6);
      input('新文字');
      await select(paragraphs()[0], 0, 3);
      fireEvent.click(screen.getByRole('button', { name }));
      await save(ctx);
      expect(ctx.execute).toHaveBeenCalledTimes(1);
      expect(ctx.execute.mock.calls[0][0].command).toMatchObject({
        operation: 'office.document.edit',
      });
      expect(ctx.saved().body).toMatchObject([{ text: '新文字' }]);
    }
  );
  test('caret formatting applies to following input without modifying previous text', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    input('粗体');
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([
      {
        runs: [
          { content: [{ text: 'Before' }] },
          { content: [{ text: '粗体' }], format: { bold: true } },
        ],
      },
    ]);
  });
  test('keyboard shortcuts use the same formatting model', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 1, 5);
    fireEvent.keyDown(document.activeElement!, { key: 'i', ctrlKey: true });
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([
      { runs: [{}, { format: { italic: true } }, {}] },
    ]);
  });
  test('undo and redo work after a successful save, preserving immutable history', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('追加');
    await save(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(texts()).toEqual(['Before']);
    await save(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(texts()).toEqual(['Before追加']);
    await save(ctx);
    expect(ctx.execute).toHaveBeenCalledTimes(3);
  });
  test('Chinese composition only commits after the candidate is accepted', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    const p = paragraphs()[0];
    fireEvent.compositionStart(p);
    p.textContent = 'Before中文';
    fireEvent.input(p, { isComposing: true });
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
    fireEvent.compositionEnd(p, { data: '中文' });
    expect(ctx.guard().hasUnsavedChanges).toBe(true);
    expect(texts()).toEqual(['Before中文']);
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([{ text: 'Before中文' }]);
  });
  test('backspace removes a whole emoji rather than one surrogate', async () => {
    setup({ initial: ['a😀'] });
    await select(paragraphs()[0], 3);
    fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    expect(texts()).toEqual(['a']);
  });
  test('selection can be replaced across two paragraphs', async () => {
    const ctx = setup({ initial: ['第一段', '第二段'] });
    const ps = paragraphs();
    await act(async () => {
      ps[0].focus();
      window
        .getSelection()
        ?.setBaseAndExtent(
          ps[0].querySelector('span span')!.firstChild!,
          1,
          ps[1].querySelector('span span')!.firstChild!,
          1
        );
      document.dispatchEvent(new Event('selectionchange'));
    });
    input('合并');
    expect(texts()).toEqual(['第合并二段']);
    await save(ctx);
    expect(ctx.saved().body).toHaveLength(1);
  });
  test('pastes plain multiline content as multiple paragraphs', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => '\n甲\n乙' },
    });
    fireEvent(document.activeElement!, event);
    expect(texts()).toEqual(['Before', '甲', '乙']);
    await save(ctx);
    expect(ctx.saved().body).toHaveLength(3);
  });
  test('keeps input typed during a pending save and serializes the next save', async () => {
    const ctx = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    ctx.execute.mockImplementationOnce(async data => {
      await gate;
      return ctx.run(data);
    });
    await select(paragraphs()[0], 6);
    input('甲');
    let pending!: Promise<void>;
    await act(async () => {
      pending = ctx.guard().save();
    });
    input('乙');
    expect(texts()).toEqual(['Before甲乙']);
    await act(async () => {
      release();
      await pending;
    });
    expect(texts()).toEqual(['Before甲乙']);
    expect(ctx.guard().hasUnsavedChanges).toBe(true);
    await save(ctx);
    expect(ctx.saved().body).toMatchObject([{ text: 'Before甲乙' }]);
    expect(ctx.execute.mock.calls[1][0].command.expectedRevisionId).toBe(
      'revision-2'
    );
  });
  test('failed saves retain all changes and retry the same idempotency key', async () => {
    const ctx = setup();
    ctx.execute.mockRejectedValueOnce(new Error('private internal stack'));
    await select(paragraphs()[0], 6);
    input('甲');
    await act(async () => {
      await expect(ctx.guard().save()).rejects.toThrow();
    });
    expect(texts()).toEqual(['Before甲']);
    expect(ctx.guard().hasUnsavedChanges).toBe(true);
    expect(screen.getByRole('alert').textContent).not.toContain(
      'private internal stack'
    );
    const first = ctx.execute.mock.calls[0][0].command;
    await save(ctx);
    expect(ctx.execute.mock.calls[1][0].command).toEqual(first);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });
  test('remote version conflict resolves an uncertain request without losing the recovery text', async () => {
    const ctx = setup();
    ctx.execute.mockRejectedValueOnce(new Error('transport timeout'));
    await select(paragraphs()[0], 6);
    input('完整草稿');
    await act(async () => {
      await expect(ctx.guard().save()).rejects.toThrow();
    });
    const pending = ctx.execute.mock.calls[0][0].command;
    expect(ctx.guard().recoveryText?.()).toBe('Before完整草稿');
    await act(async () => ctx.remoteUpdate());
    ctx.execute.mockRejectedValueOnce(
      new UserFriendlyError({
        status: 409,
        code: 'RESOURCE_CONFLICT',
        type: 'RESOURCE_CONFLICT',
        name: 'RESOURCE_CONFLICT',
        message: 'Revision changed',
      })
    );
    await act(async () => ctx.guard().discard());
    expect(ctx.execute.mock.calls[1][0].command).toEqual(pending);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
    await select(paragraphs()[0], 6);
    input('合并草稿');
    await save(ctx);
    expect(ctx.execute.mock.calls[2][0].command.expectedRevisionId).toBe(
      'foreign-revision'
    );
    expect(ctx.saved().body).toMatchObject([{ text: 'Before合并草稿' }]);
  });
  test('discard does not replay a write when the server has not advanced', async () => {
    const ctx = setup();
    ctx.execute.mockRejectedValueOnce(new Error('transport timeout'));
    await select(paragraphs()[0], 6);
    input('保留');
    await act(async () => {
      await expect(ctx.guard().save()).rejects.toThrow();
    });
    await act(async () => {
      await expect(ctx.guard().discard()).rejects.toThrow(
        'document-save-uncertain'
      );
    });
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    expect(ctx.guard().recoveryText?.()).toBe('Before保留');
  });
  test('saving does not steal focus from another input', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('甲');
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    await save(ctx);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
  test('discard before saving restores the base without a command', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('甲');
    await act(async () => ctx.guard().discard());
    expect(texts()).toEqual(['Before']);
    expect(ctx.execute).not.toHaveBeenCalled();
  });
  test('autosaves after a pause', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('甲');
    await waitFor(() => expect(ctx.execute).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });
  test('navigation confirmation pauses autosave until cancel or explicit save', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    await select(paragraphs()[0], 6);
    input('待确认');
    let pause!: ReturnType<NonNullable<OfficeEditorDraft['pauseAutosave']>>;
    act(() => {
      pause = ctx.guard().pauseAutosave!();
    });
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(ctx.execute).not.toHaveBeenCalled();
    expect(ctx.guard().hasUnsavedChanges).toBe(true);
    act(() => pause.resume());
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(ctx.execute).toHaveBeenCalledOnce();
    input('丢弃');
    act(() => {
      pause = ctx.guard().pauseAutosave!();
    });
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    await act(async () => ctx.guard().discard());
    act(() => pause.resume());
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(texts()).toEqual(['Before待确认']);
    expect(ctx.execute).toHaveBeenCalledOnce();
    await select(paragraphs()[0], 'Before待确认'.length);
    input('显式保存');
    act(() => {
      pause = ctx.guard().pauseAutosave!();
    });
    await save(ctx);
    expect(ctx.execute).toHaveBeenCalledTimes(2);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
    act(() => pause.resume());
  });
  test('read-only mode cannot create a draft', async () => {
    const ctx = setup({ readOnly: true });
    await select(paragraphs()[0], 6);
    input('甲');
    fireEvent.keyDown(paragraphs()[0], { key: 'Enter' });
    expect(texts()).toEqual(['Before']);
    expect(ctx.guard().hasUnsavedChanges).toBe(false);
  });
  test('navigation still collapses and restores', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(
      document
        .querySelector('aside[aria-label="Document navigation"]')
        ?.hasAttribute('hidden')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(
      screen.getByRole('complementary', { name: 'Document navigation' })
    ).toBeTruthy();
  });
  test('spell checking is opt-in', () => {
    setup();
    expect(
      screen.getByLabelText('Document pages').getAttribute('spellcheck')
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Spell check' }));
    expect(
      screen.getByLabelText('Document pages').getAttribute('spellcheck')
    ).toBe('true');
  });
  test('existing insertion commands resolve initial client identities to saved IDs', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 3);
    fireEvent.click(screen.getByRole('button', { name: 'Page break' }));
    await waitFor(() => expect(ctx.execute).toHaveBeenCalled());
    expect(ctx.execute.mock.calls[0][0].command).toMatchObject({
      operation: 'office.document.break.insert',
      target: { blockId: 'paragraph:1', offset: 3 },
    });
  });
  test('opening page layout does not write', () => {
    const ctx = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Page setup' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(ctx.execute).not.toHaveBeenCalled();
  });
  test('object dialog input preserves the document insertion position', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 3);
    fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
    const text = screen.getByRole('textbox', { name: 'Text' });
    await act(async () => {
      text.focus();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    fireEvent.change(text, { target: { value: 'Modal shape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(ctx.execute).toHaveBeenCalledOnce());
    expect(ctx.execute.mock.calls[0][0].command).toMatchObject({
      operation: 'office.document.object.insert',
      target: { blockId: 'paragraph:1', offset: 3 },
      object: { type: 'shape', text: 'Modal shape' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('page setup preserves a selected section insertion target', async () => {
    const ctx = setup();
    await select(paragraphs()[0], 1, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Page setup' }));
    const field = screen.getAllByRole('spinbutton')[0];
    await act(async () => {
      field.focus();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Insert after selection' })
    );
    await waitFor(() => expect(ctx.execute).toHaveBeenCalledOnce());
    expect(ctx.execute.mock.calls[0][0].command).toMatchObject({
      operation: 'office.document.section.insert',
      target: { type: 'paragraph', blockId: 'paragraph:1' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  test('mail merge navigation applies field values through the revision command and retains the field', async () => {
    const initial = openDocxPackage(
      createNativeFile({ format: 'docx', paragraphs: [{ text: 'Before' }] })
        .bytes
    );
    const xml = new TextDecoder()
      .decode(initial.requirePart(initial.documentPart))
      .replace(
        /<w:p\b[^>]*>.*?<\/w:p>/s,
        '<w:p><w:fldSimple w:instr="MERGEFIELD Customer"><w:r><w:t>Before</w:t></w:r></w:fldSimple></w:p>'
      );
    const ctx = setup({
      initialBytes: initial.write(
        new Map([[initial.documentPart, new TextEncoder().encode(xml)]])
      ),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mail merge' }));
    expect(ctx.execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Customer'), {
      target: { value: '海棠' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply field values' }));
    await waitFor(() => expect(ctx.execute).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ctx.execute.mock.calls[0][0].command).toMatchObject({
      operation: 'office.document.mail_merge.apply',
      expectedRevisionId: 'revision-1',
      source: 'user',
      values: { Customer: '海棠' },
    });
    expect(texts()).toContain('海棠');
    expect(ctx.saved().references.mailMergeFields).toMatchObject([
      { argument: 'Customer', mailMergeSupported: true },
    ]);
  });
  test('an object-only paragraph is rendered instead of an empty line', async () => {
    const ctx = setup({ initial: [''] });
    await select(paragraphs()[0], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(ctx.execute).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(paragraphs()[0].querySelector('svg path')).not.toBeNull();
    expect(
      paragraphs()[0].querySelector('span[contenteditable="false"]')
    ).toBeTruthy();
  });
});

function objectFixture() {
  const pkg = openDocxPackage(
    createNativeFile({ format: 'docx', paragraphs: [{ text: 'Object owner' }] })
      .bytes
  );
  const paragraph = readDocxSemanticState(pkg).body[0];
  return applyDocxCommand(pkg, {
    version: 'localmind-office-command/v1',
    commandId: 'insert',
    idempotencyKey: 'insert',
    artifactId: 'artifact',
    expectedRevisionId: 'revision-1',
    source: 'user',
    operation: 'office.document.object.insert',
    target: { blockId: paragraph.id, offset: 0 },
    object: {
      type: 'shape',
      shape: 'ellipse',
      widthPt: 100,
      heightPt: 60,
      text: 'Before object',
    },
  }).packageBytes;
}

test('previews and updates a shape in place while preserving its dimensions', async () => {
  const value = setup({ initialBytes: objectFixture() });
  expect(
    screen.getByRole('img', { name: 'Shape' }).querySelector('path')
  ).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit object' }));
  expect((screen.getByLabelText('Width (pt)') as HTMLInputElement).value).toBe(
    '100'
  );
  fireEvent.change(screen.getByLabelText('Text'), {
    target: { value: 'After object' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(value.execute).toHaveBeenCalledTimes(1);
  expect(value.execute.mock.calls[0][0].command).toMatchObject({
    operation: 'office.document.object.update',
    expectedRevisionId: 'revision-1',
    object: {
      type: 'shape',
      shape: 'ellipse',
      text: 'After object',
      widthPt: 100,
      heightPt: 60,
    },
  });
  expect(value.saved().stats.objects).toBe(1);
});

test('object editing respects readonly and keeps a failed draft with its captured revision', async () => {
  const value = setup({ initialBytes: objectFixture() });
  fireEvent.click(screen.getByRole('button', { name: 'Edit object' }));
  fireEvent.change(screen.getByLabelText('Text'), {
    target: { value: 'Unsaved object' },
  });
  act(() => value.remoteUpdate());
  value.execute.mockRejectedValue(new Error('revision conflict'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(value.execute).toHaveBeenCalledTimes(1));
  expect(value.execute.mock.calls[0][0].command.expectedRevisionId).toBe(
    'revision-1'
  );
  expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe(
    'Unsaved object'
  );
  expect(screen.getByRole('dialog')).not.toBeNull();
  cleanup();
  setup({ readOnly: true, initialBytes: objectFixture() });
  expect(
    (screen.getByRole('button', { name: 'Edit object' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
