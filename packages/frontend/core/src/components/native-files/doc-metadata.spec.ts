import { BehaviorSubject, defer, map } from 'rxjs';
import { describe, expect, test } from 'vitest';

import { combineDocMetadata } from './doc-metadata';

type FakeDoc = { id: string; mode$: BehaviorSubject<string> };

const createDocs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `doc-${index}`,
    mode$: new BehaviorSubject('page'),
  }));

const watch = (docs: FakeDoc[]) => {
  const docs$ = new BehaviorSubject<readonly FakeDoc[]>(docs);
  let subscriptions = 0;
  const values: { id: string; mode: string }[][] = [];
  const subscription = combineDocMetadata(docs$, doc =>
    defer(() => {
      subscriptions++;
      return doc.mode$.pipe(map(mode => ({ id: doc.id, mode })));
    })
  ).subscribe(value => values.push(value));
  return {
    docs$,
    values,
    subscription,
    subscriptions: () => subscriptions,
  };
};

describe('combineDocMetadata', () => {
  test('emits an empty list without docs', () => {
    const { values, subscription } = watch([]);
    expect(values).toEqual([[]]);
    subscription.unsubscribe();
  });

  test('updates one doc without re-subscribing the others', () => {
    const docs = createDocs(3);
    const { values, subscription, subscriptions } = watch(docs);
    expect(values.at(-1)).toEqual([
      { id: 'doc-0', mode: 'page' },
      { id: 'doc-1', mode: 'page' },
      { id: 'doc-2', mode: 'page' },
    ]);

    docs[1].mode$.next('edgeless');

    expect(values.at(-1)?.[1]).toEqual({ id: 'doc-1', mode: 'edgeless' });
    expect(subscriptions()).toBe(3);
    subscription.unsubscribe();
  });

  test('keeps subscriptions linear when every doc changes at once', () => {
    // Cold sync applies one docProperties update touching every row.
    const docs = createDocs(300);
    const { values, subscription, subscriptions } = watch(docs);

    for (const doc of docs) doc.mode$.next('edgeless');

    expect(subscriptions()).toBe(300);
    expect(values.at(-1)?.every(value => value.mode === 'edgeless')).toBe(true);
    subscription.unsubscribe();
  });

  test('re-subscribes only when the docs list changes', () => {
    const docs = createDocs(2);
    const { docs$, values, subscription, subscriptions } = watch(docs);

    docs$.next([docs[0]]);

    expect(values.at(-1)).toEqual([{ id: 'doc-0', mode: 'page' }]);
    expect(subscriptions()).toBe(3);
    subscription.unsubscribe();
  });
});
