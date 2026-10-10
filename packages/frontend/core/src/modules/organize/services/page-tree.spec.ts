import { UserFriendlyError } from '@affine/error';
import { mutateWorkspacePageTreeMutation } from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspacePageTreeService } from './page-tree';

const services: WorkspacePageTreeService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
  vi.unstubAllGlobals();
});
const page = (revision = 1, items: { nodeId: string }[] = []) => ({
  enabled: true,
  revision,
  authorizationRevision: 'a'.repeat(64),
  items,
  parent: null,
  ancestors: [],
  nextCursor: null,
});
async function setup() {
  vi.stubGlobal('navigator', { onLine: true });
  const account$ = new LiveData<unknown>({ id: 'actor' });
  const gql = vi.fn().mockResolvedValue({ workspacePageTree: page() });
  const requestPull = vi.fn().mockResolvedValue(undefined),
    invalidate = vi.fn();
  const server = { account$, gql },
    framework = new Framework();
  framework.service(
    WorkspacePageTreeService,
    () =>
      new WorkspacePageTreeService(
        {
          workspace: {
            id: 'workspace',
            flavour: 'affine-cloud',
            engine: { doc: { requestPull } },
          },
        } as never,
        { server, server$: new LiveData(server) } as never,
        { invalidate } as never
      )
  );
  const service = framework.provider().get(WorkspacePageTreeService);
  services.push(service);
  await service.load(null);
  return { service, gql, account$, invalidate };
}
const command = { action: 'move', nodeId: 'source', parentNodeId: 'target' };
const failure = (status: number) =>
  new UserFriendlyError({
    status,
    code: 'TEST',
    type: 'TEST',
    name: 'NETWORK_ERROR',
    message: 'test',
  });

test('uncertain mutation response preserves the exact request key and versions; definite conflict releases them', async () => {
  const { service, gql } = await setup();
  let attempt = 0;
  gql.mockImplementation(async ({ query }) => {
    if (query === mutateWorkspacePageTreeMutation)
      throw failure(++attempt === 1 ? 499 : 409);
    return { workspacePageTree: page(2) };
  });
  await expect(service.execute(command)).rejects.toThrow();
  await expect(service.execute(command)).rejects.toThrow();
  await expect(service.execute(command)).rejects.toThrow();
  const inputs = gql.mock.calls
    .filter(([call]) => call.query === mutateWorkspacePageTreeMutation)
    .map(([call]) => call.variables.input);
  expect(inputs[1]).toEqual(inputs[0]);
  expect(inputs[2].requestKey).not.toBe(inputs[1].requestKey);
  expect(inputs[2].expectedRevision).toBe(2);
});

test('account changes abort in-flight reads and discard their private tree result', async () => {
  const { service, gql, account$ } = await setup();
  let resolve!: (result: unknown) => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const pending = service.load('private');
  account$.next(null);
  resolve({ workspacePageTree: page(1, [{ nodeId: 'private-title' }]) });
  await pending;
  expect(service.layers$.value.has('private')).toBe(false);
  expect(service.enabled$.value).toBe(null);
});

test('changed pagination revisions discard the partial view instead of mixing snapshots', async () => {
  const { service, gql } = await setup();
  gql.mockResolvedValueOnce({
    workspacePageTree: {
      ...page(1, [{ nodeId: 'first' }]),
      nextCursor: 'cursor',
    },
  });
  await service.load(null);
  gql.mockResolvedValueOnce({
    workspacePageTree: page(2, [{ nodeId: 'second' }]),
  });
  await service.load(null, true);
  expect(service.layers$.value.get(service.key(null))).toEqual({
    loading: false,
    error: true,
  });
});

test('undo rejects a later tree revision without issuing a mutation', async () => {
  const { service, gql } = await setup();
  service.undo$.next({
    revision: 1,
    command: { action: 'move', nodeId: 'source', parentNodeId: null },
  });
  gql.mockResolvedValue({ workspacePageTree: page(2) });
  await expect(service.undo()).rejects.toThrow('changed');
  expect(
    gql.mock.calls.some(
      ([call]) => call.query === mutateWorkspacePageTreeMutation
    )
  ).toBe(false);
  expect(service.undo$.value).toBe(null);
});

test('a confirmed lifecycle preview pins its original revision after background refresh', async () => {
  const { service, gql } = await setup();
  gql.mockResolvedValue({ workspacePageTree: page(10) });
  await service.load(null);
  gql.mockImplementation(async ({ query }) => {
    if (query === mutateWorkspacePageTreeMutation) throw failure(409);
    return { workspacePageTree: page(10) };
  });
  await expect(
    service.execute(
      { action: 'trash', nodeId: 'parent' },
      { revision: 3, authorizationRevision: 'b'.repeat(64) }
    )
  ).rejects.toThrow();
  const input = gql.mock.calls.find(
    ([call]) => call.query === mutateWorkspacePageTreeMutation
  )?.[0].variables.input;
  expect(input.expectedRevision).toBe(3);
  expect(input.expectedAuthorizationRevision).toBe('b'.repeat(64));
});
