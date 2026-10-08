import { UserFriendlyError } from '@affine/error';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspaceLifecycleService } from './lifecycle';

const services: WorkspaceLifecycleService[] = [];
afterEach(() => services.splice(0).forEach(service => service.dispose()));

function setup(flavour = 'affine-cloud') {
  const account$ = new LiveData<unknown>({ id: 'actor' });
  const gql = vi.fn();
  const requestPull = vi.fn().mockResolvedValue(undefined);
  const invalidate = vi.fn();
  const server = { account$, gql };
  const framework = new Framework();
  framework.service(
    WorkspaceLifecycleService,
    () =>
      new WorkspaceLifecycleService(
        {
          workspace: {
            id: 'workspace',
            flavour,
            engine: { doc: { requestPull } },
          },
        } as never,
        { server, server$: new LiveData(server) } as never,
        { invalidate } as never
      )
  );
  const service = framework.provider().get(WorkspaceLifecycleService);
  services.push(service);
  return { service, gql, requestPull, invalidate, account$ };
}

function failure(status: number) {
  return new UserFriendlyError({
    status,
    code: 'TEST',
    type: 'TEST',
    name: 'NETWORK_ERROR',
    message: 'test failure',
  });
}

test('success requests authoritative root and directory pulls without writing local trash metadata', async () => {
  const { service, gql, requestPull, invalidate } = setup();
  const local = vi.fn();
  gql
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v1' } })
    .mockResolvedValueOnce({});
  // Scheduling/reconciliation must not keep a successful mutation spinning.
  requestPull.mockReturnValue(new Promise(() => {}));
  await service.change('doc', 'doc', 'trash', local);
  expect(local).not.toHaveBeenCalled();
  expect(requestPull.mock.calls).toEqual([['workspace'], ['db$folders']]);
  expect(invalidate).toHaveBeenCalledOnce();
  expect(service.changes$.value).toBe(1);
});

test('an uncertain response keeps its receipt key for retry, with no pre-success local update', async () => {
  const { service, gql, requestPull } = setup();
  gql
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v1' } })
    .mockRejectedValueOnce(failure(499))
    .mockResolvedValueOnce({});
  await expect(service.change('doc', 'doc', 'trash')).rejects.toThrow();
  expect(requestPull).not.toHaveBeenCalled();
  await service.change('doc', 'doc', 'trash');
  expect(gql.mock.calls[2][0].variables.input).toEqual(
    gql.mock.calls[1][0].variables.input
  );
});

test('a version rejection re-reads the version and uses a new receipt key', async () => {
  const { service, gql } = setup();
  gql
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v1' } })
    .mockRejectedValueOnce(failure(409))
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v2' } })
    .mockResolvedValueOnce({});
  await expect(service.change('doc', 'doc', 'trash')).rejects.toThrow();
  await service.change('doc', 'doc', 'trash');
  expect(gql.mock.calls[3][0].variables.input.expectedVersion).toBe('v2');
  expect(gql.mock.calls[3][0].variables.input.requestKey).not.toBe(
    gql.mock.calls[1][0].variables.input.requestKey
  );
});

test('trash and restore for the same identity cannot overlap', async () => {
  const { service, gql } = setup();
  let resolve!: (value: unknown) => void;
  gql
    .mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      })
    )
    .mockResolvedValueOnce({});
  const pending = service.change('doc', 'doc', 'trash');
  await expect(service.change('doc', 'doc', 'restore')).rejects.toThrow(
    'already in progress'
  );
  resolve({ workspaceLifecycleResource: { version: 'v1' } });
  await pending;
});

test('an old account response cannot invalidate or synchronize the new account', async () => {
  const { service, gql, account$, requestPull, invalidate } = setup();
  let resolve!: (value: unknown) => void;
  gql
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v1' } })
    .mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      })
    );
  const pending = service.change('doc', 'doc', 'trash');
  await vi.waitFor(() => expect(gql).toHaveBeenCalledTimes(2));
  account$.next({ id: 'another-actor' });
  resolve({});
  await pending;
  expect(requestPull).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

test('a background pull failure does not turn a committed mutation into failure', async () => {
  const { service, gql, requestPull } = setup();
  gql
    .mockResolvedValueOnce({ workspaceLifecycleResource: { version: 'v1' } })
    .mockResolvedValueOnce({});
  requestPull.mockRejectedValue(new Error('worker unavailable'));
  await expect(service.change('doc', 'doc', 'trash')).resolves.toBeUndefined();
});

test('local workspaces keep their offline lifecycle path', async () => {
  const { service, gql, requestPull } = setup('local');
  const local = vi.fn();
  await service.change('doc', 'doc', 'trash', local);
  expect(local).toHaveBeenCalledOnce();
  expect(gql).not.toHaveBeenCalled();
  expect(requestPull).not.toHaveBeenCalled();
});
