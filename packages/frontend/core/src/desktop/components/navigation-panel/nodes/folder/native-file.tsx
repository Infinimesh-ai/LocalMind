import { useQuery } from '@affine/core/components/hooks/use-query';
import { dragNativeResource } from '@affine/core/components/native-files/resource-drag';
import { WorkspaceNativeActions } from '@affine/core/components/native-files/workspace-actions';
import { NbstoreService } from '@affine/core/modules/storage';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { workspaceNativeResourceQuery } from '@affine/graphql';
import { PageIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { type ReactNode, useEffect } from 'react';
import { merge } from 'rxjs';

import { NavigationPanelTreeNode } from '../../tree';
import type { NavigationPanelTreeNodeIcon } from '../../tree/node';

const ignoreCollapse = () => {};
const NativeFileIcon: NavigationPanelTreeNodeIcon = ({ className }) => (
  <PageIcon className={className} />
);
export function NavigationPanelNativeFileNode({
  resourceId,
  kind,
  renderNode,
}: {
  resourceId: string;
  kind: 'file' | 'office';
  renderNode?: (
    name: string,
    open: () => void,
    actions: ReactNode
  ) => ReactNode;
}) {
  const { workspace } = useService(WorkspaceService);
  const { workbench } = useService(WorkbenchService);
  const realtime = useService(NbstoreService).realtime;
  const query = useQuery(
    {
      query: workspaceNativeResourceQuery,
      variables: { input: { workspaceId: workspace.id, resourceId, kind } },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const { mutate } = query;
  useEffect(() => {
    const subscription = merge(
      realtime.subscribe('workspace.nativeResources.changed', {
        workspaceId: workspace.id,
      }),
      realtime.subscribe('workspace.access.changed', {
        workspaceId: workspace.id,
      }),
      realtime.subscribe('workspace.directory-policy.changed', {
        workspaceId: workspace.id,
      })
    ).subscribe({
      next: () => {
        void mutate().catch(() => undefined);
      },
      error: () => {
        void mutate().catch(() => undefined);
      },
    });
    return () => subscription.unsubscribe();
  }, [realtime, workspace.id, mutate]);
  const resource = query.data?.workspaceNativeResource;
  if (query.error || !resource) return null;
  const openResource = () => {
    if (kind === 'office') workbench.openOffice(resourceId);
    else workbench.openNativeFile(resourceId);
  };
  const actions = (
    <WorkspaceNativeActions
      compact
      workspaceId={workspace.id}
      resourceId={resourceId}
      kind={kind}
      title={resource.title}
      capabilities={resource}
      onChanged={() => void mutate().catch(() => undefined)}
    />
  );
  return renderNode ? (
    renderNode(resource.title, openResource, actions)
  ) : (
    <div
      draggable={resource.canMove === true}
      onDragStart={event =>
        dragNativeResource(event, {
          workspaceId: workspace.id,
          resourceId,
          kind,
        })
      }
    >
      <NavigationPanelTreeNode
        name={resource.title}
        icon={NativeFileIcon}
        collapsed
        collapsible={false}
        setCollapsed={ignoreCollapse}
        reorderable={false}
        onClick={openResource}
        operations={[
          {
            index: 0,
            inline: true,
            view: actions,
          },
        ]}
      />
    </div>
  );
}
