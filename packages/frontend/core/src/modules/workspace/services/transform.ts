import {
  adoptWorkspaceLocalPageTreeMutation,
  WORKSPACE_PAGE_TREE_CONTRACT,
} from '@affine/graphql';
import type { BlobStorage, DocStorage } from '@affine/nbstore';
import type { Workspace as BlockSuiteWorkspace } from '@blocksuite/affine/store';
import { Service } from '@toeverything/infra';
import { applyUpdate } from 'yjs';

import { WorkspaceServerService } from '../../cloud/services/workspace-server';
import {
  AFFiNE_WORKSPACE_DB_SCHEMA,
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
} from '../../db/schema';
import { transformWorkspaceDBLocalToCloud } from '../../db/utils';
import { WorkspacePageTreeService } from '../../organize/services/page-tree';
import { FolderSortingStore } from '../../organize/stores/folder-sorting';
import type { Workspace } from '../entities/workspace';
import type { WorkspaceMetadata } from '../metadata';
import type { WorkspaceDestroyService } from './destroy';
import type { WorkspaceFactoryService } from './factory';
import type { WorkspaceRepositoryService } from './repo';

export class WorkspaceTransformService extends Service {
  constructor(
    private readonly factory: WorkspaceFactoryService,
    private readonly destroy: WorkspaceDestroyService,
    private readonly repository: WorkspaceRepositoryService
  ) {
    super();
  }

  /**
   * helper function to transform local workspace to cloud workspace
   *
   * @param accountId - all local user data will be transformed to this account
   */
  transformLocalToCloud = async (
    local: Workspace,
    accountId: string,
    flavour: string
  ): Promise<WorkspaceMetadata> => {
    if (local.flavour !== 'local') {
      throw new Error(
        'Only local workspace can be transformed to cloud workspace'
      );
    }

    const adapter = local.scope.get(WorkspacePageTreeService).localUpload;
    const positions = await adapter.uploadSnapshot();
    const sortModes = await local.scope
      .get(FolderSortingStore)
      .snapshotModes([
        '$page-tree-root',
        ...positions.map(node => node.nodeId),
      ]);
    if (positions.length > 10000)
      throw new Error('This upload supports at most 10000 resources');
    const fingerprint = JSON.stringify(positions);
    const previous = adapter.uploadTarget;
    if (
      previous &&
      (previous.actorId !== accountId ||
        previous.flavour !== flavour ||
        previous.fingerprint !== fingerprint)
    )
      throw new Error(
        'Resume the original upload before changing its account or page tree'
      );
    const localDocStorage = local.engine.doc.storage;
    const localDocList = Array.from(local.docCollection.docs.keys());

    const contentFingerprint = async () => {
      await local.engine.doc.waitForUpdated();
      const hashes: string[] = [];
      const hash = async (bin: Uint8Array) =>
        [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', new Uint8Array(bin).buffer)
          ),
        ]
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join('');
      const ids = [
        local.id,
        ...localDocList,
        ...Object.keys(AFFiNE_WORKSPACE_DB_SCHEMA).map(key => `db$${key}`),
        ...Object.keys(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA).map(
          key => `userdata$__local__$${key}`
        ),
      ].sort();
      for (const id of ids) {
        const doc = await localDocStorage.getDoc(id);
        hashes.push(JSON.stringify([id, doc ? await hash(doc.bin) : null]));
      }
      for (const { key } of (await local.engine.blob.storage.list()).sort(
        (a, b) => a.key.localeCompare(b.key)
      )) {
        const blob = await local.engine.blob.storage.get(key);
        hashes.push(JSON.stringify([key, blob ? await hash(blob.data) : null]));
      }
      return JSON.stringify(hashes);
    };
    const beforeContent = await contentFingerprint();
    const copyToCloud = async (
      docCollection: BlockSuiteWorkspace,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => {
      await adapter.saveUploadTarget({
        id: docCollection.id,
        flavour,
        actorId: accountId,
        fingerprint,
      });
      const rootDocBinary = (
        await localDocStorage.getDoc(local.docCollection.doc.guid)
      )?.bin;

      if (rootDocBinary) {
        applyUpdate(docCollection.doc, rootDocBinary);
      }

      for (const subdocId of localDocList) {
        const subdocBinary = (await localDocStorage.getDoc(subdocId))?.bin;
        if (subdocBinary) {
          const doc = docCollection.getDoc(subdocId);
          if (doc) {
            const spaceDoc = doc.spaceDoc;
            doc.load();
            applyUpdate(spaceDoc, subdocBinary);
          }
        }
      }

      // transform db
      await transformWorkspaceDBLocalToCloud(
        local.id,
        docCollection.id,
        localDocStorage,
        docStorage,
        accountId,
        true
      );

      const blobList = await local.engine.blob.storage.list();

      for (const { key } of blobList) {
        const blob = await local.engine.blob.storage.get(key);
        if (blob) {
          await blobStorage.set(blob);
        }
      }
    };
    const newMetadata =
      previous ?? (await this.factory.create(flavour, copyToCloud));

    const uploaded = this.repository.open({ metadata: newMetadata });
    try {
      const cloud = uploaded.workspace;
      await cloud.engine.doc.waitForDocLoaded(cloud.id);
      if (previous)
        await copyToCloud(
          cloud.docCollection,
          cloud.engine.blob.storage,
          cloud.engine.doc.storage
        );
      // Wait for every content and metadata document, including recycled pages,
      // before the server validates the full resource inventory.
      const releases = localDocList.map(id =>
        cloud.engine.doc.addPriority(id, 100)
      );
      try {
        await cloud.engine.doc.waitForSynced();
        const server = cloud.scope.get(WorkspaceServerService).server;
        if (!server || server.account$.value?.id !== accountId)
          throw new Error('Upload account changed');
        const result = await server.gql({
          query: adoptWorkspaceLocalPageTreeMutation,
          variables: {
            workspaceId: cloud.id,
            contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
            positions,
          },
        });
        if (!result.adoptWorkspaceLocalPageTree)
          throw new Error('Page tree upload is not complete');
        await cloud.scope.get(FolderSortingStore).inheritModes(sortModes);
        if (server.account$.value?.id !== accountId)
          throw new Error('Upload account changed');
        // Keep the local copy if a concurrent local edit changed ownership.
        if (
          JSON.stringify(await adapter.uploadSnapshot()) !== fingerprint ||
          (await contentFingerprint()) !== beforeContent
        )
          throw new Error(
            'The local Workspace changed during upload; both copies have been kept'
          );
        await this.destroy.deleteWorkspace(local.meta);
      } finally {
        releases.forEach(release => release());
      }
    } finally {
      uploaded.dispose();
    }

    return newMetadata;
  };
}
