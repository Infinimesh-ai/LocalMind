import { Logger } from '@nestjs/common';
import test from 'ava';

import { createAssetMcpTools } from '../../plugins/copilot/mcp/asset-tools';
import { createCollaborationMcpTools } from '../../plugins/copilot/mcp/collaboration-tools';
import { createCommentMcpTools } from '../../plugins/copilot/mcp/comment-tools';
import { createDocumentMcpSurface } from '../../plugins/copilot/mcp/documents';
import { createHistoryMcpTools } from '../../plugins/copilot/mcp/history-tools';

test('MCP document resources paginate every readable document', async t => {
  const docIds = Array.from({ length: 205 }, (_, index) => `doc-${index}`);
  const surface = createDocumentMcpSurface(
    {
      ac: {} as never,
      permission: {
        listReadableDocIds: async () => docIds,
      } as never,
      reader: {} as never,
      writer: {} as never,
      structured: {} as never,
      context: {} as never,
      indexer: {} as never,
      models: {
        doc: {
          findTimestampsByDocIds: async () =>
            Object.fromEntries(docIds.map((id, index) => [id, index + 1])),
          findMetas: async (
            refs: Array<{ workspaceId: string; docId: string }>
          ) =>
            refs.map(({ docId }) => ({
              docId,
              title: `Title ${docId}`,
              summary: null,
              mode: 'page',
            })),
        },
      } as never,
      logger: new Logger('McpToolsTest'),
    },
    'user-1',
    'workspace-1'
  );

  const first = await surface.listResources();
  const second = await surface.listResources(first?.nextCursor);
  const third = await surface.listResources(second?.nextCursor);

  t.is(first?.resources.length, 100);
  t.is(first?.nextCursor, '100');
  t.is(second?.resources.length, 100);
  t.is(second?.nextCursor, '200');
  t.is(third?.resources.length, 5);
  t.is(third?.nextCursor, undefined);
  t.is(await surface.listResources('not-a-cursor'), null);
  t.is(
    new Set([
      ...(first?.resources ?? []),
      ...(second?.resources ?? []),
      ...(third?.resources ?? []),
    ]).size,
    205
  );
});

test('MCP workspace tool factories expose complete scoped surfaces', t => {
  const logger = new Logger('McpToolsTest');
  const assets = createAssetMcpTools(
    { ac: {} as never, resolver: {} as never, storage: {} as never, logger },
    'user-1',
    'workspace-1'
  );
  const comments = createCommentMcpTools(
    {
      ac: {} as never,
      service: {} as never,
      resolver: {} as never,
      models: {} as never,
      logger,
    },
    'user-1',
    'workspace-1'
  );
  const history = createHistoryMcpTools(
    { ac: {} as never, history: {} as never, structured: {} as never, logger },
    'user-1',
    'workspace-1'
  );
  const collaboration = createCollaborationMcpTools(
    {
      workspaceResolver: {} as never,
      workspaceDocResolver: {} as never,
      docResolver: {} as never,
      memberResolver: {} as never,
      logger,
    },
    'user-1',
    'workspace-1'
  );

  t.is(assets.readTools.length + assets.writeTools.length, 9);
  t.is(comments.readTools.length + comments.writeTools.length, 9);
  t.is(history.readTools.length + history.writeTools.length, 3);
  t.is(collaboration.readTools.length + collaboration.writeTools.length, 17);
  t.true(
    collaboration.writeTools.find(tool => tool.name === 'publish_document')!
      .annotations.openWorldHint
  );
  t.true(
    collaboration.writeTools.find(tool => tool.name === 'delete_workspace')!
      .annotations.destructiveHint
  );
});

test('MCP collaboration reads delegate through existing permission resolvers', async t => {
  const calls: unknown[][] = [];
  const collaboration = createCollaborationMcpTools(
    {
      workspaceResolver: {} as never,
      workspaceDocResolver: {} as never,
      docResolver: {} as never,
      memberResolver: {
        members: async (...args: unknown[]) => {
          calls.push(args);
          return [{ id: 'member-1' }];
        },
      } as never,
      logger: new Logger('McpToolsTest'),
    },
    'user-1',
    'workspace-1'
  );
  const result = await collaboration.readTools
    .find(tool => tool.name === 'list_workspace_members')!
    .execute(
      { offset: 5, limit: 10, query: 'alex' },
      { signal: new AbortController().signal }
    );

  t.deepEqual(result.structuredContent?.result, {
    members: [{ id: 'member-1' }],
  });
  t.is(calls.length, 1);
  t.deepEqual(calls[0].slice(2), [5, 10, 'alex']);
});

test('MCP asset, comment, and history reads delegate to existing services', async t => {
  const logger = new Logger('McpToolsTest');
  const docAccess = {
    can: async () => true,
  };
  const ac = {
    user: () => ({
      workspace: () => ({
        doc: () => docAccess,
      }),
    }),
  } as never;
  const assets = createAssetMcpTools(
    {
      ac,
      resolver: {
        blobs: async () => [{ key: 'blob-1', size: 12 }],
      } as never,
      storage: {} as never,
      logger,
    },
    'user-1',
    'workspace-1'
  );
  const comments = createCommentMcpTools(
    {
      ac,
      service: {
        getCommentCount: async () => 1,
        listComments: async () => [{ id: 'comment-1' }],
      } as never,
      resolver: {} as never,
      models: {} as never,
      logger,
    },
    'user-1',
    'workspace-1'
  );
  const history = createHistoryMcpTools(
    {
      ac,
      history: {
        listDocHistories: async () => [
          { timestamp: 1, editor: { id: 'user-1' } },
        ],
      } as never,
      structured: {} as never,
      logger,
    },
    'user-1',
    'workspace-1'
  );
  const signal = new AbortController().signal;

  const assetResult = await assets.readTools[0].execute({}, { signal });
  const commentResult = await comments.readTools[0].execute(
    { docId: 'doc-1' },
    { signal }
  );
  const historyResult = await history.readTools[0].execute(
    { docId: 'doc-1' },
    { signal }
  );

  t.deepEqual(assetResult.structuredContent?.result, [
    { key: 'blob-1', size: 12 },
  ]);
  t.deepEqual(commentResult.structuredContent?.result, {
    docId: 'doc-1',
    total: 1,
    comments: [{ id: 'comment-1' }],
  });
  t.deepEqual(historyResult.structuredContent?.result, {
    docId: 'doc-1',
    histories: [
      { timestamp: '1970-01-01T00:00:00.001Z', editor: { id: 'user-1' } },
    ],
  });
});
