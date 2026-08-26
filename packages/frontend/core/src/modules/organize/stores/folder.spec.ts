import { createORMClient, Framework, YjsDBAdapter } from '@toeverything/infra';
import { beforeEach, describe, expect, test } from 'vitest';
import { Doc as YDoc } from 'yjs';

import type { WorkspaceDBService } from '../../db';
import { AFFiNE_WORKSPACE_DB_SCHEMA } from '../../db/schema';
import { FolderStore } from './folder';

const WorkspaceDBClient = createORMClient(AFFiNE_WORKSPACE_DB_SCHEMA);

describe('FolderStore links', () => {
  let db: InstanceType<typeof WorkspaceDBClient>;
  let store: FolderStore;

  beforeEach(() => {
    db = new WorkspaceDBClient(
      new YjsDBAdapter(AFFiNE_WORKSPACE_DB_SCHEMA, {
        getDoc: guid => new YDoc({ guid }),
      })
    );
    const framework = new Framework();
    framework.store(
      FolderStore,
      () => new FolderStore({ db } as unknown as WorkspaceDBService)
    );
    store = framework.provider().get(FolderStore);
  });

  function createFolder(id: string) {
    db.folders.create({
      id,
      parentId: null,
      type: 'folder',
      data: id,
      index: 'a0',
    });
  }

  test('reuses a link to the same target in the same folder', () => {
    createFolder('folder-1');

    const firstId = store.createLink('folder-1', 'doc', 'doc-1', 'a0');
    const secondId = store.createLink('folder-1', 'doc', 'doc-1', 'a1');

    expect(secondId).toBe(firstId);
    expect(
      db.folders.find({
        parentId: 'folder-1',
        type: 'doc',
        data: 'doc-1',
      })
    ).toEqual([expect.objectContaining({ id: firstId, index: 'a0' })]);
  });

  test('allows links to the same target in different folders', () => {
    createFolder('folder-1');
    createFolder('folder-2');

    const firstId = store.createLink('folder-1', 'doc', 'doc-1', 'a0');
    const secondId = store.createLink('folder-2', 'doc', 'doc-1', 'a0');

    expect(secondId).not.toBe(firstId);
    expect(db.folders.find({ type: 'doc', data: 'doc-1' })).toHaveLength(2);
  });

  test('removes the moved link when the target folder already has it', () => {
    createFolder('folder-1');
    createFolder('folder-2');
    const movedId = store.createLink('folder-1', 'doc', 'doc-1', 'a0');
    const existingId = store.createLink('folder-2', 'doc', 'doc-1', 'a0');

    expect(store.moveNode(movedId, 'folder-2', 'a1')).toBe(existingId);
    expect(db.folders.get(movedId)).toBeNull();
    expect(db.folders.get(existingId)).toEqual(
      expect.objectContaining({ parentId: 'folder-2', index: 'a0' })
    );
  });

  test('moves a link when the target folder does not contain it', () => {
    createFolder('folder-1');
    createFolder('folder-2');
    const linkId = store.createLink('folder-1', 'doc', 'doc-1', 'a0');

    expect(store.moveNode(linkId, 'folder-2', 'a1')).toBe(linkId);
    expect(db.folders.get(linkId)).toEqual(
      expect.objectContaining({ parentId: 'folder-2', index: 'a1' })
    );
  });
});
