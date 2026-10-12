/** @vitest-environment happy-dom */
import { UserFriendlyError } from '@affine/error';
import { setWorkspaceNativeResourceTagsMutation } from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { changeResourceBatch } from './batch';
import { WorkspaceResourceTagsService } from './tags';

const services: WorkspaceResourceTagsService[] = [];
afterEach(() => services.splice(0).forEach(service => service.dispose()));
function setup() {
  const meta$ = new LiveData({ tags: ['old'], trash: false });
  const setMeta = vi.fn((meta: { tags: string[] }) =>
    meta$.next({ ...meta$.value, ...meta })
  );
  const can = vi.fn(async () => true);
  const waitForSynced = vi.fn(async () => {});
  const account$ = new LiveData({ id: 'actor' });
  const resource = {
    tags: [{ id: 'old' }],
    metadataVersion: 4,
    canEditTags: true,
    trashedAt: null as string | null,
  };
  const mutate = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
  const gql = vi.fn(
    async (request: { query: unknown; variables: { input: unknown } }) =>
      request.query === setWorkspaceNativeResourceTagsMutation
        ? mutate(request.variables.input)
        : { workspaceNativeResource: resource }
  );
  const server = { account$, gql };
  const invalidate = vi.fn();
  const framework = new Framework();
  framework.service(
    WorkspaceResourceTagsService,
    () =>
      new WorkspaceResourceTagsService(
        {
          workspace: { id: 'workspace', engine: { doc: { waitForSynced } } },
        } as never,
        { server, server$: new LiveData(server) } as never,
        // eslint-disable-next-line rxjs/finnish -- Mock preserves DocsService.list.doc$.
        { list: { doc$: () => new LiveData({ meta$, setMeta }) } } as never,
        { can } as never,
        {
          tagList: {
            tagMetas$: new LiveData(
              ['old', 'new', 'other'].map(id => ({ id }))
            ),
          },
        } as never,
        { invalidate } as never
      )
  );
  const service = framework.provider().get(WorkspaceResourceTagsService);
  services.push(service);
  return {
    service,
    meta$,
    setMeta,
    can,
    account$,
    resource,
    mutate,
    waitForSynced,
    invalidate,
  };
}
const add = { add: ['new'], remove: [] };
const native = { kind: 'file' as const, id: 'file' };

test('a mixed batch appends tags to each resource and retains original tags without duplicate writes', async () => {
  const { service, meta$, mutate } = setup();
  const session = service.begin();
  const result = await changeResourceBatch(['doc', 'file'], id =>
    session.change({ id, kind: id === 'doc' ? 'doc' : 'file' }, add)
  );
  expect(result.failed).toEqual([]);
  expect(meta$.value.tags).toEqual(['old', 'new']);
  expect(mutate.mock.calls[0][0]).toMatchObject({
    tagIds: ['old', 'new'],
    expectedVersion: 4,
  });
  await session.change({ kind: 'doc', id: 'doc' }, add);
  expect(meta$.value.tags).toEqual(['old', 'new']);
});

test('single-resource tag deltas preserve concurrently added tags and remove only specified IDs', async () => {
  const { service, meta$ } = setup();
  const initial = await service.read({ kind: 'doc', id: 'doc' });
  expect(initial).toEqual(['old']);
  meta$.next({ tags: ['old', 'other'], trash: false });
  await service.change(
    { kind: 'doc', id: 'doc' },
    { add: ['new'], remove: ['old'] }
  );
  expect(meta$.value.tags).toEqual(['other', 'new']);
});

test('readonly page and native resources fail independently and never submit writes', async () => {
  const { service, can, resource, setMeta, mutate } = setup();
  can.mockResolvedValue(false);
  resource.canEditTags = false;
  const result = await changeResourceBatch(['doc', 'file'], id =>
    service.change({ id, kind: id === 'doc' ? 'doc' : 'file' }, add)
  );
  expect(result).toEqual({ succeeded: [], failed: ['doc', 'file'] });
  expect(setMeta).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});

test('uncertain native failures retain the exact request for retry and successful page changes are not repeated', async () => {
  const { service, mutate, setMeta } = setup();
  mutate.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
  const execute = (id: string) =>
    service.change({ id, kind: id === 'doc' ? 'doc' : 'file' }, add);
  const first = await changeResourceBatch(['doc', 'file'], execute);
  expect(first).toEqual({ succeeded: ['doc'], failed: ['file'] });
  const second = await changeResourceBatch(first.failed, execute);
  expect(second).toEqual({ succeeded: ['file'], failed: [] });
  expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
  expect(setMeta).toHaveBeenCalledTimes(1);
});

test('version conflicts rebuild a fresh patch from the latest tags rather than overwrite them', async () => {
  const { service, mutate, resource } = setup();
  mutate.mockRejectedValueOnce(
    new UserFriendlyError({
      code: 'VERSION_CONFLICT',
      status: 409,
      message: 'Version changed',
      name: 'VersionConflict',
    } as never)
  );
  await expect(service.change(native, add)).rejects.toBeTruthy();
  resource.tags = [{ id: 'old' }, { id: 'other' }];
  resource.metadataVersion = 5;
  await service.change(native, add);
  expect(mutate.mock.calls[1][0]).toMatchObject({
    tagIds: ['old', 'other', 'new'],
    expectedVersion: 5,
  });
  expect(mutate.mock.calls[1][0]).not.toEqual(mutate.mock.calls[0][0]);
});

test('a batch frozen to one account cannot continue under another account', async () => {
  const { service, account$, mutate } = setup();
  const session = service.begin();
  await session.change({ kind: 'doc', id: 'doc' }, add);
  account$.next({ id: 'another-actor' });
  await expect(session.change(native, add)).rejects.toThrow('scope');
  expect(mutate).not.toHaveBeenCalled();
});

test('permission loss during native retry prevents replay, and trashed resources cannot be edited', async () => {
  const { service, mutate, resource } = setup();
  mutate.mockRejectedValueOnce(new Error('network'));
  await expect(service.change(native, add)).rejects.toThrow('network');
  resource.canEditTags = false;
  await expect(service.change(native, add)).rejects.toThrow('unavailable');
  expect(mutate).toHaveBeenCalledTimes(1);
  resource.canEditTags = true;
  resource.trashedAt = '2026-10-12';
  await expect(service.change(native, add)).rejects.toThrow('unavailable');
  resource.trashedAt = null;
  resource.metadataVersion = 6;
  resource.tags = [{ id: 'old' }, { id: 'other' }];
  await service.change(native, add);
  expect(mutate.mock.calls[1][0]).toMatchObject({
    tagIds: ['old', 'other', 'new'],
    expectedVersion: 6,
  });
  expect(mutate.mock.calls[1][0]).not.toEqual(mutate.mock.calls[0][0]);
});

test('deleted tag definitions fail before synchronization or any resource write', async () => {
  const { service, mutate, waitForSynced } = setup();
  await expect(
    service.change(native, { add: ['deleted'], remove: [] })
  ).rejects.toThrow('definition');
  expect(waitForSynced).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});
