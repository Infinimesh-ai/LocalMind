import { Framework } from '@toeverything/infra';
import { Subject } from 'rxjs';
import { expect, test, vi } from 'vitest';

import { MemberSearchService } from './member-search';

test('member changes refresh a loaded unfiltered mention list, but not one never opened', async () => {
  const changes$ = new Subject<unknown>();
  const getMembersByEmailOrName = vi.fn(
    async (_workspaceId: string, _query?: string) => ({
      members: [
        {
          id: 'peer',
          name: `Name ${getMembersByEmailOrName.mock.calls.length}`,
        },
      ],
      memberCount: 1,
    })
  );
  const framework = new Framework();
  framework.service(
    MemberSearchService,
    () =>
      new MemberSearchService(
        {
          getMembersByEmailOrName,
          subscribeMembers: () => changes$,
        } as never,
        { workspace: { id: 'space' } } as never
      )
  );
  const service = framework.provider().get(MemberSearchService);
  try {
    changes$.next({ type: 'ready' });
    await vi.waitFor(() =>
      expect(getMembersByEmailOrName).not.toHaveBeenCalled()
    );

    service.search('');
    await vi.waitFor(() =>
      expect(service.result$.value).toMatchObject([{ name: 'Name 1' }])
    );
    changes$.next({ changed: true, reason: 'user-updated' });
    await vi.waitFor(() =>
      expect(service.result$.value).toMatchObject([{ name: 'Name 2' }])
    );
    expect(getMembersByEmailOrName.mock.calls[1][1]).toBeUndefined();
  } finally {
    service.dispose();
  }
});
