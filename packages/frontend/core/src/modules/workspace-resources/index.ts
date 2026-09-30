import type { Framework } from '@toeverything/infra';

import { WorkspaceServerService } from '../cloud';
import { NbstoreService } from '../storage';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { WorkspaceLifecycleService } from './lifecycle';
import { WorkspaceResourcesService } from './service';
export { WorkspaceLifecycleService };
export type { LifecycleAction, LifecycleKind } from './lifecycle';
export { WorkspaceResourcesService };
export type { NativeResource, ResourceState } from './service';
export function configureWorkspaceResourcesModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(WorkspaceLifecycleService, [
      WorkspaceService,
      WorkspaceServerService,
      WorkspaceResourcesService,
    ])
    .service(WorkspaceResourcesService, [
      WorkspaceService,
      WorkspaceServerService,
      NbstoreService,
    ]);
}
