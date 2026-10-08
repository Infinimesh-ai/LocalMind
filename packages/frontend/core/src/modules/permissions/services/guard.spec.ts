import { Framework, LiveData } from '@toeverything/infra';
import type { Subscription } from 'rxjs';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { GuardService } from './guard';

const services: GuardService[] = [];
const subscriptions: Subscription[] = [];

const createWorkspaceGuard = (admin = false) => {
  const getWorkspacePermissions = vi.fn().mockResolvedValue({
    Workspace_Blobs_Write: true,
  });
  const isAdmin$ = new LiveData(admin);
  const framework = new Framework();
  framework.service(
    GuardService,
    () =>
      new GuardService(
        { getWorkspacePermissions } as never,
        { workspace: { flavour: 'server-1', openOptions: {} } } as never,
        {
          permission: {
            isOwner$: new LiveData(false),
            isAdmin$,
            waitForRevalidation: vi.fn(),
            revalidate: vi.fn(),
          },
        } as never
      )
  );
  const service = framework.provider().get(GuardService);
  const canWrite$ = service.can$('Workspace_Blobs_Write');
  subscriptions.push(canWrite$.subscribe(() => {}));
  services.push(service);
  return { service, canWrite$, getWorkspacePermissions, isAdmin$ };
};

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
  subscriptions.splice(0).forEach(subscription => subscription.unsubscribe());
  services.splice(0).forEach(service => service.dispose());
});

describe('GuardService workspace permissions', () => {
  test('publishes allowed member permissions to live subscribers after revalidation', async () => {
    const { service, canWrite$, getWorkspacePermissions } =
      createWorkspaceGuard();

    expect(canWrite$.value).toBeUndefined();
    service.revalidateCan('Workspace_Blobs_Write');

    await vi.waitFor(() => expect(canWrite$.value).toBe(true));
    expect(getWorkspacePermissions).toHaveBeenCalledTimes(1);
  });

  test('publishes a denied permission instead of leaving it in loading state', async () => {
    const { service, canWrite$, getWorkspacePermissions } =
      createWorkspaceGuard();
    getWorkspacePermissions.mockResolvedValue({ Workspace_Blobs_Write: false });

    service.revalidateCan('Workspace_Blobs_Write');

    await vi.waitFor(() => expect(canWrite$.value).toBe(false));
  });

  test('updates subscribers when a refreshed permission is revoked', async () => {
    const { service, canWrite$, getWorkspacePermissions } =
      createWorkspaceGuard();
    await service.can('Workspace_Blobs_Write');
    expect(canWrite$.value).toBe(true);
    getWorkspacePermissions.mockResolvedValue({ Workspace_Blobs_Write: false });

    service.revalidateCan('Workspace_Blobs_Write');

    await vi.waitFor(() => expect(canWrite$.value).toBe(false));
  });

  test('clears the admin shortcut when the member permission has not loaded', async () => {
    const { service, canWrite$, isAdmin$ } = createWorkspaceGuard(true);
    expect(canWrite$.value).toBe(true);

    isAdmin$.next(false);
    expect(canWrite$.value).toBeUndefined();
    service.revalidateCan('Workspace_Blobs_Write');

    await vi.waitFor(() => expect(canWrite$.value).toBe(true));
  });

  test('restores a known denial when the admin shortcut no longer applies', async () => {
    const { service, canWrite$, getWorkspacePermissions, isAdmin$ } =
      createWorkspaceGuard();
    getWorkspacePermissions.mockResolvedValue({ Workspace_Blobs_Write: false });
    await service.can('Workspace_Blobs_Write');
    expect(canWrite$.value).toBe(false);

    isAdmin$.next(true);
    expect(canWrite$.value).toBe(true);
    isAdmin$.next(false);
    expect(canWrite$.value).toBe(false);
  });

  test.each([true, false])(
    'loads workspace ACL while a cached admin role is being corrected (allowed: %s)',
    async allowed => {
      const { service, canWrite$, getWorkspacePermissions, isAdmin$ } =
        createWorkspaceGuard(true);
      getWorkspacePermissions.mockResolvedValue({
        Workspace_Blobs_Write: allowed,
      });

      service.revalidateCan('Workspace_Blobs_Write');

      await vi.waitFor(() =>
        expect(getWorkspacePermissions).toHaveBeenCalledTimes(1)
      );
      isAdmin$.next(false);
      expect(canWrite$.value).toBe(allowed);
    }
  );
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
