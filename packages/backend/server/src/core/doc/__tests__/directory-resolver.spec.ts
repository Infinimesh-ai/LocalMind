import test from 'ava';

import { WorkspaceDirectoryResolver } from '../directory-resolver';

test('directory pages retain authorized native entries and filter unreadable documents', async t => {
  const rights = {
    canRead: true,
    canWrite: true,
    canOrganize: true,
    canCreateFolder: true,
  };
  const entries = [
    { id: 'a', type: 'folder', data: 'Folder', parentId: null, index: 'a0' },
    { id: 'b', type: 'file', data: 'file-1', parentId: 'a', index: 'a1' },
    { id: 'c', type: 'office', data: 'office-1', parentId: 'a', index: 'a2' },
    { id: 'd', type: 'doc', data: 'doc-allowed', parentId: null, index: 'a3' },
    { id: 'e', type: 'doc', data: 'doc-denied', parentId: null, index: 'a4' },
  ];
  const organization = {
    readDirectory: async () => ({
      revision: 'revision',
      fullSyncAllowed: false,
      rootRights: rights,
      entries: entries.map(row => ({ row, rights })),
    }),
  };
  const workspace = {
    assert: async () => {},
    projectScope: () => ({
      docs: async () => [{ docId: 'doc-allowed' }],
    }),
  };
  const resolver = new WorkspaceDirectoryResolver(
    {} as never,
    { user: () => ({ workspace: () => workspace }) } as never,
    organization as never,
    {} as never,
    { observe: async (fn: () => Promise<unknown>) => await fn() } as never
  );
  const page = await resolver.workspaceDirectory(
    { id: 'actor' } as never,
    'workspace'
  );
  t.deepEqual(
    page.items.map(item => item.id),
    ['a', 'b', 'c', 'd']
  );
  t.is(page.items[1].rights.canRead, true);
  t.is(page.nextCursor, null);
});
