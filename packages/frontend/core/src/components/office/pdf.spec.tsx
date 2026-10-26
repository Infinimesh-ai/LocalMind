/**
 * @vitest-environment happy-dom
 */
import type { PdfSemanticState } from '@affine/core/modules/office';
import { getOrCreateI18n } from '@affine/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { OfficeEditorDraft } from './edit-draft';
import { PdfEditor } from './pdf';
import { openPdf, renderRedactedPdfPage } from './pdf-tools';
import type * as Shared from './shared';
import { executeAndReloadOfficeCommand } from './shared';

vi.mock('@affine/component', async () => ({
  isComposingKeyboardEvent: (await import('@affine/component/ui/input'))
    .isComposingKeyboardEvent,
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      variant?: string;
    }
  >) => <button {...props}>{children}</button>,
  IconButton: ({
    children,
    size: _size,
    tooltip: _tooltip,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      size?: string;
      tooltip?: string;
    }
  >) => <button {...props}>{children}</button>,
}));

vi.mock('@blocksuite/icons/rc', () => ({
  AddCommentIcon: () => null,
  ArrowDownSmallIcon: () => null,
  ArrowUpSmallIcon: () => null,
  DeleteIcon: () => null,
  MinusIcon: () => null,
  PlusIcon: () => null,
  PrinterIcon: () => null,
  RotateIcon: () => null,
  SearchIcon: () => null,
}));

vi.mock('./pdf-tools', () => ({
  openPdf: vi.fn(),
  renderRedactedPdfPage: vi.fn(),
  searchPdfPages: vi.fn(),
}));

vi.mock('./shared', async importOriginal => ({
  ...(await importOriginal<typeof Shared>()),
  executeAndReloadOfficeCommand: vi.fn(),
}));

const state = {
  schemaVersion: 'localmind-office-pdf-state/v1',
  modelVersion: 'localmind-office-pdf-model/v1',
  pdfVersion: '1.7',
  byteSize: 1024,
  metadata: { keywords: [] },
  pages: [
    {
      id: 'page-1',
      index: 0,
      widthPt: 612,
      heightPt: 792,
      rotationDeg: 0,
      annotations: [
        { id: 'note-1', subtype: 'Highlight', contents: 'Review this' },
        { id: 'field-1', subtype: 'Widget' },
      ],
    },
    {
      id: 'page-2',
      index: 1,
      widthPt: 612,
      heightPt: 792,
      rotationDeg: 0,
      annotations: [],
    },
  ],
  formFields: [],
  compatibility: { signatures: 0, unsupportedFormFields: [] },
  stats: { pages: 2, annotations: 2, formFields: 0 },
} as PdfSemanticState;

describe('PdfEditor', () => {
  const renderPage = vi.fn(() => ({
    cancel: vi.fn(),
    promise: Promise.resolve(),
  }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    }),
    render: renderPage,
    cleanup: vi.fn(),
  }));

  beforeEach(() => {
    vi.mocked(executeAndReloadOfficeCommand).mockReset();
    vi.mocked(executeAndReloadOfficeCommand).mockResolvedValue({
      revision: { id: 'revision-2', sequence: 2, packageUrl: 'about:blank' },
      state,
    } as never);
    vi.mocked(renderRedactedPdfPage).mockResolvedValue('test-png');
    vi.mocked(openPdf).mockResolvedValue({
      document: {
        getPage,
        destroy: vi.fn(async () => {}),
      },
      worker: { destroy: vi.fn() },
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as never);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}

        observe(target: Element) {
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as never
          );
        }

        disconnect() {}
      }
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('Project annotations and signature drafts discard without changing the PDF', async () => {
    const guards = new Set<OfficeEditorDraft>();
    const gql = vi.fn();
    render(
      <PdfEditor
        state={state}
        revision={
          { id: 'revision-1', sequence: 1, packageUrl: 'about:blank' } as never
        }
        artifactId="artifact-1"
        owner={{ kind: 'project', projectId: 'project-1' }}
        graphql={{ gql } as never}
        readOnly={false}
        onRevision={vi.fn()}
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
    fireEvent.change(screen.getByLabelText('Annotation comment'), {
      target: { value: 'Draft annotation' },
    });
    fireEvent.change(screen.getByLabelText('Signer name'), {
      target: { value: 'Alice' },
    });
    const guard = [...guards][0];
    expect(guard.hasUnsavedChanges).toBe(true);
    await act(() => guard.discard());
    expect(guard.hasUnsavedChanges).toBe(false);
    expect(gql).not.toHaveBeenCalled();
  });

  test('renders lazy page thumbnails from one shared PDF document', async () => {
    const onCommentAnchorChange = vi.fn();
    const { container } = render(
      <PdfEditor
        state={state}
        revision={
          {
            id: 'revision-1',
            sequence: 1,
            packageUrl: 'about:blank',
          } as never
        }
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{} as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={onCommentAnchorChange}
        onAiSelectionChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll('canvas[data-page-thumbnail]')
      ).toHaveLength(2);
      expect(renderPage).toHaveBeenCalledTimes(2);
    });
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/notes/i)).toBeNull();

    const firstPage = screen.getByRole('button', {
      name: 'PDF page 1, 1 annotation',
    });
    const secondPage = screen.getByRole('button', {
      name: 'PDF page 2, no annotations',
    });
    expect(firstPage.dataset.annotationCount).toBe('1');
    expect(secondPage.dataset.annotationCount).toBe('0');

    fireEvent.click(secondPage);
    await waitFor(() => {
      expect(onCommentAnchorChange).toHaveBeenLastCalledWith({
        kind: 'pdf',
        revisionId: 'revision-1',
        pageIndex: 1,
      });
    });
  });

  function setupPdf(readOnly = false, semanticState = state) {
    const guards = new Set<OfficeEditorDraft>();
    const onRevision = vi.fn();
    render(
      <PdfEditor
        state={semanticState}
        revision={
          { id: 'revision-1', sequence: 1, packageUrl: 'about:blank' } as never
        }
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{} as never}
        readOnly={readOnly}
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
    return { guards, onRevision };
  }

  test('signature success clears the saved draft, failure preserves it for retry', async () => {
    const { guards, onRevision } = setupPdf();
    vi.mocked(executeAndReloadOfficeCommand).mockRejectedValueOnce(
      new Error('save failed')
    );
    fireEvent.change(screen.getByLabelText('Signer name'), {
      target: { value: 'QA Test' },
    });
    fireEvent.change(screen.getByLabelText('Signature reason'), {
      target: { value: 'Test only' },
    });
    const submit = screen.getByRole('button', { name: 'Add appearance' });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByText(/The action could not be completed/)).toBeTruthy()
    );
    expect([...guards][0].hasUnsavedChanges).toBe(true);
    expect(
      (screen.getByLabelText('Signer name') as HTMLInputElement).value
    ).toBe('QA Test');
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(onRevision).toHaveBeenCalledOnce());
    expect(executeAndReloadOfficeCommand).toHaveBeenCalledTimes(2);
    expect([...guards][0].hasUnsavedChanges).toBe(false);
    expect(
      (screen.getByLabelText('Signer name') as HTMLInputElement).value
    ).toBe('');
    expect(
      (screen.getByLabelText('Signature reason') as HTMLInputElement).value
    ).toBe('');
    expect(
      vi.mocked(executeAndReloadOfficeCommand).mock.calls[1][0].command
    ).toMatchObject({
      operation: 'office.pdf.signature.appearance.add',
      signerName: 'QA Test',
      reason: 'Test only',
    });
  });

  test('redaction requires the accessible confirmation and cancel performs no write', async () => {
    setupPdf();
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply permanent redaction' })
    );
    expect(screen.getByRole('dialog').textContent).toContain(
      'Earlier revisions still contain'
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );
    expect(renderRedactedPdfPage).not.toHaveBeenCalled();
    expect(executeAndReloadOfficeCommand).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply permanent redaction' })
    );
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Apply permanent redaction',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(renderRedactedPdfPage).toHaveBeenCalledOnce();
    expect(executeAndReloadOfficeCommand).toHaveBeenCalledOnce();
  });

  test('read-only PDF disables signature and redaction controls', () => {
    setupPdf(true);
    expect(
      screen
        .getByRole('button', { name: 'Add appearance' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Apply permanent redaction' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(executeAndReloadOfficeCommand).not.toHaveBeenCalled();
  });

  test('standard and unknown annotation types have readable labels', () => {
    setupPdf(false, {
      ...state,
      pages: [
        {
          ...state.pages[0],
          annotations: [
            { id: 'strike', subtype: 'StrikeOut', contents: 'Strike' },
            { id: 'stamp', subtype: 'Stamp', contents: 'Stamp' },
            { id: 'unknown', subtype: 'VendorSpecific', contents: 'Other' },
          ],
        },
      ],
    });
    expect(
      screen.getByRole('textbox', { name: 'Edit Strikeout annotation' })
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', {
        name: 'Edit Signature appearance annotation',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Edit Annotations annotation' })
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'com.affine.office.annotation-type.'
    );
  });

  test('annotation region is used by immediate and guarded draft saves', async () => {
    const { guards } = setupPdf();
    fireEvent.change(screen.getByLabelText('Annotation region · X (pt)'), {
      target: { value: '48' },
    });
    fireEvent.change(screen.getByLabelText('Annotation region · Y (pt)'), {
      target: { value: '645' },
    });
    fireEvent.change(screen.getByLabelText('Annotation region · Width (pt)'), {
      target: { value: '440' },
    });
    fireEvent.change(screen.getByLabelText('Annotation region · Height (pt)'), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByLabelText('Annotation comment'), {
      target: { value: 'Immediate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    await waitFor(() =>
      expect(executeAndReloadOfficeCommand).toHaveBeenCalledOnce()
    );
    expect(
      vi.mocked(executeAndReloadOfficeCommand).mock.calls[0][0].command
    ).toMatchObject({
      annotation: { rect: { xPt: 48, yPt: 645, widthPt: 440, heightPt: 18 } },
    });
    await waitFor(() => expect([...guards][0].hasUnsavedChanges).toBe(false));
    fireEvent.change(screen.getByLabelText('Annotation comment'), {
      target: { value: 'Guarded draft' },
    });
    await act(() => [...guards][0].save());
    expect(
      vi.mocked(executeAndReloadOfficeCommand).mock.calls[1][0].command
    ).toMatchObject({
      annotation: {
        contents: 'Guarded draft',
        rect: { xPt: 48, yPt: 645, widthPt: 440, heightPt: 18 },
      },
    });
  });

  test('existing annotation region update preserves the captured revision and annotation identity', async () => {
    setupPdf(false, {
      ...state,
      pages: [
        {
          ...state.pages[0],
          annotations: [
            {
              id: 'annotation-166',
              subtype: 'Highlight',
              contents: 'Original',
              rect: { xPt: 72, yPt: 664, widthPt: 220, heightPt: 24 },
            },
          ],
        },
      ],
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Adjust annotation region' })
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Annotation region · Y (pt)'), {
      target: { value: '640' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Apply region' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      vi.mocked(executeAndReloadOfficeCommand).mock.calls[0][0].command
    ).toMatchObject({
      operation: 'office.pdf.annotation.update',
      annotationId: 'annotation-166',
      expectedRevisionId: 'revision-1',
      rect: { xPt: 72, yPt: 640, widthPt: 220, heightPt: 24 },
    });
  });
});

beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});
