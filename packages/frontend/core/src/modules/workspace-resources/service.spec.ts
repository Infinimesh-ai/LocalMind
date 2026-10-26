/** @vitest-environment happy-dom */
import { Framework, LiveData } from '@toeverything/infra';
import { Subject } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspaceResourcesService } from './service';

const services: WorkspaceResourcesService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
  vi.useRealTimers();
});
const item = (id: string) => ({
  id,
  workspaceId: 'workspace',
  kind: 'file',
  documentType: 'txt',
  createdBy: 'actor',
  lastUpdatedAt: '2026-09-28T00:00:00Z',
  lastUpdatedBy: 'actor',
  lastUpdateActor: 'user',
  tags: [],
  canEditTags: true,
  title: `${id}.txt`,
  fileName: `${id}.txt`,
  mimeType: 'text/plain',
  byteSize: 1,
  metadataVersion: 1,
  contentVersion: 1,
  createdAt: '2026-09-28T00:00:00Z',
  updatedAt: '2026-09-28T00:00:00Z',
  trashedAt: null,
  atRoot: true,
});
const page = (items: unknown[], nextCursor: string | null = null) => ({
  ok: true,
  json: async () => ({ items, nextCursor }),
});
function setup(fetch = vi.fn(), gql = vi.fn()) {
  const changes$ = new Subject<unknown>();
  const resourceChanges$ = new Subject<unknown>();
  const account$ = new LiveData<unknown>({ id: 'actor' });
  const server = { account$, fetch, gql };
  const framework = new Framework();
  framework.service(
    WorkspaceResourcesService,
    () =>
      new WorkspaceResourcesService(
        { workspace: { id: 'workspace', flavour: 'affine-cloud' } } as never,
        { server, server$: new LiveData(server) } as never,
        {
          realtime: {
            subscribe: (event: string) =>
              event === 'workspace.nativeResources.changed'
                ? resourceChanges$
                : changes$,
          },
        } as never
      )
  );
  const service = framework.provider().get(WorkspaceResourcesService);
  services.push(service);
  return { service, fetch, changes$, resourceChanges$, account$ };
}

test('catalog includes later pages, deduplicates identity and rejects repeated cursors', async () => {
  const { service, fetch } = setup();
  fetch
    .mockResolvedValueOnce(page([item('a')], 'next'))
    .mockResolvedValueOnce(page([item('a'), item('b')]));
  expect(
    (await service.list('', false, new AbortController().signal)).map(
      item => item.id
    )
  ).toEqual(['a', 'b']);
  expect(fetch.mock.calls[1][0]).toContain('cursor=next');
  fetch.mockResolvedValue(page([item('a')], 'loop'));
  await expect(
    service.list('', false, new AbortController().signal)
  ).rejects.toThrow('limit');
});

test('ordinary resource events preserve the visible catalog until reconciliation completes', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  const { service, fetch, resourceChanges$ } = setup();
  fetch.mockResolvedValueOnce(page([item('original')])).mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    })
  );
  const stop = service.watch();
  await vi.waitFor(() => expect(service.active$.value.ready).toBe(true));
  resourceChanges$.next({});
  expect(service.active$.value.items.map(item => item.id)).toEqual([
    'original',
  ]);
  resolve(page([item('updated')]));
  await vi.waitFor(() =>
    expect(service.active$.value.items.map(item => item.id)).toEqual([
      'updated',
    ])
  );
  stop();
});

test('authorization invalidation cancels stale results and clears every subscriber view immediately', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>(done => {
    resolve = done;
  });
  const { service, fetch, changes$ } = setup();
  fetch
    .mockResolvedValueOnce(page([item('visible')]))
    .mockReturnValueOnce(pending)
    .mockResolvedValue({ ok: false });
  const stop = service.watch();
  await vi.waitFor(() => expect(service.active$.value.items).toHaveLength(1));
  void service.refresh();
  changes$.next({});
  expect(service.active$.value.items).toEqual([]);
  resolve(page([item('stale-private')]));
  await vi.waitFor(() => expect(service.active$.value.error).toBe(true));
  expect(service.active$.value.items).toEqual([]);
  stop();
});

test('multiple simultaneous views share one in-flight listing and logout clears data', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  const { service, fetch, account$ } = setup();
  fetch.mockReturnValue(
    new Promise(done => {
      resolve = done;
    })
  );
  const a = service.watch(),
    b = service.watch();
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(page([item('a')]));
  await vi.waitFor(() => expect(service.active$.value.ready).toBe(true));
  expect(fetch).toHaveBeenCalledTimes(1);
  account$.next(null);
  expect(service.active$.value.items).toEqual([]);
  a();
  b();
});

test('remounting fresh views or refreshing the same account metadata does not refetch', async () => {
  const { service, fetch, account$ } = setup();
  fetch.mockResolvedValue(page([item('cached')]));
  const stop = service.watch();
  await vi.waitFor(() => expect(service.active$.value.ready).toBe(true));
  stop();
  account$.next({ id: 'actor', name: 'updated' });
  const stopAgain = service.watch();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.active$.value.items[0].id).toBe('cached');
  stopAgain();
});

test('idle invalidation retains a snapshot and reconciles once when observed again', async () => {
  const { service, fetch } = setup();
  fetch.mockResolvedValue(page([item('cached')]));
  await service.refresh();
  service.invalidate();
  service.invalidate();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.active$.value.items[0].id).toBe('cached');
  const stop = service.watch();
  await vi.waitFor(() => expect(service.active$.value.loading).toBe(false));
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

test('an idle snapshot becomes stale by age without background requests', async () => {
  vi.useFakeTimers();
  const { service, fetch } = setup();
  fetch.mockResolvedValue(page([item('cached')]));
  await service.refresh();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(service.active$.value.items[0].id).toBe('cached');
  const stop = service.watch();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

test('in-flight refresh calls share the request; real invalidations get one follow-up', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  const { service, fetch } = setup();
  fetch
    .mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      })
    )
    .mockResolvedValue(page([item('new')]));
  const stop = service.watch();
  void service.refresh();
  void service.refresh();
  service.invalidate();
  service.invalidate();
  resolve(page([item('old')]));
  await vi.waitFor(() =>
    expect(service.active$.value.items[0]?.id).toBe('new')
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

test('transient background errors preserve rows but forbidden responses clear them', async () => {
  const { service, fetch } = setup();
  fetch
    .mockResolvedValueOnce(page([item('cached')]))
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: false, status: 403 });
  await service.refresh();
  await service.refresh();
  expect(service.active$.value.error).toBe(true);
  expect(service.active$.value.items[0].id).toBe('cached');
  await service.refresh();
  expect(service.active$.value.items).toEqual([]);
  expect(service.active$.value.error).toBe(true);
  expect(service.active$.value.ready).toBe(false);
});

test('tag metadata is reconciled by value across explorer remounts', async () => {
  const { service, fetch } = setup();
  fetch.mockResolvedValue(page([item('cached')]));
  const stop = service.watch();
  await vi.waitFor(() => expect(service.active$.value.ready).toBe(true));
  const tags = [{ id: 'tag', name: 'original', color: 'red' }];
  service.reconcileTagMetadata(tags);
  service.reconcileTagMetadata(tags.map(tag => ({ ...tag })));
  expect(fetch).toHaveBeenCalledTimes(1);
  service.reconcileTagMetadata([{ ...tags[0], name: 'renamed' }]);
  await vi.waitFor(() => expect(service.active$.value.loading).toBe(false));
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});

test('native moves await their own commit and cannot report success for a duplicate pending move or changed account', async () => {
  let finish!: (value: unknown) => void;
  const gql = vi
    .fn()
    .mockResolvedValueOnce({ workspaceNativeResource: { metadataVersion: 1 } })
    .mockResolvedValueOnce({ workspaceDirectory: { revision: 'revision' } })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
  const { service, account$ } = setup(vi.fn(), gql);
  const identity = {
    workspaceId: 'workspace',
    resourceId: 'file',
    kind: 'file' as const,
  };
  const pending = service.move(identity, null);
  await vi.waitFor(() => expect(gql).toHaveBeenCalledTimes(3));
  await expect(service.move(identity, null)).rejects.toThrow('pending');
  account$.next({ id: 'different' });
  finish({});
  await expect(pending).rejects.toThrow('Account changed');
});
