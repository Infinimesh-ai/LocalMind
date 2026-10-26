import { DocxPdfFontError } from '@localmind/office/docx';
import type { Response } from 'express';

/** Return only a bounded capability code, never the failing document content. */
export async function officePdfExportResponse<T>(
  operation: () => Promise<T>,
  response: Response
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof DocxPdfFontError)) throw error;
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-localmind-office-error', 'pdf-font-unavailable');
    response.status(422).json({ code: 'pdf-font-unavailable' });
    return null;
  }
}
