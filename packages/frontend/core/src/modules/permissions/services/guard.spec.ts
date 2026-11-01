import { UserFriendlyError } from '@affine/error';
import { Framework, LiveData } from '@toeverything/infra';
import { firstValueFrom, type Subscription } from 'rxjs';
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

const createGuard = (access: 'read' | 'write', scoped = true) => {
  const getDocPermissions = vi.fn().mockResolvedValue({
    Doc_Read: true,
    Doc_Update: true,
    Doc_Users_Manage: true,
  });
  const workspaceService = {
    workspace: {
      flavour: 'server-1',
      openOptions: scoped
        ? { docScopeId: 'doc-1', docScopeAccess: access }
        : {},
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
  return { service, getDocPermissions, workspaceService };
};

afterEach(() => {
  subscriptions.splice(0).forEach(subscription => subscription.unsubscribe());
  services.splice(0).forEach(service => service.dispose());
});

describe('GuardService indexed document visibility', () => {
  test('never emits a cached grant while the current permission is unresolved or denied', async () => {
    const { service, getDocPermissions } = createGuard('write', false);
    await service.can('Doc_Read', 'doc-1');
    let resolve!: (value: { Doc_Read: boolean }) => void;
    getDocPermissions.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const values: string[][] = [];
    subscriptions.push(
      service.readableDocIds$(['doc-1']).subscribe(ids => values.push([...ids]))
    );
    await vi.waitFor(() => expect(resolve).toBeDefined());
    expect(values).toEqual([[]]);
    resolve({ Doc_Read: false });
    await vi.waitFor(() => expect(values.length).toBeGreaterThan(1));
    expect(values.every(value => value.length === 0)).toBe(true);
  });

  test('removes a visible result when its observed ACL is revoked', async () => {
    const { service, getDocPermissions } = createGuard('write', false);
    let visible: ReadonlySet<string> = new Set();
    subscriptions.push(
      service.readableDocIds$(['doc-1']).subscribe(ids => {
        visible = ids;
      })
    );
    await vi.waitFor(() => expect(visible.has('doc-1')).toBe(true));
    getDocPermissions.mockResolvedValue({ Doc_Read: false });
    service.revalidateCan('Doc_Read', 'doc-1');
    await vi.waitFor(() => expect(visible.has('doc-1')).toBe(false));
  });

  test('hides failed checks, deduplicates candidates and bounds concurrent lookups', async () => {
    const { service, getDocPermissions } = createGuard('write', false);
    let active = 0;
    let maximum = 0;
    getDocPermissions.mockImplementation(async id => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (id === 'failed') throw new Error('Network unavailable');
      return { Doc_Read: id !== 'denied' };
    });
    const ids = [
      'failed',
      'denied',
      ...Array.from({ length: 9 }, (_, i) => String(i)),
      '0',
    ];
    let visible: ReadonlySet<string> = new Set();
    subscriptions.push(
      service.readableDocIds$(ids).subscribe(value => {
        visible = value;
      })
    );
    await vi.waitFor(() => expect(visible.size).toBe(9));
    expect(visible.has('failed')).toBe(false);
    expect(visible.has('denied')).toBe(false);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(getDocPermissions).toHaveBeenCalledTimes(11);
  });

  test('keeps local workspace search available without a server', async () => {
    const { service, getDocPermissions, workspaceService } = createGuard(
      'write',
      false
    );
    workspaceService.workspace.flavour = 'local';
    expect([
      ...(await firstValueFrom(service.readableDocIds$(['local-doc']))),
    ]).toEqual(['local-doc']);
    expect(getDocPermissions).not.toHaveBeenCalled();
  });
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
  test('refreshes an open member document and stops polling it after unmount', async () => {
    vi.useFakeTimers();
    try {
      const { service, getDocPermissions } = createGuard('write', false);
      const canWrite$ = service.can$('Doc_Update', 'doc-1');
      const subscription = canWrite$.subscribe(() => {});
      subscriptions.push(subscription);
      await service.can('Doc_Update', 'doc-1');
      expect(canWrite$.value).toBe(true);
      getDocPermissions.mockResolvedValue({
        Doc_Read: true,
        Doc_Update: false,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(canWrite$.value).toBe(false);
      subscription.unsubscribe();
      getDocPermissions.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(getDocPermissions).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([401, 403, 404])(
    'clears a cached grant when revalidation returns %s',
    async status => {
      const { service, getDocPermissions } = createGuard('write', false);
      const canRead$ = service.can$('Doc_Read', 'doc-1');
      const canWrite$ = service.can$('Doc_Update', 'doc-1');
      subscriptions.push(
        canRead$.subscribe(() => {}),
        canWrite$.subscribe(() => {})
      );
      await service.can('Doc_Update', 'doc-1');
      expect(canRead$.value).toBe(true);
      expect(canWrite$.value).toBe(true);
      getDocPermissions.mockRejectedValue(
        new UserFriendlyError({
          status,
          code: 'ACCESS_DENIED',
          type: 'ACCESS_DENIED',
          name: 'ACCESS_DENIED',
          message: 'Access revoked',
        })
      );
      await expect(service.can('Doc_Update', 'doc-1')).resolves.toBe(false);
      expect(canRead$.value).toBe(false);
      expect(canWrite$.value).toBe(false);
    }
  );

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

describe('GuardService refresh budget', () => {
  const callsFor = (mock: ReturnType<typeof vi.fn>, docId: string) =>
    mock.mock.calls.filter(([id]) => id === docId).length;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('refreshes opened documents every 5 seconds and listed rows every minute', async () => {
    vi.useFakeTimers();
    const { service, getDocPermissions } = createGuard('write', false);
    subscriptions.push(
      service.readableDocIds$(['listed']).subscribe(() => {}),
      service.can$('Doc_Update', 'opened').subscribe(() => {})
    );
    service.revalidateCan('Doc_Update', 'opened');
    await vi.waitFor(() => expect(getDocPermissions).toHaveBeenCalledTimes(2));
    getDocPermissions.mockClear();

    await vi.advanceTimersByTimeAsync(55_000);
    expect(callsFor(getDocPermissions, 'opened')).toBe(11);
    expect(callsFor(getDocPermissions, 'listed')).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(callsFor(getDocPermissions, 'opened')).toBe(12);
    expect(callsFor(getDocPermissions, 'listed')).toBe(1);
  });

  test('pauses refreshes while the page is hidden', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    const page = {
      visibilityState: 'hidden',
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    vi.stubGlobal('document', page);
    const { service, getDocPermissions } = createGuard('write', false);
    subscriptions.push(
      service.can$('Doc_Update', 'opened').subscribe(() => {})
    );

    await vi.advanceTimersByTimeAsync(20_000);
    expect(getDocPermissions).not.toHaveBeenCalled();

    page.visibilityState = 'visible';
    listeners.get('visibilitychange')?.();
    await vi.waitFor(() =>
      expect(getDocPermissions).toHaveBeenCalledWith('opened')
    );
  });

  test('coalesces concurrent checks and bounds requests across callers', async () => {
    const { service, getDocPermissions } = createGuard('write', false);
    let active = 0;
    let maximum = 0;
    getDocPermissions.mockImplementation(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return { Doc_Read: true };
    });
    const ids = Array.from({ length: 10 }, (_, index) => `doc-${index}`);
    await Promise.all(
      [...ids, ...ids, 'doc-0'].map(id => service.can('Doc_Read', id))
    );
    expect(getDocPermissions).toHaveBeenCalledTimes(10);
    expect(maximum).toBeLessThanOrEqual(4);
  });

  test('stops retrying a failing check and keeps later revalidations working', async () => {
    vi.useFakeTimers();
    const { service, getDocPermissions } = createGuard('write', false);
    getDocPermissions.mockRejectedValue(new Error('Network unavailable'));
    service.revalidateCan('Doc_Read', 'doc-1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getDocPermissions).toHaveBeenCalledTimes(4);

    getDocPermissions.mockResolvedValue({ Doc_Read: true });
    const canRead$ = service.can$('Doc_Read', 'doc-1');
    subscriptions.push(canRead$.subscribe(() => {}));
    service.revalidateCan('Doc_Read', 'doc-1');
    await vi.waitFor(() => expect(canRead$.value).toBe(true));
  });
});

describe('GuardService batch permission checks', () => {
  const createBatchGuard = () => {
    const getDocPermissions = vi.fn().mockResolvedValue({ Doc_Read: true });
    const getDocsPermissions = vi.fn(async (ids: string[]) =>
      ids.map(docId =>
        docId.startsWith('denied')
          ? { docId, status: 'denied', permissions: null }
          : docId.startsWith('missing')
            ? { docId, status: 'missing', permissions: null }
            : { docId, status: 'granted', permissions: { Doc_Read: true } }
      )
    );
    const framework = new Framework();
    framework.service(
      GuardService,
      () =>
        new GuardService(
          {
            getDocPermissions,
            getDocsPermissions,
            getWorkspacePermissions: vi.fn(),
          } as never,
          { workspace: { flavour: 'server-1', openOptions: {} } } as never,
          {
            permission: {
              isOwner$: new LiveData(false),
              isAdmin$: new LiveData(false),
              waitForRevalidation: vi.fn(),
              revalidate: vi.fn(),
            },
          } as never
        )
    );
    const service = framework.provider().get(GuardService);
    services.push(service);
    return { service, getDocPermissions, getDocsPermissions };
  };

  test('checks listed candidates with one request per hundred documents', async () => {
    const { service, getDocPermissions, getDocsPermissions } =
      createBatchGuard();
    const ids = [
      ...Array.from({ length: 150 }, (_, index) => `doc-${index}`),
      'denied-1',
      'missing-1',
    ];
    let visible: ReadonlySet<string> = new Set();
    subscriptions.push(
      service.readableDocIds$(ids).subscribe(value => {
        visible = value;
      })
    );
    await vi.waitFor(() => expect(visible.size).toBe(151));
    expect(getDocsPermissions).toHaveBeenCalledTimes(2);
    expect(
      getDocsPermissions.mock.calls.map(([chunk]) => chunk.length)
    ).toEqual([100, 52]);
    expect(visible.has('denied-1')).toBe(false);
    // Only the document the server has no record of uses the single query.
    expect(getDocPermissions).toHaveBeenCalledTimes(1);
    expect(getDocPermissions).toHaveBeenCalledWith('missing-1');
  });

  test('refreshes listed candidates in batches and applies revocations', async () => {
    vi.useFakeTimers();
    try {
      const { service, getDocsPermissions } = createBatchGuard();
      let visible: ReadonlySet<string> = new Set();
      subscriptions.push(
        service.readableDocIds$(['doc-a', 'doc-b']).subscribe(value => {
          visible = value;
        })
      );
      await vi.waitFor(() => expect(visible.size).toBe(2));
      getDocsPermissions.mockImplementation(async (ids: string[]) =>
        ids.map(docId =>
          docId === 'doc-b'
            ? { docId, status: 'denied', permissions: null }
            : { docId, status: 'granted', permissions: { Doc_Read: true } }
        )
      );
      getDocsPermissions.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getDocsPermissions).toHaveBeenCalledTimes(1);
      expect(visible.has('doc-a')).toBe(true);
      expect(visible.has('doc-b')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('falls back to single checks when the server lacks the batch query', async () => {
    const { service, getDocPermissions, getDocsPermissions } =
      createBatchGuard();
    getDocsPermissions.mockRejectedValue(
      new Error('Cannot query field "docsPermissions" on type "WorkspaceType".')
    );
    let visible: ReadonlySet<string> = new Set();
    subscriptions.push(
      service.readableDocIds$(['doc-a', 'doc-b']).subscribe(value => {
        visible = value;
      })
    );
    await vi.waitFor(() => expect(visible.size).toBe(2));
    expect(getDocPermissions).toHaveBeenCalledTimes(2);
    subscriptions.push(service.readableDocIds$(['doc-c']).subscribe(() => {}));
    await vi.waitFor(() => expect(getDocPermissions).toHaveBeenCalledTimes(3));
    expect(getDocsPermissions).toHaveBeenCalledTimes(1);
  });

  test('does not fall back to many single requests when the batch fails transiently', async () => {
    const { service, getDocPermissions, getDocsPermissions } =
      createBatchGuard();
    getDocsPermissions.mockRejectedValue(new Error('Network unavailable'));
    const values: number[] = [];
    subscriptions.push(
      service
        .readableDocIds$(['doc-a', 'doc-b'])
        .subscribe(value => values.push(value.size))
    );
    await vi.waitFor(() => expect(getDocsPermissions).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(getDocPermissions).not.toHaveBeenCalled();
    expect(values.every(size => size === 0)).toBe(true);
  });
});
