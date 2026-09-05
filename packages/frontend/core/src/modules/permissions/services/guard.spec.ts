import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { GuardService } from './guard';

const services: GuardService[] = [];

const createGuard = (access: 'read' | 'write') => {
  const getDocPermissions = vi.fn().mockResolvedValue({
    Doc_Read: true,
    Doc_Update: true,
    Doc_Users_Manage: true,
  });
  const workspaceService = {
    workspace: {
      flavour: 'server-1',
      openOptions: {
        docScopeId: 'doc-1',
        docScopeAccess: access,
      },
    },
  };
  const workspacePermissionService = {
    permission: {
      isOwner$: new LiveData(false),
      isAdmin$: new LiveData(false),
      waitForRevalidation: vi.fn(),
      revalidate: vi.fn(),
    },
  };
  const framework = new Framework();
  framework.service(
    GuardService,
    () =>
      new GuardService(
        {
          getDocPermissions,
          getWorkspacePermissions: vi.fn(),
        } as never,
        workspaceService as never,
        workspacePermissionService as never
      )
  );
  const service = framework.provider().get(GuardService);
  services.push(service);
  return { service, getDocPermissions };
};

afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
});

describe('GuardService document scope', () => {
  test('allows only read actions on the target document in read mode', async () => {
    const { service, getDocPermissions } = createGuard('read');

    await expect(service.can('Doc_Read', 'doc-1')).resolves.toBe(true);
    await expect(service.can('Doc_Update', 'doc-1')).resolves.toBe(false);
    await expect(service.can('Doc_Read', 'doc-other')).resolves.toBe(false);
    await expect(service.can('Workspace_Read')).resolves.toBe(false);
    expect(getDocPermissions).toHaveBeenCalledTimes(1);
  });

  test('still defers target-document writes to live server permission', async () => {
    const { service, getDocPermissions } = createGuard('write');

    await expect(service.can('Doc_Update', 'doc-1')).resolves.toBe(true);
    expect(getDocPermissions).toHaveBeenCalledWith('doc-1');
  });

  test('revalidates the scoped document ACL every five seconds', async () => {
    vi.useFakeTimers();
    try {
      const { getDocPermissions } = createGuard('read');

      await vi.advanceTimersByTimeAsync(4999);
      expect(getDocPermissions).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() =>
        expect(getDocPermissions).toHaveBeenCalledWith('doc-1')
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
