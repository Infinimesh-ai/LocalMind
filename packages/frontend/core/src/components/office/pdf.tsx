import {
  Button,
  IconButton,
  isComposingKeyboardEvent,
  Modal,
} from '@affine/component';
import type {
  OfficeCommand,
  PdfFormField,
  PdfSemanticState,
} from '@affine/core/modules/office';
import { officeAssetUrl } from '@affine/core/modules/office';
import { I18n, useI18n } from '@affine/i18n';
import {
  AddCommentIcon,
  ArrowDownSmallIcon,
  ArrowUpSmallIcon,
  DeleteIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  RotateIcon,
  SearchIcon,
} from '@blocksuite/icons/rc';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOfficeEditorDraft, useOfficeSelectionChange } from './edit-draft';
import {
  boundedPdfRegion,
  PdfAnnotationRegionDialog,
  type PdfRegion,
  PdfRegionFields,
} from './pdf-region';
import {
  openPdf,
  type PdfSearchResult,
  renderRedactedPdfPage,
  searchPdfPages,
} from './pdf-tools';
import {
  executeAndReloadOfficeCommand,
  type NativeOfficeEditorProps,
  officeErrorMessage,
} from './shared';
import * as styles from './surface.css';

type OpenedPdf = Awaited<ReturnType<typeof openPdf>>;
type PdfDocumentProxy = OpenedPdf['document'];
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>;

function fieldDraft(field: PdfFormField) {
  if (Array.isArray(field.value)) return field.value;
  return field.value ?? (field.type === 'checkbox' ? false : '');
}

function annotationLabel(subtype: string) {
  if (subtype.toLowerCase() === 'stamp')
    return I18n['com.affine.office.signature-appearance']();
  const types: Record<string, string> = {
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'Strikeout',
    text: 'Text',
    freetext: 'FreeText',
    square: 'Square',
    circle: 'Circle',
    ink: 'Ink',
  };
  const key = Object.hasOwn(types, subtype.toLowerCase())
    ? types[subtype.toLowerCase()]
    : undefined;
  return key
    ? I18n.t('com.affine.office.annotation-type.' + key)
    : I18n['com.affine.office.annotations']();
}

function disposePdf(opened: OpenedPdf) {
  opened.document.destroy().catch(console.error);
  opened.worker.destroy();
}

function usePdfDocument(url: string) {
  const [resource, setResource] = useState<{
    url: string;
    opened: OpenedPdf | null;
    error: string | null;
  }>({ url, opened: null, error: null });

  useEffect(() => {
    let active = true;
    let opened: OpenedPdf | null = null;
    setResource({ url, opened: null, error: null });

    void openPdf(url)
      .then(result => {
        opened = result;
        if (active) {
          setResource({ url, opened: result, error: null });
        } else {
          disposePdf(result);
        }
      })
      .catch(error => {
        if (active) {
          setResource({ url, opened: null, error: officeErrorMessage(error) });
        }
      });

    return () => {
      active = false;
      if (opened) disposePdf(opened);
    };
  }, [url]);

  if (resource.url !== url) {
    return { document: null, error: null };
  }
  return {
    document: resource.opened?.document ?? null,
    error: resource.error,
  };
}

function PdfCanvasPage({
  pdfDocument,
  documentError,
  pageIndex,
  zoom,
  previewRegion,
}: {
  pdfDocument: PdfDocumentProxy | null;
  documentError: string | null;
  pageIndex: number;
  zoom: number;
  previewRegion: PdfRegion | null;
}) {
  const i18n = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedViewport, setRenderedViewport] = useState<ReturnType<
    PdfPageProxy['getViewport']
  > | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const next = {
        width: Math.round(host.clientWidth),
        height: Math.round(host.clientHeight),
      };
      setViewport(current =>
        current.width === next.width && current.height === next.height
          ? current
          : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!pdfDocument) {
      canvas.width = 0;
      canvas.height = 0;
      setRendering(true);
      setRenderError(null);
      setRenderedViewport(null);
      return;
    }
    if (!viewport.width || !viewport.height) return;
    let active = true;
    let page: PdfPageProxy | null = null;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null =
      null;

    setRendering(true);
    setRenderError(null);
    setRenderedViewport(null);
    const render = async () => {
      page = await pdfDocument.getPage(pageIndex + 1);
      if (!active) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(120, viewport.width - 32);
      const availableHeight = Math.max(120, viewport.height - 32);
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height
      );
      const pageViewport = page.getViewport({
        scale: Math.max(0.1, fitScale * zoom),
      });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(pageViewport.width * outputScale);
      canvas.height = Math.ceil(pageViewport.height * outputScale);
      canvas.style.width = `${Math.ceil(pageViewport.width)}px`;
      canvas.style.height = `${Math.ceil(pageViewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context)
        throw new Error(
          i18n['com.affine.office.canvas-rendering-is-unavailable']()
        );
      context.setTransform(1, 0, 0, 1, 0, 0);
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: pageViewport,
        background: '#ffffff',
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await renderTask.promise;
      if (active) {
        setRendering(false);
        setRenderedViewport(pageViewport);
      }
    };
    render().catch(error => {
      if (!active || error?.name === 'RenderingCancelledException') return;
      setRendering(false);
      setRenderError(officeErrorMessage(error));
    });

    return () => {
      active = false;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [pageIndex, pdfDocument, viewport.height, viewport.width, zoom, i18n]);

  const status =
    documentError ??
    renderError ??
    (pdfDocument
      ? i18n['com.affine.office.rendering-pdf-page']()
      : i18n['com.affine.office.loading-pdf-document']());

  const preview =
    previewRegion && renderedViewport
      ? renderedViewport.convertToViewportRectangle([
          previewRegion.xPt,
          previewRegion.yPt,
          previewRegion.xPt + previewRegion.widthPt,
          previewRegion.yPt + previewRegion.heightPt,
        ])
      : null;

  return (
    <div className={styles.pdfCanvasHost} ref={hostRef}>
      <div className={styles.pdfCanvasLayer}>
        <canvas
          className={styles.pdfCanvas}
          ref={canvasRef}
          aria-label={I18n['com.affine.office.rendered-pdf-page']({
            number: String(pageIndex + 1),
          })}
        />
        {preview && renderedViewport ? (
          <div
            aria-hidden="true"
            className={styles.pdfRegionPreview}
            style={{
              left: `${(Math.min(preview[0], preview[2]) / renderedViewport.width) * 100}%`,
              top: `${(Math.min(preview[1], preview[3]) / renderedViewport.height) * 100}%`,
              width: `${(Math.abs(preview[2] - preview[0]) / renderedViewport.width) * 100}%`,
              height: `${(Math.abs(preview[3] - preview[1]) / renderedViewport.height) * 100}%`,
            }}
          />
        ) : null}
      </div>
      {rendering || documentError || renderError ? (
        <div
          className={styles.pdfCanvasStatus}
          role={documentError || renderError ? 'alert' : 'status'}
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}

function PdfPageThumbnail({
  pdfDocument,
  documentError,
  pageIndex,
  active,
}: {
  pdfDocument: PdfDocumentProxy | null;
  documentError: string | null;
  pageIndex: number;
  active: boolean;
}) {
  const i18n = useI18n();
  const hostRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(active);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    if (active) {
      setShouldRender(true);
      return;
    }
    if (shouldRender) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, shouldRender]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !host) return;
    if (!pdfDocument) {
      canvas.width = 0;
      canvas.height = 0;
      setRendering(true);
      setRenderError(false);
      return;
    }
    if (!shouldRender) return;

    let mounted = true;
    let page: PdfPageProxy | null = null;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null =
      null;
    setRendering(true);
    setRenderError(false);

    const render = async () => {
      page = await pdfDocument.getPage(pageIndex + 1);
      if (!mounted) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(48, host.clientWidth || 120);
      const viewport = page.getViewport({
        scale: targetWidth / baseViewport.width,
      });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context)
        throw new Error(
          i18n['com.affine.office.canvas-rendering-is-unavailable']()
        );
      context.setTransform(1, 0, 0, 1, 0, 0);
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: '#ffffff',
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await renderTask.promise;
      if (mounted) setRendering(false);
    };
    render().catch(error => {
      if (!mounted || error?.name === 'RenderingCancelledException') return;
      setRendering(false);
      setRenderError(true);
    });

    return () => {
      mounted = false;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [pageIndex, pdfDocument, shouldRender, i18n]);

  const unavailable = Boolean(documentError) || renderError;
  return (
    <span className={styles.pageMiniature} ref={hostRef}>
      <canvas
        className={styles.pdfThumbnailCanvas}
        ref={canvasRef}
        data-page-thumbnail={pageIndex}
        aria-hidden="true"
      />
      {rendering || unavailable ? (
        <span
          className={styles.pdfThumbnailStatus}
          data-error={unavailable}
          aria-hidden="true"
        >
          {unavailable
            ? i18n['com.affine.office.preview-unavailable']()
            : i18n['com.affine.office.loading-preview']()}
        </span>
      ) : null}
    </span>
  );
}

export function PdfEditor({
  state,
  revision,
  artifactId,
  owner,
  graphql,
  readOnly,
  onRevision,
  onCommentAnchorChange,
  onAiSelectionChange,
  registerDraft,
  beforeSelectionChange,
}: NativeOfficeEditorProps<PdfSemanticState>) {
  const i18n = useI18n();
  const changeSelection = useOfficeSelectionChange(beforeSelectionChange);
  const [pageIndex, setPageIndex] = useState(0);
  const [annotationText, setAnnotationText] = useState('');
  const [annotationSubtype, setAnnotationSubtype] = useState<
    'text' | 'highlight' | 'underline' | 'strikeout' | 'square'
  >('highlight');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [signerName, setSignerName] = useState('');
  const [signatureReason, setSignatureReason] = useState('');
  const [annotationRect, setAnnotationRect] = useState<PdfRegion>({
    xPt: 72,
    yPt: 664,
    widthPt: 220,
    heightPt: 24,
  });
  const [signatureRect, setSignatureRect] = useState<PdfRegion>({
    xPt: 352,
    yPt: 48,
    widthPt: 220,
    heightPt: 60,
  });
  const [previewRegion, setPreviewRegion] = useState<{
    pageIndex: number;
    rect: PdfRegion;
  } | null>(null);
  const [annotationRegion, setAnnotationRegion] = useState<{
    id: string;
    revisionId: string;
    rect: PdfRegion;
  } | null>(null);
  const draftValues = useRef({ annotationText, signerName, signatureReason });
  draftValues.current = { annotationText, signerName, signatureReason };
  const latestRevision = useRef(revision);
  const latestPdfState = useRef(state);
  if (revision.sequence >= latestRevision.current.sequence) {
    latestRevision.current = revision;
    latestPdfState.current = state;
  }
  const [redactionRect, setRedactionRect] = useState({
    xPt: 72,
    yPt: 640,
    widthPt: 180,
    heightPt: 24,
  });
  const [processing, setProcessing] = useState(false);
  const [redactionConfirmation, setRedactionConfirmation] = useState(false);
  const redactionInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const commandInFlight = useRef(false);
  const annotationDrafts = useRef(
    new Map<string, { original: string; value: string }>()
  );
  const annotationWriting = useRef<string | null>(null);
  const [, setAnnotationDraftVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const viewerRef = useRef<HTMLIFrameElement>(null);
  const pdfResource = usePdfDocument(revision.packageUrl);
  const page = state.pages[Math.min(pageIndex, state.pages.length - 1)];
  const preview = useCallback(
    (rect: PdfRegion) => {
      setPreviewRegion({ pageIndex, rect });
    },
    [pageIndex]
  );
  const editableAnnotations = useMemo(
    () =>
      page?.annotations.filter(annotation => annotation.subtype !== 'Widget') ??
      [],
    [page]
  );

  useEffect(() => {
    if (pageIndex >= state.pages.length) {
      setPageIndex(Math.max(0, state.pages.length - 1));
    }
  }, [pageIndex, state.pages.length]);

  useEffect(() => {
    onCommentAnchorChange(
      page ? { kind: 'pdf', revisionId: revision.id, pageIndex } : null
    );
    onAiSelectionChange(
      page ? { kind: 'pdf', target: { type: 'page', pageIndex } } : null
    );
  }, [
    onAiSelectionChange,
    onCommentAnchorChange,
    page,
    pageIndex,
    revision.id,
  ]);

  useEffect(() => {
    if (!page) return;
    setAnnotationRect(current => boundedPdfRegion(current, page));
    setSignatureRect(current => boundedPdfRegion(current, page));
    setRedactionRect(current => boundedPdfRegion(current, page));
  }, [page]);

  const runCommand = useCallback(
    async (command: OfficeCommand, message: string) => {
      if (readOnly || saving || commandInFlight.current) return false;
      commandInFlight.current = true;
      setSaving(true);
      setError(null);
      setStatus(
        I18n['com.affine.office.previewing-operation']({ operation: message })
      );
      try {
        const result = await executeAndReloadOfficeCommand<PdfSemanticState>({
          graphql,
          owner,
          kind: 'pdf',
          command,
        });
        latestRevision.current = result.revision;
        latestPdfState.current = result.state;
        onRevision(result.revision, result.state);
        setStatus(
          I18n['com.affine.office.operation-saved']({
            operation: message,
            version: String(result.revision.sequence),
          })
        );
        return true;
      } catch (err) {
        setError(officeErrorMessage(err, owner));
        setStatus(i18n['com.affine.office.save-failed']());
        return false;
      } finally {
        commandInFlight.current = false;
        setSaving(false);
      }
    },
    [graphql, onRevision, owner, readOnly, saving, i18n]
  );

  const commandBase = useCallback(() => {
    const id = nanoid();
    return {
      version: 'localmind-office-command/v1' as const,
      commandId: id,
      idempotencyKey: `office-user:${id}`,
      artifactId,
      expectedRevisionId: revision.id,
      source: 'user' as const,
    };
  }, [artifactId, revision.id]);

  const flushAnnotationDraft = useCallback(async () => {
    if (readOnly || saving || commandInFlight.current) return false;
    const entry = annotationDrafts.current.entries().next().value;
    if (!entry) return true;
    const [annotationId, draft] = entry;
    const current = latestPdfState.current.pages
      .flatMap(item => item.annotations)
      .find(item => item.id === annotationId);
    if (!current || (current.contents ?? '') !== draft.original) {
      setError(I18n['com.affine.office.error.conflict']());
      return false;
    }
    annotationWriting.current = annotationId;
    const saved = await runCommand(
      {
        ...commandBase(),
        expectedRevisionId: latestRevision.current.id,
        operation: 'office.pdf.annotation.update',
        annotationId,
        contents: draft.value,
      },
      i18n['com.affine.office.annotation-update']()
    );
    annotationWriting.current = null;
    if (saved) {
      const currentDraft = annotationDrafts.current.get(annotationId);
      if (currentDraft === draft) {
        annotationDrafts.current.delete(annotationId);
      } else if (currentDraft?.original === draft.original) {
        annotationDrafts.current.set(annotationId, {
          ...currentDraft,
          original: draft.value,
        });
      }
      setAnnotationDraftVersion(value => value + 1);
    }
    return saved;
  }, [commandBase, i18n, readOnly, runCommand, saving]);

  useEffect(() => {
    if (!saving && !error && annotationDrafts.current.size) {
      flushAnnotationDraft().catch(console.error);
    }
  }, [saving, error, flushAnnotationDraft]);

  useOfficeEditorDraft(registerDraft, {
    get hasUnsavedChanges() {
      return (
        annotationDrafts.current.size > 0 ||
        Object.values(draftValues.current).some(value => value.length > 0)
      );
    },
    save: async () => {
      if (readOnly || saving || !page)
        throw new Error(
          i18n['com.affine.office.office-editor-is-not-writable']()
        );
      while (annotationDrafts.current.size) {
        if (!(await flushAnnotationDraft())) {
          throw new Error(i18n['com.affine.office.save-failed']());
        }
      }
      const draft = draftValues.current;
      if (draft.signatureReason && !draft.signerName.trim())
        throw new Error(i18n['com.affine.office.signature-name-is-required']());
      const commands: {
        kind: 'annotation' | 'signature';
        command: OfficeCommand;
      }[] = [];
      if (draft.annotationText)
        commands.push({
          kind: 'annotation',
          command: {
            ...commandBase(),
            operation: 'office.pdf.annotation.add',
            target: { type: 'page', pageIndex },
            annotation: {
              subtype: annotationSubtype,
              rect: boundedPdfRegion(annotationRect, page),
              contents: draft.annotationText,
              color: '#FFFF00',
            },
          },
        });
      if (draft.signerName)
        commands.push({
          kind: 'signature',
          command: {
            ...commandBase(),
            operation: 'office.pdf.signature.appearance.add',
            target: { type: 'page', pageIndex },
            rect: boundedPdfRegion(signatureRect, page),
            signerName: draft.signerName,
            reason: draft.signatureReason || undefined,
          },
        });
      for (const { kind, command } of commands) {
        const result = await executeAndReloadOfficeCommand<PdfSemanticState>({
          graphql,
          owner,
          kind: 'pdf',
          command: {
            ...command,
            expectedRevisionId: latestRevision.current.id,
          },
        });
        latestRevision.current = result.revision;
        latestPdfState.current = result.state;
        if (kind === 'annotation') {
          draftValues.current.annotationText = '';
          setAnnotationText('');
        } else {
          draftValues.current.signerName = '';
          draftValues.current.signatureReason = '';
          setSignerName('');
          setSignatureReason('');
        }
        onRevision(result.revision, result.state);
      }
    },
    discard: async () => {
      annotationDrafts.current.clear();
      setAnnotationDraftVersion(value => value + 1);
      draftValues.current = {
        annotationText: '',
        signerName: '',
        signatureReason: '',
      };
      setAnnotationText('');
      setSignerName('');
      setSignatureReason('');
    },
  });

  const reorder = useCallback(
    async (from: number, to: number) => {
      if (to < 0 || to >= state.pages.length) return;
      const order = state.pages.map((_, index) => index);
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      const saved = await runCommand(
        {
          ...commandBase(),
          operation: 'office.pdf.pages.reorder',
          order,
        },
        i18n['com.affine.office.page-order']()
      );
      if (saved) setPageIndex(to);
    },
    [commandBase, runCommand, state.pages, i18n]
  );

  const updateForm = useCallback(
    async (field: PdfFormField, value: string | boolean | string[]) => {
      await runCommand(
        {
          ...commandBase(),
          operation: 'office.pdf.form.set',
          fieldName: field.name,
          value,
        },
        I18n['com.affine.office.named-form-field']({ name: field.name })
      );
    },
    [commandBase, runCommand]
  );

  const search = useCallback(async () => {
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const results = await searchPdfPages(revision.packageUrl, searchQuery);
      setSearchResults(results);
      setStatus(
        results.length
          ? I18n['com.affine.office.match-count']({
              count: results.reduce((total, item) => total + item.matches, 0),
            })
          : i18n['com.affine.office.no-search-matches']()
      );
    } catch (err) {
      setError(officeErrorMessage(err, owner));
      setStatus(i18n['com.affine.office.search-failed']());
    } finally {
      setSearching(false);
    }
  }, [owner, revision.packageUrl, searchQuery, searching, i18n]);

  const applyRedaction = useCallback(async () => {
    if (!page || readOnly || processing || saving || redactionInFlight.current)
      return;
    redactionInFlight.current = true;
    setProcessing(true);
    setError(null);
    try {
      const flattenedPagePngBase64 = await renderRedactedPdfPage(
        revision.packageUrl,
        pageIndex,
        page,
        [redactionRect]
      );
      const saved = await runCommand(
        {
          ...commandBase(),
          operation: 'office.pdf.redaction.apply',
          target: { type: 'page', pageIndex },
          flattenedPagePngBase64,
          rects: [redactionRect],
        },
        i18n['com.affine.office.permanent-redaction']()
      );
      if (saved) setRedactionConfirmation(false);
    } catch (err) {
      setError(officeErrorMessage(err, owner));
      setStatus(i18n['com.affine.office.redaction-failed']());
    } finally {
      redactionInFlight.current = false;
      setProcessing(false);
    }
  }, [
    commandBase,
    owner,
    page,
    pageIndex,
    processing,
    readOnly,
    redactionRect,
    revision.packageUrl,
    runCommand,
    saving,

    i18n,
  ]);

  if (!page) {
    return (
      <div className={styles.editor}>
        <div className={styles.emptyState} role="status">
          {i18n['com.affine.office.this-pdf-has-no-pages']()}{' '}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label={i18n['com.affine.office.pdf-page-operations']()}
      >
        <span>
          {i18n['com.affine.office.page-position']({
            current: String(pageIndex + 1),
            total: String(state.pages.length),
          })}
        </span>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.move-page-up']()}
          aria-label={i18n['com.affine.office.move-page-up']()}
          disabled={readOnly || saving || pageIndex === 0}
          onClick={() => void reorder(pageIndex, pageIndex - 1)}
        >
          <ArrowUpSmallIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.move-page-down']()}
          aria-label={i18n['com.affine.office.move-page-down']()}
          disabled={readOnly || saving || pageIndex === state.pages.length - 1}
          onClick={() => void reorder(pageIndex, pageIndex + 1)}
        >
          <ArrowDownSmallIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.rotate-page-clockwise']()}
          aria-label={i18n['com.affine.office.rotate-page-clockwise']()}
          disabled={readOnly || saving}
          onClick={() =>
            void runCommand(
              {
                ...commandBase(),
                operation: 'office.pdf.page.rotate',
                target: { type: 'page', pageIndex },
                rotationDeg: ((page.rotationDeg + 90) % 360) as
                  | 0
                  | 90
                  | 180
                  | 270,
              },
              i18n['com.affine.office.page-rotation']()
            )
          }
        >
          <RotateIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.delete-page']()}
          aria-label={i18n['com.affine.office.delete-page']()}
          disabled={readOnly || saving || state.pages.length === 1}
          onClick={() =>
            void runCommand(
              {
                ...commandBase(),
                operation: 'office.pdf.page.delete',
                target: { type: 'page', pageIndex },
              },
              i18n['com.affine.office.page-deletion']()
            )
          }
        >
          <DeleteIcon />
        </IconButton>
        <input
          className={styles.pdfSearchInput}
          value={searchQuery}
          aria-label={i18n['com.affine.office.search-pdf-text']()}
          placeholder={i18n['com.affine.office.search-pdf']()}
          onChange={event => setSearchQuery(event.target.value)}
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              !isComposingKeyboardEvent(event) &&
              !event.repeat
            ) {
              event.preventDefault();
              search().catch(console.error);
            }
          }}
        />
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.search-pdf']()}
          aria-label={i18n['com.affine.office.search-pdf']()}
          disabled={searching || !searchQuery.trim()}
          onClick={() => void search()}
        >
          <SearchIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.keyboardShortcuts.zoomOut']()}
          aria-label={i18n['com.affine.keyboardShortcuts.zoomOut']()}
          disabled={zoom <= 0.5}
          onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}
        >
          <MinusIcon />
        </IconButton>
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.keyboardShortcuts.zoomIn']()}
          aria-label={i18n['com.affine.keyboardShortcuts.zoomIn']()}
          disabled={zoom >= 2}
          onClick={() => setZoom(value => Math.min(2, value + 0.25))}
        >
          <PlusIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.print-pdf']()}
          aria-label={i18n['com.affine.office.print-pdf']()}
          onClick={() => {
            try {
              viewerRef.current?.contentWindow?.print();
            } catch {
              window.open(
                officeAssetUrl(revision.packageUrl),
                '_blank',
                'noopener,noreferrer'
              );
            }
          }}
        >
          <PrinterIcon />
        </IconButton>
        <div className={styles.toolbarSpacer} />
        <span>
          {i18n['com.affine.office.page-dimensions']({
            width: String(Math.round(page.widthPt)),
            height: String(Math.round(page.heightPt)),
          })}
        </span>
      </div>
      <div className={styles.pdfBody}>
        <aside
          className={styles.pdfPageRail}
          aria-label={i18n['com.affine.office.pdf-pages']()}
        >
          {state.pages.map((candidate, index) => {
            const annotationCount = candidate.annotations.filter(
              annotation => annotation.subtype !== 'Widget'
            ).length;
            return (
              <button
                type="button"
                className={styles.pdfPageButton}
                data-active={index === pageIndex}
                data-annotation-count={annotationCount}
                key={candidate.id}
                aria-label={i18n.t('com.affine.office.pdf-page-label', {
                  number: index + 1,
                  count: annotationCount,
                })}
                onClick={() => {
                  if (index !== pageIndex)
                    changeSelection(() => setPageIndex(index));
                }}
              >
                <span className={styles.pdfPageNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <span
                  className={styles.pdfThumbnailFrame}
                  style={{
                    aspectRatio: `${candidate.widthPt} / ${candidate.heightPt}`,
                  }}
                >
                  <PdfPageThumbnail
                    pdfDocument={pdfResource.document}
                    documentError={pdfResource.error}
                    pageIndex={index}
                    active={index === pageIndex}
                  />
                  {annotationCount ? (
                    <span
                      className={styles.pdfAnnotationBadge}
                      aria-hidden="true"
                    >
                      {annotationCount}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </aside>
        <main
          className={styles.pdfViewer}
          aria-label={i18n['com.affine.office.pdf-document-viewer']()}
        >
          <PdfCanvasPage
            pdfDocument={pdfResource.document}
            documentError={pdfResource.error}
            pageIndex={pageIndex}
            zoom={zoom}
            previewRegion={
              previewRegion?.pageIndex === pageIndex ? previewRegion.rect : null
            }
          />
          <iframe
            ref={viewerRef}
            className={styles.pdfPrintFrame}
            key={`print:${revision.id}`}
            title={i18n['com.affine.office.pdf-print-source']()}
            src={officeAssetUrl(revision.packageUrl)}
          />
        </main>
        <aside
          className={styles.pdfInspector}
          aria-label={i18n['com.affine.office.pdf-annotations-and-forms']()}
        >
          <div className={styles.panelTitle}>
            {i18n['com.affine.office.annotations']()}
          </div>
          <div className={styles.inspectorGroup}>
            <select
              className={styles.select}
              value={annotationSubtype}
              disabled={readOnly || saving}
              aria-label={i18n['com.affine.office.annotation-type']()}
              onChange={event =>
                setAnnotationSubtype(
                  event.target.value as typeof annotationSubtype
                )
              }
            >
              <option value="highlight">
                {i18n['com.affine.office.highlight']()}
              </option>
              <option value="underline">
                {i18n['com.affine.keyboardShortcuts.underline']()}
              </option>
              <option value="strikeout">
                {i18n['com.affine.office.strikeout']()}
              </option>
              <option value="text">
                {i18n['com.affine.office.text-note']()}
              </option>
              <option value="square">
                {i18n['com.affine.office.rectangle']()}
              </option>
            </select>
            <textarea
              className={styles.textarea}
              value={annotationText}
              disabled={readOnly || saving}
              aria-label={i18n['com.affine.office.annotation-comment']()}
              placeholder={i18n[
                'com.affine.office.add-a-comment-for-this-page'
              ]()}
              onChange={event => setAnnotationText(event.target.value)}
            />
            <PdfRegionFields
              label={i18n['com.affine.office.annotation-region']()}
              value={boundedPdfRegion(annotationRect, page)}
              page={page}
              disabled={readOnly || saving}
              onChange={setAnnotationRect}
              onPreview={preview}
            />
            <Button
              variant="primary"
              disabled={readOnly || saving || !annotationText.trim()}
              loading={saving}
              onClick={() => {
                const contents = annotationText;
                runCommand(
                  {
                    ...commandBase(),
                    operation: 'office.pdf.annotation.add',
                    target: { type: 'page', pageIndex },
                    annotation: {
                      subtype: annotationSubtype,
                      rect: boundedPdfRegion(annotationRect, page),
                      contents,
                      color: '#FFFF00',
                    },
                  },
                  i18n['com.affine.office.annotations']()
                )
                  .then(saved => {
                    if (saved) {
                      draftValues.current.annotationText = '';
                      setAnnotationText('');
                    }
                  })
                  .catch(console.error);
              }}
            >
              <AddCommentIcon />
              {i18n['com.affine.office.add-annotation']()}{' '}
            </Button>
          </div>
          <div className={styles.annotationList}>
            {editableAnnotations.map(annotation => (
              <div className={styles.annotationItem} key={annotation.id}>
                <div className={styles.objectRow}>
                  <strong>{annotationLabel(annotation.subtype)}</strong>
                  <IconButton
                    size="24"
                    tooltip={i18n['com.affine.office.delete-annotation']()}
                    aria-label={I18n[
                      'com.affine.office.delete-typed-annotation'
                    ]({
                      type: annotationLabel(annotation.subtype),
                    })}
                    disabled={readOnly || saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.pdf.annotation.delete',
                          annotationId: annotation.id,
                        },
                        i18n['com.affine.office.annotation-deletion']()
                      )
                    }
                  >
                    <DeleteIcon />
                  </IconButton>
                </div>
                {annotation.rect ? (
                  <Button
                    disabled={readOnly || saving}
                    onClick={() => {
                      if (!annotation.rect) return;
                      setAnnotationRegion({
                        id: annotation.id,
                        revisionId: revision.id,
                        rect: annotation.rect,
                      });
                      preview(annotation.rect);
                    }}
                  >
                    {i18n['com.affine.office.edit-annotation-region']()}
                  </Button>
                ) : null}
                <input
                  className={styles.field}
                  value={
                    annotationDrafts.current.get(annotation.id)?.value ??
                    annotation.contents ??
                    ''
                  }
                  disabled={readOnly}
                  aria-label={I18n['com.affine.office.edit-typed-annotation']({
                    type: annotationLabel(annotation.subtype),
                  })}
                  onChange={event => {
                    const value = event.target.value;
                    const original =
                      annotationDrafts.current.get(annotation.id)?.original ??
                      annotation.contents ??
                      '';
                    if (
                      value === original &&
                      annotationWriting.current !== annotation.id
                    ) {
                      annotationDrafts.current.delete(annotation.id);
                    } else {
                      annotationDrafts.current.set(annotation.id, {
                        original,
                        value,
                      });
                    }
                    setAnnotationDraftVersion(version => version + 1);
                  }}
                  onBlur={() => {
                    flushAnnotationDraft().catch(console.error);
                  }}
                />
                <input
                  className={styles.colorInput}
                  type="color"
                  defaultValue={annotation.color ?? '#FFFF00'}
                  disabled={readOnly || saving}
                  aria-label={I18n['com.affine.office.color-typed-annotation']({
                    type: annotationLabel(annotation.subtype),
                  })}
                  onBlur={event => {
                    if (event.target.value === annotation.color) return;
                    runCommand(
                      {
                        ...commandBase(),
                        operation: 'office.pdf.annotation.update',
                        annotationId: annotation.id,
                        color: event.target.value,
                      },
                      i18n['com.affine.office.annotation-color']()
                    ).catch(console.error);
                  }}
                />
              </div>
            ))}
          </div>
          {searchResults.length ? (
            <>
              <div className={styles.panelTitle}>
                {i18n['com.affine.office.search-results']()}
              </div>
              <div className={styles.annotationList}>
                {searchResults.map(result => (
                  <button
                    type="button"
                    className={styles.searchResult}
                    key={result.pageIndex}
                    onClick={() => {
                      if (result.pageIndex !== pageIndex)
                        changeSelection(() => setPageIndex(result.pageIndex));
                    }}
                  >
                    <strong>
                      {i18n['com.affine.shortcutsTitle.page']()}{' '}
                      {result.pageIndex + 1} · {result.matches}
                    </strong>
                    <span>{result.snippet}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className={styles.panelTitle}>
            {i18n['com.affine.office.signature-appearance']()}
          </div>
          <div className={styles.inspectorGroup}>
            <input
              className={styles.field}
              value={signerName}
              maxLength={1024}
              disabled={readOnly || saving}
              aria-label={i18n['com.affine.office.signer-name']()}
              placeholder={i18n['com.affine.office.signer-name']()}
              onChange={event => setSignerName(event.target.value)}
            />
            <input
              className={styles.field}
              value={signatureReason}
              maxLength={2048}
              disabled={readOnly || saving}
              aria-label={i18n['com.affine.office.signature-reason']()}
              placeholder={i18n['com.affine.office.reason']()}
              onChange={event => setSignatureReason(event.target.value)}
            />
            <PdfRegionFields
              label={i18n['com.affine.office.signature-region']()}
              value={boundedPdfRegion(signatureRect, page)}
              page={page}
              disabled={readOnly || saving}
              onChange={setSignatureRect}
              onPreview={preview}
            />
            <Button
              disabled={readOnly || saving || !signerName.trim()}
              loading={saving}
              onClick={() =>
                void runCommand(
                  {
                    ...commandBase(),
                    operation: 'office.pdf.signature.appearance.add',
                    target: { type: 'page', pageIndex },
                    rect: boundedPdfRegion(signatureRect, page),
                    signerName,
                    reason: signatureReason || undefined,
                  },
                  i18n[
                    'com.affine.office.signature-appearance-not-cryptographic'
                  ]()
                ).then(saved => {
                  if (saved) {
                    draftValues.current.signerName = '';
                    draftValues.current.signatureReason = '';
                    setSignerName('');
                    setSignatureReason('');
                  }
                })
              }
            >
              {i18n['com.affine.office.add-appearance']()}{' '}
            </Button>
          </div>
          <div className={styles.panelTitle}>
            {i18n['com.affine.office.permanent-redaction']()}
          </div>
          <div className={styles.inspectorGroup}>
            <PdfRegionFields
              label={i18n['com.affine.office.redaction-region']()}
              value={redactionRect}
              page={page}
              disabled={readOnly || saving || processing}
              onChange={setRedactionRect}
              onPreview={preview}
            />
            <Button
              disabled={readOnly || saving || processing}
              loading={saving || processing}
              onClick={() => setRedactionConfirmation(true)}
            >
              {i18n['com.affine.office.apply-permanent-redaction']()}{' '}
            </Button>
          </div>
          {state.formFields.length ? (
            <>
              <div className={styles.panelTitle}>
                {i18n['com.affine.office.form-fields']()}
              </div>
              {state.formFields.map(field => {
                const value = fieldDraft(field);
                return (
                  <label className={styles.formRow} key={field.name}>
                    <span>{field.name}</span>
                    {field.type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        disabled={readOnly || saving || field.readOnly}
                        onChange={event =>
                          void updateForm(field, event.target.checked)
                        }
                      />
                    ) : field.options?.length ? (
                      <select
                        className={styles.select}
                        value={
                          Array.isArray(value)
                            ? (value[0] ?? '')
                            : String(value)
                        }
                        disabled={readOnly || saving || field.readOnly}
                        onChange={event =>
                          void updateForm(field, [event.target.value])
                        }
                      >
                        {field.options.map(option => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.field}
                        defaultValue={String(value)}
                        disabled={
                          readOnly ||
                          saving ||
                          field.readOnly ||
                          field.type === 'signature'
                        }
                        onBlur={event => {
                          if (event.target.value !== String(value)) {
                            updateForm(field, event.target.value).catch(
                              console.error
                            );
                          }
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </>
          ) : null}
        </aside>
      </div>
      {annotationRegion ? (
        <PdfAnnotationRegionDialog
          initial={annotationRegion.rect}
          page={page}
          disabled={readOnly || saving}
          registerDraft={registerDraft}
          onPreview={preview}
          onClose={() => {
            setAnnotationRegion(null);
            setPreviewRegion(null);
          }}
          onSubmit={rect =>
            runCommand(
              {
                ...commandBase(),
                expectedRevisionId: annotationRegion.revisionId,
                operation: 'office.pdf.annotation.update',
                annotationId: annotationRegion.id,
                rect,
              },
              i18n['com.affine.office.annotation-update']()
            )
          }
        />
      ) : null}
      <Modal
        open={redactionConfirmation}
        title={i18n['com.affine.office.apply-permanent-redaction']()}
        onOpenChange={open => {
          if (!redactionInFlight.current) setRedactionConfirmation(open);
        }}
      >
        <p>
          {i18n[
            'com.affine.office.apply-permanent-redaction-to-this-page-the-page-will-be-flattened-and-its-original-text-and-objects-'
          ]()}
        </p>
        <p>{i18n['com.affine.office.redaction-history-preserved']()}</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.buttonRow}>
          <Button
            disabled={processing || saving}
            onClick={() => setRedactionConfirmation(false)}
          >
            {i18n['com.affine.auth.sign-out.confirm-modal.cancel']()}
          </Button>
          <Button
            disabled={readOnly || processing || saving}
            loading={processing || saving}
            onClick={() => void applyRedaction()}
          >
            {i18n['com.affine.office.apply-permanent-redaction']()}
          </Button>
        </div>
      </Modal>
      <div className={styles.statusBar} role="status" aria-live="polite">
        <span>
          {state.stats.pages} {i18n['com.affine.office.pages']()}
        </span>
        <span>
          {state.stats.annotations} {i18n['com.affine.office.annotations-2']()}
        </span>
        <span>
          {state.stats.formFields} {i18n['com.affine.office.form-fields-2']()}
        </span>
        {state.compatibility.signatures ? (
          <span>
            {state.compatibility.signatures}{' '}
            {i18n['com.affine.office.digital-signatures']()}
          </span>
        ) : null}
        {readOnly ? (
          <span>{i18n['com.affine.share-menu.option.link.readonly']()}</span>
        ) : null}
        {error ? (
          <span className={styles.statusError}>{error}</span>
        ) : (
          <span>{status}</span>
        )}
      </div>
    </div>
  );
}
