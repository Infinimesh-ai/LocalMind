import test from 'ava';
import * as Y from 'yjs';

import {
  readResourceMarkdown,
  updateResourceMarkdown,
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
import {
  addEditorProperties,
  DAILY_LOG_MARKDOWN,
} from './fixtures/resource-markdown';

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

test('editor defaults and provenance do not make a Markdown log read-only', t => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(
      doc,
      createDocWithMarkdown('日志', DAILY_LOG_MARKDOWN, 'doc')
    );
    const before = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    addEditorProperties(doc);
    const after = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    t.true(after.contentWritable);
    t.deepEqual(after.content, before.content);
  } finally {
    doc.destroy();
  }
});

test('legacy blocks keep missing creation history on modification', t => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, createDocWithMarkdown('日志', '原有段落\n', 'doc'));
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const old = [...blocks.values()].find(
      block => block.get('sys:flavour') === 'affine:paragraph'
    )!;
    const id = String(old.get('sys:id'));
    Y.applyUpdate(
      doc,
      updateResourceMarkdown(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        '修订段落\n',
        'doc',
        'current-editor',
        1800000000000
      )
    );
    const retained = blocks.get(id)!;
    t.truthy(retained);
    t.false(retained.has('prop:meta:createdAt'));
    t.false(retained.has('prop:meta:createdBy'));
    t.is(retained.get('prop:meta:updatedBy'), 'current-editor');
    t.true(
      readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc))
        .contentWritable
    );
  } finally {
    doc.destroy();
  }
});

test('todo checkbox state remains semantic during a direct update', t => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(
      doc,
      createDocWithMarkdown('待办', '- [ ] 待办事项\n', 'doc')
    );
    const list = [...doc.getMap<Y.Map<unknown>>('blocks').values()].find(
      block => block.get('sys:flavour') === 'affine:list'
    )!;
    list.set('prop:collapsed', false);
    t.true(
      readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc))
        .contentWritable
    );
    Y.applyUpdate(
      doc,
      updateResourceMarkdown(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        '- [x] 待办事项\n',
        'doc',
        'current-editor'
      )
    );
    const read = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    t.true(read.contentWritable);
    t.true(read.content.text.includes('[x] 待办事项'));
    t.is(list.get('prop:checked'), true);
    t.is(list.get('prop:meta:updatedBy'), 'current-editor');
  } finally {
    doc.destroy();
  }
});

test('reconciliation preserves nested identities across insertions, removals and an empty replacement', t => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(
      doc,
      createDocWithMarkdown('日志', DAILY_LOG_MARKDOWN, 'doc')
    );
    addEditorProperties(doc);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const stable = [...blocks].filter(
      ([, block]) =>
        String(block.get('prop:text')).includes('已有成果') ||
        String(block.get('prop:text')).includes('验证记录')
    );
    const textObjects = stable.map(([, block]) => block.get('prop:text'));
    const changed = DAILY_LOG_MARKDOWN.replace('- 待更新事项\n', '')
      .replace('## 今日完成\n', '## 今日完成\n\n- [新增 / 条目] 内容\n')
      .replace('  - [验证记录]', '  - 新增子项\n  - [验证记录]');
    Y.applyUpdate(
      doc,
      updateResourceMarkdown(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        changed,
        'doc',
        'current-editor'
      )
    );
    for (const [index, [id, block]] of stable.entries()) {
      t.is(blocks.get(id), block);
      t.is(block.get('prop:text'), textObjects[index]);
      t.is(block.get('prop:meta:createdBy'), 'previous-editor');
    }
    const read = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    t.true(read.contentWritable);
    t.deepEqual(
      read.content,
      validateResourceMarkdown('日志', changed, 'doc').content
    );
    Y.applyUpdate(
      doc,
      updateResourceMarkdown(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        '',
        'doc',
        'current-editor'
      )
    );
    const empty = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    t.true(empty.contentWritable);
    t.is(empty.content.text, '');
    for (const [id] of stable) t.false(blocks.has(id));
  } finally {
    doc.destroy();
  }
});

for (const [flavour, key, value] of [
  ['affine:paragraph', 'prop:collapsed', true],
  ['affine:list', 'prop:checked', true],
  ['affine:list', 'prop:order', 7],
  ['affine:note', 'prop:lockedBySelf', true],
  ['affine:note', 'prop:edgeless', { style: { borderRadius: 9 } }],
  ['affine:paragraph', 'prop:meta:custom', 'unknown'],
  ['affine:paragraph', 'prop:meta:createdAt', 'not-a-timestamp'],
  ['affine:paragraph', 'prop:comments', { thread: true }],
] as const) {
  test(`non-default or unsupported editor state remains read-only: ${key}`, t => {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(
        doc,
        createDocWithMarkdown('日志', DAILY_LOG_MARKDOWN, 'doc')
      );
      addEditorProperties(doc);
      const block = [...doc.getMap<Y.Map<unknown>>('blocks').values()].find(
        block => block.get('sys:flavour') === flavour
      )!;
      block.set(key, value);
      t.false(
        readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc))
          .contentWritable
      );
    } finally {
      doc.destroy();
    }
  });
}

test('structural updates preserve existing provenance and stamp changed/new blocks', t => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(
      doc,
      createDocWithMarkdown('日志', DAILY_LOG_MARKDOWN, 'doc')
    );
    addEditorProperties(doc);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const before = new Map(
      [...blocks].map(([id, block]) => [id, block.toJSON()])
    );
    const textObjects = new Map(
      [...blocks].map(([id, block]) => [id, block.get('prop:text')])
    );
    const now = 1800000000000;
    const updated =
      DAILY_LOG_MARKDOWN.replace('待更新事项', '更新后的事项') +
      '\n- 新增记录\n';
    Y.applyUpdate(
      doc,
      updateResourceMarkdown(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        updated,
        'doc',
        'current-editor',
        now
      )
    );
    for (const [id, old] of before) {
      const block = blocks.get(id)!;
      t.truthy(block, `retained block ${id}`);
      if (
        ['affine:note', 'affine:surface', 'affine:page'].includes(
          old['sys:flavour']
        )
      ) {
        // The note's child IDs change when a paragraph is appended.
        const { 'sys:children': _oldChildren, ...oldProps } = old;
        const { 'sys:children': _newChildren, ...newProps } = block.toJSON();
        t.deepEqual(newProps, oldProps);
        continue;
      }
      t.is(block.get('prop:meta:createdAt'), old['prop:meta:createdAt']);
      t.is(block.get('prop:meta:createdBy'), old['prop:meta:createdBy']);
      const changed = old['prop:text'] === '待更新事项';
      if (!changed) t.is(block.get('prop:text'), textObjects.get(id));
      t.is(
        block.get('prop:meta:updatedAt'),
        changed ? now : old['prop:meta:updatedAt']
      );
      t.is(
        block.get('prop:meta:updatedBy'),
        changed ? 'current-editor' : old['prop:meta:updatedBy']
      );
    }
    const added = [...blocks].filter(([id]) => !before.has(id));
    t.is(added.length, 1);
    t.is(added[0][1].get('prop:meta:createdAt'), now);
    t.is(added[0][1].get('prop:meta:createdBy'), 'current-editor');
    t.is(added[0][1].get('prop:meta:updatedAt'), now);
    t.is(added[0][1].get('prop:meta:updatedBy'), 'current-editor');
    const read = readResourceMarkdown('w', 'doc', Y.encodeStateAsUpdate(doc));
    t.true(read.contentWritable);
    t.deepEqual(
      read.content,
      validateResourceMarkdown('日志', updated, 'doc').content
    );
  } finally {
    doc.destroy();
  }
});
