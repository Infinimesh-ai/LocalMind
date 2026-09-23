import { Framework } from '@toeverything/infra';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, test } from 'vitest';

import { DocsStore } from './docs';

const fixture = () => {
  const state$ = new BehaviorSubject({ ready: false, synced: false });
  const framework = new Framework();
  framework.store(
    DocsStore,
    () =>
      new DocsStore(
        {
          workspace: {
            id: 'workspace',
            engine: {
              doc: {
                // The mock must keep the production service method name.
                // eslint-disable-next-line rxjs/finnish
                docState$: () => state$,
              },
            },
          },
        } as never,
        {} as never
      )
  );
  return { store: framework.provider().get(DocsStore), state$ };
};

describe('document list availability', () => {
  test('keeps local content visible through background sync and retry', () => {
    const { store, state$ } = fixture();
    const available: boolean[] = [];
    const synced: boolean[] = [];
    const availability = store
      .watchDocListAvailable()
      .subscribe(v => available.push(v));
    const readiness = store.watchDocListReady().subscribe(v => synced.push(v));

    state$.next({ ready: true, synced: false });
    state$.next({ ready: true, synced: true });
    state$.next({ ready: true, synced: false });
    state$.next({ ready: true, synced: true });

    expect(available).toEqual([false, true]);
    // Mutation guards must still wait for sync before treating missing docs as removed.
    expect(synced).toEqual([false, false, true, false, true]);
    availability.unsubscribe();
    readiness.unsubscribe();
    store.dispose();
  });

  test('waits without local data and handles a fully synced empty workspace', () => {
    const { store, state$ } = fixture();
    const values: boolean[] = [];
    const subscription = store
      .watchDocListAvailable()
      .subscribe(v => values.push(v));
    state$.next({ ready: false, synced: false });
    expect(values).toEqual([false]);
    state$.next({ ready: false, synced: true });
    expect(values).toEqual([false, true]);
    // A disconnected/disposed document must not retain an availability latch.
    state$.next({ ready: false, synced: false });
    expect(values).toEqual([false, true, false]);
    subscription.unsubscribe();
    store.dispose();
  });
});
