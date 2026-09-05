import { describe, expect, test } from 'vitest';

import { createDocumentScopedWorkerInitOptions } from './document-scope';

describe('createDocumentScopedWorkerInitOptions', () => {
  test.each([
    ['read', true],
    ['write', false],
  ] as const)('creates an isolated %s transport', (access, readonlyMode) => {
    const options = createDocumentScopedWorkerInitOptions({
      workspaceId: 'workspace-1',
      docId: 'doc-1',
      access,
      serverBaseUrl: 'https://localmind.example',
      isSelfHosted: true,
    });

    expect(options).toEqual({
      local: {
        doc: {
          name: 'CloudDocStorage',
          opts: {
            type: 'workspace',
            id: 'workspace-1',
            serverBaseUrl: 'https://localmind.example',
            isSelfHosted: true,
            docScopeId: 'doc-1',
            readonlyMode,
          },
        },
        blob: {
          name: 'CloudBlobStorage',
          opts: {
            id: 'workspace-1',
            serverBaseUrl: 'https://localmind.example',
            docScopeId: 'doc-1',
            readonlyMode,
          },
        },
      },
      remotes: {},
    });
    expect(Object.keys(options.local).sort()).toEqual(['blob', 'doc']);
  });
});
