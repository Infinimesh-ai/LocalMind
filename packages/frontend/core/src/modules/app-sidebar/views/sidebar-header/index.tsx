import { useLiveData, useService } from '@toeverything/infra';

import { AppSidebarService } from '../../services/app-sidebar';
import { SidebarSwitch } from './sidebar-switch';

export const SidebarHeader = () => {
  const appSidebarService = useService(AppSidebarService).sidebar;
  const open = useLiveData(appSidebarService.open$);

  if (BUILD_CONFIG.isElectron || !open) {
    return null;
  }

  return <SidebarSwitch show />;
};

export * from './sidebar-switch';
