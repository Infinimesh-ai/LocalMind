/** @vitest-environment happy-dom */
/* eslint-disable rxjs/finnish */

import { Framework } from '@toeverything/infra';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DocsSearchService } from './docs-search';

it('filters cached titles and snippets until current read permission is granted, and removes revoked results', () => {
  const readable = new BehaviorSubject<ReadonlySet<string>>(new Set());
  const framework = new Framework();
  framework.service(
    DocsSearchService,
    () =>
      new DocsSearchService(
        {
          workspace: {
            engine: {
              indexer: {
                state$: of({}),
                search$: () =>
                  of({ nodes: [{ id: 'private' }, { id: 'allowed' }] }),
                aggregate$: () =>
                  of({
                    buckets: ['private', 'allowed'].map(key => ({
                      key,
                      score: 1,
                      hits: {
                        nodes: [
                          {
                            fields: { flavour: 'affine:page' },
                            highlights: { content: [key + ' title'] },
                          },
                          {
                            fields: { blockId: 'block' },
                            highlights: { content: [key + ' secret content'] },
                          },
                        ],
                      },
                    })),
                  }),
              },
            },
          },
        } as never,
        {} as never,
        { readableDocIds$: () => readable } as never
      )
  );
  const provider = framework.provider();
  const service = provider.get(DocsSearchService);
  const titles: string[][] = [];
  const content: unknown[] = [];
  const subscriptions = [
    service.searchTitle$('secret').subscribe(value => titles.push(value)),
    service.search$('secret', 'local').subscribe(value => content.push(value)),
  ];
  expect(titles.at(-1)).toEqual([]);
  expect(content.at(-1)).toEqual([]);
  readable.next(new Set(['allowed']));
  expect(titles.at(-1)).toEqual(['allowed']);
  expect(content.at(-1)).toEqual([
    expect.objectContaining({
      docId: 'allowed',
      blockContent: 'allowed secret content',
    }),
  ]);
  readable.next(new Set());
  expect(content.at(-1)).toEqual([]);
  expect(JSON.stringify(content)).not.toContain('private secret');
  subscriptions.forEach(subscription => subscription.unsubscribe());
  provider.dispose();
});

describe('DocsSearchService refs', () => {
  it('skips malformed reference items without poisoning the result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const indexer = {
      state$: of({ indexing: 0, errorMessage: null }),
      search$: vi.fn().mockReturnValue(
        of({
          nodes: [
            {
              fields: {
                docId: 'source',
                ref: [
                  JSON.stringify({ docId: 'target' }),
                  '{invalid-json',
                  JSON.stringify({ docId: 42 }),
                  7,
                ],
              },
            },
          ],
        })
      ),
    };
    const workspaceService = { workspace: { engine: { indexer } } };
    const docsService = {
      list: {
        doc$: (id: string) => ({
          value:
            id === 'target'
              ? { id, title$: { value: 'Target document' } }
              : null,
        }),
      },
    };
    const framework = new Framework();
    framework.service(
      DocsSearchService,
      () =>
        new DocsSearchService(
          workspaceService as unknown as ConstructorParameters<
            typeof DocsSearchService
          >[0],
          docsService as unknown as ConstructorParameters<
            typeof DocsSearchService
          >[1],
          {} as never
        )
    );
    const service = framework.provider().get(DocsSearchService);

    await expect(
      firstValueFrom(service.watchRefsFrom('source'))
    ).resolves.toEqual([
      { docId: 'target', title: 'Target document', params: undefined },
    ]);
    expect(warn).toHaveBeenCalledWith(
      '[docs-search] skipped malformed references',
      { count: 3 }
    );
    warn.mockRestore();
  });

  it('groups one batch of references by source document', async () => {
    const indexer = {
      state$: of({ indexing: 0, errorMessage: null }),
      search$: vi.fn().mockReturnValue(
        of({
          nodes: [
            {
              fields: {
                docId: 'a',
                ref: JSON.stringify({ docId: 'target-a' }),
              },
            },
            {
              fields: {
                docId: ['b'],
                ref: [
                  JSON.stringify({ docId: 'target-b' }),
                  JSON.stringify({ docId: 'b' }),
                ],
              },
            },
          ],
        })
      ),
    };
    const docs = new Map([
      ['target-a', 'Target A'],
      ['target-b', 'Target B'],
    ]);
    const framework = new Framework();
    framework.service(
      DocsSearchService,
      () =>
        new DocsSearchService(
          { workspace: { engine: { indexer } } } as never,
          {
            list: {
              doc$: (id: string) => ({
                value: docs.has(id)
                  ? { id, title$: { value: docs.get(id) } }
                  : null,
              }),
            },
          } as never,
          {} as never
        )
    );
    const service = framework.provider().get(DocsSearchService);

    const grouped = await firstValueFrom(
      service.watchRefsBySourceFrom(['a', 'b'])
    );
    expect([...grouped]).toEqual([
      ['a', [{ docId: 'target-a', title: 'Target A', params: undefined }]],
      ['b', [{ docId: 'target-b', title: 'Target B', params: undefined }]],
    ]);
    expect(indexer.search$).toHaveBeenCalledTimes(1);
    expect(indexer.search$.mock.calls[0][2]).toMatchObject({
      pagination: { limit: Infinity },
    });
  });
});
