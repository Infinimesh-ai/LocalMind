import { WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Y from 'yjs';

import {
  DocWriter,
  WorkspaceOrganizationService,
  WorkspacePageTreeService,
} from '../../core/doc';
import {
  type LegacyTreeRow,
  planWorkspacePageTree,
} from '../../core/doc/page-tree-plan';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
});
test.beforeEach(async () => {
  await app.initTestingDB();
});
test.after.always(async () => {
  await app.close();
});

async function fixture() {
  const owner = await app.createUser();
  const workspace = await app.models.workspace.create(owner.id);
  const actor = { workspaceId: workspace.id, actorId: owner.id };
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app
    .get(DocWriter)
    .pushDocUpdate(
      workspace.id,
      workspace.id,
      Y.encodeStateAsUpdate(root),
      owner.id
    );
  root.destroy();
  const service = app.get(WorkspacePageTreeService);
  return { actor, owner, service, db: app.get(PrismaClient) };
}

test.serial(
  'deterministic migration preserves empty/nested folders, native identity, root records and defaults',
  t => {
    const rows: LegacyTreeRow[] = [
      {
        id: 'parent',
        type: 'folder',
        data: '同名',
        parentId: null,
        index: 'a0',
        defaultSortMode: 'name-desc',
      },
      {
        id: 'child',
        type: 'folder',
        data: '同名',
        parentId: 'parent',
        index: 'a0',
      },
      {
        id: 'office-placement',
        type: 'doc',
        data: 'office',
        parentId: 'child',
        index: 'a0',
      },
      {
        id: 'tag-placement',
        type: 'tag',
        data: 'tag',
        parentId: 'parent',
        index: 'a1',
      },
      {
        id: 'stale',
        type: 'doc',
        data: 'deleted',
        parentId: 'parent',
        index: 'a2',
      },
    ];
    const input = {
      workspaceId: 'workspace',
      sourceRevision: 'revision',
      rows,
      resources: [
        { kind: 'office' as const, resourceId: 'office', trashed: false },
        {
          kind: 'doc' as const,
          resourceId: 'root-doc',
          primaryMode: 'page' as const,
          trashed: false,
        },
      ],
      policies: [],
    };
    const plan = planWorkspacePageTree(input);
    t.deepEqual(plan.conflicts, []);
    t.is(plan.nodes.length, 4);
    t.is(
      plan.nodes.find(node => node.resource.resourceId === 'office')
        ?.parentNodeId,
      'child'
    );
    t.is(
      plan.nodes.find(node => node.resource.resourceId === 'root-doc')
        ?.parentNodeId,
      null
    );
    t.is(
      plan.nodes.find(node => node.nodeId === 'parent')?.defaultSortMode,
      'name-desc'
    );
    t.deepEqual(plan.mappings, []);
    t.is(plan.typedMappings[0].targetKind, 'folder');
    t.is(
      plan.nodes.find(node => node.nodeId === 'parent')?.resource.kind,
      'folder'
    );
    t.deepEqual(
      planWorkspacePageTree({
        ...input,
        rows: rows.reverse(),
        resources: input.resources.reverse(),
      }),
      plan
    );
  }
);

test.serial(
  'duplicate positions require permission equivalence for every principal, including hidden paths',
  t => {
    const rows: LegacyTreeRow[] = [
      {
        id: 'wide',
        type: 'folder',
        data: 'Visible',
        parentId: null,
        index: 'a1',
      },
      {
        id: 'hidden',
        type: 'folder',
        data: 'Hidden',
        parentId: null,
        index: 'a0',
      },
      { id: 'one', type: 'doc', data: 'same', parentId: 'wide', index: 'a0' },
      { id: 'two', type: 'doc', data: 'same', parentId: 'hidden', index: 'a0' },
    ];
    const input = {
      workspaceId: 'w',
      sourceRevision: 'v',
      rows,
      resources: [
        {
          kind: 'doc' as const,
          resourceId: 'same',
          primaryMode: 'page' as const,
          trashed: false,
        },
      ],
      policies: [],
    };
    const equivalent = planWorkspacePageTree(input);
    t.deepEqual(equivalent.conflicts, []);
    t.is(
      equivalent.nodes.find(node => node.resource.resourceId === 'same')
        ?.parentNodeId,
      'hidden'
    );
    const conflict = planWorkspacePageTree({
      ...input,
      policies: [
        {
          directoryId: 'hidden',
          principalId: 'another-user',
          canRead: false,
          canWrite: false,
          canOrganize: false,
          canCreateFolder: false,
        },
      ],
    });
    t.true(
      conflict.conflicts.some(
        item => item.code === 'non_equivalent_permissions'
      )
    );
  }
);

test.serial(
  'real migration and page creation retain one authoritative Yjs tree with durable replay',
  async t => {
    const { actor, service, db } = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    await organization.applyDataOperations(
      actor.workspaceId,
      actor.actorId,
      actor.actorId,
      'folders',
      [
        {
          op: 'upsert',
          key: 'legacy',
          values: {
            type: 'folder',
            data: '旧目录',
            parentId: null,
            index: 'a0',
            defaultSortMode: 'name-desc',
          },
        },
      ]
    );
    const before = await service.preflight(actor);
    t.deepEqual(before.conflicts, []);
    await service.migrate(actor, before.fingerprint);
    const tree = await service.list(actor, null);
    t.true(tree.enabled);
    t.is(tree.items.length, 1);
    t.is(tree.items[0].title, '旧目录');
    t.is(tree.items[0].nodeId, 'legacy');
    const request = {
      action: 'create' as const,
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
      requestKey: 'create-child',
      parentNodeId: 'legacy',
      title: '子页面',
      primaryMode: 'page' as const,
    };
    const receipt = await service.execute(actor, request);
    t.deepEqual(await service.execute(actor, request), receipt);
    const children = await service.list(actor, 'legacy');
    t.is(children.items.length, 1);
    t.is(children.items[0].title, '子页面');
    t.is((await service.list(actor, null)).items.length, 1);
    t.is(await db.workspacePageTreeOperation.count(), 1);
    await t.throwsAsync(
      service.execute(actor, { ...request, title: '不同参数' })
    );
    await t.throwsAsync(
      service.execute(actor, { ...request, requestKey: 'stale-create' })
    );
    await t.throwsAsync(
      db.workspacePageTreeOperation.update({
        where: { id: receipt.id },
        data: { result: {} },
      })
    );
  }
);

test.serial(
  'stale migration plans and cross-workspace graph targets are rejected without partial creation',
  async t => {
    const { actor, service, db } = await fixture();
    const plan = await service.preflight(actor);
    await t.throwsAsync(service.migrate(actor, 'wrong-fingerprint'));
    t.is(await db.workspacePageTreeState.count(), 0);
    await service.migrate(actor, plan.fingerprint);
    const tree = await service.list(actor, null);
    await t.throwsAsync(
      service.execute(actor, {
        action: 'create',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
        requestKey: 'foreign',
        parentNodeId: 'other-workspace-node',
        title: 'Rejected',
        primaryMode: 'page',
      })
    );
    t.is((await service.list(actor, null)).items.length, 0);
    t.is(await db.workspacePageTreeOperation.count(), 0);
  }
);

test.serial(
  'subtree Trash preserves earlier independent claims and restore preserves content update evidence',
  async t => {
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    const create = async (title: string, parentNodeId: string | null) => {
      const tree = await service.list(actor, null);
      const receipt = await service.execute(actor, {
        action: 'create',
        title,
        parentNodeId,
        primaryMode: 'page',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
        requestKey: `create-${title}`,
      });
      return (receipt.result as { nodeId: string }).nodeId;
    };
    const parent = await create('parent', null),
      independent = await create('independent', parent),
      child = await create('child', parent);
    const change = async (
      action: 'trash' | 'restore' | 'delete',
      nodeId: string
    ) => {
      const tree = await service.list(actor, null);
      return service.execute(actor, {
        action,
        nodeId,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
        requestKey: `${action}-${nodeId}`,
      });
    };
    await change('trash', independent);
    await change('trash', parent);
    t.is((await service.list(actor, null)).items.length, 0);
    await change('restore', parent);
    t.deepEqual(
      (await service.list(actor, parent)).items.map(node => node.nodeId),
      [child]
    );
    await change('restore', independent);
    t.is((await service.list(actor, parent)).items.length, 2);
  }
);

test.serial(
  'raw folder, root lifecycle and persistent leaf-mode writes cannot bypass the new protocol',
  async t => {
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    const tree = await service.list(actor, null);
    const receipt = await service.execute(actor, {
      action: 'create',
      title: 'Parent',
      parentNodeId: null,
      primaryMode: 'page',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
      requestKey: 'parent',
    });
    const parent = receipt.result as {
      nodeId: string;
      resource: { resourceId: string };
    };
    const current = await service.list(actor, null);
    await service.execute(actor, {
      action: 'create',
      title: 'Child',
      parentNodeId: parent.nodeId,
      primaryMode: 'page',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: current.revision,
      expectedAuthorizationRevision: current.authorizationRevision,
      requestKey: 'child',
    });
    const legacy = new Y.Doc();
    const row = legacy.getMap('illegal');
    row.set('id', 'illegal');
    row.set('type', 'folder');
    row.set('data', 'Legacy');
    row.set('index', 'a0');
    row.set('parentId', null);
    await t.throwsAsync(
      app
        .get(DocWriter)
        .pushDocUpdate(
          actor.workspaceId,
          `db$${actor.workspaceId}$folders`,
          Y.encodeStateAsUpdate(legacy),
          actor.actorId
        )
    );
    legacy.destroy();
    await t.throwsAsync(
      app.get(WorkspaceOrganizationService).setDocumentTrashed({
        workspaceId: actor.workspaceId,
        editorId: actor.actorId,
        documentId: parent.resource.resourceId,
        expectedTitle: 'Parent',
        trashed: true,
      })
    );
    await t.throwsAsync(
      app
        .get(WorkspaceOrganizationService)
        .applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'document_properties',
          [
            {
              op: 'upsert',
              key: parent.resource.resourceId,
              values: { primaryMode: 'edgeless' },
            },
          ]
        )
    );
    t.is((await service.list(actor, parent.nodeId)).items.length, 1);
  }
);

test.serial(
  'native TXT creation commits content, a typed page target and its receipt together',
  async t => {
    const { actor, service, db } = await fixture();
    const { WorkspaceNativeResourceService } =
      await import('../../core/office/workspace-resource-service');
    const native = app.get(WorkspaceNativeResourceService);
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    let tree = await service.list(actor, null);
    const created = await service.execute(actor, {
      action: 'create',
      title: 'Container',
      primaryMode: 'page',
      parentNodeId: null,
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
      requestKey: 'parent',
    });
    const parent = (created.result as { nodeId: string }).nodeId;
    tree = await service.list(actor, null);
    const request = {
      ...actor,
      title: 'Notes',
      content: { format: 'txt' as const, text: 'Native content' },
      requestKey: 'file',
      parentNodeId: parent,
      treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedTreeRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    };
    const file = await native.create(request);
    t.is((await native.create(request)).id, file.id);
    t.is(await db.workspaceFile.count(), 1);
    const children = await service.list(actor, parent);
    t.is(children.items.length, 1);
    t.is(children.items[0].resource.kind, 'file');
    t.is(children.items[0].resource.resourceId, file.id);
    t.is(
      (await native.get({ ...actor, kind: 'file', resourceId: file.id }))
        .atRoot,
      false
    );
    await t.throwsAsync(
      native.create({
        ...actor,
        title: 'Legacy',
        content: { format: 'txt', text: 'rejected' },
        requestKey: 'legacy-create',
      })
    );
    t.is(await db.workspaceFile.count(), 1);
  }
);

test.serial(
  'generated GraphQL query resolves the same typed parent and ancestors as the tree',
  async t => {
    const { workspacePageTreeQuery, mutateWorkspacePageTreeMutation } =
      await import('@affine/graphql');
    const { actor, owner, service } = await fixture();
    await app.login(owner);
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    const tree = await service.list(actor, null);
    const created = await service.execute(actor, {
      action: 'create',
      title: 'GraphQL page',
      parentNodeId: null,
      primaryMode: 'page',
      requestKey: 'graphql',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    const { resource } = created.result as { resource: { resourceId: string } };
    const result = await app.gql({
      query: workspacePageTreeQuery,
      variables: {
        workspaceId: actor.workspaceId,
        clientContract: WORKSPACE_PAGE_TREE_CONTRACT,
        resourceKind: 'doc',
        resourceId: resource.resourceId,
      },
    });
    t.is(result.workspacePageTree.parent?.title, 'GraphQL page');
    t.deepEqual(result.workspacePageTree.ancestors, []);
    const fresh = await service.list(actor, null);
    const mutation = await app.gql({
      query: mutateWorkspacePageTreeMutation,
      variables: {
        input: {
          workspaceId: actor.workspaceId,
          action: 'create',
          title: 'GraphQL child',
          parentNodeId: result.workspacePageTree.parent?.nodeId,
          primaryMode: 'page',
          contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
          expectedRevision: fresh.revision,
          expectedAuthorizationRevision: fresh.authorizationRevision,
          requestKey: 'graphql-child',
        },
      },
    });
    t.is(
      mutation.mutateWorkspacePageTree.parentNodeId,
      result.workspacePageTree.parent?.nodeId ?? null
    );
  }
);

test.serial(
  'authority changes invalidate pagination and versioned commands even without directory policy changes',
  async t => {
    const { DocRole } = await import('../../models');
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    for (const title of ['A', 'B']) {
      const tree = await service.list(actor, null);
      await service.execute(actor, {
        action: 'create',
        title,
        primaryMode: 'page',
        parentNodeId: null,
        requestKey: title,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
      });
    }
    const page = await service.list(actor, null, undefined, 1);
    t.truthy(page.nextCursor);
    await app.models.docAccessPolicy.upsert(
      actor.workspaceId,
      page.items[0].resource.resourceId,
      { defaultRole: DocRole.Reader }
    );
    await t.throwsAsync(service.list(actor, null, page.nextCursor!, 1));
    await t.throwsAsync(
      service.execute(actor, {
        action: 'trash',
        nodeId: page.items[0].nodeId,
        requestKey: 'stale-permission',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: page.revision,
        expectedAuthorizationRevision: page.authorizationRevision,
      })
    );
    t.is((await service.list(actor, null)).items.length, 2);
  }
);

test.serial(
  'concurrent opposite moves serialize and reject the stale command; undo never overwrites a later revision',
  async t => {
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    for (const title of ['A', 'B']) {
      const tree = await service.list(actor, null);
      await service.execute(actor, {
        action: 'create',
        title,
        primaryMode: 'page',
        parentNodeId: null,
        requestKey: title,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
      });
    }
    const tree = await service.list(actor, null),
      [a, b] = tree.items;
    const base = {
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    };
    const results = await Promise.allSettled([
      service.execute(actor, {
        ...base,
        action: 'move',
        nodeId: a.nodeId,
        parentNodeId: b.nodeId,
        requestKey: 'a-to-b',
      }),
      service.execute(actor, {
        ...base,
        action: 'move',
        nodeId: b.nodeId,
        parentNodeId: a.nodeId,
        requestKey: 'b-to-a',
      }),
    ]);
    t.is(results.filter(result => result.status === 'fulfilled').length, 1);
    const after = await service.list(actor, null);
    t.is(after.items.length, 1);
    await t.throwsAsync(
      service.execute(actor, {
        ...base,
        action: 'move',
        nodeId: a.nodeId,
        parentNodeId: null,
        requestKey: 'stale-undo',
      })
    );
    t.is((await service.list(actor, null)).revision, after.revision);
  }
);

test.serial(
  'native legacy lifecycle is retired; subtree restore preserves immutable file content and visible update evidence',
  async t => {
    const { actor, service, db } = await fixture();
    const { WorkspaceNativeResourceService } =
      await import('../../core/office/workspace-resource-service');
    const native = app.get(WorkspaceNativeResourceService);
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    const tree = await service.list(actor, null);
    const file = await native.create({
      ...actor,
      title: 'Keep evidence',
      content: { format: 'txt', text: 'unchanged' },
      requestKey: 'evidence',
      parentNodeId: null,
      treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedTreeRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    const identity = { ...actor, kind: 'file' as const, resourceId: file.id };
    const before = await db.workspaceFile.findUniqueOrThrow({
      where: { id: file.id },
      include: { state: true },
    });
    await t.throwsAsync(
      native.change({
        ...identity,
        action: 'trash',
        expectedVersion: file.metadataVersion,
        requestKey: 'old-trash',
      })
    );
    const page = await service.list(actor, null),
      nodeId = page.items[0].nodeId;
    for (const action of ['trash', 'restore'] as const) {
      const current = await service.list(actor, null);
      await service.execute(actor, {
        action,
        nodeId,
        requestKey: action,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: current.revision,
        expectedAuthorizationRevision: current.authorizationRevision,
      });
    }
    const after = await db.workspaceFile.findUniqueOrThrow({
      where: { id: file.id },
      include: { state: true },
    });
    t.is(after.blobKey, before.blobKey);
    t.is(after.fingerprint, before.fingerprint);
    t.deepEqual(after.state?.lastUpdatedAt, before.state?.lastUpdatedAt);
    t.is(after.state?.lastUpdatedBy, before.state?.lastUpdatedBy);
    t.is(after.state?.lastUpdateEvent, before.state?.lastUpdateEvent);
    t.is(after.state?.trashedAt, null);
  }
);

test.serial(
  'migration checkpoints survive worker replacement and an expired lease cannot write',
  async t => {
    const { actor, service, db } = await fixture();
    await app.get(WorkspaceOrganizationService).applyDataOperations(
      actor.workspaceId,
      actor.actorId,
      actor.actorId,
      'folders',
      ['A', 'B', 'C'].map((name, index) => ({
        op: 'upsert' as const,
        key: name,
        values: {
          type: 'folder',
          data: name,
          index: `a${index}`,
          parentId: null,
        },
      }))
    );
    const plan = await service.preflight(actor);
    const frozen = await service.prepareMigration(actor, plan.fingerprint);
    t.is(frozen?.phase, 'frozen');
    const firstLease = await app.models.workspacePageTree.claim(
      actor.workspaceId,
      frozen!.planId!
    );
    t.deepEqual(await service.migrationBatch(actor, firstLease, 1), {
      done: false,
      checkpoint: 1,
    });
    t.is(await db.workspacePageTreeTypedMapping.count(), 1);
    await t.throwsAsync(service.list(actor, null), {
      message: 'page_tree_migration_incomplete',
    });
    await db.workspacePageTreeState.update({
      where: { workspaceId: actor.workspaceId },
      data: { leaseExpiresAt: new Date(0) },
    });
    const replacementLease = await app.models.workspacePageTree.claim(
      actor.workspaceId,
      frozen!.planId!
    );
    await t.throwsAsync(service.migrationBatch(actor, firstLease, 1));
    t.is(
      (await app.models.workspacePageTree.state(actor.workspaceId))?.checkpoint,
      1
    );
    const cancelled = await service.cancelMigration(actor);
    t.is(cancelled?.errorCode, 'cancelled');
    t.is(cancelled?.checkpoint, 1);
    await t.throwsAsync(service.migrationBatch(actor, replacementLease, 1));
    const resumedLease = await app.models.workspacePageTree.claim(
      actor.workspaceId,
      frozen!.planId!
    );
    while (!(await service.migrationBatch(actor, resumedLease, 1)).done) {
      /* Commit the next bounded batch. */
    }
    const tree = await service.list(actor, null);
    t.deepEqual(
      tree.items.map(node => node.title),
      ['A', 'B', 'C']
    );
    t.is(await db.workspacePageTreeTypedMapping.count(), 3);
    await t.throwsAsync(service.migrationBatch(actor, replacementLease));
  }
);

test.serial(
  'subpage creation atomically binds its explicit entry; invalid insertion rolls back without another resource',
  async t => {
    const { PgWorkspaceDocStorageAdapter } =
      await import('../../core/doc/adapters/workspace');
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    let tree = await service.list(actor, null);
    const parentReceipt = await service.execute(actor, {
      action: 'create',
      title: 'Body parent',
      primaryMode: 'page',
      parentNodeId: null,
      requestKey: 'body-parent',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    const parent = parentReceipt.result as {
      nodeId: string;
      resource: { resourceId: string };
    };
    await app
      .get(DocWriter)
      .updateDoc(
        actor.workspaceId,
        parent.resource.resourceId,
        'Insert a child below this paragraph.',
        actor.actorId
      );
    const storage = app.get(PgWorkspaceDocStorageAdapter);
    const document = new Y.Doc();
    Y.applyUpdate(
      document,
      (await storage.getDocReadOnly(
        actor.workspaceId,
        parent.resource.resourceId
      ))!.bin
    );
    const blocks = document.getMap<Y.Map<unknown>>('blocks');
    const paragraph = [...blocks.values()].find(
      block => block.get('sys:flavour') === 'affine:paragraph'
    );
    t.truthy(paragraph);
    const insertion = String(paragraph!.get('sys:id'));
    document.destroy();
    tree = await service.list(actor, null);
    const command = {
      action: 'create' as const,
      title: 'Real child',
      primaryMode: 'page' as const,
      parentNodeId: parent.nodeId,
      requestKey: 'body-child',
      insertAfterBlockId: insertion,
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    };
    const receipt = await service.execute(actor, command);
    t.is((await service.execute(actor, command)).id, receipt.id);
    const body = new Y.Doc();
    Y.applyUpdate(
      body,
      (await storage.getDocReadOnly(
        actor.workspaceId,
        parent.resource.resourceId
      ))!.bin
    );
    const entries = [...body.getMap<Y.Map<unknown>>('blocks').values()].filter(
      block => block.get('sys:flavour') === 'localmind:subpage'
    );
    t.is(entries.length, 1);
    const { parseDocToMarkdownFromDocSnapshot, readAllBlocksFromDocSnapshot } =
      await import('../../core/utils/blocksuite');
    const canonical = Y.encodeStateAsUpdate(body);
    const exported = parseDocToMarkdownFromDocSnapshot(
      actor.workspaceId,
      parent.resource.resourceId,
      canonical
    );
    t.deepEqual(exported.unknownBlocks, []);
    const references = await readAllBlocksFromDocSnapshot(
      parent.resource.resourceId,
      canonical
    );
    t.true(
      references.blocks.some(block =>
        block.refDocId?.includes(String(entries[0].get('prop:resourceId')))
      )
    );
    t.is(
      body
        .getMap<Y.Map<unknown>>('blocks')
        .get(String(entries[0].get('sys:id')))
        ?.get('sys:flavour'),
      'localmind:subpage'
    );

    t.is(
      entries[0].get('prop:resourceId'),
      (receipt.result as { resource: { resourceId: string } }).resource
        .resourceId
    );
    body.destroy();
    const children = await service.list(actor, parent.nodeId);
    t.is(children.items.length, 1);
    tree = await service.list(actor, null);
    await t.throwsAsync(
      service.execute(actor, {
        ...command,
        requestKey: 'invalid-insertion',
        insertAfterBlockId: 'absent',
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
      })
    );
    t.is((await service.list(actor, parent.nodeId)).items.length, 1);
    t.is((await service.list(actor, null)).revision, tree.revision);
  }
);

test.serial(
  'legacy folder recycle manifests migrate without reviving independently deleted descendants',
  async t => {
    const { actor, service } = await fixture();
    const writer = app.get(DocWriter),
      organization = app.get(WorkspaceOrganizationService);
    const regular = await writer.createDoc(
      actor.workspaceId,
      'Regular',
      'Keep content',
      actor.actorId
    );
    const independent = await writer.createDoc(
      actor.workspaceId,
      'Independent',
      'Already in Trash',
      actor.actorId
    );
    await organization.applyDataOperations(
      actor.workspaceId,
      actor.actorId,
      actor.actorId,
      'folders',
      [
        {
          op: 'upsert',
          key: 'old-parent',
          values: {
            type: 'folder',
            data: 'Recycled folder',
            parentId: null,
            index: 'a0',
          },
        },
        {
          op: 'upsert',
          key: 'normal-placement',
          values: {
            type: 'doc',
            data: regular.docId,
            parentId: 'old-parent',
            index: 'a0',
          },
        },
        {
          op: 'upsert',
          key: 'independent-placement',
          values: {
            type: 'doc',
            data: independent.docId,
            parentId: 'old-parent',
            index: 'a1',
          },
        },
      ]
    );
    await organization.setDocumentTrashed({
      workspaceId: actor.workspaceId,
      editorId: actor.actorId,
      documentId: independent.docId,
      expectedTitle: 'Independent',
      trashed: true,
    });
    await organization.trashFolderTree({
      workspaceId: actor.workspaceId,
      userId: actor.actorId,
      editorId: actor.actorId,
      folderId: 'old-parent',
      expectedName: 'Recycled folder',
      recursive: true,
      authorizeDocument: async () => {},
    });
    const plan = await service.preflight(actor);
    t.deepEqual(plan.conflicts, []);
    t.is(
      plan.nodes.find(node => node.resource.resourceId === regular.docId)
        ?.trashRootNodeId,
      'old-parent'
    );
    t.is(
      plan.nodes.find(node => node.resource.resourceId === independent.docId)
        ?.trashRootNodeId,
      `tree:doc:${independent.docId}`
    );
    await service.migrate(actor, plan.fingerprint);
    const tree = await service.list(actor, null);
    t.is(tree.items.length, 0);
    await service.execute(actor, {
      action: 'restore',
      nodeId: 'old-parent',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
      requestKey: 'restore-migrated',
    });
    t.deepEqual(
      (await service.list(actor, 'old-parent')).items.map(
        item => item.resource.resourceId
      ),
      [regular.docId]
    );
    t.is(
      (await service.list(actor, null, undefined, 100, { trash: true })).items
        .length,
      1
    );
  }
);

test.serial(
  'import identity is allocated once and cannot overwrite or revive a resource',
  async t => {
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    const version = async () => {
      const page = await service.list(actor, null);
      return {
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: page.revision,
        expectedAuthorizationRevision: page.authorizationRevision,
      };
    };
    const command = {
      ...(await version()),
      action: 'create' as const,
      title: 'Imported',
      primaryMode: 'page' as const,
      parentNodeId: null,
      resourceId: 'imported-identity',
      requestKey: 'import-1',
    };
    const receipt = await service.execute(actor, command);
    t.deepEqual(await service.execute(actor, command), receipt);
    await t.throwsAsync(
      service.execute(actor, {
        ...command,
        ...(await version()),
        requestKey: 'different-import',
      }),
      { message: 'Document identity already exists' }
    );
    for (const resourceId of [
      actor.workspaceId,
      'db$folders',
      'userdata$actor$settings',
    ])
      await t.throwsAsync(
        service.execute(actor, {
          ...command,
          ...(await version()),
          requestKey: resourceId,
          resourceId,
        })
      );
    for (const action of ['trash', 'delete'] as const)
      await service.execute(actor, {
        ...(await version()),
        action,
        nodeId: 'tree:doc:imported-identity',
        requestKey: action,
      });
    await t.throwsAsync(
      service.execute(actor, {
        ...command,
        ...(await version()),
        requestKey: 'revive-import',
      }),
      { message: 'Document identity already exists' }
    );
    t.is((await service.list(actor, null)).items.length, 0);
  }
);

test.serial(
  'local upload negotiates a complete graph, rejects missing resources and replays the same switched plan',
  async t => {
    const { actor, service } = await fixture();
    const writer = app.get(DocWriter);
    const parent = await writer.createDoc(
      actor.workspaceId,
      'Uploaded page',
      'body',
      actor.actorId
    );
    const child = await writer.createDoc(
      actor.workspaceId,
      'Uploaded child',
      'child body',
      actor.actorId
    );
    const positions = [
      {
        kind: 'doc' as const,
        trashed: false,
        nodeId: 'local-parent',
        resourceId: parent.docId,
        parentNodeId: null,
        order: 'a0',
      },
      {
        kind: 'doc' as const,
        trashed: false,
        nodeId: 'local-child',
        resourceId: child.docId,
        parentNodeId: 'local-parent',
        order: 'a0',
      },
    ];
    await t.throwsAsync(service.adoptLocalTree(actor, positions.slice(0, 1)));
    t.falsy(await app.models.workspacePageTree.state(actor.workspaceId));
    const outsider = await app.createUser();
    await t.throwsAsync(
      service.adoptLocalTree({ ...actor, actorId: outsider.id }, positions)
    );
    const result = await service.adoptLocalTree(actor, positions);
    t.is(result?.phase, 'switched');
    t.is(
      (await service.list(actor, 'local-parent')).items[0].resource.resourceId,
      child.docId
    );
    t.deepEqual(await service.adoptLocalTree(actor, positions), result);
    await t.throwsAsync(
      service.adoptLocalTree(
        actor,
        positions.map(node => ({ ...node, parentNodeId: null }))
      )
    );
  }
);

test.serial(
  'native copy uses a versioned page target, replays once and preserves the source',
  async t => {
    const { WorkspaceNativeResourceService } =
      await import('../../core/office/workspace-resource-service');
    const { actor, service } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    let tree = await service.list(actor, null);
    const native = app.get(WorkspaceNativeResourceService);
    const file = await native.create({
      ...actor,
      title: 'source',
      content: { format: 'txt', text: 'original payload' },
      requestKey: 'copy-source',
      parentNodeId: null,
      treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedTreeRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    tree = await service.list(actor, null);
    const identity = { ...actor, kind: 'file' as const, resourceId: file.id };
    await t.throwsAsync(
      native.copy({
        ...identity,
        title: 'legacy',
        expectedContentVersion: file.contentVersion,
        requestKey: 'old-copy',
      })
    );
    const input = {
      ...identity,
      title: 'copy',
      expectedContentVersion: file.contentVersion,
      requestKey: 'tree-copy',
      parentNodeId: null,
      treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedTreeRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    };
    const copy = await native.copy(input);
    t.not(copy.id, file.id);
    t.is((await native.copy(input)).id, copy.id);
    t.is((await service.list(actor, null)).items.length, 2);
    t.is(
      (await native.readText({ ...identity, resourceId: copy.id })).text,
      'original payload'
    );
    t.is((await native.get(identity)).contentVersion, file.contentVersion);
    await t.throwsAsync(native.copy({ ...input, requestKey: 'stale-copy' }));
  }
);

test.serial(
  'Workspace AI uses durable tree receipts, excludes frozen tasks and checks live session scope and destructive intent',
  async t => {
    const { createWorkspacePageTreeTools } =
      await import('../../plugins/copilot/tools/workspace-page-tree');
    const { WorkspaceNativeResourceService } =
      await import('../../core/office/workspace-resource-service');
    const { actor, service, db } = await fixture();
    const plan = await service.preflight(actor);
    await service.migrate(actor, plan.fingerprint);
    await db.aiPrompt.create({ data: { name: 'tree-tools', model: 'test' } });
    const session = await db.aiSession.create({
      data: {
        userId: actor.actorId,
        workspaceId: actor.workspaceId,
        scopeType: 'workspace',
        promptName: 'tree-tools',
        promptAction: '',
      },
    });
    const options: Parameters<typeof createWorkspacePageTreeTools>[3] = {
      user: actor.actorId,
      workspace: actor.workspaceId,
      session: session.id,
      tools: ['docCreate', 'docUpdateMeta', 'workspaceOrganization'],
    };
    const tools = createWorkspacePageTreeTools(
      app.models,
      service,
      app.get(WorkspaceNativeResourceService),
      options,
      true
    );
    t.deepEqual(
      createWorkspacePageTreeTools(
        app.models,
        service,
        undefined,
        { ...options, taskId: 'old-frozen' },
        true
      ),
      {}
    );
    t.falsy(
      createWorkspacePageTreeTools(
        app.models,
        service,
        undefined,
        options,
        false
      ).workspace_page_tree_create
    );
    const run = async (
      name: string,
      args: Record<string, unknown>,
      id: string,
      content = '整理页面'
    ) =>
      tools[name].execute!(args, {
        toolCallId: id,
        messages: [{ role: 'user', content }],
      });
    const versions = async () => {
      const page = await service.list(actor, null);
      return {
        contract_version: WORKSPACE_PAGE_TREE_CONTRACT,
        expected_revision: page.revision,
        expected_authorization_revision: page.authorizationRevision,
      };
    };
    const args = {
      ...(await versions()),
      title: 'AI page',
      parent_node_id: null,
      primary_mode: 'page',
    };
    const created = await run('workspace_page_tree_create', args, 'create');
    t.deepEqual(
      await run('workspace_page_tree_create', args, 'create'),
      created
    );
    const node = (await service.list(actor, null)).items[0];
    t.is(
      await db.workspacePageTreeOperation.count({
        where: { workspaceId: actor.workspaceId },
      }),
      1
    );
    await t.throwsAsync(
      run(
        'workspace_page_tree_move',
        {
          ...(await versions()),
          node_id: node.nodeId,
          parent_node_id: node.nodeId,
        },
        'cycle'
      )
    );
    await run(
      'workspace_page_tree_file_create',
      {
        ...(await versions()),
        title: 'AI text',
        content: { format: 'txt', text: 'Retain content' },
        parent_node_id: node.nodeId,
      },
      'file-create'
    );
    const nativeNode = (await service.list(actor, node.nodeId)).items[0];
    const native = app.get(WorkspaceNativeResourceService);
    const nativeBefore = await native.read({
      ...actor,
      kind: 'file',
      resourceId: nativeNode.resource.resourceId,
    });
    const metadata = await app.models.workspaceNativeResource.get({
      ...actor,
      kind: 'file',
      resourceId: nativeNode.resource.resourceId,
    });
    const rename = {
      resource_id: nativeNode.resource.resourceId,
      kind: 'file',
      expected_version: metadata.metadataVersion,
      title: 'Renamed by AI',
    };
    const renamed = await run(
      'workspace_page_tree_resource_rename',
      rename,
      'rename'
    );
    t.deepEqual(
      await run('workspace_page_tree_resource_rename', rename, 'rename'),
      renamed
    );
    await t.throwsAsync(
      run(
        'workspace_page_tree_resource_rename',
        { ...rename, title: 'Stale rename' },
        'stale-rename'
      )
    );
    t.deepEqual(
      (
        await native.read({
          ...actor,
          kind: 'file',
          resourceId: nativeNode.resource.resourceId,
        })
      ).bytes,
      nativeBefore.bytes
    );
    t.is(
      (await service.list(actor, node.nodeId)).items[0].title,
      'Renamed by AI'
    );
    await run(
      'workspace_page_tree_lifecycle',
      { ...(await versions()), node_id: node.nodeId, action: 'trash' },
      'trash'
    );
    const deletion = {
      ...(await versions()),
      node_id: node.nodeId,
      action: 'delete',
      confirm_permanent_deletion: true,
    };
    await t.throwsAsync(
      run('workspace_page_tree_lifecycle', deletion, 'delete'),
      { message: /explicit user request/ }
    );
    await run(
      'workspace_page_tree_lifecycle',
      deletion,
      'delete',
      '永久删除回收站中的这个页面'
    );
    t.is(
      (await service.list(actor, null, undefined, 100, { trash: true })).items
        .length,
      0
    );
    await run(
      'workspace_folder_create',
      { ...(await versions()), title: 'AI folder', parent_node_id: null },
      'folder-create'
    );
    const folderNode = (await service.list(actor, null)).items[0];
    await run(
      'workspace_folder_rename',
      {
        ...(await versions()),
        node_id: folderNode.nodeId,
        expected_resource_version: 1,
        title: 'AI renamed folder',
      },
      'folder-rename'
    );
    const conversion = {
      ...(await versions()),
      node_id: folderNode.nodeId,
      expected_resource_version: 2,
      target_kind: 'doc',
      confirm_conversion: true,
    };
    await t.throwsAsync(
      run('workspace_container_convert', conversion, 'convert-no-intent')
    );
    await t.throwsAsync(
      run(
        'workspace_container_convert',
        conversion,
        'convert-negative',
        '不要把这个文件夹转换为页面'
      )
    );
    const converted = await run(
      'workspace_container_convert',
      conversion,
      'convert-folder',
      '请把这个文件夹转换为页面'
    );
    t.deepEqual(
      await run(
        'workspace_container_convert',
        conversion,
        'convert-folder',
        '请把这个文件夹转换为页面'
      ),
      converted
    );
    t.is(
      (await service.list(actor, folderNode.nodeId)).parent?.resource.kind,
      'doc'
    );
    await db.aiSession.update({
      where: { id: session.id },
      data: { deletedAt: new Date() },
    });
    await t.throwsAsync(
      run(
        'workspace_page_tree_list',
        { parent_node_id: null, trash: false },
        'read'
      ),
      { message: /authorization changed/ }
    );
  }
);

test.serial(
  'lifecycle preview is bounded, hides unauthorized subtrees and pins confirmation before late children',
  async t => {
    const { actor, service } = await fixture();
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    const create = async (title: string, parentNodeId: string | null) => {
      const page = await service.list(actor, null);
      const receipt = await service.execute(actor, {
        action: 'create',
        title,
        primaryMode: 'page',
        parentNodeId,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: page.revision,
        expectedAuthorizationRevision: page.authorizationRevision,
        requestKey: title,
      });
      return (receipt.result as { nodeId: string }).nodeId;
    };
    const parent = await create('Parent', null);
    const children = [];
    for (let index = 0; index < 21; index++)
      children.push(await create(`Child ${index}`, parent));
    const preview = await service.lifecyclePreview(actor, parent, 'trash');
    t.is(preview.total, 22);
    t.is(preview.items.length, 20);
    t.true(preview.truncated);
    await create('Late child', parent);
    await t.throwsAsync(
      service.execute(actor, {
        action: 'trash',
        nodeId: parent,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: preview.revision,
        expectedAuthorizationRevision: preview.authorizationRevision,
        requestKey: 'old-confirmation',
      }),
      { message: /changed/ }
    );
    t.is((await service.list(actor, parent)).items.length, 22);
    await app.models.workspaceDirectoryGrant.set({
      ...actor,
      directoryId: children[0],
      principalId: actor.actorId,
      rights: {
        canRead: false,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    const error = await t.throwsAsync(
      service.lifecyclePreview(actor, parent, 'trash')
    );
    t.false(error!.message.includes('Child'));
    t.false(error!.message.includes('23'));
  }
);

test.serial(
  'root, folder and page targets create every supported native format and restore a mixed subtree without changing revision chains',
  async t => {
    const { actor, service, db } = await fixture();
    const { WorkspaceNativeResourceService } =
      await import('../../core/office/workspace-resource-service');
    const { OfficeResourceStorage } =
      await import('../../core/office/resource-storage');
    const { createMinimalPdfFixture } =
      await import('@localmind/office/testing');
    const native = app.get(WorkspaceNativeResourceService);
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    let page = await service.list(actor, null);
    const receipt = await service.execute(actor, {
      action: 'create',
      title: 'Mixed parent',
      primaryMode: 'page',
      parentNodeId: null,
      requestKey: 'mixed-parent',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: page.revision,
      expectedAuthorizationRevision: page.authorizationRevision,
    });
    const parent = (receipt.result as { nodeId: string }).nodeId;
    page = await service.list(actor, null);
    const folder = await service.execute(actor, {
      action: 'create-folder',
      title: 'Native folder',
      parentNodeId: parent,
      requestKey: 'native-folder',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: page.revision,
      expectedAuthorizationRevision: page.authorizationRevision,
    });
    const folderNodeId = (folder.result as { nodeId: string }).nodeId;
    const content: Parameters<
      InstanceType<typeof WorkspaceNativeResourceService>['create']
    >[0]['content'][] = [
      { format: 'docx', paragraphs: [{ text: 'Keep document content' }] },
      { format: 'xlsx', sheets: [{ name: 'Sheet', rows: [['A', 12]] }] },
      {
        format: 'pptx',
        slides: [{ title: 'Slide', paragraphs: ['Keep slide content'] }],
      },
      { format: 'txt', text: 'Keep text content' },
      { format: 'md', text: '# Keep Markdown' },
      { format: 'json', text: '{"keep":true}' },
      {
        format: 'csv',
        rows: [
          ['name', 'value'],
          ['keep', 12],
        ],
      },
    ];
    const pdfKey = await app
      .get(OfficeResourceStorage)
      .put(
        actor.workspaceId,
        actor.actorId,
        'fixture.pdf',
        Buffer.from(await createMinimalPdfFixture()),
        { contentType: 'application/pdf' }
      );
    for (const parentNodeId of [null, parent, folderNodeId]) {
      for (const [index, value] of [...content, undefined].entries()) {
        page = await service.list(actor, null);
        const created = await native.create({
          ...actor,
          title: value ? `format-${value.format}` : 'fixture.pdf',
          ...(value ? { content: value } : { blobKey: pdfKey }),
          requestKey: `mixed-${parentNodeId}-${index}`,
          parentNodeId,
          treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
          expectedTreeRevision: page.revision,
          expectedAuthorizationRevision: page.authorizationRevision,
        });
        const located = await service.list(actor, null, undefined, 100, {
          resource: { kind: created.kind, resourceId: created.id },
        });
        t.is(located.parent?.parentNodeId, parentNodeId);
        t.is(
          located.parent?.resource.kind,
          index < 3 || index === 7 ? 'office' : 'file'
        );
        t.is(
          (
            await native.get({
              ...actor,
              kind: created.kind,
              resourceId: created.id,
            })
          ).id,
          created.id
        );
      }
    }
    const beforeRevisions = await db.officeRevision.findMany({
      orderBy: { id: 'asc' },
    });
    const beforeFiles = await db.workspaceFile.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { revisions: true },
      orderBy: { id: 'asc' },
    });
    const preview = await service.lifecyclePreview(actor, parent, 'trash');
    t.is(preview.total, 18);
    t.true(preview.items.some(item => item.documentType === 'pdf'));
    for (const action of ['trash', 'restore'] as const) {
      page = await service.list(actor, null);
      await service.execute(actor, {
        action,
        nodeId: parent,
        requestKey: `mixed-${action}`,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: page.revision,
        expectedAuthorizationRevision: page.authorizationRevision,
      });
    }
    t.is((await service.list(actor, parent)).items.length, 9);
    t.is((await service.list(actor, folderNodeId)).items.length, 8);
    t.is((await service.list(actor, null)).items.length, 9);
    t.deepEqual(
      await db.officeRevision.findMany({ orderBy: { id: 'asc' } }),
      beforeRevisions
    );
    t.deepEqual(
      await db.workspaceFile.findMany({
        where: { workspaceId: actor.workspaceId },
        include: { revisions: true },
        orderBy: { id: 'asc' },
      }),
      beforeFiles
    );
  }
);

test.serial(
  'directory administration manages real pages and refuses leaf containers after migration',
  async t => {
    const { actor, owner, service } = await fixture();
    const { WorkspaceDirectoryResolver } =
      await import('../../core/doc/directory-resolver');
    const resolver = app.get(WorkspaceDirectoryResolver);
    const user = { ...owner, hasPassword: true, emailVerified: true };
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    const create = async (mode: 'page' | 'edgeless') => {
      const tree = await service.list(actor, null);
      const result = await service.execute(actor, {
        action: 'create',
        title: mode,
        primaryMode: mode,
        parentNodeId: null,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
        requestKey: mode,
      });
      return (result.result as { nodeId: string }).nodeId;
    };
    const page = await create('page'),
      board = await create('edgeless');
    const snapshot = await resolver.workspaceDirectoryAdministration(
      user,
      actor.workspaceId
    );
    t.deepEqual(
      snapshot.directories.map(directory => directory.id),
      ['$root', page]
    );
    const rights = {
      canRead: true,
      canWrite: false,
      canOrganize: false,
      canCreateFolder: false,
    };
    await t.throwsAsync(
      resolver.changeWorkspaceDirectoryPolicy(
        user,
        actor.workspaceId,
        snapshot.revision,
        board,
        '*',
        rights
      )
    );
    await resolver.changeWorkspaceDirectoryPolicy(
      user,
      actor.workspaceId,
      snapshot.revision,
      page,
      '*',
      rights
    );
    t.true(
      (
        await resolver.workspaceDirectoryAdministration(user, actor.workspaceId)
      ).policies.some(
        policy =>
          policy.directoryId === page && policy.rights.canWrite === false
      )
    );
  }
);

test.serial(
  'name-sorted siblings become one atomic manual order with complete undo and hidden-level rejection',
  async t => {
    const { actor, service } = await fixture();
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    const ids: string[] = [];
    const version = async (parentNodeId: string | null = null) => {
      const page = await service.list(actor, parentNodeId);
      return {
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: page.revision,
        expectedAuthorizationRevision: page.authorizationRevision,
      };
    };
    for (const title of ['B', 'A', 'C']) {
      const receipt = await service.execute(actor, {
        ...(await version()),
        action: 'create',
        primaryMode: 'page',
        title,
        parentNodeId: null,
        requestKey: title,
      });
      ids.push((receipt.result as { nodeId: string }).nodeId);
    }
    const before = await version();
    await t.throwsAsync(
      service.execute(actor, {
        ...before,
        action: 'move',
        nodeId: ids[0],
        parentNodeId: null,
        siblingOrder: [ids[0]],
        requestKey: 'partial',
      })
    );
    t.deepEqual(await version(), before);
    const receipt = await service.execute(actor, {
      ...before,
      action: 'move',
      nodeId: ids[2],
      parentNodeId: null,
      siblingOrder: [ids[1], ids[2], ids[0]],
      requestKey: 'order',
    });
    t.deepEqual(
      (await service.list(actor, null)).items.map(node => node.title),
      ['A', 'C', 'B']
    );
    const prior = (receipt.result as { oldSiblingOrder: string[] })
      .oldSiblingOrder;
    t.deepEqual(prior, ids);
    await service.execute(actor, {
      ...(await version()),
      action: 'move',
      nodeId: ids[2],
      parentNodeId: null,
      siblingOrder: prior,
      requestKey: 'undo-order',
    });
    t.deepEqual(
      (await service.list(actor, null)).items.map(node => node.title),
      ['B', 'A', 'C']
    );
  }
);

test.serial(
  'v2 folders have no content, support mixed nesting, metadata CAS, conversion replay and old identity resolution',
  async t => {
    const { actor, service, db } = await fixture();
    const { PgWorkspaceDocStorageAdapter } =
      await import('../../core/doc/adapters/workspace');
    const storage = app.get(PgWorkspaceDocStorageAdapter);
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    const command = async (
      value: Omit<
        import('../../core/doc/workspace-page-tree').PageTreeCommand,
        | 'contractVersion'
        | 'expectedRevision'
        | 'expectedAuthorizationRevision'
        | 'requestKey'
      > &
        Record<string, unknown>
    ) => {
      const tree = await service.list(actor, null);
      return service.execute(actor, {
        ...value,
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
        requestKey: crypto.randomUUID(),
      } as import('../../core/doc/workspace-page-tree').PageTreeCommand);
    };
    await command({
      action: 'create-folder',
      title: '  Folder  ',
      parentNodeId: null,
    });
    let folder = (await service.list(actor, null)).items[0];
    t.is(folder.title, 'Folder');
    t.is(folder.resource.kind, 'folder');
    t.is(folder.folder?.metadataVersion, 1);
    t.is(
      await storage.getDocReadOnly(
        actor.workspaceId,
        folder.resource.resourceId
      ),
      null
    );
    const before = folder.folder!;
    await command({
      action: 'create',
      title: 'Page',
      primaryMode: 'page',
      parentNodeId: folder.nodeId,
    });
    const child = (await service.list(actor, folder.nodeId)).items[0];
    await command({
      action: 'create-folder',
      title: 'Folder',
      parentNodeId: child.nodeId,
    });
    t.deepEqual((await service.list(actor, null)).items[0].folder, before);
    await command({
      action: 'rename-folder',
      nodeId: folder.nodeId,
      title: 'Renamed',
      expectedResourceVersion: 1,
    });
    await t.throwsAsync(
      command({
        action: 'rename-folder',
        nodeId: folder.nodeId,
        title: 'stale',
        expectedResourceVersion: 1,
      })
    );
    folder = (await service.list(actor, null)).items[0];
    t.deepEqual(
      [folder.folder?.createdAt, folder.folder?.createdBy],
      [before.createdAt, before.createdBy]
    );
    t.is(folder.folder?.metadataVersion, 2);
    const tree = await service.list(actor, null);
    const convert = {
      action: 'convert-folder' as const,
      nodeId: folder.nodeId,
      expectedResourceVersion: 2,
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
      requestKey: 'convert-folder',
    };
    const result = await service.execute(actor, convert);
    t.is((await service.execute(actor, convert)).id, result.id);
    t.is(await db.workspacePageTreeConversion.count(), 1);
    const converted = (await service.list(actor, folder.nodeId)).parent!;
    t.is(converted.resource.kind, 'doc');
    t.is(converted.nodeId, folder.nodeId);
    t.is(converted.order, folder.order);
    t.truthy(
      await storage.getDocReadOnly(
        actor.workspaceId,
        converted.resource.resourceId
      )
    );
    t.is(
      (await service.list(actor, folder.nodeId)).items[0].nodeId,
      child.nodeId
    );
    t.is(
      (
        await service.list(actor, null, undefined, 100, {
          resource: folder.resource,
        })
      ).parent?.nodeId,
      folder.nodeId
    );
    await t.throwsAsync(
      command({
        action: 'rename-folder',
        nodeId: folder.nodeId,
        expectedResourceVersion: 2,
        title: 'wrong type',
      })
    );
    await t.throwsAsync(
      command({
        action: 'move',
        nodeId: folder.nodeId,
        parentNodeId: child.nodeId,
      })
    );
    await t.throwsAsync(
      db.workspacePageTreeConversion.update({
        where: {
          id: (await db.workspacePageTreeConversion.findFirstOrThrow()).id,
        },
        data: { sourceVersion: 99 },
      })
    );
  }
);

test.serial(
  'v1 upgrade retains edited pages and immutable historical plans, and rejects v1 writers',
  async t => {
    const { actor, service, db } = await fixture();
    const { WORKSPACE_PAGE_TREE_V1_CONTRACT } = await import('@affine/graphql');
    // A persisted v1 graph is identical for native pages; preserve its node IDs and body.
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    let tree = await service.list(actor, null);
    await service.execute(actor, {
      action: 'create',
      title: 'Edited v1 page',
      primaryMode: 'page',
      parentNodeId: null,
      requestKey: 'original',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    const before = await service.list(actor, null);
    const oldPlan = await db.workspacePageTreePlan.findFirstOrThrow();
    await db.workspacePageTreeState.update({
      where: { workspaceId: actor.workspaceId },
      data: { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
    });
    const plan = await service.preflight(actor);
    t.is(plan.sourceContract, WORKSPACE_PAGE_TREE_V1_CONTRACT);
    await service.migrate(actor, plan.fingerprint);
    tree = await service.list(actor, null);
    t.deepEqual(tree.items, before.items);
    t.deepEqual(
      await db.workspacePageTreePlan.findUniqueOrThrow({
        where: { id: oldPlan.id },
      }),
      oldPlan
    );
    await t.throwsAsync(
      service.execute(actor, {
        action: 'create-folder',
        title: 'Old client',
        parentNodeId: null,
        requestKey: 'old',
        contractVersion:
          WORKSPACE_PAGE_TREE_V1_CONTRACT as typeof WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
      })
    );
  }
);

test.serial(
  'folder conversion rolls back content, ownership and evidence together on failure',
  async t => {
    const { actor, service, db } = await fixture();
    await service.migrate(actor, (await service.preflight(actor)).fingerprint);
    let tree = await service.list(actor, null);
    await service.execute(actor, {
      action: 'create-folder',
      title: 'Atomic',
      parentNodeId: null,
      requestKey: 'folder',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    tree = await service.list(actor, null);
    const before = tree.items[0];
    const writer = app.get(DocWriter);
    const original = writer.createDoc.bind(writer);
    writer.createDoc = async (...args) => {
      await original(...args);
      throw new Error('Injected failure after content creation');
    };
    try {
      await t.throwsAsync(
        service.execute(actor, {
          action: 'convert-folder',
          nodeId: before.nodeId,
          expectedResourceVersion: 1,
          requestKey: 'conversion',
          contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
          expectedRevision: tree.revision,
          expectedAuthorizationRevision: tree.authorizationRevision,
        }),
        { message: 'Injected failure after content creation' }
      );
    } finally {
      writer.createDoc = original;
    }
    t.deepEqual((await service.list(actor, null)).items[0], before);
    t.is(await db.workspacePageTreeConversion.count(), 0);
    t.is(
      await db.workspacePageTreeOperation.count({
        where: { requestKey: 'conversion' },
      }),
      0
    );
    const { PgWorkspaceDocStorageAdapter } =
      await import('../../core/doc/adapters/workspace');
    const root = new Y.Doc();
    Y.applyUpdate(
      root,
      (await app
        .get(PgWorkspaceDocStorageAdapter)
        .getDocReadOnly(actor.workspaceId, actor.workspaceId))!.bin
    );
    t.is((root.getMap('meta').get('pages') as Y.Array<unknown>).length, 0);
    root.destroy();
  }
);

test.serial(
  'folder creation permission is independent, hidden paths deny folder writes and typed upload creates no fake documents',
  async t => {
    const { actor, service, db } = await fixture();
    const doc = await app
      .get(DocWriter)
      .createDoc(actor.workspaceId, 'Local page', '', actor.actorId);
    await service.adoptLocalTree(actor, [
      {
        nodeId: 'uploaded-folder',
        kind: 'folder',
        resourceId: 'local-folder',
        trashed: false,
        parentNodeId: null,
        order: 'a0',
        folder: {
          title: 'Local folder',
          metadataVersion: 3,
          createdAt: null,
          createdBy: null,
          updatedAt: null,
          updatedBy: null,
        },
      },
      {
        nodeId: 'uploaded-page',
        kind: 'doc',
        resourceId: doc.docId,
        trashed: false,
        parentNodeId: 'uploaded-folder',
        order: 'a0',
      },
    ]);
    const { PgWorkspaceDocStorageAdapter } =
      await import('../../core/doc/adapters/workspace');
    t.is(
      await app
        .get(PgWorkspaceDocStorageAdapter)
        .getDocReadOnly(actor.workspaceId, 'local-folder'),
      null
    );
    await db.workspaceDirectoryGrant.create({
      data: {
        workspaceId: actor.workspaceId,
        directoryId: 'uploaded-folder',
        principalId: '*',
        canRead: true,
        canWrite: true,
        canOrganize: true,
        canCreateFolder: false,
      },
    });
    const tree = await service.list(actor, 'uploaded-folder');
    t.false(tree.canCreateFolder);
    t.true(tree.canCreatePage);
    await t.throwsAsync(
      service.execute(actor, {
        action: 'create-folder',
        title: 'Denied',
        parentNodeId: 'uploaded-folder',
        requestKey: 'deny-folder',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedRevision: tree.revision,
        expectedAuthorizationRevision: tree.authorizationRevision,
      })
    );
    await service.execute(actor, {
      action: 'create',
      title: 'Allowed page',
      primaryMode: 'page',
      parentNodeId: 'uploaded-folder',
      requestKey: 'allow-page',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: tree.revision,
      expectedAuthorizationRevision: tree.authorizationRevision,
    });
    await t.throwsAsync(service.conversionPreview(actor, 'uploaded-page'));
    await db.workspaceDirectoryGrant.updateMany({
      where: { workspaceId: actor.workspaceId },
      data: { canRead: false },
    });
    t.deepEqual((await service.list(actor, null)).items, []);
    await t.throwsAsync(service.list(actor, 'uploaded-folder'));
  }
);
