import test from 'ava';
import * as Y from 'yjs';

import {
  readResourceMarkdown,
  validateResourceMarkdown,
} from '../../core/doc/resource-markdown';
import { createDocWithMarkdown } from '../../native';
import {
  MCP_CAPABILITIES,
  MCP_DELEGATION_CAPABILITIES,
  mcpAccessModeForCapabilities,
  normalizeMcpCapabilities,
} from '../../plugins/copilot/mcp/capabilities';
import { RESOURCE_INPUT_SCHEMAS } from '../../plugins/copilot/mcp/resource-schema';

test('resource capabilities never expand legacy defaults', t => {
  t.is(MCP_CAPABILITIES.length, 13);
  t.deepEqual(normalizeMcpCapabilities([], 'READ_WRITE'), [
    ...MCP_DELEGATION_CAPABILITIES,
  ]);
  t.deepEqual(normalizeMcpCapabilities(undefined, 'READ_ONLY'), [
    'get_localmind_task',
  ]);
  t.is(mcpAccessModeForCapabilities(['workspace_doc_create']), 'READ_WRITE');
  t.is(
    mcpAccessModeForCapabilities([
      'workspace_doc_read',
      'workspace_operation_get',
    ]),
    'READ_ONLY'
  );
});

test('strict public inputs distinguish root, omission, unknown actors and UTF8 bounds', t => {
  t.is(RESOURCE_INPUT_SCHEMAS.workspace_doc_list.parse({}).folderId, undefined);
  t.is(
    RESOURCE_INPUT_SCHEMAS.workspace_doc_list.parse({ folderId: null })
      .folderId,
    null
  );
  t.false(
    RESOURCE_INPUT_SCHEMAS.workspace_doc_read.safeParse({
      documentId: 'd',
      actorId: 'forged',
    }).success
  );
  t.throws(() => validateResourceMarkdown('标题', '中'.repeat(400000), 'd'), {
    message: 'content_too_large',
  });
});

for (const markdown of [
  '',
  '正文\n',
  '## 今日完成\n\n- 完成测试\n- 第二项\n',
  'A **bold** and *italic* [link](https://example.com).\n',
]) {
  test(`safe Markdown round trip: ${JSON.stringify(markdown).slice(0, 40)}`, t => {
    const bin = createDocWithMarkdown('标题', markdown, 'document');
    const read = readResourceMarkdown('workspace', 'document', bin);
    t.true(read.contentWritable, JSON.stringify(read));
    t.notThrows(() => validateResourceMarkdown('标题', markdown, 'document'));
  });
}

test('unsupported images and block structures are never writable', t => {
  t.throws(
    () => validateResourceMarkdown('title', '![secret](blob:abc)', 'doc'),
    { message: 'unsupported_document_structure' }
  );
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createDocWithMarkdown('title', 'body', 'doc'));
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  for (const block of blocks.values())
    if (block.get('sys:flavour') === 'affine:paragraph')
      block.set('sys:flavour', 'affine:database');
  t.false(
    readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc)).contentWritable
  );
  doc.destroy();
});

test('code blocks with lossy native round trips are read-only', t => {
  const bin = createDocWithMarkdown(
    'Code',
    '```ts\nconst a = 1;\n```\n',
    'doc'
  );
  t.false(readResourceMarkdown('w', 'doc', bin).contentWritable);
});
