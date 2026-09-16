import { Logger } from '@nestjs/common';
import test from 'ava';
import Sinon from 'sinon';

import { createDocumentMcpSurface } from '../../plugins/copilot/mcp/documents';

function fixture() {
  const applied = Sinon.stub();
  const permission = Sinon.stub().resolves();
  const audit = Sinon.stub().callsFake(async (_input, execute) => execute());
  const models = {
    copilotContext: {
      withWorkspaceWriteAudit: audit,
    },
  };
  const writer = {
    withDeferredBroadcasts: async (operation: () => Promise<unknown>) =>
      await operation(),
    createDoc: applied,
    updateDoc: async (
      _workspace: string,
      _doc: string,
      _content: string,
      _actor: string,
      check: () => Promise<void>
    ) => {
      await check();
      applied();
    },
    updateDocMeta: async (
      _workspace: string,
      _doc: string,
      _meta: unknown,
      _actor: string,
      check: () => Promise<void>
    ) => {
      await check();
      applied();
    },
  };
  const ac = {
    user: () => ({
      workspace: () => ({
        doc: () => ({ can: async () => true, assert: permission }),
      }),
    }),
  };
  const surface = createDocumentMcpSurface(
    {
      ac,
      writer,
      models,
      permission: {},
      reader: {},
      context: {},
      indexer: {},
      structured: {
        applyBlockOperations: applied,
        applyWhiteboardOperations: applied,
        applyDatabaseOperations: applied,
      },
      logger: new Logger('DirectMcpSourceTest'),
    } as unknown as Parameters<typeof createDocumentMcpSurface>[0],
    'actor',
    'workspace'
  );
  const execute = async (name: string, args: Record<string, unknown>) => {
    const tool = surface.writeTools.find(tool => tool.name === name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return await tool.execute(args, { signal: new AbortController().signal });
  };
  return { applied, permission, audit, execute };
}

test('direct MCP creation uses the supported delegation entrypoint', async t => {
  const f = fixture();
  const result = await f.execute('create_document', {
    title: 'Synthetic',
    content: 'Private content',
  });
  t.true(result.isError);
  t.false(f.applied.called);
});

test('direct Markdown, title and structured writes use live ACL on every attempt', async t => {
  const f = fixture();
  const operations: Array<[string, Record<string, unknown>]> = [
    ['update_document', { docId: 'doc', content: 'Private content' }],
    ['update_document_meta', { docId: 'doc', title: 'Private title' }],
    [
      'apply_document_block_operations',
      {
        docId: 'doc',
        operations: [
          {
            op: 'update',
            blockId: 'paragraph',
            props: { text: 'Private content' },
          },
        ],
      },
    ],
    [
      'apply_whiteboard_operations',
      {
        docId: 'doc',
        operations: [
          {
            op: 'update_element',
            elementId: 'text',
            props: { text: 'Private content' },
          },
        ],
      },
    ],
    [
      'apply_database_operations',
      {
        docId: 'doc',
        databaseId: 'table',
        operations: [
          { op: 'update_row_title', rowId: 'row', title: 'Private content' },
        ],
      },
    ],
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const [name, args] of operations)
      t.falsy((await f.execute(name, args)).isError);
  }
  t.is(f.applied.callCount, 10);
  f.permission.rejects(new Error('Doc.Update denied'));
  for (const [name, args] of operations)
    t.true((await f.execute(name, args)).isError);
  t.is(f.applied.callCount, 10);
});
