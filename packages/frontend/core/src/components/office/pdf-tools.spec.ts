/** @vitest-environment happy-dom */
import { getOrCreateI18n } from '@affine/i18n';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';

import { openPdf, renderRedactedPdfPage } from './pdf-tools';

const pdf = vi.hoisted(() => ({
  createWorker: vi.fn(() => ({ destroy: vi.fn() })),
  getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 52 }) })),
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  PDFWorker: { create: pdf.createWorker },
  getDocument: pdf.getDocument,
}));
const originalUrl = window.location.href;
beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});
afterEach(() => {
  window.location.href = originalUrl;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test('PDF rendering fetches the authenticated Project package through the local frontend proxy', async () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  vi.stubGlobal('Worker', class {});
  window.location.href = 'http://localhost:8081/project/p';
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetch);
  const result = await openPdf(
    'http://localhost:3011/api/projects/p/office/artifacts/a/revisions/r/package'
  );
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8081/api/projects/p/office/artifacts/a/revisions/r/package',
    { credentials: 'include' }
  );
  expect(result.document.numPages).toBe(52);
  expect(pdf.getDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      data: new Uint8Array([1, 2, 3]),
      isEvalSupported: false,
    })
  );
});

test('a rejected package request cannot start a PDF worker', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
  );
  await expect(
    openPdf(
      'https://localmind.test/api/projects/p/office/artifacts/a/revisions/r/package'
    )
  ).rejects.toThrow(/403/);
  expect(pdf.createWorker).not.toHaveBeenCalled();
});

test('redaction rasterizes an unrotated page and maps PDF coordinates through its viewport', async () => {
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(new Uint8Array([1])))
  );
  const fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    fillRect,
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    callback => {
      callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    }
  );
  const getViewport = vi.fn(() => ({
    width: 1224,
    height: 1584,
    viewBox: [0, 0, 612, 792],
    convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [
      2 * x1,
      2 * (792 - y1),
      2 * x2,
      2 * (792 - y2),
    ],
  }));
  const page = {
    getViewport,
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
  };
  const destroy = vi.fn(async () => {});
  pdf.getDocument.mockReturnValueOnce({
    promise: Promise.resolve({ getPage: vi.fn(async () => page), destroy }),
  } as never);
  await expect(
    renderRedactedPdfPage(
      'https://localmind.test/test.pdf',
      0,
      { widthPt: 612, heightPt: 792 },
      [{ xPt: 48, yPt: 645, widthPt: 480, heightPt: 22 }]
    )
  ).resolves.toBe('AQID');
  expect(getViewport).toHaveBeenCalledWith({ scale: 2, rotation: 0 });
  expect(fillRect).toHaveBeenCalledWith(96, 250, 960, 44);
  expect(destroy).toHaveBeenCalledOnce();
});

test('redaction rejects cropped coordinates before painting or creating an output', async () => {
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(new Uint8Array([1])))
  );
  const render = vi.fn();
  const destroy = vi.fn(async () => {});
  pdf.getDocument.mockReturnValueOnce({
    promise: Promise.resolve({
      getPage: vi.fn(async () => ({
        getViewport: () => ({ viewBox: [10, 10, 500, 700] }),
        render,
      })),
      destroy,
    }),
  } as never);
  await expect(
    renderRedactedPdfPage(
      'https://localmind.test/test.pdf',
      0,
      { widthPt: 612, heightPt: 792 },
      [{ xPt: 48, yPt: 645, widthPt: 480, heightPt: 22 }]
    )
  ).rejects.toThrow(/not supported/);
  expect(render).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
});
