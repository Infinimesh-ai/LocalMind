import { OfficeResourceStorage } from '../../core/office/resource-storage';
import type { ProjectBlobStorage } from '../../core/project';
import type { WorkspaceBlobStorage } from '../../core/storage';

export function workspaceOfficeStorage(storage: WorkspaceBlobStorage) {
  return new OfficeResourceStorage(
    Object.assign(storage, {
      putCopyAttachment: async (
        workspaceId: string,
        key: string,
        bytes: Buffer,
        input: { contentType: string },
        authorize: () => Promise<void>
      ) => {
        await authorize();
        await storage.put(workspaceId, key, bytes, {
          contentType: input.contentType,
          contentLength: bytes.length,
        });
      },
    }),
    {} as ProjectBlobStorage,
    {
      user: () => ({ workspace: () => ({ assert: async () => {} }) }),
    } as never,
    { getWorkspaceQuotaCalculator: async () => () => undefined } as never,
    { blob: { get: async () => null } } as never
  );
}

// Unit fixtures isolate Office package behavior. Lifecycle/ACL/CAS integration is
// exercised against PostgreSQL by workspace-native-crud.e2e.ts.
export function withNativeStateFixture<T extends object>(models: T): T {
  return Object.assign(models, {
    workspaceNativeResource: {
      get: async () => ({}),
      index: async () => ({ count: 1 }),
    },
  });
}

export const nativeAccessFixture = {
  assert: async () => ({}),
  assertBlobRead: async () => false,
  write: async <T>(_input: unknown, operation: () => Promise<T>) => operation(),
} as unknown as import('../../core/doc/native-resource-access').WorkspaceNativeResourceAccess;

export const nativeTransactionFixture = {
  snapshot: async <T>(_input: unknown, operation: () => Promise<T>) =>
    operation(),
} as unknown as import('../../core/doc/workspace-resource').WorkspaceResourceService;

export const nativeDirectoryFixture = {
  assertResourceFolder: async () => ({}),
} as unknown as import('../../core/doc/workspace-organization').WorkspaceOrganizationService;
