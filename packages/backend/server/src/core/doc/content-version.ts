import { createHash } from 'node:crypto';

import type { DocRecord } from './storage';

/** Content timestamps are monotonic under DocModel's content-write lock. */
export function documentContentVersion(
  record: Pick<DocRecord, 'spaceId' | 'docId' | 'timestamp'>
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'workspace-document-content/v1',
        record.spaceId,
        record.docId,
        record.timestamp,
      ])
    )
    .digest('hex');
}

export class DocumentVersionConflict extends Error {
  constructor() {
    super(
      'version_conflict: The document changed. Read it again with workspace_doc_read and merge your changes before retrying. Do not create a replacement document.'
    );
  }
}
