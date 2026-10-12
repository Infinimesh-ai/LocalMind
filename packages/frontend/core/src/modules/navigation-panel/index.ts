import { type Framework } from '@toeverything/infra';

import { WorkspacePageTreeService } from '../organize';
import { GlobalCache } from '../storage';
import { WorkbenchService } from '../workbench';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { CreatedResourceService } from './services/created-resource';
import { NavigationPanelService } from './services/navigation-panel';
export { CreatedResourceService } from './services/created-resource';
export { NavigationPanelService } from './services/navigation-panel';

export function configureNavigationPanelModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(NavigationPanelService, [GlobalCache, WorkspaceService])
    .service(CreatedResourceService, [
      WorkspacePageTreeService,
      NavigationPanelService,
      WorkbenchService,
    ]);
}
