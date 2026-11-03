import { Framework, LiveData } from '@toeverything/infra';
import { Subject } from 'rxjs';
import { expect, test, vi } from 'vitest';

import { PublicUserService } from './public-user';

test('public profiles deduplicate and batch users, cache results, distinguish deleted users and release timers', async () => {
  vi.useFakeTimers();
  const getPublicUsersByIds = vi.fn(async (ids: string[]) =>
    ids
      .filter(id => id !== 'deleted')
      .map(id => ({ id, name: `User ${id}`, avatarUrl: null }))
  );
  const framework = new Framework();
  framework.service(
    PublicUserService,
    () => new PublicUserService({ getPublicUsersByIds } as never)
  );
  const service = framework.provider().get(PublicUserService);
  try {
    for (const id of ['one', 'two', 'one', 'deleted', 'two'])
      service.revalidate(id);
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(1);
    expect(getPublicUsersByIds.mock.calls[0][0]).toEqual([
      'one',
      'two',
      'deleted',
    ]);
    expect(service.publicUser$('one').value).toMatchObject({
      name: 'User one',
    });
    expect(service.publicUser$('deleted').value?.removed).toBe(true);
    service.revalidate('one');
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(1);
  } finally {
    service.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});

function createService(factory: () => PublicUserService) {
  const framework = new Framework();
  framework.service(PublicUserService, factory);
  return framework.provider().get(PublicUserService);
}

function setupRealtime() {
  const getPublicUsersByIds = vi.fn(async (ids: string[]) =>
    ids.map(id => ({ id, name: names.get(id) ?? id, avatarUrl: null }))
  );
  const names = new Map<string, string>();
  const events$ = new Subject<
    { type: 'ready' } | { changed: true; reason: string; userIds: string[] }
  >();
  const subscribe = vi.fn(() => events$);
  const account$ = new LiveData<{ id: string } | null>({ id: 'me' });
  const service = createService(
    () =>
      new PublicUserService(
        { getPublicUsersByIds } as never,
        { session: { account$ } } as never,
        { realtime: { subscribe } } as never
      )
  );
  return { service, names, events$, subscribe, getPublicUsersByIds, account$ };
}

test('a rename event refetches cached profiles at once and reports every renamed id', async () => {
  vi.useFakeTimers();
  const { service, names, events$, subscribe, getPublicUsersByIds } =
    setupRealtime();
  const changed: string[][] = [];
  service.changed$.subscribe(ids => changed.push(ids));
  try {
    expect(subscribe).toHaveBeenCalledWith('user.public-profile.changed', {});
    names.set('peer', 'Old name');
    service.revalidate('peer');
    await vi.advanceTimersByTimeAsync(20);
    expect(service.publicUser$('peer').value).toMatchObject({
      name: 'Old name',
    });

    names.set('peer', 'New name');
    events$.next({
      changed: true,
      reason: 'user-updated',
      userIds: ['peer', 'never-seen'],
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(2);
    expect(getPublicUsersByIds.mock.calls[1][0]).toEqual(['peer']);
    expect(service.publicUser$('peer').value).toMatchObject({
      name: 'New name',
    });
    // Uncached ids are not fetched but still reported for snapshot views.
    expect(changed).toEqual([['peer', 'never-seen']]);
  } finally {
    service.dispose();
    vi.useRealTimers();
  }
});

test('a (re)subscription ready signal refreshes every cached profile missed offline', async () => {
  vi.useFakeTimers();
  const { service, names, events$, getPublicUsersByIds } = setupRealtime();
  try {
    service.revalidate('a');
    service.revalidate('b');
    await vi.advanceTimersByTimeAsync(20);
    names.set('a', 'Renamed while offline');
    events$.next({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(2);
    expect(getPublicUsersByIds.mock.calls[1][0].sort()).toEqual(['a', 'b']);
    expect(service.publicUser$('a').value).toMatchObject({
      name: 'Renamed while offline',
    });
  } finally {
    service.dispose();
    vi.useRealTimers();
  }
});

test('an invalidation during an in-flight request refetches after it settles', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const names = new Map([['peer', 'Old name']]);
  const getPublicUsersByIds = vi.fn(async (ids: string[]) => {
    const snapshot = ids.map(id => ({
      id,
      name: names.get(id)!,
      avatarUrl: null,
    }));
    if (getPublicUsersByIds.mock.calls.length === 1)
      await new Promise<void>(resolve => (release = resolve));
    return snapshot;
  });
  const service = createService(
    () => new PublicUserService({ getPublicUsersByIds } as never)
  );
  try {
    service.revalidate('peer');
    await vi.advanceTimersByTimeAsync(20);
    names.set('peer', 'New name');
    service.invalidate(['peer']);
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(2);
    expect(service.publicUser$('peer').value).toMatchObject({
      name: 'New name',
    });
  } finally {
    service.dispose();
    vi.useRealTimers();
  }
});

test('own account changes refresh the own cached profile and follow the signed-in account', async () => {
  vi.useFakeTimers();
  const { service, getPublicUsersByIds, subscribe, account$ } = setupRealtime();
  try {
    service.revalidate('me');
    await vi.advanceTimersByTimeAsync(20);
    service.onAccountChanged({ id: 'me' });
    await vi.advanceTimersByTimeAsync(20);
    expect(getPublicUsersByIds).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(1);

    account$.next(null);
    service.onAccountChanged(null);
    account$.next({ id: 'other' });
    service.onAccountChanged({ id: 'other' });
    expect(subscribe).toHaveBeenCalledTimes(2);
  } finally {
    service.dispose();
    vi.useRealTimers();
  }
});
