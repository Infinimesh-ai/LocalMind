import { UserFriendlyError } from '@affine/error';
import { mutateWorkspacePageTreeMutation } from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspacePageTreeService } from './page-tree';

const services: WorkspacePageTreeService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
  vi.useRealTimers();
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

test('cross-parent undo restores the former target order in the same inverse move', async () => {
  const { service, gql } = await setup();
  let revision = 1;
  gql.mockImplementation(async ({ query, variables }) => {
    if (query !== mutateWorkspacePageTreeMutation)
      return { workspacePageTree: page(revision) };
    revision++;
    return {
      mutateWorkspacePageTree: {
        operationId: 'move',
        nodeId: 'source',
        parentNodeId: variables.input.parentNodeId,
        revision,
        oldParentNodeId: 'old',
        oldBeforeNodeId: 'anchor',
        oldSiblingOrder: null,
        oldTargetSiblingOrder: ['B', 'A', 'C'],
        oldSourceSiblingOrder: null,
      },
    };
  });
  await service.execute({
    ...command,
    targetSiblingOrder: ['A', 'B', 'source', 'C'],
  });
  await service.undo();
  const inputs = gql.mock.calls
    .filter(([call]) => call.query === mutateWorkspacePageTreeMutation)
    .map(([call]) => call.variables.input);
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toMatchObject({
    action: 'move',
    nodeId: 'source',
    parentNodeId: 'old',
    beforeNodeId: 'anchor',
    sourceSiblingOrder: ['B', 'A', 'C'],
    expectedRevision: 2,
  });
  expect(inputs[1].targetSiblingOrder).toBeUndefined();
  expect(service.undo$.value).toBeNull();
});
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

test('sidebar, breadcrumbs and folder content share one read and reuse the fresh result', async () => {
  const { service, gql } = await setup();
  gql.mockClear();
  let resolve!: (result: unknown) => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const sidebar = service.observe('folder');
  const breadcrumbs = service.observe('folder');
  const content = service.observe('folder');
  const pending = service.load('folder');
  expect(gql).toHaveBeenCalledTimes(1);
  expect(gql.mock.calls[0][0].context.signal.aborted).toBe(false);
  resolve({ workspacePageTree: page() });
  await pending;
  sidebar();
  breadcrumbs();
  content();
  const reopened = service.observe('folder');
  expect(gql).toHaveBeenCalledTimes(1);
  reopened();
});

test('polling refreshes only visible layers, with a bounded and fair batch', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  const close = service.observe('closed');
  await service.load('closed');
  close();
  for (let i = 0; i < 8; i++) {
    service.observe(`open-${i}`);
    await service.load(`open-${i}`);
  }
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(gql).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(30_000);
  const parents = new Set(
    gql.mock.calls.map(([call]) => call.variables.parentNodeId)
  );
  expect(parents.has('closed')).toBe(false);
  for (let i = 0; i < 8; i++) expect(parents.has(`open-${i}`)).toBe(true);
  expect(gql.mock.calls.length).toBeLessThanOrEqual(12);
});

test('unchanged authoritative snapshots poll only root and reuse reopened branches', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  gql.mockResolvedValue({
    workspacePageTree: { ...page(), snapshotRevision: 'snapshot-a' },
  });
  await service.load(null);
  const close = service.observe('closed');
  await service.load('closed');
  close();
  for (let i = 0; i < 8; i++) {
    service.observe(`open-${i}`);
    await service.load(`open-${i}`);
  }
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(gql).toHaveBeenCalledTimes(6);
  expect(
    gql.mock.calls.every(([call]) => call.variables.parentNodeId === null)
  ).toBe(true);
  const reopen = service.observe('closed');
  expect(gql).toHaveBeenCalledTimes(6);
  reopen();
});

test('nested metadata and ACL snapshot changes refresh children without a tree command', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  gql.mockResolvedValue({
    workspacePageTree: { ...page(), snapshotRevision: 'snapshot-a' },
  });
  await service.load(null);
  service.observe('folder');
  await service.load('folder');
  gql.mockClear();
  // A title or authorization change need not increment the tree command revision.
  gql.mockResolvedValue({
    workspacePageTree: { ...page(), snapshotRevision: 'snapshot-b' },
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(gql.mock.calls.map(([call]) => call.variables.parentNodeId)).toEqual([
    null,
    'folder',
  ]);
  expect(service.layers$.value.get('folder')?.page?.snapshotRevision).toBe(
    'snapshot-b'
  );
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(gql).toHaveBeenCalledTimes(1);
  expect(gql.mock.calls[0][0].variables.parentNodeId).toBeNull();
});

test('a failed root snapshot check cannot suppress child revalidation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  gql.mockResolvedValue({
    workspacePageTree: { ...page(), snapshotRevision: 'snapshot-a' },
  });
  await service.load(null);
  service.observe('folder');
  await service.load('folder');
  gql.mockClear();
  gql.mockRejectedValueOnce(failure(503));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(gql.mock.calls.map(([call]) => call.variables.parentNodeId)).toEqual([
    null,
    'folder',
  ]);
});

test('rate limiting preserves loaded content and pauses every layer before automatic recovery', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  service.observe('folder');
  await service.load('folder');
  gql.mockRejectedValueOnce(failure(429));
  await service.load('folder');
  expect(service.layers$.value.get('folder')).toMatchObject({
    page: page(),
    error: true,
    rateLimited: true,
    loading: false,
  });
  gql.mockClear();
  await service.load('folder');
  service.observe('another');
  await vi.advanceTimersByTimeAsync(59_999);
  expect(gql).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(service.layers$.value.get('folder')).toEqual({
    page: page(),
    loading: false,
    error: false,
  });
  expect(service.layers$.value.get('another')?.page).toBeDefined();
});

test('consecutive rate limits extend the shared cooldown instead of retrying each polling tick', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  gql.mockRejectedValue(failure(429));
  await service.load(null);
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(gql).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(gql).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(gql).toHaveBeenCalledTimes(2);
});

test('temporary errors keep the last layer, but permission errors discard it', async () => {
  vi.useFakeTimers();
  const { service, gql } = await setup();
  await service.load('folder');
  gql.mockRejectedValueOnce(failure(503));
  await service.load('folder');
  expect(service.layers$.value.get('folder')?.page).toBeDefined();
  await vi.advanceTimersByTimeAsync(15_000);
  gql.mockRejectedValueOnce(
    new UserFriendlyError({
      status: 403,
      code: 'FORBIDDEN',
      type: 'FORBIDDEN',
      name: 'ACCESS_DENIED',
      message: 'Forbidden',
    })
  );
  await service.load('folder');
  expect(service.layers$.value.get('folder')).toEqual({
    loading: false,
    error: true,
  });
});

test('concurrent load-more consumers append a cursor only once', async () => {
  const { service, gql } = await setup();
  gql.mockResolvedValueOnce({
    workspacePageTree: {
      ...page(1, [{ nodeId: 'first' }]),
      nextCursor: 'cursor',
    },
  });
  await service.load('folder');
  gql.mockClear();
  let resolve!: (result: unknown) => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const first = service.load('folder', true);
  const second = service.load('folder', true);
  expect(gql).toHaveBeenCalledTimes(1);
  expect(gql.mock.calls[0][0].variables.after).toBe('cursor');
  resolve({ workspacePageTree: page(1, [{ nodeId: 'second' }]) });
  await Promise.all([first, second]);
  expect(service.layers$.value.get('folder')?.page?.items).toEqual([
    { nodeId: 'first' },
    { nodeId: 'second' },
  ]);
});

test('mutation refresh waits for an older read then fetches the committed revision', async () => {
  const { service, gql } = await setup();
  let resolve!: (result: unknown) => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const olderRead = service.load(null);
  gql.mockImplementation(async ({ query }) =>
    query === mutateWorkspacePageTreeMutation
      ? {
          mutateWorkspacePageTree: {
            revision: 2,
            nodeId: 'source',
            oldParentNodeId: null,
          },
        }
      : { workspacePageTree: page(2) }
  );
  const mutation = service.execute(command);
  resolve({ workspacePageTree: page(1) });
  await Promise.all([olderRead, mutation]);
  expect(service.layers$.value.get(service.key(null))?.page?.revision).toBe(2);
});

test('disposing cancels reads and prevents subsequent requests', async () => {
  const { service, gql } = await setup();
  let resolve!: (result: unknown) => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const pending = service.load('folder');
  const signal = gql.mock.calls.at(-1)?.[0].context.signal;
  service.dispose();
  expect(signal.aborted).toBe(true);
  resolve({ workspacePageTree: page() });
  await pending;
  expect(service.layers$.value.get('folder')?.page).toBeUndefined();
  gql.mockClear();
  await service.load('folder');
  expect(gql).not.toHaveBeenCalled();
});

test('an initial root failure recovers even before the tree is enabled', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql, account$ } = await setup();
  gql.mockRejectedValueOnce(failure(429));
  account$.next({ id: 'another-actor' });
  await service.load(null);
  expect(service.enabled$.value).toBe(null);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(service.enabled$.value).toBe(true);
  expect(service.layers$.value.get(service.key(null))?.error).toBe(false);
});

test('background polling stays idle while the page is hidden', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const { gql } = await setup();
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(gql).not.toHaveBeenCalled();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(gql).toHaveBeenCalledTimes(1);
});

test('ten creates refresh only the root and destination among eight expanded branches', async () => {
  const { service, gql } = await setup();
  for (let i = 0; i < 8; i++) {
    service.observe(`open-${i}`);
    await service.load(`open-${i}`);
  }
  let revision = 1;
  gql.mockClear();
  gql.mockImplementation(async ({ query }) =>
    query === mutateWorkspacePageTreeMutation
      ? {
          mutateWorkspacePageTree: {
            revision: ++revision,
            nodeId: `created-${revision}`,
            parentNodeId: 'open-0',
            oldParentNodeId: null,
          },
        }
      : { workspacePageTree: page(revision) }
  );
  for (let i = 0; i < 10; i++)
    await service.execute({
      action: 'create-folder',
      title: `Folder ${i}`,
      parentNodeId: 'open-0',
    });
  const reads = gql.mock.calls.filter(
    ([call]) => call.query !== mutateWorkspacePageTreeMutation
  );
  expect(reads).toHaveLength(20);
  expect(new Set(reads.map(([call]) => call.variables.parentNodeId))).toEqual(
    new Set([null, 'open-0'])
  );
  gql.mockClear();
  service.observe('open-7');
  expect(gql).not.toHaveBeenCalled();
});

test('invalid commands do not refetch the tree', async () => {
  const { service, gql } = await setup();
  service.observe('folder');
  await service.load('folder');
  gql.mockClear();
  gql.mockRejectedValueOnce(failure(400));
  await expect(service.execute(command)).rejects.toThrow();
  expect(gql).toHaveBeenCalledTimes(1);
});

test('a rejected creation preserves its conflict while refreshing the root', async () => {
  const { service, gql } = await setup();
  const conflict = failure(409);
  gql.mockImplementation(async ({ query }) => {
    if (query === mutateWorkspacePageTreeMutation) throw conflict;
    return { workspacePageTree: page(2) };
  });
  await expect(
    service.execute({
      action: 'create-folder',
      title: 'Folder',
      parentNodeId: null,
    })
  ).rejects.toBe(conflict);
  expect(service.layer$(null).value.page?.revision).toBe(2);
});

test('concurrent rate limits count as one cooldown and honor Retry-After', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  const pending = Array.from({ length: 4 }, () =>
    Promise.withResolvers<unknown>()
  );
  let index = 0;
  gql.mockImplementation(() => pending[index++].promise);
  const reads = pending.map((_, i) => {
    service.observe(`burst-${i}`);
    return service.load(`burst-${i}`);
  });
  for (const request of pending)
    request.reject(
      new UserFriendlyError({
        status: 429,
        code: 'too_many_requests',
        type: 'too_many_request',
        name: 'TOO_MANY_REQUEST',
        message: 'Throttled',
        retryAfterMs: 5000,
      })
    );
  await Promise.all(reads);
  gql.mockResolvedValue({ workspacePageTree: page() });
  gql.mockClear();
  await vi.advanceTimersByTimeAsync(4999);
  expect(gql).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(gql).toHaveBeenCalledTimes(4);
});

test('a committed write waits for an authoritative root before allowing another write', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const { service, gql } = await setup();
  const throttle = new UserFriendlyError({
    status: 429,
    code: 'too_many_requests',
    type: 'too_many_request',
    name: 'TOO_MANY_REQUEST',
    message: 'Throttled',
    retryAfterMs: 5000,
  });
  let revision = 1;
  let limited = true;
  gql.mockImplementation(async ({ query }) => {
    if (query === mutateWorkspacePageTreeMutation)
      return {
        mutateWorkspacePageTree: {
          revision: ++revision,
          nodeId: 'created',
          parentNodeId: null,
          oldParentNodeId: null,
        },
      };
    if (limited) throw throttle;
    return { workspacePageTree: page(revision) };
  });
  const create = {
    action: 'create-folder',
    title: 'First',
    parentNodeId: null,
  };
  expect((await service.execute(create)).revision).toBe(2);
  expect(service.syncing$.value).toBe(true);
  expect(service.writeBlocked$.value).toBe(true);
  await expect(service.execute({ ...create, title: 'Second' })).rejects.toThrow(
    'synchronization'
  );
  expect(
    gql.mock.calls.filter(
      ([call]) => call.query === mutateWorkspacePageTreeMutation
    )
  ).toHaveLength(1);
  limited = false;
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.syncing$.value).toBe(false);
  await service.execute({ ...create, title: 'Second' });
  expect(
    gql.mock.calls.findLast(
      ([call]) => call.query === mutateWorkspacePageTreeMutation
    )?.[0].variables.input.expectedRevision
  ).toBe(2);
});

const node = (nodeId: string, parentNodeId: string | null = null) => ({
  nodeId,
  resourceId: nodeId,
  kind: 'folder',
  title: nodeId,
  parentNodeId,
});

test('resolved resource observers share the node cache and updates', async () => {
  const { service, gql } = await setup();
  gql.mockResolvedValue({
    workspacePageTree: { ...page(), parent: node('folder') },
  });
  service.observe('folder');
  await service.load('folder');
  gql.mockClear();
  service.observeResource('folder', 'folder');
  expect(gql).not.toHaveBeenCalled();
  expect(
    service.layers$.value.get(service.resourceKey('folder', 'folder'))
  ).toBe(service.layer$('folder').value);
  await service.load('folder');
  expect(
    service.layers$.value.get(service.resourceKey('folder', 'folder'))
  ).toBe(service.layer$('folder').value);
});

test('moving a container refreshes both parents and visible descendant paths', async () => {
  const { service, gql } = await setup();
  let moved = false;
  const layers = (parentNodeId: string | null) => {
    if (!parentNodeId) return page(moved ? 2 : 1);
    const ancestors =
      parentNodeId === 'source'
        ? [node(moved ? 'target' : 'old')]
        : parentNodeId === 'child'
          ? [
              node(moved ? 'target' : 'old'),
              node('source', moved ? 'target' : 'old'),
            ]
          : [];
    return {
      ...page(
        moved ? 2 : 1,
        parentNodeId === 'old' && !moved ? [node('source', 'old')] : []
      ),
      parent: node(parentNodeId),
      ancestors,
    };
  };
  gql.mockImplementation(async ({ query, variables }) => {
    if (query === mutateWorkspacePageTreeMutation) {
      moved = true;
      return {
        mutateWorkspacePageTree: {
          revision: 2,
          nodeId: 'source',
          parentNodeId: 'target',
          oldParentNodeId: 'old',
        },
      };
    }
    return { workspacePageTree: layers(variables.parentNodeId) };
  });
  for (const id of ['old', 'target', 'source', 'child', 'unrelated']) {
    service.observe(id);
    await service.load(id);
  }
  gql.mockClear();
  await service.execute(command);
  const parents = gql.mock.calls
    .filter(([call]) => call.query !== mutateWorkspacePageTreeMutation)
    .map(([call]) => call.variables.parentNodeId);
  expect(new Set(parents)).toEqual(
    new Set([null, 'old', 'target', 'source', 'child'])
  );
  expect(service.layer$('child').value.page?.ancestors[0].nodeId).toBe(
    'target'
  );
});

test('an unrelated layer restarts pagination when the global revision advances', async () => {
  const { service, gql } = await setup();
  gql.mockResolvedValueOnce({
    workspacePageTree: {
      ...page(1, [{ nodeId: 'old' }]),
      nextCursor: 'old-cursor',
    },
  });
  await service.load('unrelated');
  gql.mockResolvedValueOnce({ workspacePageTree: page(2) });
  await service.load(null);
  gql.mockClear();
  gql.mockResolvedValue({
    workspacePageTree: {
      ...page(2, [{ nodeId: 'new' }]),
      nextCursor: 'new-cursor',
    },
  });
  await service.load('unrelated', true);
  expect(gql.mock.calls[0][0].variables.after).toBeUndefined();
  expect(service.layer$('unrelated').value.page?.items).toEqual([
    { nodeId: 'new' },
  ]);
});

test('trash changes refresh the observed trash list', async () => {
  const { service, gql } = await setup();
  service.observeTrash();
  await service.loadTrash();
  gql.mockClear();
  gql.mockImplementation(async ({ query }) =>
    query === mutateWorkspacePageTreeMutation
      ? {
          mutateWorkspacePageTree: {
            revision: 2,
            nodeId: 'source',
            parentNodeId: null,
            oldParentNodeId: null,
          },
        }
      : { workspacePageTree: page(2) }
  );
  await service.execute({ action: 'trash', nodeId: 'source' });
  expect(gql.mock.calls.some(([call]) => call.variables.trash === true)).toBe(
    true
  );
});

test('conversion refreshes descendant identities without reloading unrelated branches', async () => {
  const { service, gql } = await setup();
  let converted = false;
  const source = () => ({
    ...node('source', 'old'),
    kind: converted ? 'doc' : 'folder',
    resourceId: converted ? 'document' : 'source',
  });
  gql.mockImplementation(async ({ query, variables }) => {
    if (query === mutateWorkspacePageTreeMutation) {
      converted = true;
      return {
        mutateWorkspacePageTree: {
          revision: 2,
          nodeId: 'source',
          parentNodeId: 'old',
          oldParentNodeId: 'old',
        },
      };
    }
    return {
      workspacePageTree: {
        ...page(converted ? 2 : 1),
        parent: variables.parentNodeId
          ? variables.parentNodeId === 'source'
            ? source()
            : node(variables.parentNodeId)
          : null,
        ancestors:
          variables.parentNodeId === 'child' ? [node('old'), source()] : [],
      },
    };
  });
  for (const id of ['old', 'source', 'child', 'unrelated']) {
    service.observe(id);
    await service.load(id);
  }
  gql.mockClear();
  await service.execute({
    action: 'convert-folder',
    nodeId: 'source',
    expectedResourceVersion: 1,
  });
  expect(service.layer$('child').value.page?.ancestors.at(-1)?.kind).toBe(
    'doc'
  );
  expect(
    service.layers$.value.get(service.resourceKey('doc', 'document'))
  ).toBe(service.layer$('source').value);
  expect(
    gql.mock.calls.some(([call]) => call.variables.parentNodeId === 'unrelated')
  ).toBe(false);
});

test('a late read through another identity cannot replace a newer node snapshot', async () => {
  const { service, gql } = await setup();
  const older = Promise.withResolvers<unknown>();
  gql.mockReturnValueOnce(older.promise);
  const pending = service.loadResource('folder', 'folder');
  gql.mockResolvedValue({
    workspacePageTree: { ...page(2), parent: node('folder') },
  });
  await service.load('folder');
  older.resolve({ workspacePageTree: { ...page(1), parent: node('folder') } });
  await pending;
  expect(service.layer$('folder').value.page?.revision).toBe(2);
  expect(
    service.layers$.value.get(service.resourceKey('folder', 'folder'))
  ).toBe(service.layer$('folder').value);
});

test('native creation refreshes only its destination and root', async () => {
  const { service, gql } = await setup();
  for (const id of ['destination', 'unrelated']) {
    service.observe(id);
    await service.load(id);
  }
  gql.mockClear();
  await service.refresh('destination');
  expect(gql.mock.calls.map(([call]) => call.variables.parentNodeId)).toEqual([
    null,
    'destination',
  ]);
});

test('same-account profile updates preserve tree cache and in-flight reads', async () => {
  const { service, gql, account$ } = await setup();
  const pending = Promise.withResolvers<unknown>();
  gql.mockReturnValueOnce(pending.promise);
  const loading = service.load('folder');
  const signal = gql.mock.calls.at(-1)![0].context.signal;
  gql.mockClear();
  account$.next({ id: 'actor', label: 'Updated profile' });
  expect(signal.aborted).toBe(false);
  expect(gql).not.toHaveBeenCalled();
  pending.resolve({ workspacePageTree: page() });
  await loading;
  expect(service.layers$.value.get('folder')?.page).toEqual(page());
});
