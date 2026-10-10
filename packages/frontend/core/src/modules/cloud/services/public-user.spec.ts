import { Framework } from '@toeverything/infra';
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
