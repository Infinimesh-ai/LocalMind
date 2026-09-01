import {
  docLinkBaseURLMiddleware,
  embedSyncedDocMiddleware,
  titleMiddleware,
} from '@blocksuite/affine-shared/adapters';
import type {
  ExtensionType,
  Schema,
  Store,
  Workspace,
} from '@blocksuite/store';
import type {
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';

import { MarkdownTransformer } from './markdown.js';
import { download } from './utils.js';

type ImportPdfOptions = {
  collection: Workspace;
  schema: Schema;
  imported: Blob;
  extensions: ExtensionType[];
  ocrPage?: PdfOcrPageHandler;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number }) => void;
};

type PdfTextSegment = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  direction: string;
};

type PdfTextLine = PdfTextSegment & {
  pageNumber: number;
};

type PdfHtmlResult = {
  html: string;
  fileName: string;
  pageCount: number;
  emptyPageNumbers: number[];
};

type PdfImportResult = {
  docId: string | undefined;
  ocrPageNumbers: number[];
  failedOcrPageNumbers: number[];
};

type PdfPageContent = {
  lines: PdfTextLine[];
  ocrMarkdown?: string;
};

type PdfOcrPageHandler = (input: {
  pageNumber: number;
  image: Blob;
}) => Promise<string>;

type PdfMarkdownOptions = {
  ocrPage?: PdfOcrPageHandler;
  renderOcrPage?: (input: {
    page: PDFPageProxy;
    pageNumber: number;
  }) => Promise<Blob>;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number }) => void;
};

type PdfMarkdownResult = {
  markdown: string;
  fileName: string;
  pageCount: number;
  ocrPageNumbers: number[];
  failedOcrPageNumbers: number[];
};

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_PDF_TEXT_ITEMS = 250_000;
const MAX_PDF_TEXT_CHARACTERS = 2_000_000;
const MAX_PDF_OCR_PAGES = 100;
const PDF_HEADER_SCAN_BYTES = 1024;
const OCR_RENDER_MAX_SCALE = 3;
const OCR_RENDER_MAX_DIMENSION = 2880;
const OCR_RENDER_MAX_PIXELS = 6_500_000;
const OCR_JPEG_QUALITY = 0.9;

const CJK_CHARACTER =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;
const NO_SPACE_BEFORE =
  /^[,.;:!?%)\]}\u3001\u3002\u3009\u300b\u300d\u300f\u3011\uff01\uff0c\uff1a\uff1b\uff1f]/u;
const NO_SPACE_AFTER = /[([{\u201c\u3008\u300a\u300c\u300e\u3010]$/u;

export class PdfOcrRequiredError extends Error {
  override name = 'PdfOcrRequiredError';

  constructor() {
    super(
      'This PDF has no extractable text layer. OCR is required before it can be converted into an editable LocalMind page.'
    );
  }
}

export class PdfOcrPageLimitError extends Error {
  override name = 'PdfOcrPageLimitError';

  constructor() {
    super(
      `This PDF has more than ${MAX_PDF_OCR_PAGES} scanned pages. Split it into smaller files before importing.`
    );
  }
}

export class PdfOcrEmptyResultError extends Error {
  override name = 'OCR_EMPTY_RESULT';

  constructor() {
    super('OCR did not detect readable text on this PDF page.');
  }
}

function pdfFileName(file: Blob) {
  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  return name.replace(/\.pdf$/i, '') || 'Imported PDF';
}

function isPdfTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item && typeof item.str === 'string';
}

function fontSizeOf(item: TextItem) {
  const [, b = 0, c = 0, d = 0] = item.transform;
  return (
    item.height || Math.hypot(c, d) || Math.hypot(item.transform[0] ?? 0, b)
  );
}

function normalizeText(text: string) {
  return text.replaceAll('\0', '').replace(/\s+/g, ' ').trim();
}

function dominantDirection(items: TextItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.dir, (counts.get(item.dir) ?? 0) + item.str.length);
  }
  return (
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ltr'
  );
}

function shouldInsertSpace(
  previous: TextItem,
  next: TextItem,
  gap: number,
  fontSize: number
) {
  const previousText = normalizeText(previous.str);
  const nextText = normalizeText(next.str);
  if (!previousText || !nextText) return false;
  if (NO_SPACE_AFTER.test(previousText) || NO_SPACE_BEFORE.test(nextText)) {
    return false;
  }

  const previousLast = previousText.at(-1) ?? '';
  const nextFirst = nextText[0] ?? '';
  if (CJK_CHARACTER.test(previousLast) && CJK_CHARACTER.test(nextFirst)) {
    return gap > fontSize * 0.8;
  }
  return gap > -fontSize * 0.2;
}

function createSegment(items: TextItem[]): PdfTextSegment {
  const direction = dominantDirection(items);
  const sorted = [...items].sort((a, b) => {
    const xDifference = (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
    return direction === 'rtl' ? -xDifference : xDifference;
  });

  let text = '';
  for (const [index, item] of sorted.entries()) {
    const itemText = normalizeText(item.str);
    if (!itemText) continue;
    const previous = sorted[index - 1];
    if (previous && text) {
      const gap =
        direction === 'rtl'
          ? (previous.transform[4] ?? 0) -
            ((item.transform[4] ?? 0) + item.width)
          : (item.transform[4] ?? 0) -
            ((previous.transform[4] ?? 0) + previous.width);
      if (shouldInsertSpace(previous, item, gap, fontSizeOf(item))) {
        text += ' ';
      }
    }
    text += itemText;
  }

  const fontSize = Math.max(...sorted.map(fontSizeOf), 1);
  const x = Math.min(...sorted.map(item => item.transform[4] ?? 0));
  const y =
    sorted.reduce((sum, item) => sum + (item.transform[5] ?? 0), 0) /
    sorted.length;
  const right = Math.max(
    ...sorted.map(item => (item.transform[4] ?? 0) + item.width)
  );
  return { text, x, y, width: right - x, fontSize, direction };
}

function splitBaseline(items: TextItem[]) {
  const direction = dominantDirection(items);
  const sorted = [...items].sort((a, b) => {
    const xDifference = (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
    return direction === 'rtl' ? -xDifference : xDifference;
  });
  const segments: TextItem[][] = [];

  for (const item of sorted) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous) {
      segments.push([item]);
      continue;
    }
    const gap =
      direction === 'rtl'
        ? (previous.transform[4] ?? 0) - ((item.transform[4] ?? 0) + item.width)
        : (item.transform[4] ?? 0) -
          ((previous.transform[4] ?? 0) + previous.width);
    const splitThreshold = Math.max(
      48,
      Math.max(fontSizeOf(previous), fontSizeOf(item)) * 5
    );
    if (gap > splitThreshold) {
      segments.push([item]);
    } else {
      current.push(item);
    }
  }
  return segments;
}

function textLinesFromItems(items: TextItem[], pageNumber: number) {
  const meaningfulItems = items.filter(item => normalizeText(item.str));
  meaningfulItems.sort((a, b) => {
    const yDifference = (b.transform[5] ?? 0) - (a.transform[5] ?? 0);
    return Math.abs(yDifference) > 0.5
      ? yDifference
      : (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
  });

  const baselines: TextItem[][] = [];
  for (const item of meaningfulItems) {
    const current = baselines.at(-1);
    const currentY = current?.[0]?.transform[5] ?? 0;
    const tolerance = Math.max(2, fontSizeOf(item) * 0.3);
    if (current && Math.abs(currentY - (item.transform[5] ?? 0)) <= tolerance) {
      current.push(item);
    } else {
      baselines.push([item]);
    }
  }

  return baselines
    .flatMap(splitBaseline)
    .map(items => ({ ...createSegment(items), pageNumber }))
    .filter(line => line.text);
}

function medianFontSize(lines: PdfTextLine[]) {
  const sizes = lines.map(line => line.fontSize).sort((a, b) => a - b);
  const middle = Math.floor(sizes.length / 2);
  if (!sizes.length) return 1;
  return sizes.length % 2
    ? sizes[middle]
    : (sizes[middle - 1] + sizes[middle]) / 2;
}

function headingLevel(line: PdfTextLine, median: number) {
  if (line.text.length > 160) return 0;
  const ratio = line.fontSize / median;
  if (ratio >= 1.8) return 1;
  if (ratio >= 1.45) return 2;
  if (ratio >= 1.2) return 3;
  return 0;
}

function joinWrappedLines(previous: string, next: string) {
  if (/[a-z]-$/i.test(previous) && /^[a-z]/.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }
  const previousLast = previous.at(-1) ?? '';
  const nextFirst = next[0] ?? '';
  const separator =
    CJK_CHARACTER.test(previousLast) && CJK_CHARACTER.test(nextFirst)
      ? ''
      : ' ';
  return `${previous}${separator}${next}`;
}

type PdfTextBlock = {
  text: string;
  heading: number;
};

function pageBlocksFromLines(lines: PdfTextLine[], median: number) {
  const blocks: Array<{ block: PdfTextBlock; line: PdfTextLine }> = [];
  let current:
    | {
        block: PdfTextBlock;
        line: PdfTextLine;
      }
    | undefined;

  for (const line of lines) {
    const heading = headingLevel(line, median);
    const verticalGap = current
      ? current.line.y - line.y
      : Number.POSITIVE_INFINITY;
    const indentDifference = current
      ? Math.abs(current.line.x - line.x)
      : Number.POSITIVE_INFINITY;
    const closeEnough =
      current &&
      verticalGap > 0 &&
      verticalGap <= Math.max(current.line.fontSize, line.fontSize) * 1.85 &&
      indentDifference <= Math.max(24, line.fontSize * 2.5);
    const canMerge = Boolean(closeEnough && current?.block.heading === heading);

    if (canMerge && current) {
      current.block.text = joinWrappedLines(current.block.text, line.text);
      current.line = line;
      continue;
    }

    const block = { text: line.text, heading };
    blocks.push({ block, line });
    current = { block, line };
  }

  return blocks.map(({ block }) => block);
}

function appendPageLines(
  output: Document,
  lines: PdfTextLine[],
  median: number
) {
  for (const block of pageBlocksFromLines(lines, median)) {
    const tagName =
      block.heading === 1
        ? 'h1'
        : block.heading === 2
          ? 'h2'
          : block.heading === 3
            ? 'h3'
            : 'p';
    const element = output.createElement(tagName);
    element.textContent = block.text;
    output.body.append(element);
  }
}

async function createPdfLoadingTask(data: Uint8Array) {
  const pdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const options = {
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  };

  if (typeof Worker !== 'undefined') {
    const port = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
      type: 'module',
    });
    const worker = pdfJs.PDFWorker.create({ port });
    return pdfJs.getDocument({ ...options, worker });
  }

  // @ts-expect-error -- PDF.js does not publish types for its worker subpath.
  const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  if (!('pdfjsWorker' in globalThis)) {
    Object.defineProperty(globalThis, 'pdfjsWorker', {
      configurable: true,
      value: pdfWorker,
    });
  }
  return pdfJs.getDocument(options);
}

function validatePdfSize(imported: Blob) {
  if (imported.size > MAX_PDF_BYTES) {
    throw new Error(
      `The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MiB import limit.`
    );
  }
}

function validatePdfHeader(data: Uint8Array) {
  const header = new TextDecoder('latin1').decode(
    data.subarray(0, PDF_HEADER_SCAN_BYTES)
  );
  if (!header.includes('%PDF-')) {
    throw new Error('The selected file is not a valid PDF document.');
  }
}

async function extractPdfTextPages(
  imported: Blob,
  options: Pick<PdfMarkdownOptions, 'signal' | 'onProgress'> = {}
) {
  validatePdfSize(imported);
  const data = new Uint8Array(await imported.arrayBuffer());
  validatePdfHeader(data);

  const loadingTask = await createPdfLoadingTask(data);
  const pages: PdfTextLine[][] = [];
  const emptyPageNumbers: number[] = [];
  let textItemCount = 0;
  let characterCount = 0;

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `The PDF exceeds the ${MAX_PDF_PAGES}-page import limit.`
      );
    }

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const items = textContent.items.filter(isPdfTextItem);
        textItemCount += items.length;
        characterCount += items.reduce((sum, item) => sum + item.str.length, 0);
        if (textItemCount > MAX_PDF_TEXT_ITEMS) {
          throw new Error(
            `The PDF exceeds the ${MAX_PDF_TEXT_ITEMS}-text-item import limit.`
          );
        }
        if (characterCount > MAX_PDF_TEXT_CHARACTERS) {
          throw new Error(
            `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character import limit.`
          );
        }

        const lines = textLinesFromItems(items, pageNumber);
        pages.push(lines);
        if (!lines.length) emptyPageNumbers.push(pageNumber);
        options.onProgress?.({ completed: pageNumber, total: pdf.numPages });
      } finally {
        page.cleanup();
      }
    }

    return {
      pdf,
      pages,
      emptyPageNumbers,
      destroy: () => loadingTask.destroy().catch(() => undefined),
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error(
        'Password-protected PDFs must be unlocked before they can be imported.'
      );
    }
    throw error;
  }
}

export async function parsePdfToHtml(imported: Blob): Promise<PdfHtmlResult> {
  const { pages, emptyPageNumbers, destroy } =
    await extractPdfTextPages(imported);

  try {
    const allLines = pages.flat();
    if (!allLines.length) {
      throw new PdfOcrRequiredError();
    }

    const output = new DOMParser().parseFromString(
      '<!doctype html><html><body></body></html>',
      'text/html'
    );
    const median = medianFontSize(allLines);
    let hasContent = false;
    for (const lines of pages) {
      if (!lines.length) continue;
      if (hasContent) output.body.append(output.createElement('hr'));
      appendPageLines(output, lines, median);
      hasContent = true;
    }

    return {
      html: output.documentElement.outerHTML,
      fileName: pdfFileName(imported),
      pageCount: pages.length,
      emptyPageNumbers,
    };
  } finally {
    await destroy();
  }
}

function markdownText(value: string) {
  return value
    .replace(/([\\`*_[\]<>])/gu, '\\$1')
    .replace(/^(\s*)([#>+-]|\d+[.)])\s/gu, '$1\\$2 ');
}

function pageLinesToMarkdown(lines: PdfTextLine[], median: number) {
  return pageBlocksFromLines(lines, median)
    .map(block => {
      const prefix = block.heading ? `${'#'.repeat(block.heading)} ` : '';
      return `${prefix}${markdownText(block.text)}`;
    })
    .join('\n\n');
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to rasterize the PDF page for OCR.'));
      },
      'image/jpeg',
      OCR_JPEG_QUALITY
    );
  });
}

async function renderPdfPageForOcr({ page }: { page: PDFPageProxy }) {
  if (typeof document === 'undefined') {
    throw new Error('PDF OCR page rendering requires a browser canvas.');
  }
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    OCR_RENDER_MAX_SCALE,
    OCR_RENDER_MAX_DIMENSION /
      Math.max(baseViewport.width, baseViewport.height),
    Math.sqrt(
      OCR_RENDER_MAX_PIXELS / (baseViewport.width * baseViewport.height)
    )
  );
  const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) {
    throw new Error('PDF OCR page rendering is unavailable.');
  }
  canvasContext.fillStyle = '#ffffff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext,
    viewport,
    background: '#ffffff',
  }).promise;
  return await canvasToJpeg(canvas);
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return '';
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('name' in error && typeof error.name === 'string') return error.name;
  return '';
}

export async function parsePdfToMarkdown(
  imported: Blob,
  options: PdfMarkdownOptions = {}
): Promise<PdfMarkdownResult> {
  const { pdf, pages, emptyPageNumbers, destroy } = await extractPdfTextPages(
    imported,
    options
  );
  const pageContents: PdfPageContent[] = pages.map(lines => ({ lines }));
  const ocrPageNumbers: number[] = [];
  const failedOcrPageNumbers: number[] = [];
  let firstOcrError: unknown;
  let stoppedOcrError: unknown;

  try {
    if (options.ocrPage && emptyPageNumbers.length > MAX_PDF_OCR_PAGES) {
      throw new PdfOcrPageLimitError();
    }

    const renderOcrPage = options.renderOcrPage ?? renderPdfPageForOcr;
    const totalProgress = pages.length + emptyPageNumbers.length;
    for (const [index, pageNumber] of emptyPageNumbers.entries()) {
      options.signal?.throwIfAborted();
      if (!options.ocrPage) continue;
      if (stoppedOcrError) {
        failedOcrPageNumbers.push(pageNumber);
        continue;
      }

      const page = await pdf.getPage(pageNumber);
      try {
        const image = await renderOcrPage({ page, pageNumber });
        options.signal?.throwIfAborted();
        const markdown = (await options.ocrPage({ pageNumber, image })).trim();
        if (!markdown) throw new PdfOcrEmptyResultError();
        const content = pageContents[pageNumber - 1];
        if (!content) {
          throw new Error('PDF page content is unavailable.');
        }
        content.ocrMarkdown = markdown;
        ocrPageNumbers.push(pageNumber);
      } catch (error) {
        firstOcrError ??= error;
        failedOcrPageNumbers.push(pageNumber);
        if (errorCode(error) !== 'OCR_EMPTY_RESULT') {
          stoppedOcrError = error;
        }
      } finally {
        page.cleanup();
        options.onProgress?.({
          completed: pages.length + index + 1,
          total: totalProgress,
        });
      }
    }

    const allLines = pages.flat();
    const median = medianFontSize(allLines);
    const markdownPages = pageContents
      .map(page =>
        page.ocrMarkdown
          ? page.ocrMarkdown
          : page.lines.length
            ? pageLinesToMarkdown(page.lines, median)
            : ''
      )
      .filter(Boolean);
    if (!markdownPages.length) {
      if (firstOcrError) throw firstOcrError;
      throw new PdfOcrRequiredError();
    }

    return {
      markdown: markdownPages.join('\n\n---\n\n'),
      fileName: pdfFileName(imported),
      pageCount: pages.length,
      ocrPageNumbers,
      failedOcrPageNumbers,
    };
  } finally {
    await destroy();
  }
}

async function importPdf({
  collection,
  schema,
  imported,
  extensions,
  ocrPage,
  signal,
  onProgress,
}: ImportPdfOptions): Promise<PdfImportResult> {
  const { markdown, fileName, ocrPageNumbers, failedOcrPageNumbers } =
    await parsePdfToMarkdown(imported, {
      ocrPage,
      signal,
      onProgress,
    });
  const docId = await MarkdownTransformer.importMarkdownToDoc({
    collection,
    schema,
    markdown,
    fileName,
    extensions,
  });
  return { docId, ocrPageNumbers, failedOcrPageNumbers };
}

async function exportDoc(doc: Store) {
  const { PdfAdapter } = await import('@blocksuite/affine-shared/adapters/pdf');
  const provider = doc.provider;
  const job = doc.getTransformer([
    docLinkBaseURLMiddleware(doc.workspace.id),
    titleMiddleware(doc.workspace.meta.docMetas),
    embedSyncedDocMiddleware('content'),
  ]);
  const snapshot = job.docToSnapshot(doc);
  if (!snapshot) {
    return;
  }
  const adapter = new PdfAdapter(job, provider);
  const { file } = await adapter.fromDocSnapshot({
    snapshot,
    assets: job.assetsManager,
  });
  download(file.blob, file.fileName);
}

export const PdfTransformer = {
  exportDoc,
  importPdf,
  parsePdfToHtml,
  parsePdfToMarkdown,
};
