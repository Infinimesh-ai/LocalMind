import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspacePermission } from './permission';

describe('WorkspacePermission document scope', () => {
  test('does not read, persist, or subscribe to workspace ACL cache', async () => {
    const store = {
      watchWorkspacePermissionCache: vi.fn(() => {
        throw new Error('workspace ACL cache must remain isolated');
      }),
      subscribeWorkspaceAccess: vi.fn(),
      fetchWorkspaceInfo: vi.fn(),
      setWorkspacePermissionCache: vi.fn(),
    };
    const workspaceService = {
      workspace: {
        id: 'workspace-1',
        flavour: 'server-1',
        openOptions: { docScopeId: 'doc-1', docScopeAccess: 'read' },
      },
    };
    const framework = new Framework();
    framework.entity(
      WorkspacePermission,
      () => new WorkspacePermission(workspaceService as never, store as never)
    );
    const permission = framework.provider().createEntity(WorkspacePermission);

    expect(permission.isOwner$.value).toBe(false);
    expect(permission.isAdmin$.value).toBe(false);
    permission.revalidate();
    await permission.waitForRevalidation();

    expect(store.watchWorkspacePermissionCache).not.toHaveBeenCalled();
    expect(store.subscribeWorkspaceAccess).not.toHaveBeenCalled();
    expect(store.fetchWorkspaceInfo).not.toHaveBeenCalled();
    expect(store.setWorkspacePermissionCache).not.toHaveBeenCalled();
    permission.dispose();
  });
});
