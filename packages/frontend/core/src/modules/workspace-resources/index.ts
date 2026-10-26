import type { Framework } from '@toeverything/infra';

import { WorkspaceServerService } from '../cloud';
import { DocsService } from '../doc';
import { WorkspacePageTreeService } from '../organize/services/page-tree';
import { GuardService } from '../permissions';
import { NbstoreService } from '../storage';
import { TagService } from '../tag';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { WorkspaceLifecycleService } from './lifecycle';
import { WorkspaceResourceMoveService } from './move';
import { WorkspaceResourcesService } from './service';
import { WorkspaceResourceTagsService } from './tags';
export { WorkspaceResourceTagsService };
export type { ResourceTagPatch, ResourceTagTarget } from './tags';
export { WorkspaceLifecycleService };
export { WorkspaceResourceMoveService };
export type { LifecycleAction, LifecycleKind } from './lifecycle';
export { NestedResourceMoveError, type ResourceMoveTarget } from './move';
export { WorkspaceResourcesService };
export type { NativeResource, ResourceState } from './service';
export function configureWorkspaceResourcesModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(WorkspaceResourceMoveService, [
      WorkspaceService,
      WorkspaceServerService,
      WorkspaceResourcesService,
      WorkspacePageTreeService,
    ])
    .service(WorkspaceResourceTagsService, [
      WorkspaceService,
      WorkspaceServerService,
      DocsService,
      GuardService,
      TagService,
      WorkspaceResourcesService,
    ])
    .service(WorkspaceLifecycleService, [
      WorkspaceService,
      WorkspaceServerService,
      WorkspaceResourcesService,
      WorkspacePageTreeService,
    ])
    .service(WorkspaceResourcesService, [
      WorkspaceService,
      WorkspaceServerService,
      NbstoreService,
    ]);
}
