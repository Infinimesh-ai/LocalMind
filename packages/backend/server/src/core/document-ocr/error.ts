import { HttpStatus } from '@nestjs/common';

export type DocumentOcrErrorCode =
  | 'OCR_DISABLED'
  | 'OCR_INVALID_CONFIG'
  | 'OCR_INVALID_IMAGE'
  | 'OCR_IMAGE_TOO_LARGE'
  | 'OCR_BUSY'
  | 'OCR_TIMEOUT'
  | 'OCR_UPSTREAM_UNAVAILABLE'
  | 'OCR_UPSTREAM_REJECTED'
  | 'OCR_INVALID_RESPONSE'
  | 'OCR_EMPTY_RESULT';

export class DocumentOcrError extends Error {
  override readonly name = 'DocumentOcrError';

  constructor(
    readonly code: DocumentOcrErrorCode,
    message: string,
    readonly status: HttpStatus
  ) {
    super(message);
  }
}
