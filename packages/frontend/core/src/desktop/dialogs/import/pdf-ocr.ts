import type { FetchService } from '@affine/core/modules/cloud';

type OcrResponse = {
  markdown?: unknown;
  model?: unknown;
};

const KNOWN_OCR_ERROR_CODES = new Set([
  'OCR_DISABLED',
  'OCR_INVALID_CONFIG',
  'OCR_INVALID_IMAGE',
  'OCR_IMAGE_TOO_LARGE',
  'OCR_BUSY',
  'OCR_TIMEOUT',
  'OCR_UPSTREAM_UNAVAILABLE',
  'OCR_UPSTREAM_REJECTED',
  'OCR_INVALID_RESPONSE',
  'OCR_EMPTY_RESULT',
]);

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return '';
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('name' in error && typeof error.name === 'string') return error.name;
  return '';
}

export class PdfOcrRequestError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = code;
  }
}

export async function requestPdfPageOcr(
  fetchService: FetchService,
  workspaceId: string,
  image: Blob,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');

  let response: Response;
  try {
    response = await fetchService.fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/document-ocr`,
      {
        method: 'POST',
        body: image,
        headers: {
          'Content-Type': image.type || 'image/jpeg',
        },
        signal,
        timeout: 125_000,
      }
    );
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException('Import cancelled', 'AbortError');
    }
    const code = errorCode(error);
    if (KNOWN_OCR_ERROR_CODES.has(code)) {
      throw new PdfOcrRequestError(
        code,
        error instanceof Error ? error.message : 'PDF OCR failed.'
      );
    }
    throw new PdfOcrRequestError(
      'OCR_UPSTREAM_UNAVAILABLE',
      'The OCR service could not be reached.'
    );
  }

  let payload: OcrResponse;
  try {
    payload = (await response.json()) as OcrResponse;
  } catch {
    throw new PdfOcrRequestError(
      'OCR_INVALID_RESPONSE',
      'The OCR service returned invalid JSON.'
    );
  }
  if (typeof payload.markdown !== 'string' || !payload.markdown.trim()) {
    throw new PdfOcrRequestError(
      'OCR_EMPTY_RESULT',
      'The OCR service did not detect readable text.'
    );
  }
  return payload.markdown.trim();
}
