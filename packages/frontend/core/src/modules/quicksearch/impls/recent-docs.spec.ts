/* eslint-disable rxjs/finnish */
import { Framework, LiveData } from '@toeverything/infra';
import { BehaviorSubject } from 'rxjs';
import { expect, test } from 'vitest';

import { RecentDocsQuickSearchSession } from './recent-docs';

test('recent document labels remain hidden before authorization and disappear on revocation', () => {
  const readable = new BehaviorSubject<ReadonlySet<string>>(new Set());
  const framework = new Framework();
  framework.entity(
    RecentDocsQuickSearchSession,
    () =>
      new RecentDocsQuickSearchSession(
        {
          getRecentDocs: () => [
            {
              id: 'secret',
              trash$: new LiveData(false),
              meta$: new LiveData({ updatedDate: 1 }),
            },
          ],
        } as never,
        {
          getDocDisplayMeta: () => ({
            title: 'Private title',
            icon: () => null,
          }),
        } as never,
        { readableDocIds$: () => readable } as never
      )
  );
  const provider = framework.provider();
  const session = provider.createEntity(RecentDocsQuickSearchSession);
  const subscription = session.items$.subscribe(() => {});
  expect(session.items$.value).toEqual([]);
  readable.next(new Set(['secret']));
  expect(session.items$.value.map(item => item.label)).toEqual([
    { title: 'Private title' },
  ]);
  readable.next(new Set());
  expect(session.items$.value).toEqual([]);
  readable.next(new Set(['secret']));
  session.query('typed query');
  expect(session.items$.value).toEqual([]);
  subscription.unsubscribe();
  session.dispose();
  provider.dispose();
});
