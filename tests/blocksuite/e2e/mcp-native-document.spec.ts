import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';

import { documentBlockParents } from '../../../packages/backend/server/src/core/doc/document-block-defaults';
import {
  documentAdapterManifest,
  documentPropertyCapability,
} from '../../../packages/backend/server/src/core/doc/document-capabilities';
import { editNativeDocument } from '../../../packages/backend/server/src/core/doc/document-editor';
import { documentBlockVersions } from '../../../packages/backend/server/src/core/doc/document-schema';
import {
  enterPlaygroundRoom,
  initEmptyParagraphState,
} from './utils/actions/misc';
import { test } from './utils/playwright';

test('native adapters cover the real editor block registry and create editor models', async ({
  page,
}) => {
  await enterPlaygroundRoom(page);
  const { noteId } = await initEmptyParagraphState(page);
  const fixture = await page.evaluate(() => ({
    schemas: [...window.doc.schema.flavourSchemaMap].map(
      ([flavour, schema]) => ({
        flavour,
        version: schema.version,
        properties: Object.keys(
          schema.model.props?.({
            Text: (...args) => new window.$blocksuite.store.Text(...args),
            Boxed: value => ({ value }),
          }) ?? {}
        ),
      })
    ),
    parents: Object.fromEntries(
      [...window.doc.schema.flavourSchemaMap.keys()].map(child => [
        child,
        [...window.doc.schema.flavourSchemaMap.keys()].filter(parent =>
          window.doc.schema.isValid(child, parent)
        ),
      ])
    ),
    rootId: window.doc.root!.id,
    surfaceId:
      window.doc.getBlocksByFlavour('affine:surface')[0]?.id ??
      window.doc.addBlock('affine:surface', {}, window.doc.root!.id),
    binary: Array.from(
      window.$blocksuite.yjs.encodeStateAsUpdate(window.doc.spaceDoc)
    ),
  }));
  for (const schema of fixture.schemas) {
    expect(
      documentBlockVersions[
        schema.flavour as keyof typeof documentBlockVersions
      ],
      schema.flavour
    ).toBe(schema.version);
    for (const field of schema.properties)
      expect(
        documentPropertyCapability(schema.flavour, field).kind,
        `${schema.flavour}.${field} requires an adapter classification`
      ).not.toBe('opaque');
  }
  const registered = new Set(fixture.schemas.map(schema => schema.flavour));
  for (const [child, expected] of Object.entries(fixture.parents))
    expect(
      (documentBlockParents[child as keyof typeof documentBlockParents] ?? [])
        .filter(parent => registered.has(parent))
        .sort(),
      child
    ).toEqual(expected.sort());
  const flavours = fixture.schemas
    .map(schema => schema.flavour)
    .filter(
      flavour =>
        ![
          'affine:page',
          'affine:surface',
          'affine:transcription',
          'localmind:subpage',
        ].includes(flavour)
    );
  const result = editNativeDocument({
    bin: new Uint8Array(fixture.binary),
    actorId: 'test',
    operationId: 'registry',
    now: 12345,
    commands: flavours.map((flavour, index) => ({
      opId: `create${index}`,
      type: 'block.create',
      clientRef: `block${index}`,
      flavour,
      parentId:
        flavour === 'affine:note'
          ? fixture.rootId
          : ['affine:frame', 'affine:edgeless-text'].includes(flavour)
            ? fixture.surfaceId
            : noteId,
    })),
  });
  const actual = await page.evaluate(
    ({ update, identities }) => {
      window.$blocksuite.yjs.applyUpdate(
        window.doc.spaceDoc,
        new Uint8Array(update)
      );
      return Object.values(identities)
        .filter(id => window.doc.getModelById(id))
        .map(id => {
          const model = window.doc.getModelById(id)!;
          return {
            id,
            flavour: model.flavour,
            properties: model.yBlock.toJSON(),
          };
        });
    },
    { update: Array.from(result.update), identities: result.identities }
  );
  expect(actual.map(block => block.flavour).sort()).toEqual(flavours.sort());
  await expect(page.locator('affine-frame')).toHaveCount(0); // Canvas frames are retained outside the page renderer.
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`native MCP preserves real editor text and table (${colorScheme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(
      dark => localStorage.setItem('blocksuite:dark', dark),
      colorScheme === 'dark' ? 'true' : 'false'
    );
    await enterPlaygroundRoom(page);
    const { noteId, paragraphId } = await initEmptyParagraphState(page);
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      colorScheme
    );
    const fixture = await page.evaluate(
      ({ noteId, paragraphId }) => {
        const {
          doc,
          $blocksuite: {
            store: { Text },
            yjs: Y,
          },
        } = window;
        const formatted = doc.addBlock(
          'affine:paragraph',
          {
            text: new Text([
              { insert: '保留加粗', attributes: { bold: true } },
              { insert: ' 与批注' },
            ]),
            textAlign: 'center',
            comments: { 'test-comment': true },
          },
          noteId
        );
        const table = doc.addBlock(
          'affine:table',
          {
            rows: {
              row1: { rowId: 'row1', order: 'a0', backgroundColor: 'red' },
            },
            columns: {
              col1: { columnId: 'col1', order: 'a0', width: 260 },
              col2: { columnId: 'col2', order: 'a1', width: 190 },
            },
            cells: {
              'row1:col1': {
                text: new Text([
                  { insert: '原始值', attributes: { bold: true } },
                ]),
              },
              'row1:col2': { text: new Text('保留单元格') },
            },
          },
          noteId
        );
        const latex = doc.addBlock('affine:latex', { latex: 'E=mc^2' }, noteId);
        const block = doc.getModelById(formatted)!;
        const text = block.yBlock.get('prop:text');
        if (!(text instanceof Y.Text))
          throw new Error('Expected editor Y.Text');
        const anchor = Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(text, 2)
        );
        return {
          formatted,
          table,
          latex,
          paragraphId,
          anchor,
          binary: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
        };
      },
      { noteId, paragraphId }
    );
    await expect(page.locator('affine-table')).toBeVisible();
    const result = editNativeDocument({
      bin: new Uint8Array(fixture.binary),
      actorId: 'mcp-editor',
      operationId: 'real-editor-test',
      now: 12345,
      commands: [
        {
          opId: 'empty',
          type: 'text.splice',
          target: { kind: 'block_text', blockId: paragraphId },
          offset: 0,
          deleteCount: 0,
          insert: [{ insert: '空段落现在可编辑' }],
        },
        {
          opId: 'cell',
          type: 'text.splice',
          target: {
            kind: 'table_cell',
            blockId: fixture.table,
            rowId: 'row1',
            columnId: 'col1',
          },
          offset: 0,
          deleteCount: 3,
          insert: [{ insert: '修改值' }],
          marksPolicy: 'inherit_replaced_range',
        },
        {
          opId: 'append',
          type: 'text.splice',
          target: { kind: 'block_text', blockId: fixture.formatted },
          offset: 8,
          deleteCount: 0,
          insert: [{ insert: '，新增文字' }],
        },
      ],
    });
    await page.evaluate(
      update =>
        window.$blocksuite.yjs.applyUpdate(
          window.doc.spaceDoc,
          new Uint8Array(update)
        ),
      Array.from(result.update)
    );
    await expect(page.locator('affine-table')).toContainText('修改值');
    await expect(page.locator('affine-table')).toContainText('保留单元格');
    await expect(
      page.locator(`[data-block-id="${paragraphId}"]`)
    ).toContainText('空段落现在可编辑');
    const verified = await page.evaluate(fixture => {
      const {
        doc,
        $blocksuite: { yjs: Y },
      } = window;
      const table = doc.getModelById(fixture.table)!.yBlock;
      const formatted = doc.getModelById(fixture.formatted)!.yBlock;
      const anchor = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(fixture.anchor),
        doc.spaceDoc
      );
      return {
        width: table.get('prop:columns.col1.width'),
        color: table.get('prop:rows.row1.backgroundColor'),
        delta: (
          table.get('prop:cells.row1:col1.text') as import('yjs').Text
        ).toDelta(),
        align: formatted.get('prop:textAlign'),
        anchor: anchor?.index,
        latex: doc.getModelById(fixture.latex)!.yBlock.get('prop:latex'),
        binary: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
      };
    }, fixture);
    expect(verified).toMatchObject({
      width: 260,
      color: 'red',
      align: 'center',
      anchor: 2,
      latex: 'E=mc^2',
      delta: [{ insert: '修改值', attributes: { bold: true } }],
    });
    await page.screenshot({
      path: testInfo.outputPath(`native-${colorScheme}.png`),
      fullPage: true,
    });

    // Reopen the actual Yjs state in a fresh editor, then edit using the UI.
    await enterPlaygroundRoom(page);
    await page.evaluate(
      binary =>
        window.$blocksuite.yjs.applyUpdate(
          window.doc.spaceDoc,
          new Uint8Array(binary)
        ),
      verified.binary
    );
    await expect(page.locator('affine-table')).toContainText('修改值');
    const editable = page
      .locator(`[data-block-id="${paragraphId}"] [contenteditable="true"]`)
      .first();
    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' UI');
    await expect(
      page.locator(`[data-block-id="${paragraphId}"]`)
    ).toContainText('UI');
  });
}

test('real editor observes durable comment anchors in flat cells and preserves resolved anchors', async ({
  page,
}) => {
  await enterPlaygroundRoom(page);
  const { noteId } = await initEmptyParagraphState(page);
  const state = await page.evaluate(
    ({ noteId }) => {
      const {
        doc,
        $blocksuite: {
          store: { Text },
          affineModel: {
            collectNativeCommentIds,
            updateNativeTextCommentState,
          },
          yjs: Y,
        },
      } = window;
      const table = doc.addBlock(
        'affine:table',
        {
          rows: { r: { rowId: 'r', order: 'a0' } },
          columns: { c: { columnId: 'c', order: 'a0' } },
          cells: {
            'r:c': {
              text: new Text([
                { insert: 'anchored', attributes: { 'comment-cell': true } },
              ]),
            },
          },
        },
        noteId
      );
      const before = [...collectNativeCommentIds(doc.spaceDoc)];
      updateNativeTextCommentState(doc.spaceDoc, 'cell', false);
      const resolved = [...collectNativeCommentIds(doc.spaceDoc)];
      const cell = doc
        .getModelById(table)!
        .yBlock.get('prop:cells.r:c.text') as import('yjs').Text;
      const marks = cell.toDelta();
      const roundtrip = new Y.Doc();
      Y.applyUpdate(roundtrip, Y.encodeStateAsUpdate(doc.spaceDoc));
      const reopened = [...collectNativeCommentIds(roundtrip)];
      roundtrip.destroy();
      doc.deleteBlock(doc.getModelById(table)!);
      return {
        before,
        resolved,
        reopened,
        marks,
        deleted: [...collectNativeCommentIds(doc.spaceDoc)],
      };
    },
    { noteId }
  );
  expect(state.before).toContain('cell');
  expect(state.resolved).toContain('cell');
  expect(state.reopened).toContain('cell');
  expect(state.marks).toEqual([
    { insert: 'anchored', attributes: { 'comment-cell': false } },
  ]);
  expect(state.deleted).not.toContain('cell');
});

test('LocalMind extension models and column schemas accept native MCP edits and preserve source evidence', async ({
  page,
}) => {
  test.setTimeout(90000);
  await enterPlaygroundRoom(page);
  const { noteId } = await initEmptyParagraphState(page);
  const paths = [
    'ai/blocks/ai-chat-block/model/ai-chat-model.ts',
    'ai/blocks/transcription-block/model.ts',
    'page-tree/model.ts',
    'database-block/properties/file/define.ts',
    'database-block/properties/member/define.ts',
    'database-block/properties/created-by/define.ts',
  ].map(
    path =>
      `/@fs${fileURLToPath(new URL(`../../../packages/frontend/core/src/blocksuite/${path}`, import.meta.url))}`
  );
  const fixture = await page.evaluate(
    async ({ paths, noteId }) => {
      const [chat, transcript, subpage, files, members, author] =
        await Promise.all(paths.map(path => import(/* @vite-ignore */ path)));
      const schemas = [
        chat.AIChatBlockSchema,
        transcript.TranscriptionBlockSchema,
        subpage.SubpageBlockSchema,
      ];
      window.doc.schema.register(schemas);
      const block = window.doc.addBlock(
        'affine:embed-ai-chat',
        {
          messages: '[{"role":"user","content":"source evidence"}]',
          sessionId: 'source-session',
          rootWorkspaceId: 'source-workspace',
          rootDocId: 'source-doc',
        },
        noteId
      );
      const attachment = window.doc.addBlock('affine:attachment', {}, noteId);
      const transcription = window.doc.addBlock(
        'affine:transcription',
        { jobId: 'source-job', createdBy: 'original' },
        attachment
      );
      const child = window.doc.addBlock('affine:callout', {}, transcription);
      const paragraph = window.doc.addBlock(
        'affine:paragraph',
        { text: new window.$blocksuite.store.Text('transcript') },
        child
      );
      const reference = window.doc.addBlock(
        'localmind:subpage',
        { resourceId: 'target', kind: 'doc' },
        noteId
      );
      const database = window.doc.addBlock('affine:database', {}, noteId);
      // Store the product validators in this isolated editor, not copied schemas.
      Object.assign(window, {
        mcpColumnValidators: {
          files: files.FileItemSchema,
          members: members.MemberItemSchema,
          author: author.createdByPropertyModelConfig,
        },
      });
      return {
        block,
        transcription,
        paragraph,
        reference,
        database,
        binary: Array.from(
          window.$blocksuite.yjs.encodeStateAsUpdate(window.doc.spaceDoc)
        ),
        schemas: schemas.map(schema => ({
          flavour: schema.model.flavour,
          version: schema.version,
          properties: Object.keys(schema.model.props({})),
        })),
      };
    },
    { paths, noteId }
  );
  for (const schema of fixture.schemas) {
    expect(
      documentBlockVersions[
        schema.flavour as keyof typeof documentBlockVersions
      ]
    ).toBe(schema.version);
    for (const field of schema.properties)
      expect(documentPropertyCapability(schema.flavour, field).kind).not.toBe(
        'opaque'
      );
  }
  const result = editNativeDocument({
    bin: new Uint8Array(fixture.binary),
    actorId: 'editor',
    operationId: 'localmind-extensions',
    now: 12345,
    dependencies: {
      assets: { asset: { size: 10, mimeType: 'text/plain' } },
      resources: new Set(),
      members: new Set(['member']),
    },
    commands: [
      {
        opId: 'geometry',
        type: 'block.properties',
        blockId: fixture.block,
        flavour: 'affine:embed-ai-chat',
        properties: { xywh: '[10,20,400,300]' },
      },
      {
        opId: 'transcript',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: fixture.paragraph },
        offset: 10,
        deleteCount: 0,
        insert: [{ insert: ' edited' }],
      },
      {
        opId: 'files',
        type: 'database.column.create',
        blockId: fixture.database,
        clientRef: 'files',
        column: { name: 'Files', type: 'attachment', data: {} },
      },
      {
        opId: 'members',
        type: 'database.column.create',
        blockId: fixture.database,
        clientRef: 'members',
        column: { name: 'Members', type: 'member', data: {} },
      },
      {
        opId: 'author',
        type: 'database.column.create',
        blockId: fixture.database,
        clientRef: 'author',
        column: { name: 'Author', type: 'created-by', data: {} },
      },
      {
        opId: 'row',
        type: 'database.row.create',
        blockId: fixture.database,
        clientRef: 'row',
        title: 'Native row',
      },
      {
        opId: 'file-cell',
        type: 'database.cell.files.set',
        blockId: fixture.database,
        rowId: '$row',
        columnId: '$files',
        files: [{ blobId: 'asset', name: 'report.txt' }],
      },
      {
        opId: 'member-cell',
        type: 'database.cell.members.set',
        blockId: fixture.database,
        rowId: '$row',
        columnId: '$members',
        userIds: ['member'],
      },
    ],
  });
  const actual = await page.evaluate(
    ({ fixture, update, identities }) => {
      const {
        doc,
        $blocksuite: { yjs: Y },
      } = window;
      Y.applyUpdate(doc.spaceDoc, new Uint8Array(update));
      const database = doc.getModelById(fixture.database)!;
      const cells = database.yBlock.get('prop:cells') as import('yjs').Map<
        import('yjs').Map<unknown>
      >;
      const fileValue = (
        cells
          .get(identities.row)!
          .get(identities.files) as import('yjs').Map<unknown>
      ).get('value') as import('yjs').Map<import('yjs').Map<unknown>>;
      const file = fileValue.get('asset')!.toJSON();
      const validators = (
        window as unknown as {
          mcpColumnValidators: {
            files: { parse(value: unknown): unknown };
            members: { parse(value: unknown): unknown };
          };
        }
      ).mcpColumnValidators;
      validators.files.parse(file);
      validators.members.parse('member');
      return {
        file,
        members: (
          (
            cells
              .get(identities.row)!
              .get(identities.members) as import('yjs').Map<unknown>
          ).get('value') as import('yjs').Array<string>
        ).toJSON(),
        messages: doc.getModelById(fixture.block)!.yBlock.get('prop:messages'),
        job: doc.getModelById(fixture.transcription)!.yBlock.get('prop:jobId'),
        transcript: (
          doc
            .getModelById(fixture.paragraph)!
            .yBlock.get('prop:text') as import('yjs').Text
        ).toString(),
        reference: doc
          .getModelById(fixture.reference)!
          .yBlock.get('prop:resourceId'),
      };
    },
    {
      fixture,
      update: Array.from(result.update),
      identities: result.identities,
    }
  );
  expect(actual).toMatchObject({
    file: { id: 'asset', name: 'report.txt', mime: 'text/plain' },
    members: ['member'],
    messages: '[{"role":"user","content":"source evidence"}]',
    job: 'source-job',
    transcript: 'transcript edited',
    reference: 'target',
  });
  expect(documentAdapterManifest().databaseColumns).toEqual(
    expect.arrayContaining(['attachment', 'member', 'created-by'])
  );
});

test('mapped Markdown merges an offline editor change without replacing live text or its comment anchor', async ({
  page,
}) => {
  await enterPlaygroundRoom(page);
  const { noteId, paragraphId } = await initEmptyParagraphState(page);
  const fixture = await page.evaluate(
    ({ paragraphId }) => {
      const {
        doc,
        $blocksuite: { yjs: Y },
      } = window;
      const text = doc
        .getModelById(paragraphId)!
        .yBlock.get('prop:text') as import('yjs').Text;
      text.insert(0, 'before KEEP after');
      text.format(7, 4, { 'comment-offline': true, underline: true });
      const baseline = Array.from(Y.encodeStateAsUpdate(doc.spaceDoc));
      const anchor = Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, 8)
      );
      // An unsent editor update after the server's version-bound snapshot.
      text.insert(text.length, ' OFFLINE');
      return { baseline, anchor };
    },
    { paragraphId }
  );
  const result = editNativeDocument({
    bin: new Uint8Array(fixture.baseline),
    actorId: 'editor',
    operationId: 'markdown-offline',
    now: 12345,
    commands: [
      {
        opId: 'markdown',
        type: 'markdown.rewrite',
        parentId: noteId,
        selectedBlockIds: [paragraphId],
        markdown: 'changed **KEEP** after',
        marksPolicy: 'preserve_existing',
        mappings: [{ path: '0', blockId: paragraphId }],
        mode: 'update_preserve',
      },
    ],
  });
  const merged = await page.evaluate(
    ({ update, paragraphId, anchor }) => {
      const {
        doc,
        $blocksuite: {
          yjs: Y,
          affineModel: { findNativeCommentTargets },
        },
      } = window;
      const text = doc
        .getModelById(paragraphId)!
        .yBlock.get('prop:text') as import('yjs').Text;
      Y.applyUpdate(doc.spaceDoc, new Uint8Array(update));
      return {
        sameText:
          text === doc.getModelById(paragraphId)!.yBlock.get('prop:text'),
        text: text.toString(),
        anchor: Y.createAbsolutePositionFromRelativePosition(
          Y.createRelativePositionFromJSON(anchor),
          doc.spaceDoc
        )?.index,
        targets: findNativeCommentTargets(doc.spaceDoc, 'offline'),
        delta: text.toDelta(),
      };
    },
    { update: Array.from(result.update), paragraphId, anchor: fixture.anchor }
  );
  expect(merged).toMatchObject({
    sameText: true,
    text: 'changed KEEP after OFFLINE',
    anchor: 9,
    targets: { blockIds: [paragraphId] },
  });
  expect(
    merged.delta.some(
      run =>
        run.insert === 'KEEP' &&
        run.attributes?.bold &&
        run.attributes?.underline &&
        run.attributes?.['comment-offline']
    )
  ).toBe(true);
  await expect(page.locator(`[data-block-id="${paragraphId}"]`)).toContainText(
    'OFFLINE'
  );
});

test('native canvas adapters instantiate every registered element and use the editor mindmap style', async ({
  page,
}) => {
  await enterPlaygroundRoom(page);
  await initEmptyParagraphState(page);
  const registryPath = `/@fs${fileURLToPath(new URL('../../../blocksuite/affine/blocks/surface/src/element-model/index.ts', import.meta.url))}`;
  const fixture = await page.evaluate(async registryPath => {
    const { elementsCtorMap } = await import(/* @vite-ignore */ registryPath);
    const {
      doc,
      $blocksuite: { yjs: Y },
    } = window;
    const surfaceId =
      doc.getBlocksByFlavour('affine:surface')[0]?.id ??
      doc.addBlock('affine:surface', {}, doc.root!.id);
    return {
      surfaceId,
      kinds: Object.keys(elementsCtorMap),
      binary: Array.from(Y.encodeStateAsUpdate(doc.spaceDoc)),
    };
  }, registryPath);
  expect(
    documentAdapterManifest()
      .elements.map(item => item.kind)
      .sort()
  ).toEqual(fixture.kinds.sort());
  const result = editNativeDocument({
    bin: new Uint8Array(fixture.binary),
    actorId: 'editor',
    operationId: 'canvas-registry',
    now: 12345,
    commands: [
      ...fixture.kinds.map(kind => ({
        opId: kind,
        type: 'element.create',
        surfaceId: fixture.surfaceId,
        clientRef: kind,
        element: {
          kind,
          properties:
            kind === 'connector'
              ? {
                  source: { position: [0, 0] },
                  target: { position: [100, 100] },
                }
              : {},
        },
      })),
      {
        opId: 'child',
        type: 'element.create',
        surfaceId: fixture.surfaceId,
        clientRef: 'child',
        element: { kind: 'shape', properties: { xywh: '[0,0,100,40]' } },
      },
      {
        opId: 'root-bounds',
        type: 'element.update',
        surfaceId: fixture.surfaceId,
        elementId: '$shape',
        element: { kind: 'shape', properties: { xywh: '[0,0,100,40]' } },
      },
      {
        opId: 'mindmap-style',
        type: 'element.update',
        surfaceId: fixture.surfaceId,
        elementId: '$mindmap',
        element: { kind: 'mindmap', properties: { style: 2 } },
      },
      {
        opId: 'members',
        type: 'element.members.set',
        surfaceId: fixture.surfaceId,
        elementId: '$mindmap',
        members: [
          { id: '$shape', index: 'a0' },
          { id: '$child', parent: '$shape', index: 'a0' },
        ],
      },
    ],
  });
  const actual = await page.evaluate(
    ({ fixture, update, identities }) => {
      const {
        doc,
        $blocksuite: { yjs: Y },
      } = window;
      Y.applyUpdate(doc.spaceDoc, new Uint8Array(update));
      const surface = doc.getModelById(
        fixture.surfaceId
      ) as import('@blocksuite/affine/blocks/surface').SurfaceBlockModel;
      const mindmap = surface.getElementById(
        identities.mindmap
      ) as import('@blocksuite/affine-model').MindmapElementModel;
      const root = surface.getElementById(
        identities.shape
      ) as import('@blocksuite/affine-model').ShapeElementModel;
      const child = surface.getElementById(
        identities.child
      ) as import('@blocksuite/affine-model').ShapeElementModel;
      const expected = mindmap.styleGetter.root;
      return {
        kinds: fixture.kinds.map(
          kind => surface.getElementById(identities[kind])!.type
        ),
        root: {
          fontFamily: root.fontFamily,
          fontSize: root.fontSize,
          radius: root.radius,
          padding: root.padding,
        },
        expected: {
          fontFamily: expected.fontFamily,
          fontSize: expected.fontSize,
          radius: expected.radius,
          padding: expected.padding,
        },
        childTextIdentity: child.text instanceof Y.Text,
        nodes: [...mindmap.children.keys()].sort(),
      };
    },
    {
      fixture,
      update: Array.from(result.update),
      identities: result.identities,
    }
  );
  expect(actual.kinds.sort()).toEqual(fixture.kinds.sort());
  expect(actual.root).toEqual(actual.expected);
  expect(actual.nodes).toEqual(
    [result.identities.shape, result.identities.child].sort()
  );
});
