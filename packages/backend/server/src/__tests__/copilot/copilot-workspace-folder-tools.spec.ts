import test from 'ava';
import * as Y from 'yjs';

import { WorkspaceOrganizationService } from '../../core/doc';
import { createWorkspaceOrganizationTools } from '../../plugins/copilot/tools/workspace-organization';

function rootFixture() {
  const doc = new Y.Doc({ guid: 'workspace-1' });
  const meta = doc.getMap<unknown>('meta');
  const pages = new Y.Array<Y.Map<unknown>>();
  for (const [id, title] of [
    ['doc-1', 'Readable'],
    ['doc-2', 'Private'],
  ]) {
    const page = new Y.Map<unknown>();
    page.set('id', id);
    page.set('title', title);
    pages.push([page]);
  }
  meta.set('pages', pages);
  return doc;
}

function createOrganization() {
  const docs = new Map<string, Y.Doc>([['workspace-1', rootFixture()]]);
  const reader = {
    getDoc: async (_workspaceId: string, docId: string) => {
      const doc = docs.get(docId);
      return doc
        ? {
            spaceId: 'workspace-1',
            docId,
            bin: Y.encodeStateAsUpdate(doc),
            timestamp: 1,
          }
        : null;
    },
  };
  const writer = {
    pushDocUpdate: async (
      _workspaceId: string,
      docId: string,
      update: Uint8Array
    ) => {
      let doc = docs.get(docId);
      if (!doc) {
        doc = new Y.Doc({ guid: docId });
        docs.set(docId, doc);
      }
      Y.applyUpdate(doc, update);
      return { success: true, timestamp: 2 };
    },
  };
  return new WorkspaceOrganizationService(reader as never, writer as never);
}

function createPermissions(input?: {
  read?: boolean;
  write?: boolean;
  readableDocumentIds?: string[];
}) {
  const read = input?.read ?? true;
  const write = input?.write ?? true;
  const readable = new Set(input?.readableDocumentIds ?? ['doc-1']);
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async (permission: string) => {
          if (
            (permission === 'Workspace.Organize.Read' && !read) ||
            (permission === 'Workspace.Sync' && !write)
          ) {
            throw new Error(`Permission denied: ${permission}`);
          }
        },
      }),
      doc: ({ docId }: { docId: string }) => ({
        allowLocal: () => ({ can: async () => readable.has(docId) }),
      }),
    }),
  };
  const permission = {
    listReadableDocIds: async () => [...readable],
  };
  return { ac, permission };
}

function tools(
  organization: WorkspaceOrganizationService,
  permissions = createPermissions()
) {
  return createWorkspaceOrganizationTools(
    permissions.ac as never,
    permissions.permission as never,
    organization,
    { user: 'user-1', workspace: 'workspace-1' }
  );
}

async function run(
  toolSet: ReturnType<typeof tools>,
  name: keyof ReturnType<typeof tools>,
  args: Record<string, unknown>
) {
  return (await toolSet[name].execute?.(args, {})) as Record<string, any>;
}

test('workspace folder tools manage folder trees and document placements safely', async t => {
  const organization = createOrganization();
  const toolSet = tools(organization);

  const projects = await run(toolSet, 'workspace_folder_create', {
    name: 'Projects',
    parent_folder_id: null,
  });
  t.true(projects.success);
  t.false(projects.idempotentReplay);
  const replay = await run(toolSet, 'workspace_folder_create', {
    name: 'Projects',
    parent_folder_id: null,
  });
  t.is(replay.folderId, projects.folderId);
  t.true(replay.idempotentReplay);
  await organization.applyDataOperations(
    'workspace-1',
    'user-1',
    'user-1',
    'folders',
    [
      {
        op: 'upsert',
        key: 'private-placement',
        values: {
          parentId: projects.folderId,
          type: 'doc',
          data: 'doc-2',
          index: 'a0',
        },
      },
    ]
  );

  const archive = await run(toolSet, 'workspace_folder_create', {
    name: 'Archive',
    parent_folder_id: null,
  });
  const child = await run(toolSet, 'workspace_folder_create', {
    name: 'Child',
    parent_folder_id: projects.folderId,
  });
  const renamed = await run(toolSet, 'workspace_folder_rename', {
    folder_id: child.folderId,
    name: 'Work',
  });
  t.like(renamed, { success: true, name: 'Work' });

  const moved = await run(toolSet, 'workspace_folder_move', {
    folder_id: child.folderId,
    parent_folder_id: archive.folderId,
  });
  t.is(moved.parentFolderId, archive.folderId);
  const cycle = await run(toolSet, 'workspace_folder_move', {
    folder_id: archive.folderId,
    parent_folder_id: child.folderId,
  });
  t.is(cycle.type, 'error');
  t.regex(cycle.message, /descendant/);

  const added = await run(toolSet, 'workspace_folder_add_document', {
    folder_id: child.folderId,
    document_id: 'doc-1',
  });
  t.false(added.idempotentReplay);
  const addedReplay = await run(toolSet, 'workspace_folder_add_document', {
    folder_id: child.folderId,
    document_id: 'doc-1',
  });
  t.is(addedReplay.placementId, added.placementId);
  t.true(addedReplay.idempotentReplay);
  const unreadable = await run(toolSet, 'workspace_folder_add_document', {
    folder_id: child.folderId,
    document_id: 'doc-2',
  });
  t.is(unreadable.type, 'error');

  const movedDocument = await run(toolSet, 'workspace_folder_move_document', {
    document_id: 'doc-1',
    folder_id: archive.folderId,
  });
  t.is(movedDocument.folderId, archive.folderId);
  const listing = await run(toolSet, 'workspace_folder_list', {});
  t.deepEqual(
    listing.documents.map((document: any) => document.documentId),
    ['doc-1']
  );
  t.is(listing.documents[0].folderId, archive.folderId);
  const movedDocumentReplay = await run(
    toolSet,
    'workspace_folder_move_document',
    { document_id: 'doc-1', folder_id: archive.folderId }
  );
  t.true(movedDocumentReplay.idempotentReplay);
  const removedDocument = await run(toolSet, 'workspace_folder_move_document', {
    document_id: 'doc-1',
    folder_id: null,
  });
  t.like(removedDocument, {
    folderId: null,
    removedPlacementCount: 1,
    idempotentReplay: false,
  });
  const removedDocumentReplay = await run(
    toolSet,
    'workspace_folder_move_document',
    { document_id: 'doc-1', folder_id: null }
  );
  t.true(removedDocumentReplay.idempotentReplay);
  await run(toolSet, 'workspace_folder_add_document', {
    folder_id: child.folderId,
    document_id: 'doc-1',
  });

  const wrongName = await run(toolSet, 'workspace_folder_delete', {
    folder_id: archive.folderId,
    expected_name: 'Wrong',
    recursive: true,
  });
  t.is(wrongName.type, 'error');
  const nonRecursive = await run(toolSet, 'workspace_folder_delete', {
    folder_id: archive.folderId,
    expected_name: 'Archive',
    recursive: false,
  });
  t.is(nonRecursive.type, 'error');

  const deleted = await run(toolSet, 'workspace_folder_delete', {
    folder_id: archive.folderId,
    expected_name: 'Archive',
    recursive: true,
  });
  t.like(deleted, {
    success: true,
    deletedFolderCount: 2,
    removedPlacementCount: 1,
    documentsDeleted: 0,
  });
  const deletedReplay = await run(toolSet, 'workspace_folder_delete', {
    folder_id: archive.folderId,
    expected_name: 'Archive',
    recursive: true,
  });
  t.true(deletedReplay.alreadyAbsent);
  t.true(deletedReplay.idempotentReplay);

  const afterDelete = await run(toolSet, 'workspace_folder_list', {});
  t.deepEqual(
    afterDelete.folders.map((item: any) => item.name),
    ['Projects']
  );
  t.deepEqual(afterDelete.documents, []);
});

test('workspace folder tools enforce organization ACLs', async t => {
  const organization = createOrganization();
  const noRead = tools(
    organization,
    createPermissions({ read: false, readableDocumentIds: ['doc-1'] })
  );
  const list = await run(noRead, 'workspace_folder_list', {});
  t.is(list.type, 'error');
  t.regex(list.message, /Workspace\.Organize\.Read/);

  const noWrite = tools(
    organization,
    createPermissions({ write: false, readableDocumentIds: ['doc-1'] })
  );
  const create = await run(noWrite, 'workspace_folder_create', {
    name: 'Denied',
    parent_folder_id: null,
  });
  t.is(create.type, 'error');
  t.regex(create.message, /Workspace\.Sync/);
});
