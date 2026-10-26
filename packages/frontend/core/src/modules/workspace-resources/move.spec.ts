/** @vitest-environment happy-dom */
import { UserFriendlyError } from '@affine/error';
import {
  moveWorkspaceDocumentMutation,
  workspaceDirectoryQuery,
} from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { NestedResourceMoveError, WorkspaceResourceMoveService } from './move';

const services: WorkspaceResourceMoveService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
});
function setup(treeEnabled = false) {
  const gql = vi.fn(async ({ query }: { query: unknown }) =>
    query === workspaceDirectoryQuery
      ? { workspaceDirectory: { revision: 'version-1' } }
      : { moveWorkspaceDocument: { revision: 'version-2' } }
  );
  const tree = {
    enabled$: new LiveData<boolean | null>(treeEnabled),
    accountGeneration: 1,
    load: vi.fn(),
    locate: vi.fn(),
    execute: vi.fn(),
  };
  const resources = { move: vi.fn(), invalidate: vi.fn() };
  const requestPull = vi.fn(async () => {});
  const framework = new Framework();
  framework.service(
    WorkspaceResourceMoveService,
    () =>
      new WorkspaceResourceMoveService(
        {
          workspace: {
            id: 'workspace',
            flavour: 'affine-cloud',
            engine: { doc: { requestPull } },
          },
        } as never,
        { server: { account$: new LiveData({ id: 'a' }), gql } } as never,
        resources as never,
        tree as never
      )
  );
  const service = framework.provider().get(WorkspaceResourceMoveService);
  services.push(service);
  return { service, gql, tree, resources, requestPull };
}
const doc = { id: 'doc', kind: 'doc' as const };
const text = { id: 'text', kind: 'file' as const };
const office = { id: 'office', kind: 'office' as const };

test('mixed session freezes destination, waits for acknowledgment, and does not replay successes', async () => {
  const { service, gql, resources, requestPull } = setup();
  const session = await service.begin([doc, text, office], 'folder');
  await session.move(doc);
  expect(gql.mock.calls[1][0]).toEqual({
    query: moveWorkspaceDocumentMutation,
    variables: {
      workspaceId: 'workspace',
      documentId: 'doc',
      folderId: 'folder',
      expectedRevision: 'version-1',
    },
  });
  expect(requestPull.mock.calls).toEqual([['workspace'], ['db$folders']]);
  resources.move
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue(undefined);
  await expect(session.move(text)).rejects.toThrow('network');
  await session.move(office);
  await session.move(text);
  await session.move(doc);
  await session.move(office);
  expect(gql).toHaveBeenCalledTimes(2);
  expect(resources.move.mock.calls.map(([item]) => item.kind)).toEqual([
    'file',
    'office',
    'file',
  ]);
  expect(
    resources.move.mock.calls.every(([, parent]) => parent === 'folder')
  ).toBe(true);
  await expect(session.move({ id: 'other', kind: 'doc' })).rejects.toThrow(
    'outside'
  );
});

test('unknown document response preserves version and definite conflict permits a fresh explicit retry', async () => {
  const { service, gql } = setup();
  const session = await service.begin([doc], null);
  gql
    .mockResolvedValueOnce({ workspaceDirectory: { revision: 'version-1' } })
    .mockRejectedValueOnce(new Error('network'))
    .mockRejectedValueOnce(
      new UserFriendlyError({
        status: 400,
        code: 'BAD_REQUEST',
        type: 'BAD_REQUEST',
        name: 'BAD_REQUEST',
        message: 'stale',
      })
    );
  await expect(session.move(doc)).rejects.toThrow();
  await expect(session.move(doc)).rejects.toThrow();
  expect(gql.mock.calls[1][0]).toEqual(gql.mock.calls[2][0]);
  gql
    .mockResolvedValueOnce({ workspaceDirectory: { revision: 'version-3' } })
    .mockResolvedValueOnce({
      moveWorkspaceDocument: { revision: 'version-4' },
    });
  await session.move(doc);
  expect(gql.mock.calls[4][0]).toMatchObject({
    variables: { expectedRevision: 'version-3', folderId: null },
  });
});

test('duplicate in-flight calls and a changed account cannot report success or execute the next item', async () => {
  const { service, gql, tree, resources } = setup();
  let finish!: () => void;
  resources.move.mockReturnValue(
    new Promise<void>(resolve => {
      finish = resolve;
    })
  );
  const session = await service.begin([text, doc], null);
  const pending = session.move(text);
  await expect(session.move(text)).rejects.toThrow('pending');
  tree.accountGeneration++;
  finish();
  await expect(pending).rejects.toThrow('scope');
  await expect(session.move(doc)).rejects.toThrow('scope');
  expect(gql).not.toHaveBeenCalled();
});

test('nested or self-target tree selection is rejected before side effects', async () => {
  const { service, tree, resources } = setup(true);
  tree.locate
    .mockResolvedValueOnce({ parent: { nodeId: 'parent' }, ancestors: [] })
    .mockResolvedValueOnce({
      parent: { nodeId: 'child' },
      ancestors: [{ nodeId: 'parent' }],
    });
  await expect(service.begin([doc, text], null)).rejects.toBeInstanceOf(
    NestedResourceMoveError
  );
  tree.locate.mockResolvedValue({
    parent: { nodeId: 'parent' },
    ancestors: [],
  });
  await expect(service.begin([doc], 'parent')).rejects.toBeInstanceOf(
    NestedResourceMoveError
  );
  expect(tree.execute).not.toHaveBeenCalled();
  expect(resources.move).not.toHaveBeenCalled();
});

test('tree moves bind the original parent, preserve failed items, and reject oversized batches', async () => {
  const { service, tree } = setup(true);
  tree.locate.mockResolvedValue({
    parent: {
      nodeId: 'node',
      parentNodeId: 'old',
      canOrganize: true,
      trashed: false,
    },
    ancestors: [],
  });
  const session = await service.begin([doc], 'target');
  tree.execute
    .mockRejectedValueOnce(new Error('target removed'))
    .mockResolvedValue(undefined);
  await expect(session.move(doc)).rejects.toThrow('target removed');
  await session.move(doc);
  expect(tree.execute.mock.calls[0]).toEqual(tree.execute.mock.calls[1]);
  expect(tree.execute).toHaveBeenLastCalledWith({
    action: 'move',
    nodeId: 'node',
    parentNodeId: 'target',
    expectedParentNodeId: 'old',
  });
  await expect(
    service.begin(
      Array.from({ length: 101 }, () => doc),
      null
    )
  ).rejects.toThrow('100');
});

test('preflight rejects unavailable tree ancestry and stale dialog accounts before any write', async () => {
  const { service, tree, resources } = setup(true);
  tree.locate.mockRejectedValue(new Error('tree unavailable'));
  await expect(service.begin([doc, text], null)).rejects.toThrow(
    'tree unavailable'
  );
  expect(tree.execute).not.toHaveBeenCalled();
  tree.accountGeneration = 2;
  await expect(service.begin([doc], null, 1)).rejects.toThrow('scope');
  expect(resources.move).not.toHaveBeenCalled();
});
