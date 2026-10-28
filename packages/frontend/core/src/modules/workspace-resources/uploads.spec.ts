/** @vitest-environment happy-dom */
import { UserFriendlyError } from '@affine/error';
import {
  type CreateWorkspaceNativeResourceInput,
  WORKSPACE_PAGE_TREE_CONTRACT,
} from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('./upload-blob', () => ({
  uploadWorkspaceNativeBlob: vi.fn(async () => 'blob-one'),
  WorkspaceUploadSizeError: class extends Error {},
}));
import {
  uploadWorkspaceNativeBlob,
  WorkspaceUploadSizeError,
} from './upload-blob';
import { workspaceUploadFailure, WorkspaceUploadsService } from './uploads';

const services: WorkspaceUploadsService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
  vi.useRealTimers();
  vi.clearAllMocks();
});
const error = (status: number, retryAfterMs?: number) =>
  new UserFriendlyError({
    status,
    name: status === 429 ? 'TOO_MANY_REQUEST' : 'BAD_REQUEST',
    type: 'BAD_REQUEST',
    code: 'BAD_REQUEST',
    message: 'bounded failure',
    retryAfterMs,
  });
function setup() {
  const account$ = new LiveData({ id: 'a' });
  let count = 0;
  const gql = vi.fn(
    async (_request: {
      variables: { input: CreateWorkspaceNativeResourceInput };
      context: { signal: AbortSignal };
    }) => ({
      createWorkspaceNativeResource: {
        id: `resource-${++count}`,
        kind: 'file',
      },
    })
  );
  const server = { account$, gql };
  const tree = {
    accountGeneration: 1,
    load: vi.fn(async () => {}),
    key: (id: string | null) => id ?? 'root',
    layers$: new LiveData(
      new Map([
        ['root', { page: { revision: 'r1', authorizationRevision: 'a1' } }],
      ])
    ),
  };
  const resources = { invalidate: vi.fn() };
  const framework = new Framework();
  framework.service(
    WorkspaceUploadsService,
    () =>
      new WorkspaceUploadsService(
        { workspace: { id: 'w' } } as never,
        { server, server$: new LiveData(server) } as never,
        tree as never,
        resources as never
      )
  );
  const service = framework.provider().get(WorkspaceUploadsService);
  services.push(service);
  return { service, gql, account$, tree, resources };
}
const file = () => new File(['test marker'], 'one.txt', { type: 'text/plain' });
const destination = { name: 'Folder', folderId: 'folder' };

test('101 files survive view subscriptions, pause on throttling and preserve the request identity', async () => {
  vi.useFakeTimers();
  const { service, gql } = setup();
  gql.mockRejectedValueOnce(error(429, 5000));
  const observer = service.jobs$.subscribe(() => {});
  const ids = service.enqueue(Array.from({ length: 101 }, file), destination);
  observer.unsubscribe();
  await vi.advanceTimersByTimeAsync(0);
  expect(gql).toHaveBeenCalledTimes(1);
  expect(service.jobs$.value[0]).toMatchObject({
    status: 'waiting',
    reason: 'rateLimited',
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(gql).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(gql).toHaveBeenCalledTimes(102);
  const retried = gql.mock.calls.filter(
    ([request]) => request.variables.input.requestKey === ids[0]
  );
  expect(retried).toHaveLength(2);
  expect(retried[0][0].variables.input).toBe(retried[1][0].variables.input);
  expect(new Set(ids).size).toBe(101);
  expect(
    service.jobs$.value.every(job => job.status === 'done' && !job.file)
  ).toBe(true);
  expect(uploadWorkspaceNativeBlob).toHaveBeenCalledTimes(101);
  service.clearDone();
  expect(service.jobs$.value).toEqual([]);
});

test('unknown outcomes reuse the blob and mutation, definite conflicts refresh the destination only on explicit retry', async () => {
  const { service, gql, tree } = setup();
  gql.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  service.enqueue([file()], {
    ...destination,
    tree: {
      parentNodeId: null,
      treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
    },
  });
  await vi.waitFor(() => expect(service.jobs$.value[0].status).toBe('failed'));
  const original = gql.mock.calls[0][0].variables.input;
  const firstKey = service.jobs$.value[0].requestKey;
  gql.mockRejectedValueOnce(error(409));
  service.retryFailed();
  await vi.waitFor(() =>
    expect(service.jobs$.value[0].reason).toBe('conflict')
  );
  expect(gql.mock.calls[1][0].variables.input).toBe(original);
  expect(tree.load).toHaveBeenCalledTimes(1);
  tree.layers$.next(
    new Map([
      ['root', { page: { revision: 'r2', authorizationRevision: 'a2' } }],
    ])
  );
  service.retryFailed();
  await vi.waitFor(() => expect(service.jobs$.value[0].status).toBe('done'));
  expect(service.jobs$.value[0].requestKey).toBe(firstKey);
  expect(service.jobs$.value[0].mutationKey).not.toBe(firstKey);
  expect(gql.mock.calls[2][0]).toMatchObject({
    variables: {
      input: {
        expectedTreeRevision: 'r2',
        expectedAuthorizationRevision: 'a2',
      },
    },
  });
  expect(uploadWorkspaceNativeBlob).toHaveBeenCalledTimes(1);
});

test('account changes abort requests, erase progress and never upload queued files for the next actor', async () => {
  const { service, gql, account$, tree } = setup();
  let finish!: () => void;
  gql.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () =>
          resolve({
            createWorkspaceNativeResource: { id: 'old', kind: 'file' },
          });
      })
  );
  service.enqueue([file(), file()], destination);
  await vi.waitFor(() => expect(gql).toHaveBeenCalledTimes(1));
  const request = gql.mock.calls[0][0];
  tree.accountGeneration++;
  account$.next({ id: 'b' });
  expect(request.context.signal.aborted).toBe(true);
  expect(service.jobs$.value).toEqual([]);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(gql).toHaveBeenCalledTimes(1);
  expect(uploadWorkspaceNativeBlob).toHaveBeenCalledTimes(1);
  service.enqueue([file()], destination);
  await vi.waitFor(() => expect(service.jobs$.value[0].status).toBe('done'));
});

test('classifies failures without exposing raw server details', () => {
  expect(
    workspaceUploadFailure(new WorkspaceUploadSizeError('private body'))
  ).toBe('size');
  expect(workspaceUploadFailure(error(403))).toBe('permission');
  expect(workspaceUploadFailure(error(400))).toBe('invalid');
  expect(workspaceUploadFailure(error(404))).toBe('missing');
  expect(workspaceUploadFailure(error(409))).toBe('conflict');
  expect(workspaceUploadFailure(error(429))).toBe('rateLimited');
  expect(workspaceUploadFailure(new Error('transaction expired'))).toBe(
    'timeout'
  );
});
