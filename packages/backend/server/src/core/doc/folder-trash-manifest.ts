import { createHash } from 'node:crypto';

export function folderTrashFingerprint(input: {
  rootFolderId: string;
  nodes: Record<string, unknown>[];
  documentIds: string[];
  newlyTrashedDocumentIds: string[];
  previouslyTrashedDocumentIds: string[];
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 'localmind-folder-trash-manifest/v1',
        rootFolderId: input.rootFolderId,
        nodes: input.nodes
          .map(record => ({
            id: record.id,
            parentId: record.parentId ?? null,
            type: record.type,
            data: record.data,
            index: record.index,
          }))
          .sort((left, right) =>
            String(left.id).localeCompare(String(right.id))
          ),
        documentIds: [...input.documentIds].sort(),
        newlyTrashedDocumentIds: [...input.newlyTrashedDocumentIds].sort(),
        previouslyTrashedDocumentIds: [
          ...input.previouslyTrashedDocumentIds,
        ].sort(),
      })
    )
    .digest('hex');
}
