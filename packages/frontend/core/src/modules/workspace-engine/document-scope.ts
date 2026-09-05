import type { WorkerInitOptions } from '@affine/nbstore/worker/client';

export type DocumentScopeAccess = 'read' | 'write';

export type DocumentScopedWorkerOptions = {
  workspaceId: string;
  docId: string;
  access: DocumentScopeAccess;
  serverBaseUrl: string;
  isSelfHosted: boolean;
};

/**
 * Creates a transient worker that can only reach one server-authorized doc.
 * Deliberately omit persistent, indexer, awareness, and sync storages.
 */
export const createDocumentScopedWorkerInitOptions = ({
  workspaceId,
  docId,
  access,
  serverBaseUrl,
  isSelfHosted,
}: DocumentScopedWorkerOptions): WorkerInitOptions => {
  const readonlyMode = access === 'read';

  return {
    local: {
      doc: {
        name: 'CloudDocStorage',
        opts: {
          type: 'workspace',
          id: workspaceId,
          serverBaseUrl,
          isSelfHosted,
          docScopeId: docId,
          readonlyMode,
        },
      },
      blob: {
        name: 'CloudBlobStorage',
        opts: {
          id: workspaceId,
          serverBaseUrl,
          docScopeId: docId,
          readonlyMode,
        },
      },
    },
    remotes: {},
  };
};
