import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { WorkspaceRepositoryService } from './repo';

const createListService = () => ({
  list: {
    workspaces$: new LiveData<Array<{ id: string; flavour: string }>>([]),
  },
});

const createRepository = (
  options = { ttlMs: 60_000, capacity: 3 },
  flavours: Array<{
    flavour: string;
    validateWorkspaceAccess?: (
      workspaceId: string,
      signal?: AbortSignal
    ) => Promise<void>;
  }> = []
) => {
  const framework = new Framework();
  const listService = createListService();
  const flavoursService = { flavours$: new LiveData(flavours) };
  framework.service(
    WorkspaceRepositoryService,
    () =>
      new WorkspaceRepositoryService(
        flavoursService as never,
        {} as never,
        listService as never,
        options
      )
  );
  return {
    listService,
    repository: framework.provider().get(WorkspaceRepositoryService),
  };
};

const createWorkspaceMock = (id: string, flavour: string) => ({
  id,
  flavour,
  meta: { id, flavour },
  scope: { dispose: vi.fn() },
  canGracefulStop: true,
  suspendBackgroundWork: vi.fn().mockResolvedValue(undefined),
  resumeBackgroundWork: vi.fn().mockResolvedValue(undefined),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkspaceRepositoryService document scope', () => {
  test('always creates and disposes isolated workspace instances', () => {
    const { repository } = createRepository();
    const scopes: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(repository, 'instantiate').mockImplementation(options => {
      const scope = { dispose: vi.fn() };
      scopes.push(scope);
      return {
        id: options.metadata.id,
        meta: options.metadata,
        scope,
      } as never;
    });
    const options = {
      metadata: { id: 'workspace-1', flavour: 'server-1' },
      docScopeId: 'doc-1',
      docScopeAccess: 'read' as const,
    };

    const first = repository.open(options, { local: {}, remotes: {} });
    const second = repository.open(options, { local: {}, remotes: {} });

    expect(repository.instantiate).toHaveBeenCalledTimes(2);
    expect(first.workspace).not.toBe(second.workspace);
    expect(repository.pool.get('workspace:server-1:workspace-1')).toBeNull();
    first.dispose();
    second.dispose();
    expect(scopes[0].dispose).toHaveBeenCalledTimes(1);
    expect(scopes[1].dispose).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceRepositoryService warm cache', () => {
  test('reuses a recently released workspace and resumes background work', () => {
    const { repository } = createRepository();
    const workspace = createWorkspaceMock('workspace-1', 'server-1');
    vi.spyOn(repository, 'instantiate').mockReturnValue(workspace as never);
    const options = {
      metadata: { id: 'workspace-1', flavour: 'server-1' },
    };

    const first = repository.open(options);
    first.dispose();
    const second = repository.open(options);

    expect(repository.instantiate).toHaveBeenCalledTimes(1);
    expect(second.workspace).toBe(first.workspace);
    expect(workspace.suspendBackgroundWork).toHaveBeenCalledTimes(1);
    expect(workspace.resumeBackgroundWork).toHaveBeenCalledTimes(2);
  });

  test('marks warm cloud instances for a fresh access check', async () => {
    const validateWorkspaceAccess = vi.fn().mockResolvedValue(undefined);
    const { repository } = createRepository(undefined, [
      { flavour: 'server-1', validateWorkspaceAccess },
    ]);
    const workspace = createWorkspaceMock('workspace-1', 'server-1');
    vi.spyOn(repository, 'instantiate').mockReturnValue(workspace as never);
    const options = {
      metadata: { id: 'workspace-1', flavour: 'server-1' },
    };

    const first = repository.open(options);
    expect(first.reused).toBe(false);
    first.dispose();
    const second = repository.open(options);
    expect(second.reused).toBe(true);
    await second.validateAccess?.();

    expect(validateWorkspaceAccess).toHaveBeenCalledWith(
      'workspace-1',
      undefined
    );
  });

  test('expires warm workspaces and keeps flavours isolated', () => {
    vi.useFakeTimers();
    const { repository } = createRepository({ ttlMs: 100, capacity: 3 });
    const workspaces: ReturnType<typeof createWorkspaceMock>[] = [];
    vi.spyOn(repository, 'instantiate').mockImplementation(options => {
      const workspace = createWorkspaceMock(
        options.metadata.id,
        options.metadata.flavour
      );
      workspaces.push(workspace);
      return workspace as never;
    });

    repository
      .open({ metadata: { id: 'same', flavour: 'server-1' } })
      .dispose();
    const otherFlavour = repository.open({
      metadata: { id: 'same', flavour: 'server-2' },
    });
    expect(repository.instantiate).toHaveBeenCalledTimes(2);
    otherFlavour.dispose();

    vi.advanceTimersByTime(1_100);
    repository.open({
      metadata: { id: 'same', flavour: 'server-1' },
    });
    expect(repository.instantiate).toHaveBeenCalledTimes(3);
    expect(workspaces[0].scope.dispose).toHaveBeenCalledTimes(1);
  });

  test('evicts inactive workspaces when the account-scoped list changes', () => {
    vi.useFakeTimers();
    const { listService, repository } = createRepository({
      ttlMs: 60_000,
      capacity: 3,
    });
    const workspace = createWorkspaceMock('workspace-1', 'server-1');
    vi.spyOn(repository, 'instantiate').mockReturnValue(workspace as never);
    repository
      .open({ metadata: { id: 'workspace-1', flavour: 'server-1' } })
      .dispose();

    listService.list.workspaces$.setValue([
      { id: 'workspace-2', flavour: 'server-1' },
    ]);
    vi.advanceTimersByTime(1_000);

    expect(workspace.scope.dispose).toHaveBeenCalledTimes(1);
  });
});
