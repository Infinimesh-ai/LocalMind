import {
  dragNativeResource,
  nativeResourceDirectoryDragData,
} from '@affine/core/components/native-files/resource-drag';
import { WorkspaceNativeActions } from '@affine/core/components/native-files/workspace-actions';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useWorkspaceResources } from '@affine/core/modules/workspace-resources/use-resources';
import { PageIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import type { ReactNode } from 'react';

import { NavigationPanelTreeNode } from '../../tree';
import type { NavigationPanelTreeNodeIcon } from '../../tree/node';
import type { GenericNavigationPanelNode } from '../types';

const ignoreCollapse = () => {};
const NativeFileIcon: NavigationPanelTreeNodeIcon = ({ className }) => (
  <PageIcon className={className} />
);
export function NavigationPanelNativeFileNode({
  resourceId,
  kind,
  renderNode,
  location,
  onDrop,
  canDrop,
  dropEffect,
  reorderable,
}: {
  resourceId: string;
  kind: 'file' | 'office';
  renderNode?: (
    name: string,
    open: () => void,
    actions: ReactNode
  ) => ReactNode;
} & Partial<GenericNavigationPanelNode>) {
  const { workspace } = useService(WorkspaceService);
  const { workbench } = useService(WorkbenchService);
  const catalog = useWorkspaceResources();
  // The shared authorized catalog owns visibility, including remote trash.
  // A separate cached query per row can outlive its removal from the catalog.
  const resource = catalog.items.find(
    item => item.id === resourceId && item.kind === kind
  );
  if (catalog.error || !resource || resource.trashedAt) return null;
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
      onChanged={() => catalog.service.invalidate()}
    />
  );
  if (!renderNode && location?.at === 'navigation-panel:organize:folder-node') {
    const identity = { workspaceId: workspace.id, resourceId, kind };
    return (
      <NavigationPanelTreeNode
        name={resource.title}
        icon={NativeFileIcon}
        collapsed
        collapsible={false}
        setCollapsed={ignoreCollapse}
        canDrag={resource.canMove === true && reorderable !== false}
        reorderable={reorderable}
        dndData={{
          draggable: {
            entity: { type: 'doc', id: resourceId },
            from: location,
            nativeResource: identity,
          },
          dropTarget: { at: 'navigation-panel:doc' },
        }}
        externalDragData={nativeResourceDirectoryDragData(identity)}
        canDrop={canDrop}
        onDrop={onDrop}
        dropEffect={dropEffect}
        onClick={openResource}
        operations={[{ index: 0, inline: true, view: actions }]}
      />
    );
  }
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
