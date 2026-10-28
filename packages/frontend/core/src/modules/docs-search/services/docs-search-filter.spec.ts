/** @vitest-environment happy-dom */
import 'fake-indexeddb/auto';

import { IndexerDocument, type IndexerStorageBase } from '@affine/nbstore';
import { IndexedDBIndexerStorage } from '@affine/nbstore/idb';
import { Framework, LiveData } from '@toeverything/infra';
import { firstValueFrom, of } from 'rxjs';
import { expect, test } from 'vitest';

import { DocsSearchService } from './docs-search';

test('resource filtering requires all query terms in the real local index while ranked search keeps its existing behavior', async () => {
  const indexer = new IndexedDBIndexerStorage({
    flavour: 'test',
    type: 'workspace',
    id: 'resource-search-filter',
  });
  indexer.connection.connect();
  await indexer.connection.waitForConnected();
  const framework = new Framework();
  framework.service(
    DocsSearchService,
    () =>
      new DocsSearchService(
        {
          workspace: {
            engine: {
              indexer: {
                ...indexer,
                state$: of({}),
                // eslint-disable-next-line rxjs/finnish -- Forward the indexer's observable method with its original name.
                aggregate$(...args: Parameters<typeof indexer.aggregate$>) {
                  return indexer.aggregate$(...args);
                },
              },
            },
          },
        } as never,
        {
          list: {
            // eslint-disable-next-line rxjs/finnish -- Mock method mirrors the document list API.
            doc$(id: string) {
              return new LiveData({ title$: new LiveData(id) });
            },
          },
        } as never,
        {
          // eslint-disable-next-line rxjs/finnish -- Mock method mirrors the directory access API.
          readableDocIds$() {
            return of(new Set(['target', 'unrelated']));
          },
        } as never
      )
  );
  const provider = framework.provider();
  const storage: IndexerStorageBase = indexer;
  try {
    for (const [id, content] of [
      ['target', 'QA-FIXED target 验收正文 ONLY_BODY_REPAIR098'],
      ['unrelated', 'QA-FIXED unrelated'],
    ]) {
      await storage.insert(
        'block',
        IndexerDocument.from<'block'>(id, {
          docId: id,
          blockId: id,
          flavour: 'affine:paragraph',
          content,
        })
      );
    }
    await indexer.refresh('block');
    const service = provider.get(DocsSearchService);
    const search = (query: string, requireAllTerms: boolean) =>
      firstValueFrom(service.search$(query, 'local', 100, { requireAllTerms }));
    expect(
      (await search('NO_MATCH_FIXED_8412', false))
        .map(item => item.docId)
        .sort()
    ).toEqual(['target', 'unrelated']);
    expect(await search('NO_MATCH_FIXED_8412', true)).toEqual([]);
    expect(
      (await search('FIXED target', true)).map(item => item.docId)
    ).toEqual(['target']);
    expect(
      (await search('ONLY_BODY_REPAIR098', true)).map(item => item.docId)
    ).toEqual(['target']);
    expect((await search('验收正文', true)).map(item => item.docId)).toEqual([
      'target',
    ]);
    expect(await search('___--- ', true)).toEqual([]);
  } finally {
    provider.dispose();
    indexer.connection.disconnect();
  }
});
