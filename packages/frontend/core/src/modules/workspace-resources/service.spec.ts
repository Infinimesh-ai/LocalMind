/** @vitest-environment happy-dom */
import { Framework, LiveData } from '@toeverything/infra';
import { Subject } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspaceResourcesService } from './service';

const services: WorkspaceResourcesService[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
});
const item = (id: string) => ({
  id,
  workspaceId: 'workspace',
  kind: 'file',
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
function setup(fetch = vi.fn()) {
  const changes$ = new Subject<unknown>();
  const resourceChanges$ = new Subject<unknown>();
  const account$ = new LiveData<unknown>({ id: 'actor' });
  const server = { account$, fetch };
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
