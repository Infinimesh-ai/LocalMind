import { useWorkspace } from '@affine/core/components/hooks/use-workspace';
import {
  type WorkspaceMetadata,
  WorkspacesService,
} from '@affine/core/modules/workspace';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const WORKBENCH_LAST_WORKSPACE_KEY = 'last_workspace_id';

export const resolveWorkbenchHost = (
  workspaces: WorkspaceMetadata[],
  preferredWorkspaceId: string | null
) =>
  workspaces.find(workspace => workspace.id === preferredWorkspaceId) ??
  workspaces[0] ??
  null;

const getInitialHostId = () =>
  typeof localStorage === 'undefined'
    ? null
    : localStorage.getItem(WORKBENCH_LAST_WORKSPACE_KEY);

export const useWorkbenchHost = () => {
  const workspacesService = useService(WorkspacesService);
  const workspaces = useLiveData(workspacesService.list.workspaces$);
  const workspacesRevalidating = useLiveData(
    workspacesService.list.isRevalidating$
  );
  const [preferredHostId, setPreferredHostId] = useState(getInitialHostId);
  const hostMetadata = useMemo(
    () => resolveWorkbenchHost(workspaces, preferredHostId),
    [preferredHostId, workspaces]
  );
  const hostWorkspace = useWorkspace(hostMetadata);

  useEffect(() => {
    workspacesService.list.revalidate();
  }, [workspacesService]);

  useEffect(() => {
    if (hostMetadata && hostMetadata.id !== preferredHostId) {
      setPreferredHostId(hostMetadata.id);
    }
  }, [hostMetadata, preferredHostId]);

  const selectHost = useCallback((metadata: WorkspaceMetadata) => {
    localStorage.setItem(WORKBENCH_LAST_WORKSPACE_KEY, metadata.id);
    setPreferredHostId(metadata.id);
  }, []);

  return {
    hostMetadata,
    hostWorkspace,
    selectHost,
    workspacesRevalidating,
  };
};
