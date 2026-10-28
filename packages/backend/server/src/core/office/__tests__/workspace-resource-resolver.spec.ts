import test from 'ava';

import { ResourceError } from '../../doc/resource-types';
import { WorkspaceNativeResourceResolver } from '../workspace-resource-resolver';

test('a rolled-back directory conflict is a definite 409; unknown errors remain unknown', async t => {
  const input = {
    workspaceId: 'workspace',
    resourceId: 'file',
    kind: 'file',
    action: 'move',
    expectedVersion: 1,
    requestKey: 'request',
    folderId: 'folder',
    expectedDirectoryVersion: 'revision',
  };
  const actor = { id: 'actor' } as never;
  const resolver = new WorkspaceNativeResourceResolver({
    change: async () => {
      throw new ResourceError('directory_version_conflict');
    },
  } as never);
  const conflict = await t.throwsAsync(
    resolver.changeWorkspaceNativeResource(actor, input)
  );
  t.is((conflict as { status?: number }).status, 409);

  const unknown = new Error('unknown');
  const other = new WorkspaceNativeResourceResolver({
    change: async () => {
      throw unknown;
    },
  } as never);
  t.is(
    await t.throwsAsync(other.changeWorkspaceNativeResource(actor, input)),
    unknown
  );
});
