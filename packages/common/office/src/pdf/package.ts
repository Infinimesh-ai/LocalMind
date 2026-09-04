import { PDFDocument } from 'pdf-lib';

export const PDF_MIME_TYPE = 'application/pdf';

export type PdfPackageLimits = {
  maxPackageBytes: number;
  maxPages: number;
};

export const DEFAULT_PDF_PACKAGE_LIMITS: Readonly<PdfPackageLimits> = {
  maxPackageBytes: 512 * 1024 * 1024,
  maxPages: 100_000,
};

export class PdfPackageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfPackageError';
  }
}

function normalizedLimits(options: Partial<PdfPackageLimits>) {
  const limits = { ...DEFAULT_PDF_PACKAGE_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new PdfPackageError(`PDF package limit must be positive: ${name}`);
    }
  }
  return limits;
}

function inspectEnvelope(bytes: Uint8Array) {
  const headerWindow = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  const header = /%PDF-(1\.[0-7]|2\.0)/.exec(headerWindow);
  if (!header) throw new PdfPackageError('PDF package has no valid header');
  const eofWindow = new TextDecoder('latin1').decode(bytes.slice(-8192));
  if (!/%%EOF\s*$/.test(eofWindow)) {
    throw new PdfPackageError('PDF package has no terminal EOF marker');
  }
  return header[1];
}

export class PdfPackage {
  private constructor(
    private readonly sourceBytes: Uint8Array,
    readonly document: PDFDocument,
    readonly version: string,
    readonly limits: PdfPackageLimits
  ) {}

  static async open(
    input: Uint8Array,
    options: Partial<PdfPackageLimits> = {}
  ) {
    const limits = normalizedLimits(options);
    if (!input.byteLength || input.byteLength > limits.maxPackageBytes) {
      throw new PdfPackageError('PDF package exceeds its byte limit');
    }
    const bytes = input.slice();
    const version = inspectEnvelope(bytes);
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
        capNumbers: true,
      });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new PdfPackageError(
        `Invalid or encrypted PDF package: ${cause.message}`,
        {
          cause,
        }
      );
    }
    if (!document.getPageCount() || document.getPageCount() > limits.maxPages) {
      throw new PdfPackageError('PDF package has an invalid page count');
    }
    return new PdfPackage(bytes, document, version, limits);
  }

  get byteSize() {
    return this.sourceBytes.byteLength;
  }

  readBytes() {
    return this.sourceBytes.slice();
  }

  async cloneDocument() {
    return await PDFDocument.load(this.sourceBytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
      capNumbers: true,
    });
  }
}

export async function openPdfPackage(
  input: Uint8Array,
  options: Partial<PdfPackageLimits> = {}
) {
  return await PdfPackage.open(input, options);
}
