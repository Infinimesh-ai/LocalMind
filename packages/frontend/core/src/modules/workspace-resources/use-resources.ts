import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

import { WorkspaceResourcesService } from './service';
export function useWorkspaceResources(trash = false) {
  const service = useService(WorkspaceResourcesService);
  const state = useLiveData(service.state(trash));
  useEffect(() => service.watch(trash), [service, trash]);
  return { ...state, service };
}
