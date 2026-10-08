import { type Framework } from '@toeverything/infra';

import { WorkspaceServerService } from '../cloud';
import { CollectionService } from '../collection';
import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { DocDisplayMetaService } from '../doc-display-meta';
import { NbstoreService } from '../storage';
import { TagService } from '../tag';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { WorkspaceResourcesService } from '../workspace-resources';
import { FolderNode } from './entities/folder-node';
import { FolderTree } from './entities/folder-tree';
import { OrganizeService } from './services/organize';
import { DirectoryAccessStore } from './stores/directory-access';
import { FolderStore } from './stores/folder';
import { FolderSortingStore } from './stores/folder-sorting';

export type { FolderNode } from './entities/folder-node';
export type { FolderSortMode } from './folder-sorting';
export { OrganizeService } from './services/organize';

export function configureOrganizeModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(OrganizeService)
    .entity(FolderTree, [FolderStore])
    .entity(FolderNode, [FolderStore, FolderSortingStore])
    .store(FolderSortingStore, [
      WorkspaceService,
      WorkspaceServerService,
      WorkspaceDBService,
      DocsService,
      TagService,
      CollectionService,
      WorkspaceResourcesService,
      DocDisplayMetaService,
    ])
    .store(DirectoryAccessStore, [
      WorkspaceService,
      WorkspaceServerService,
      NbstoreService,
    ])
    .store(FolderStore, [
      WorkspaceDBService,
      DocsService,
      DirectoryAccessStore,
    ]);
}
