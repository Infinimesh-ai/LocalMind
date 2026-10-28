import { officeWorkbookCompatibilityFileName } from '@localmind/office';
import { XlsxCompatibilityError } from '@localmind/office/xlsx';
import type { Response } from 'express';

import type { OfficeArtifactService } from './artifact-service';

export async function officeXlsxExportResponse(
  operation: () => ReturnType<
    OfficeArtifactService['exportWorkbookRevisionCopy']
  >,
  response: Response
) {
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  try {
    const asset = await operation();
    response.setHeader('content-length', asset.bytes.byteLength);
    response.setHeader('etag', `"${asset.fingerprint}"`);
    response.setHeader(
      'x-localmind-office-source-fingerprint',
      asset.revision.packageFingerprint
    );
    response.setHeader(
      'x-localmind-office-export-version',
      asset.repairVersion
    );
    response
      .attachment(
        officeWorkbookCompatibilityFileName(
          asset.artifact.title,
          asset.revision.sequence
        )
      )
      .type(asset.revision.packageMimeType);
    response.send(asset.bytes);
  } catch (error) {
    if (!(error instanceof XlsxCompatibilityError)) throw error;
    response.setHeader(
      'x-localmind-office-error',
      'xlsx-compatibility-unavailable'
    );
    response.status(422).json({ code: 'xlsx-compatibility-unavailable' });
  }
}
