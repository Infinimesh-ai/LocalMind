export const OFFICE_PACKAGE_MIME_TYPE = {
  document:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
} as const;

export type OfficeArtifactKind = keyof typeof OFFICE_PACKAGE_MIME_TYPE;

const OFFICE_EXTENSION = {
  document: 'docx',
  workbook: 'xlsx',
  presentation: 'pptx',
  pdf: 'pdf',
} as const;

/** Current display title owns the download name; sourceFileName is evidence. */
export function officeDownloadFileName(
  title: string,
  kind: OfficeArtifactKind
) {
  const stem = title
    .trim()
    .replace(/\.(docx|xlsx|pptx|pdf)$/i, '')
    .trim();
  return `${stem || 'document'}.${OFFICE_EXTENSION[kind]}`;
}
export type OfficePackageMimeType =
  (typeof OFFICE_PACKAGE_MIME_TYPE)[OfficeArtifactKind];

export function getOfficePackageMimeType(kind: OfficeArtifactKind) {
  return OFFICE_PACKAGE_MIME_TYPE[kind];
}

export function assertOfficePackageMimeType(
  kind: OfficeArtifactKind,
  mimeType: string
) {
  const expected = getOfficePackageMimeType(kind);
  if (mimeType !== expected) {
    throw new Error(
      `Office ${kind} package MIME type must be ${expected}, received ${mimeType}`
    );
  }
}
