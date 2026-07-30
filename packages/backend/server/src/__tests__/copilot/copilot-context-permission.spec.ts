import { Prisma } from '@prisma/client';
import test from 'ava';

import { BadRequest } from '../../base';
import type { PermissionService } from '../../core/permission';
import type { Models } from '../../models';
import { CopilotContextService } from '../../plugins/copilot/context';
import { CopilotContextMemoryResolver } from '../../plugins/copilot/context-memory-resolver';
import type { EmbeddingClient } from '../../plugins/copilot/embedding';

test('workspace semantic search applies Doc.Read before reranking', async t => {
  const readablePredicate = Prisma.sql`TRUE`;
  const rerankedDocIds: string[] = [];
  const client = {
    getEmbedding: async () => [1],
    reRank: async (
      _query: string,
      chunks: Array<{ docId?: string }>,
      topK: number
    ) => {
      rerankedDocIds.push(
        ...chunks.flatMap(chunk => (chunk.docId ? [chunk.docId] : []))
      );
      return chunks.slice(0, topK);
    },
  } as unknown as EmbeddingClient;
  const permission = {
    docReadableSqlPredicate: () => readablePredicate,
  } as unknown as PermissionService;
  const models = {
    copilotContext: {
      matchWorkspaceEmbedding: async (
        _embedding: number[],
        _workspaceId: string,
        _topK: number,
        _threshold: number,
        predicate: Prisma.Sql
      ) =>
        predicate === readablePredicate
          ? [
              {
                docId: 'readable-doc',
                chunk: 0,
                content: 'readable',
                distance: 0,
              },
            ]
          : [
              {
                docId: 'hidden-doc',
                chunk: 0,
                content: 'hidden',
                distance: 0,
              },
            ],
    },
    copilotWorkspace: {
      matchFileEmbedding: async () => [],
      matchBlobEmbedding: async () => [],
    },
  } as unknown as Models;
  const context = new CopilotContextService(
    { getClient: () => client } as never,
    {} as never,
    models,
    permission
  );

  const result = await context.matchWorkspaceAll(
    'workspace-1',
    'query',
    10,
    undefined,
    0.8,
    undefined,
    0.85,
    { userId: 'user-1' }
  );

  t.deepEqual(rerankedDocIds, ['readable-doc']);
  t.deepEqual(
    result.map(chunk => ('docId' in chunk ? chunk.docId : undefined)),
    ['readable-doc']
  );
});

test('workspace semantic search rejects calls without an actor', async t => {
  let embeddingCalled = false;
  const client = {
    getEmbedding: async () => {
      embeddingCalled = true;
      return [1];
    },
  } as unknown as EmbeddingClient;
  const context = new CopilotContextService(
    { getClient: () => client } as never,
    {} as never,
    {} as Models,
    {} as PermissionService
  );

  await t.throwsAsync(context.matchWorkspaceDocs('workspace-1', 'query', 10), {
    message: 'Document embedding search requires a user id.',
  });
  t.false(embeddingCalled);
});

test('context mutations expose validation failures as user-friendly errors', async t => {
  const resolver = new CopilotContextMemoryResolver({} as never, {} as never);

  const error = await t.throwsAsync(
    resolver.createCopilotContextMemory({ id: 'user-1' } as never, {
      scope: 'user',
      kind: 'rule',
      content: ' ',
    })
  );

  t.true(error instanceof BadRequest);
  t.is(error.message, 'Memory content is required');
});
