import {
  NotificationLevel,
  NotificationType,
  type PaginationInput,
} from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import type { Notification } from '../stores/notification';
import { NotificationListService } from './list';

function makeNotification(id: string, read = false): Notification {
  return {
    id,
    type: NotificationType.Mention,
    level: NotificationLevel.Default,
    read,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    body: {},
  };
}

function createService(notifications: Notification[] = []) {
  const store = {
    listNotification: vi.fn(
      async (
        pagination: PaginationInput,
        includeRead: boolean,
        _signal?: AbortSignal
      ) => {
        const filtered = notifications.filter(n => includeRead || !n.read);
        const start = pagination.after
          ? filtered.findIndex(n => n.id === pagination.after) + 1
          : 0;
        const page = filtered.slice(start, start + (pagination.first ?? 8));
        return {
          totalCount: filtered.length,
          edges: page.map(notification => ({
            cursor: notification.id,
            node: notification,
          })),
          pageInfo: {
            startCursor: null,
            endCursor: page.at(-1)?.id ?? null,
            hasNextPage: start + page.length < filtered.length,
            hasPreviousPage: false,
          },
        };
      }
    ),
    readNotification: vi.fn(async (id: string) => {
      notifications = notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      );
      return true;
    }),
    readAllNotifications: vi.fn(async () => {
      notifications = notifications.map(n => ({ ...n, read: true }));
      return true;
    }),
    dismissNotification: vi.fn(async (id: string) => {
      notifications = notifications.filter(n => n.id !== id);
      return true;
    }),
    dismissReadNotifications: vi.fn(async () => {
      notifications = notifications.filter(n => !n.read);
      return true;
    }),
    dismissAllNotifications: vi.fn(async () => {
      notifications = [];
      return true;
    }),
  };
  const count = {
    revision$: new LiveData(0),
    count$: new LiveData(1),
    setCount: vi.fn((value: number) => count.count$.setValue(value)),
    revalidate: vi.fn(),
  };
  const framework = new Framework();
  framework.service(
    NotificationListService,
    () =>
      new NotificationListService(
        store as unknown as ConstructorParameters<
          typeof NotificationListService
        >[0],
        count as unknown as ConstructorParameters<
          typeof NotificationListService
        >[1]
      )
  );
  const service = framework.provider().get(NotificationListService);
  return {
    count,
    service,
    store,
    add: (n: Notification) => notifications.push(n),
  };
}

describe('NotificationListService', () => {
  test('realtime revisions refresh status even when the unread count is unchanged', async () => {
    const { service, store, count } = createService([makeNotification('one')]);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(1)
    );
    count.revision$.setValue(1);
    await vi.waitFor(() =>
      expect(store.listNotification).toHaveBeenCalledTimes(2)
    );
    expect(store.listNotification.mock.calls[1][0]).toEqual({
      first: 8,
      after: undefined,
    });
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(1)
    );
  });
  test('loads unread and all modes with distinct query variables', async () => {
    const { service, store } = createService([makeNotification('one')]);

    service.loadMore();
    await vi.waitFor(() => expect(store.listNotification).toHaveBeenCalled());
    expect(store.listNotification.mock.calls[0][1]).toBe(false);

    service.setMode('all');
    await vi.waitFor(() =>
      expect(store.listNotification).toHaveBeenCalledTimes(2)
    );
    expect(store.listNotification.mock.calls[1][1]).toBe(true);
  });

  test('keeps read notifications in all mode and deletes only on dismiss', async () => {
    const notification = makeNotification('one');
    const { count, service, store } = createService([notification]);
    service.mode$.setValue('all');
    service.notifications$.setValue([notification]);

    await service.readNotification(notification.id);
    await vi.waitFor(() =>
      expect(service.notifications$.value).toEqual([
        { ...notification, read: true },
      ])
    );
    expect(count.setCount).toHaveBeenCalledWith(0);

    await service.dismissNotification(notification.id);
    expect(service.notifications$.value).toEqual([]);
    expect(store.dismissNotification).toHaveBeenCalledWith(notification.id);
  });

  test('deletes only read notifications from the local all view', async () => {
    const unread = makeNotification('unread');
    const read = makeNotification('read', true);
    const { service, store } = createService([unread, read]);
    service.mode$.setValue('all');
    service.notifications$.setValue([unread, read]);

    await service.dismissReadNotifications();

    await vi.waitFor(() =>
      expect(service.notifications$.value).toEqual([unread])
    );
    expect(store.dismissReadNotifications).toHaveBeenCalledOnce();
  });

  test('restores unread count when an optimistic delete fails', async () => {
    const notification = makeNotification('one');
    const { count, service, store } = createService([notification]);
    service.notifications$.setValue([notification]);
    store.dismissNotification.mockRejectedValueOnce(new Error('failed'));

    await expect(service.dismissNotification(notification.id)).rejects.toThrow(
      'failed'
    );

    expect(count.count$.value).toBe(1);
    await vi.waitFor(() =>
      expect(service.notifications$.value).toEqual([notification])
    );
  });

  test('clears beyond the loaded page, prevents repeated submissions and reloads from the first page', async () => {
    const notifications = Array.from({ length: 120 }, (_, i) =>
      makeNotification(String(i))
    );
    const { count, service, store } = createService(notifications);
    service.notifications$.setValue(notifications.slice(0, 8));
    service.nextCursor$.setValue('old-cursor');
    count.count$.setValue(120);
    let finish!: () => void;
    const clear = store.dismissAllNotifications.getMockImplementation()!;
    store.dismissAllNotifications.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return clear();
    });
    const pending = service.dismissAllNotifications();
    await service.dismissAllNotifications();
    expect(service.isMutating$.value).toBe(true);
    expect(count.count$.value).toBe(0);
    expect(service.notifications$.value).toEqual([]);
    count.revision$.setValue(1);
    expect(store.listNotification).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(store.dismissAllNotifications).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(service.hasMore$.value).toBe(false));
    expect(store.listNotification.mock.lastCall?.[0]).toEqual({
      first: 8,
      after: undefined,
    });
    expect(count.revalidate).toHaveBeenCalledOnce();
    expect(service.isMutating$.value).toBe(false);
  });

  test('preserves a newer unread count received before a read mutation responds', async () => {
    const one = makeNotification('one');
    const two = makeNotification('two');
    const { count, service, store, add } = createService([one, two]);
    count.count$.setValue(2);
    service.notifications$.setValue([one, two]);
    const read = store.readNotification.getMockImplementation()!;
    store.readNotification.mockImplementationOnce(async id => {
      await read(id);
      add(makeNotification('new'));
      count.count$.setValue(2);
      count.revision$.setValue(1);
      return true;
    });
    await service.readNotification('one');
    await vi.waitFor(() =>
      expect(service.notifications$.value.map(n => n.id)).toEqual([
        'two',
        'new',
      ])
    );
    expect(count.count$.value).toBe(2);
  });

  test('failed clear restores notifications and permits retry', async () => {
    const one = makeNotification('one');
    const { service, store, count } = createService([one]);
    service.notifications$.setValue([one]);
    store.dismissAllNotifications.mockRejectedValueOnce(new Error('offline'));
    await expect(service.dismissAllNotifications()).rejects.toThrow('offline');
    await vi.waitFor(() => expect(service.notifications$.value).toEqual([one]));
    expect(count.count$.value).toBe(1);
    expect(service.isMutating$.value).toBe(false);
    await service.dismissAllNotifications();
    expect(service.notifications$.value).toEqual([]);
  });

  test('never empties unaffected rows during mutation reconciliation and coalesces count events', async () => {
    const { service, store, count } = createService([
      makeNotification('one'),
      makeNotification('two'),
    ]);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(2)
    );
    const snapshots: string[][] = [];
    const subscription = service.notifications$.subscribe(rows =>
      snapshots.push(rows.map(n => n.id))
    );
    await service.dismissNotification('one');
    count.revision$.setValue(1);
    count.revision$.setValue(2);
    count.revision$.setValue(3);
    expect(service.notifications$.value.map(n => n.id)).toEqual(['two']);
    expect(service.isLoading$.value).toBe(false);
    await vi.waitFor(() => expect(service.isRefreshing$.value).toBe(false));
    expect(store.listNotification).toHaveBeenCalledTimes(2);
    expect(snapshots.every(rows => rows.includes('two'))).toBe(true);
    subscription.unsubscribe();
    service.dispose();
  });

  test('preserves three loaded pages, refreshes their cursors, and appends without duplicates', async () => {
    const { service } = createService(
      Array.from({ length: 26 }, (_, i) => makeNotification(String(i)))
    );
    for (const length of [8, 16, 24]) {
      service.loadMore();
      await vi.waitFor(() =>
        expect(service.notifications$.value).toHaveLength(length)
      );
    }
    await service.dismissNotification('12');
    expect(service.notifications$.value).toHaveLength(23);
    await vi.waitFor(() => expect(service.isRefreshing$.value).toBe(false));
    expect(service.notifications$.value).toHaveLength(24);
    expect(service.nextCursor$.value).toBe('24');
    expect(service.notifications$.value.some(n => n.id === '12')).toBe(false);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(25)
    );
    expect(new Set(service.notifications$.value.map(n => n.id)).size).toBe(25);
    expect(service.hasMore$.value).toBe(false);
    service.dispose();
  });

  test('failed background refresh preserves rows and cursor until a successful retry', async () => {
    const { service, store, count } = createService([
      makeNotification('one'),
      makeNotification('two'),
    ]);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(2)
    );
    const previous = service.notifications$.value;
    store.listNotification.mockRejectedValueOnce(new Error('offline'));
    count.revision$.setValue(1);
    await vi.waitFor(() => expect(service.error$.value).toBeTruthy());
    expect(service.notifications$.value).toBe(previous);
    expect(service.nextCursor$.value).toBe('two');
    service.retry();
    await vi.waitFor(() => expect(service.error$.value).toBeNull());
    expect(service.notifications$.value).toBe(previous);
    service.dispose();
  });

  test('restores a failed optimistic operation immediately even if the following refresh also fails', async () => {
    const one = makeNotification('one');
    const { service, store } = createService([one]);
    service.notifications$.setValue([one]);
    store.dismissNotification.mockRejectedValueOnce(new Error('offline'));
    store.listNotification.mockRejectedValueOnce(new Error('still offline'));
    await expect(service.dismissNotification('one')).rejects.toThrow('offline');
    expect(service.notifications$.value).toEqual([one]);
    await vi.waitFor(() => expect(service.error$.value).toBeTruthy());
    expect(service.notifications$.value).toEqual([one]);
    service.dispose();
  });

  test('a stale background response cannot resurrect a deleted row', async () => {
    const { service, store, count } = createService([
      makeNotification('one'),
      makeNotification('two'),
    ]);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(2)
    );
    const oldPage = await store.listNotification({ first: 8 }, false);
    let finish!: (value: typeof oldPage) => void;
    store.listNotification.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    count.revision$.setValue(1);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await service.dismissNotification('one');
    finish(oldPage);
    await vi.waitFor(() => expect(service.isRefreshing$.value).toBe(false));
    expect(service.notifications$.value.map(n => n.id)).toEqual(['two']);
    service.dispose();
  });

  test('reset aborts background reads and does not expose rows from the previous filter', async () => {
    const { service, store, count } = createService([
      makeNotification('one'),
      makeNotification('read', true),
    ]);
    service.loadMore();
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(1)
    );
    const oldPage = await store.listNotification({ first: 8 }, false);
    let finish!: (value: typeof oldPage) => void;
    store.listNotification.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    count.revision$.setValue(1);
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.setMode('all');
    await vi.waitFor(() =>
      expect(service.notifications$.value).toHaveLength(2)
    );
    finish(oldPage);
    await Promise.resolve();
    expect(service.notifications$.value).toHaveLength(2);
    service.dispose();
  });

  test('a filter change during a mutation loads the new view after completion', async () => {
    const one = makeNotification('one');
    const { service, store } = createService([one]);
    service.notifications$.setValue([one]);
    let reject!: (error: Error) => void;
    store.dismissNotification.mockImplementationOnce(
      () =>
        new Promise((_, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    const pending = service.dismissNotification('one');
    service.setMode('all');
    reject(new Error('offline'));
    await expect(pending).rejects.toThrow('offline');
    await vi.waitFor(() => expect(service.hasLoaded$.value).toBe(true));
    expect(service.mode$.value).toBe('all');
    expect(service.notifications$.value).toEqual([one]);
    expect(store.listNotification.mock.lastCall?.[1]).toBe(true);
    service.dispose();
  });
});
