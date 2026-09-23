/** @vitest-environment happy-dom */
import type * as Components from '@affine/component';
import type { DocxSemanticState } from '@affine/core/modules/office';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type PropsWithChildren, useState } from 'react';
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

const state: DocxSemanticState = {
  schemaVersion: 'localmind-office-docx-state/v1',
  modelVersion: 'localmind-office-docx-model/v1',
  documentPart: 'word/document.xml',
  body: [
    {
      id: 'paragraph-1',
      type: 'paragraph',
      text: 'Before',
      runs: [{ content: [{ type: 'text', text: 'Before' }] }],
      fields: [],
      bookmarks: [],
    },
  ],
  styles: [],
  sections: [],
  stories: [],
  notes: { footnotes: [], endnotes: [] },
  references: {
    fields: [],
    bookmarks: [],
    tableOfContentsFields: [],
    crossReferenceFields: [],
    mailMergeFields: [],
  },
  review: { trackRevisions: false, comments: [], changes: [] },
  package: { parts: [], opaqueParts: [], externalRelationships: [] },
  compatibility: { unsupportedBodyElements: [] },
  stats: {
    blocks: 1,
    paragraphs: 1,
    runs: 1,
    textCharacters: 6,
    tables: 0,
    styles: 0,
    sections: 0,
    headersFooters: 0,
    footnotes: 0,
    endnotes: 0,
    fields: 0,
    bookmarks: 0,
    comments: 0,
    changes: 0,
    objects: 0,
    packageParts: 0,
    opaqueParts: 0,
    externalRelationships: 0,
  },
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  vi.resetAllMocks();
});

function setup(editParagraph = true) {
  const guards = new Set<OfficeEditorDraft>();
  const onRevision = vi.fn();
  render(
    <DocumentEditor
      state={state}
      revision={
        { id: 'revision-1', sequence: 1, packageUrl: '/document.docx' } as never
      }
      artifactId="artifact-1"
      owner={{ kind: 'project', projectId: 'project-1' }}
      graphql={{} as never}
      readOnly={false}
      onRevision={onRevision}
      onCommentAnchorChange={vi.fn()}
      onAiSelectionChange={vi.fn()}
      registerDraft={guard => {
        guards.add(guard);
        return () => {
          guards.delete(guard);
        };
      }}
    />
  );
  const paragraph = screen.getByLabelText('Editable document paragraph');
  if (editParagraph) {
    paragraph.textContent = 'After';
    fireEvent.input(paragraph);
  }
  return { paragraph, guard: [...guards][0], guards, onRevision };
}

async function selectParagraphText(paragraph: HTMLElement, start = 0, end = 6) {
  const text = paragraph.querySelector('span span')?.firstChild;
  expect(text).toBeTruthy();
  const range = document.createRange();
  range.setStart(text!, start);
  range.setEnd(text!, end);
  const browserSelection = window.getSelection();
  browserSelection?.removeAllRanges();
  browserSelection?.addRange(range);
  await act(async () => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('Project native document drafts', () => {
  test('collapses and restores the document navigation', () => {
    setup(false);
    const navigation = screen.getByLabelText('Document navigation');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(navigation.hasAttribute('hidden')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(navigation.hasAttribute('hidden')).toBe(false);
  });

  test('uses a collapsed caret as the target for insertion commands', async () => {
    const { paragraph } = setup(false);
    const text = paragraph.querySelector('span span')?.firstChild;
    expect(text).toBeTruthy();
    const range = document.createRange();
    range.setStart(text!, 3);
    range.collapse(true);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValueOnce({
      revision: { id: 'revision-2', sequence: 2 } as never,
      state,
      preview: {} as never,
      summary: {},
    });
    const pageBreak = screen.getByRole('button', { name: 'Page break' });
    expect(pageBreak.hasAttribute('disabled')).toBe(false);
    fireEvent.click(pageBreak);

    await waitFor(() =>
      expect(executeAndReloadOfficeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            operation: 'office.document.break.insert',
            target: { blockId: 'paragraph-1', offset: 3 },
          }),
        })
      )
    );
  });

  test('applies toolbar formatting directly to the selected text', async () => {
    const { paragraph, onRevision } = setup(false);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.hasAttribute('disabled')).toBe(true);
    await selectParagraphText(paragraph);
    expect(bold.hasAttribute('disabled')).toBe(false);

    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValueOnce({
      revision: { id: 'revision-2', sequence: 2 } as never,
      state,
      preview: {} as never,
      summary: {},
    });
    fireEvent.click(bold);

    await waitFor(() =>
      expect(executeAndReloadOfficeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            operation: 'office.document.text.format',
            target: {
              type: 'text_range',
              start: { blockId: 'paragraph-1', offset: 0 },
              end: { blockId: 'paragraph-1', offset: 6 },
            },
            format: { bold: true },
          }),
        })
      )
    );
    expect(onRevision).toHaveBeenCalledOnce();
  });

  test('uses the same immediate formatting path for keyboard shortcuts', async () => {
    const { paragraph } = setup(false);
    await selectParagraphText(paragraph, 1, 5);
    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValueOnce({
      revision: { id: 'revision-2', sequence: 2 } as never,
      state,
      preview: {} as never,
      summary: {},
    });

    fireEvent.keyDown(screen.getByLabelText('Document pages'), {
      key: 'i',
      ctrlKey: true,
    });

    await waitFor(() =>
      expect(
        vi.mocked(executeAndReloadOfficeCommand).mock.lastCall?.[0].command
      ).toMatchObject({
        operation: 'office.document.text.format',
        target: {
          start: { blockId: 'paragraph-1', offset: 1 },
          end: { blockId: 'paragraph-1', offset: 5 },
        },
        format: { italic: true },
      })
    );
  });

  test('opening a layout dialog is clean and discarding form edits never writes', async () => {
    const { guards } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'Page setup' }));
    expect([...guards].some(guard => guard.hasUnsavedChanges)).toBe(false);
    const width = screen.getByLabelText('Page width (pt)');
    fireEvent.change(width, { target: { value: '600' } });
    const draft = [...guards].find(guard => guard.hasUnsavedChanges);
    expect(draft).toBeDefined();
    await act(() => draft!.discard());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(executeAndReloadOfficeCommand).not.toHaveBeenCalled();
  });

  test('blur and discard never execute the draft as a command', async () => {
    const { paragraph, guard } = setup();
    fireEvent.blur(paragraph);
    expect(guard.hasUnsavedChanges).toBe(true);
    expect(executeAndReloadOfficeCommand).not.toHaveBeenCalled();
    await act(() => guard.discard());
    expect(guard.hasUnsavedChanges).toBe(false);
    expect(paragraph.textContent).toBe('Before');
    expect(executeAndReloadOfficeCommand).not.toHaveBeenCalled();
  });

  test('explicit save retains expected revision and clears only a successful draft', async () => {
    const { guard, onRevision } = setup();
    vi.mocked(executeAndReloadOfficeCommand).mockRejectedValueOnce(
      new Error('conflict')
    );
    await expect(guard.save()).rejects.toThrow('conflict');
    expect(guard.hasUnsavedChanges).toBe(true);
    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValueOnce({
      revision: { id: 'revision-2', sequence: 2 } as never,
      state,
      preview: {} as never,
      summary: {},
    });
    await act(() => guard.save());
    expect(
      vi.mocked(executeAndReloadOfficeCommand).mock.lastCall?.[0].command
    ).toMatchObject({
      artifactId: 'artifact-1',
      expectedRevisionId: 'revision-1',
      operation: 'office.document.text.replace',
    });
    expect(guard.hasUnsavedChanges).toBe(false);
    expect(onRevision).toHaveBeenCalledOnce();
  });

  test('remounts browser-mutated content after advancing the immutable revision', async () => {
    const guards = new Set<OfficeEditorDraft>();
    const paragraph = state.body[0];
    if (!paragraph || paragraph.type !== 'paragraph') {
      throw new Error(
        'Expected the document fixture to start with a paragraph'
      );
    }
    const afterState: DocxSemanticState = {
      ...state,
      body: [
        {
          ...paragraph,
          text: 'After',
          runs: [{ content: [{ type: 'text', text: 'After' }] }],
        },
      ],
    };
    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValueOnce({
      revision: { id: 'revision-2', sequence: 2 } as never,
      state: afterState,
      preview: {} as never,
      summary: {},
    });

    function RevisionHarness() {
      const [current, setCurrent] = useState<{
        revision: Shared.OfficeRevision;
        state: DocxSemanticState;
      }>({
        revision: {
          id: 'revision-1',
          sequence: 1,
          packageUrl: '/document.docx',
        } as Shared.OfficeRevision,
        state,
      });
      return (
        <DocumentEditor
          state={current.state}
          revision={current.revision}
          artifactId="artifact-1"
          owner={{ kind: 'project', projectId: 'project-1' }}
          graphql={{} as never}
          readOnly={false}
          onRevision={(revision, nextState) =>
            setCurrent({ revision, state: nextState })
          }
          onCommentAnchorChange={vi.fn()}
          onAiSelectionChange={vi.fn()}
          registerDraft={guard => {
            guards.add(guard);
            return () => guards.delete(guard);
          }}
        />
      );
    }

    render(<RevisionHarness />);
    const original = screen.getByLabelText('Editable document paragraph');
    original.textContent = 'After';
    fireEvent.input(original);
    const guard = [...guards][0];
    await act(() => guard.save());

    const refreshed = screen.getByLabelText('Editable document paragraph');
    expect(refreshed).not.toBe(original);
    expect(refreshed.textContent).toBe('After');
  });
});
