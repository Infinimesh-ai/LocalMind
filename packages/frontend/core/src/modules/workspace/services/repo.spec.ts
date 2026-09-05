import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceRepositoryService } from './repo';

describe('WorkspaceRepositoryService document scope', () => {
  test('always creates and disposes isolated workspace instances', () => {
    const framework = new Framework();
    framework.service(
      WorkspaceRepositoryService,
      () =>
        new WorkspaceRepositoryService({} as never, {} as never, {} as never)
    );
    const repository = framework.provider().get(WorkspaceRepositoryService);
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
    expect(repository.pool.get('workspace-1')).toBeNull();
    first.dispose();
    second.dispose();
    expect(scopes[0].dispose).toHaveBeenCalledTimes(1);
    expect(scopes[1].dispose).toHaveBeenCalledTimes(1);
  });
});
