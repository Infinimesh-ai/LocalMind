import {
  Framework,
  generateFractionalIndexingKeyBetween,
  LiveData,
  MemoryMemento,
} from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceFolderPageService } from './folder-page';

function setup(state = new MemoryMemento()) {
  const account$ = new LiveData<{ id: string } | null>({ id: 'actor' });
  let generation = 1;
  const gql = vi.fn().mockResolvedValue({
    createWorkspaceFolderPage: { documentId: 'one-page', folderId: 'folder' },
  });
  const server = { baseUrl: 'https://test.example', account$, gql };
  const pull = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const createDoc = vi.fn();
  const workspace = {
    id: 'workspace',
    flavour: 'affine-cloud',
    engine: { doc: { requestPull: pull } },
  };
  const docs = {
    createDoc,
    list: {
      isReady$: new LiveData(true),
      // eslint-disable-next-line rxjs/finnish -- Mock method mirrors the document list API.
      doc$() {
        return new LiveData({ id: 'one-page', trash$: new LiveData(false) });
      },
    },
  };
  const folders = {
    watchNodeChildren: vi.fn(() => new LiveData<{ index: string }[]>([])),
    createLinkAuthorized: vi.fn().mockResolvedValue(undefined),
  };
  const directory = {
    refresh,
    get accountGeneration() {
      return generation;
    },
  };
  const framework = new Framework();
  framework.service(
    WorkspaceFolderPageService,
    () =>
      new WorkspaceFolderPageService(
        { workspace } as never,
        { server } as never,
        state,
        docs as never,
        directory as never,
        folders as never
      )
  );
  return {
    service: framework.provider().get(WorkspaceFolderPageService),
    state,
    gql,
    pull,
    refresh,
    createDoc,
    folders,
    workspace,
    docs,
    changeAccount: () => {
      generation++;
      account$.next({ id: 'other' });
    },
  };
}

describe('folder page creation recovery', () => {
  test('unknown result retries the same intent after service recreation and ignores newly calculated titles', async () => {
    const first = setup();
    first.gql.mockRejectedValueOnce(new Error('response lost'));
    await expect(
      first.service.create('folder', 'page', 'Original title')
    ).rejects.toThrow('response lost');
    const retry = setup(first.state);
    expect(
      await retry.service.create('folder', 'page', 'Later date title')
    ).toBe('one-page');
    expect(retry.gql.mock.calls[0][0].variables.input).toEqual(
      first.gql.mock.calls[0][0].variables.input
    );
    expect(retry.createDoc).not.toHaveBeenCalled();
    expect(
      first.state.keys().filter(key => first.state.get(key) !== undefined)
    ).toHaveLength(0);
  });
  test('rapid duplicate calls share one operation while a later successful creation gets a new key', async () => {
    const f = setup();
    const first = f.service.create('folder', 'page', 'Title');
    expect(f.service.create('folder', 'page', 'Title')).toBe(first);
    await first;
    expect(f.gql).toHaveBeenCalledTimes(1);
    await f.service.create('folder', 'page', 'Title');
    expect(f.gql.mock.calls[1][0].variables.input.requestKey).not.toBe(
      f.gql.mock.calls[0][0].variables.input.requestKey
    );
  });
  test('refresh failure retains the committed request; retry never calls the local creator', async () => {
    const f = setup();
    f.refresh.mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.create('folder', 'page', 'Title')).rejects.toThrow(
      'offline'
    );
    await f.service.create('folder', 'page', 'Title');
    expect(f.gql.mock.calls[1][0].variables.input.requestKey).toBe(
      f.gql.mock.calls[0][0].variables.input.requestKey
    );
    expect(f.createDoc).not.toHaveBeenCalled();
  });
  test('failed persistence sends no request; corrupt recovery state fails closed', async () => {
    const f = setup();
    vi.spyOn(f.state, 'set').mockImplementationOnce(() => {
      throw new Error('full');
    });
    await expect(f.service.create('folder', 'page', 'Title')).rejects.toThrow(
      'full'
    );
    expect(f.gql).not.toHaveBeenCalled();
    f.gql.mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.create('folder', 'page', 'Title')).rejects.toThrow();
    const key = f.state.keys().find(key => f.state.get(key) !== undefined)!;
    f.state.set(key, { title: 'invalid' });
    await expect(f.service.create('folder', 'page', 'Title')).rejects.toThrow();
    expect(f.gql).toHaveBeenCalledTimes(1);
  });
  test('account changes reject late success and isolate the next account from the pending request', async () => {
    const f = setup();
    f.gql.mockImplementationOnce(async () => {
      f.changeAccount();
      return { createWorkspaceFolderPage: { documentId: 'one-page' } };
    });
    await expect(f.service.create('folder', 'page', 'Title')).rejects.toThrow(
      'Account changed'
    );
    expect(f.pull).not.toHaveBeenCalled();
    await f.service.create('folder', 'page', 'Title');
    expect(f.gql.mock.calls[1][0].variables.input.requestKey).not.toBe(
      f.gql.mock.calls[0][0].variables.input.requestKey
    );
  });
  test('different folders and whiteboard mode keep separate creation intents', async () => {
    const f = setup();
    f.gql.mockRejectedValue(new Error('offline'));
    await Promise.allSettled([
      f.service.create('a', 'page', 'Title'),
      f.service.create('b', 'page', 'Title'),
      f.service.create('a', 'edgeless', 'Title'),
    ]);
    expect(
      new Set(f.gql.mock.calls.map(call => call[0].variables.input.requestKey))
        .size
    ).toBe(3);
  });
});

test('an old retry action stays bound to its original request after another attempt succeeds', async () => {
  const f = setup();
  const recovery = f.service.prepare('folder', 'page', 'Original');
  await f.service.create('folder', 'page', 'Original', recovery);
  await f.service.create('folder', 'page', 'New page');
  await f.service.create('folder', 'page', 'Original', recovery);
  expect(f.gql.mock.calls[2][0].variables.input.requestKey).toBe(
    f.gql.mock.calls[0][0].variables.input.requestKey
  );
  expect(f.gql.mock.calls[1][0].variables.input.requestKey).not.toBe(
    f.gql.mock.calls[0][0].variables.input.requestKey
  );
});

test('an old recovery request does not join a different in-flight creation', async () => {
  const f = setup();
  const old = f.service.prepare('folder', 'page', 'Original');
  await f.service.create('folder', 'page', 'Original', old);
  const newer = f.service.create('folder', 'page', 'New');
  const replay = f.service.create('folder', 'page', 'Original', old);
  expect(replay).not.toBe(newer);
  await Promise.all([newer, replay]);
  expect(f.gql.mock.calls[2][0].variables.input.requestKey).toBe(
    old.intent.requestKey
  );
});

test('local placement retry preserves the existing page without reinitializing it', async () => {
  const f = setup();
  f.workspace.flavour = 'local';
  const previousIndex = generateFractionalIndexingKeyBetween(null, null);
  f.folders.watchNodeChildren.mockReturnValue(
    new LiveData([{ index: previousIndex }])
  );
  const prepared = f.service.prepare('folder', 'page', 'Original');
  const page = { id: prepared.intent.documentId!, trash$: new LiveData(false) };
  let exists = false;
  vi.spyOn(f.docs.list, 'doc$').mockImplementation(
    () => new LiveData(exists ? page : undefined) as never
  );
  f.createDoc.mockImplementation(() => {
    exists = true;
    return page;
  });
  f.folders.createLinkAuthorized.mockRejectedValueOnce(
    new Error('placement failed')
  );
  await expect(
    f.service.create('folder', 'page', 'Original', prepared)
  ).rejects.toThrow('placement failed');
  await expect(f.service.create('folder', 'page', 'Later')).resolves.toBe(
    page.id
  );
  expect(f.createDoc).toHaveBeenCalledTimes(1);
  expect(f.gql).not.toHaveBeenCalled();
  expect(f.folders.createLinkAuthorized.mock.calls[1][3] > previousIndex).toBe(
    true
  );
  page.trash$.next(true);
  await expect(
    f.service.create('folder', 'page', 'Original', prepared)
  ).rejects.toThrow('deleted');
  expect(f.createDoc).toHaveBeenCalledTimes(1);
});
