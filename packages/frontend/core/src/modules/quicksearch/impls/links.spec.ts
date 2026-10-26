/** @vitest-environment happy-dom */
/* eslint-disable rxjs/finnish */
import { Framework, LiveData } from '@toeverything/infra';
import { BehaviorSubject } from 'rxjs';
import { expect, test } from 'vitest';

import { LinksQuickSearchSession } from './links';

test('pasted document links do not reveal cached titles before authorization or after revocation', () => {
  const readable = new BehaviorSubject<ReadonlySet<string>>(new Set());
  const workspaceId = '252af581-9b2d-40b4-b5a2-74a1e107c9b6';
  const framework = new Framework();
  framework.entity(
    LinksQuickSearchSession,
    () =>
      new LinksQuickSearchSession(
        { workspace: { id: workspaceId } } as never,
        {
          list: {
            doc$: () =>
              new LiveData({ id: 'secret', trash$: new LiveData(false) }),
          },
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
  const session = provider.createEntity(LinksQuickSearchSession);
  const subscription = session.items$.subscribe(() => {});
  session.query(`${location.origin}/workspace/${workspaceId}/secret`);
  expect(session.items$.value).toEqual([]);
  readable.next(new Set(['secret']));
  expect(session.items$.value.map(item => item.label)).toEqual([
    { title: 'Private title' },
  ]);
  readable.next(new Set());
  expect(session.items$.value).toEqual([]);
  subscription.unsubscribe();
  session.dispose();
  provider.dispose();
});
