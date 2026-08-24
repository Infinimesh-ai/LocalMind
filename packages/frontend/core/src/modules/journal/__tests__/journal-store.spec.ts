import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test } from 'vitest';

import type { DocsService } from '../../doc';
import { JournalStore } from '../store/journal';

function createDoc(id: string, journal: string, trash = false) {
  return {
    id,
    properties$: new LiveData({ journal }),
    trash$: new LiveData(trash),
  };
}

function createStore(docs: ReturnType<typeof createDoc>[]) {
  const docsService = {
    list: {
      docs$: new LiveData(docs),
    },
  } as unknown as DocsService;

  const framework = new Framework();
  framework.store(JournalStore, () => new JournalStore(docsService));
  return framework.provider().get(JournalStore);
}

describe('JournalStore', () => {
  const date = '2026-08-10';

  test('journal lookups skip trashed documents', () => {
    const store = createStore([
      createDoc('trashed', date, true),
      createDoc('kept', date),
    ]);

    expect(store.allJournalDates$.value).toEqual(new Set([date]));
    expect(store.getDocsByJournalDate(date).map(doc => doc.id)).toEqual([
      'kept',
    ]);
    expect(store.docsByJournalDate$(date).value.map(doc => doc.id)).toEqual([
      'kept',
    ]);
  });

  test('restoring a journal makes its date visible again', () => {
    const doc = createDoc('journal', date, true);
    const store = createStore([doc]);

    expect(store.allJournalDates$.value).toEqual(new Set());
    expect(store.docsByJournalDate$(date).value).toEqual([]);

    doc.trash$.next(false);

    expect(store.allJournalDates$.value).toEqual(new Set([date]));
    expect(store.docsByJournalDate$(date).value.map(item => item.id)).toEqual([
      'journal',
    ]);
  });
});
