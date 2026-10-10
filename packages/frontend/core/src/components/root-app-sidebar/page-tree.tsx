import {
  Button,
  MenuItem,
  MenuSub,
  Modal,
  toast,
  useConfirmModal,
  usePromptModal,
} from '@affine/component';
import { FolderSortButton } from '@affine/core/desktop/components/navigation-panel/nodes/folder/sort-menu';
import {
  NavigationPanelTreeNode,
  NavigationPanelTreeRoot,
} from '@affine/core/desktop/components/navigation-panel/tree';
import { DocsService } from '@affine/core/modules/doc/services/docs';
import { NavigationPanelService } from '@affine/core/modules/navigation-panel';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import {
  type FolderSortMode,
  sortFolderChildren,
} from '@affine/core/modules/organize/folder-sorting';
import type { PageTreeItem } from '@affine/core/modules/organize/services/page-tree';
import { FolderSortingStore } from '@affine/core/modules/organize/stores/folder-sorting';
import { TemplateListMenuContentScrollable } from '@affine/core/modules/template-doc/view/template-list-menu';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  WORKSPACE_PAGE_TREE_CONTRACT,
  workspaceDocumentTypes,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { LiveData, useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';
import { firstValueFrom } from 'rxjs';

import { WorkspaceCreateMenu } from '../native-files/create-menu';
import { ResourceTypeIcon } from '../native-files/resource-rows';
import * as styles from './index.css';

export function usePageTreeLayer(parentId: string | null) {
  const service = useService(WorkspacePageTreeService);
  const layer$ = useMemo(() => service.layer$(parentId), [service, parentId]);
  const layer = useLiveData(layer$);
  useEffect(() => {
    void service.load(parentId).catch(console.error);
  }, [service, parentId]);
  return layer;
}
function useSorting(
  parentId: string | null,
  fallback: FolderSortMode = 'manual'
) {
  const service = useService(WorkspacePageTreeService);
  const store = useService(FolderSortingStore);
  const preference$ = useMemo(
    () => LiveData.from(store.watchMode(service.key(parentId)), null),
    [service, parentId, store]
  );
  const preference = useLiveData(preference$);
  const ready = useLiveData(store.ready$);
  return {
    mode: preference ?? fallback,
    ready,
    setMode: (mode: FolderSortMode) =>
      store.setMode(service.key(parentId), mode),
  };
}

export function PageTreeCreateMenu({
  parentId = null,
  name,
}: {
  parentId?: string | null;
  name: string;
}) {
  const t = useI18n(),
    service = useService(WorkspacePageTreeService);
  const { workbench } = useService(WorkbenchService);
  const docs = useService(DocsService);
  const navigation = useService(NavigationPanelService);
  const saving = useLiveData(service.saving$);
  const { openPromptModal } = usePromptModal();
  const create = (primaryMode: 'page' | 'edgeless') =>
    openPromptModal({
      title:
        primaryMode === 'page'
          ? t['com.affine.localmind.page-tree.newPage']()
          : t['Edgeless'](),
      inputOptions: { placeholder: t['Untitled']() },
      confirmText: t['save'](),
      cancelText: t['Cancel'](),
      onConfirm: async title => {
        const result = await service.execute({
          action: 'create',
          title,
          primaryMode,
          parentNodeId: parentId,
        });
        expandParent();
        workbench.openDoc(result.resourceId);
      },
    });
  const rootLayer$ = useMemo(() => service.layer$(null), [service]);
  const root = useLiveData(rootLayer$).page;
  const targetLayer = usePageTreeLayer(parentId);
  const expandParent = () => {
    for (const node of [
      ...(targetLayer.page?.ancestors ?? []),
      ...(targetLayer.page?.parent ? [targetLayer.page.parent] : []),
    ])
      navigation.setCollapsed(['page-tree', node.nodeId], false);
  };
  if (!root) return null;
  return (
    <WorkspaceCreateMenu
      parentId={parentId}
      onFolder={() =>
        openPromptModal({
          title: t['com.affine.rootAppSidebar.organize.new-folders'](),
          inputOptions: { placeholder: t['Untitled'](), maxLength: 512 },
          confirmText: t['save'](),
          cancelText: t['Cancel'](),
          onConfirm: async title => {
            const result = await service.execute({
              action: 'create-folder',
              title,
              parentNodeId: parentId,
            });
            expandParent();
            workbench.openTreeResource({ ...result, kind: 'folder' });
          },
        })
      }
      onPage={() => create('page')}
      onEdgeless={() => create('edgeless')}
      treeTarget={{
        parentNodeId: parentId,
        treeContractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        expectedTreeRevision: root.revision,
        expectedAuthorizationRevision: root.authorizationRevision,
        name,
        canOrganize:
          !saving &&
          !!targetLayer.page &&
          (!targetLayer.page.parent || targetLayer.page.parent.canOrganize),
        canCreateFolder: !!targetLayer.page?.canCreateFolder && !saving,
        canCreatePage: !!targetLayer.page?.canCreatePage && !saving,
      }}
      extra={
        parentId === null ? (
          <MenuSub
            items={
              <TemplateListMenuContentScrollable
                onSelect={id => {
                  void docs
                    .duplicateFromTemplate(id)
                    .then(id => workbench.openDoc(id))
                    .catch(() =>
                      toast(t['com.affine.localmind.page-tree.error']())
                    );
                }}
              />
            }
          >
            {t['Template']()}
          </MenuSub>
        ) : undefined
      }
      onNativeCreated={() => void service.refresh()}
    />
  );
}

export function FolderTreeActions({ item }: { item: PageTreeItem }) {
  const service = useService(WorkspacePageTreeService);
  const workbench = useService(WorkbenchService).workbench;
  const saving = useLiveData(service.saving$);
  const t = useI18n();
  const { openPromptModal } = usePromptModal();
  const { openConfirmModal } = useConfirmModal();
  if (item.kind !== 'folder' || !item.folder) return null;
  const folder = item.folder;
  return (
    <>
      <MenuItem
        disabled={saving || !item.canRename}
        onClick={() =>
          openPromptModal({
            title: t['com.affine.localmind.native-files.rename'](),
            defaultValue: item.title,
            inputOptions: { maxLength: 512 },
            confirmText: t['save'](),
            cancelText: t['Cancel'](),
            onConfirm: title =>
              service
                .execute({
                  action: 'rename-folder',
                  nodeId: item.nodeId,
                  title,
                  expectedResourceVersion: folder.metadataVersion,
                })
                .then(() => undefined),
          })
        }
      >
        {t['com.affine.localmind.native-files.rename']()}
      </MenuItem>
      {item.canConvertToPage && (
        <MenuItem
          disabled={saving}
          onClick={() =>
            void service
              .conversionPreview(item.nodeId)
              .then(preview =>
                openConfirmModal({
                  title: t['com.affine.localmind.page-tree.convertToPage'](),
                  description:
                    t['com.affine.localmind.page-tree.convertToPageHint'](),
                  confirmText: t['Confirm'](),
                  cancelText: t['Cancel'](),
                  onConfirm: async () => {
                    const result = await service.execute(
                      {
                        action: 'convert-folder',
                        nodeId: item.nodeId,
                        expectedResourceVersion: preview.resourceVersion,
                      },
                      preview
                    );
                    workbench.openDoc(result.resourceId);
                  },
                })
              )
              .catch(() => toast(t['com.affine.localmind.page-tree.error']()))
          }
        >
          {t['com.affine.localmind.page-tree.convertToPage']()}
        </MenuItem>
      )}
    </>
  );
}

export function MovePageDialog({
  item,
  onClose,
  action = 'move',
}: {
  item: PageTreeItem;
  onClose: () => void;
  action?: 'move' | 'restore';
}) {
  const t = useI18n(),
    service = useService(WorkspacePageTreeService);
  const [target, setTarget] = useState<string | null>(null);
  const layer = usePageTreeLayer(target),
    saving = useLiveData(service.saving$);
  const [path, setPath] = useState<{ id: string; title: string }[]>([]);
  const [failed, setFailed] = useState(false);
  return (
    <Modal
      open
      title={t['com.affine.localmind.page-tree.move']()}
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <div>
        <Button
          variant="plain"
          onClick={() => {
            setTarget(null);
            setPath([]);
          }}
        >
          {t['com.affine.localmind.page-tree.root']()}
        </Button>
        {path.map((entry, index) => (
          <Button
            key={entry.id}
            variant="plain"
            onClick={() => {
              setTarget(entry.id);
              setPath(path.slice(0, index + 1));
            }}
          >
            {entry.title}
          </Button>
        ))}
      </div>
      {layer.loading && (
        <p role="status">{t['com.affine.localmind.page-tree.loading']()}</p>
      )}
      {layer.error && (
        <Button onClick={() => void service.load(target)}>
          {t['com.affine.error.retry']()}
        </Button>
      )}
      <div role="list">
        {layer.page?.items
          .filter(node => node.isContainer)
          .map(node => (
            <div key={node.nodeId} role="listitem">
              <Button
                variant="plain"
                disabled={
                  node.nodeId === item.nodeId || !node.canOrganize || saving
                }
                onClick={() => {
                  setTarget(node.nodeId);
                  setPath([...path, { id: node.nodeId, title: node.title }]);
                }}
              >
                {node.title || t['Untitled']()}
              </Button>
            </div>
          ))}
      </div>
      {layer.page?.nextCursor && (
        <Button
          disabled={layer.loading}
          onClick={() => void service.load(target, true)}
        >
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
      {failed && (
        <p role="alert">{t['com.affine.localmind.page-tree.error']()}</p>
      )}
      <Button disabled={saving} onClick={onClose}>
        {t['Cancel']()}
      </Button>
      <Button
        variant="primary"
        disabled={
          saving ||
          layer.loading ||
          layer.error ||
          target === item.nodeId ||
          (action === 'move' && target === item.parentNodeId)
        }
        onClick={() => {
          setFailed(false);
          void service
            .execute({
              action,
              nodeId: item.nodeId,
              parentNodeId: target,
            })
            .then(onClose)
            .catch(() => setFailed(true));
        }}
      >
        {t['com.affine.localmind.page-tree.moveHere']()}
      </Button>
    </Modal>
  );
}

function PageTreeNode({ item }: { item: PageTreeItem }) {
  const t = useI18n(),
    service = useService(WorkspacePageTreeService);
  const { workspace } = useService(WorkspaceService);
  const { workbench } = useService(WorkbenchService);
  const navigation = useService(NavigationPanelService);
  const store = useService(FolderSortingStore);
  const path = useMemo(() => ['page-tree', item.nodeId], [item.nodeId]);
  const collapsed = useLiveData(navigation.collapsed$(path));
  const saving = useLiveData(service.saving$);
  const sorting = useSorting(
    item.nodeId,
    item.defaultSortMode === 'name-desc' ? 'name-desc' : 'manual'
  );
  const [moving, setMoving] = useState(false);
  const [dropHere, setDropHere] = useState(false);
  const container = item.isContainer;
  const open = () => workbench.openTreeResource(item);
  const reorder = async (
    direction: 'up' | 'down' | 'after',
    sourceId = item.nodeId
  ) => {
    await service.load(item.parentNodeId);
    while (service.layer$(item.parentNodeId).value.page?.nextCursor)
      await service.load(item.parentNodeId, true);
    const siblings = sortFolderChildren(
      (service.layer$(item.parentNodeId).value.page?.items ?? []).map(node => ({
        ...node,
        id: node.nodeId,
      })),
      (await firstValueFrom(store.watchMode(service.key(item.parentNodeId)))) ??
        (service.layer$(item.parentNodeId).value.page?.parent
          ?.defaultSortMode === 'name-desc'
          ? 'name-desc'
          : 'manual'),
      node => node.title
    );
    const index = siblings.findIndex(node => node.nodeId === item.nodeId);
    if (
      index < 0 ||
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === siblings.length - 1)
    )
      return;
    const before =
      direction === 'up'
        ? siblings[index - 1]
        : siblings[index + (direction === 'down' ? 2 : 1)];
    const order = siblings
      .filter(node => node.nodeId !== sourceId)
      .map(node => node.nodeId);
    const position = before ? order.indexOf(before.nodeId) : order.length;
    order.splice(position, 0, sourceId);
    await service.execute({
      action: 'move',
      ...(siblings.some(node => node.nodeId === sourceId)
        ? { siblingOrder: order }
        : {}),
      nodeId: sourceId,
      parentNodeId: item.parentNodeId,
      ...(before ? { beforeNodeId: before.nodeId } : {}),
    });
    store.setMode(service.key(item.parentNodeId), 'manual');
  };
  const trash = () => void service.confirmLifecycle('trash', item.nodeId);
  return (
    <>
      <div
        draggable={item.canOrganize && !saving}
        onKeyDown={event => {
          if (
            !event.altKey ||
            !['ArrowUp', 'ArrowDown'].includes(event.key) ||
            saving ||
            !item.canOrganize
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          void reorder(event.key === 'ArrowUp' ? 'up' : 'down').catch(() =>
            toast(t['com.affine.localmind.page-tree.error']())
          );
        }}
        onDragStart={event => {
          event.stopPropagation();
          event.dataTransfer.setData(
            'application/x-localmind-page-tree',
            JSON.stringify({ workspaceId: workspace.id, nodeId: item.nodeId })
          );
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={event => {
          if (
            item.canOrganize &&
            event.dataTransfer.types.includes(
              'application/x-localmind-page-tree'
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setDropHere(true);
          }
        }}
        onDragLeave={event => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDropHere(false);
        }}
        onDrop={event => {
          setDropHere(false);
          const value = event.dataTransfer.getData(
            'application/x-localmind-page-tree'
          );
          if (!value) return;
          event.preventDefault();
          event.stopPropagation();
          try {
            const source = JSON.parse(value) as {
              workspaceId?: string;
              nodeId?: string;
            };
            if (
              source.workspaceId !== workspace.id ||
              typeof source.nodeId !== 'string'
            )
              throw new Error('Invalid drag');
            const row =
              event.currentTarget.querySelector('[data-page-tree-row]') ??
              event.currentTarget;
            const rect = row.getBoundingClientRect();
            const before = event.clientY - rect.top < rect.height / 4;
            const after = rect.bottom - event.clientY < rect.height / 4;
            if (after) {
              void reorder('after', source.nodeId).catch(() =>
                toast(t['com.affine.localmind.page-tree.error']())
              );
              return;
            }
            if (!before && !container) throw new Error('Leaf target');
            void service
              .execute({
                action: 'move',
                nodeId: source.nodeId,
                parentNodeId: before ? item.parentNodeId : item.nodeId,
                ...(before ? { beforeNodeId: item.nodeId } : {}),
              })
              .then(() => {
                if (before)
                  store.setMode(service.key(item.parentNodeId), 'manual');
                else navigation.setCollapsed(path, false);
              })
              .catch(() => toast(t['com.affine.localmind.page-tree.error']()));
          } catch {
            toast(t['com.affine.localmind.page-tree.error']());
          }
        }}
      >
        {dropHere && (
          <span role="status" className={styles.treeMessage}>
            {t['com.affine.localmind.page-tree.move']()} · {item.title}
          </span>
        )}
        <NavigationPanelTreeNode
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-page-tree-row
          name={item.title || t['Untitled']()}
          icon={() => (
            <ResourceTypeIcon
              type={
                workspaceDocumentTypes.find(
                  type => type === item.documentType
                ) ?? 'other'
              }
            />
          )}
          collapsed={collapsed}
          setCollapsed={value => navigation.setCollapsed(path, value)}
          collapsible={container}
          to={
            item.kind === 'folder'
              ? `/folder/${encodeURIComponent(item.nodeId)}`
              : item.kind === 'office'
                ? `/office/${item.resourceId}`
                : item.kind === 'file'
                  ? `/files/${item.resourceId}`
                  : `/${item.resourceId}`
          }
          onClick={open}
          reorderable={false}
          canDrag={false}
          operations={[
            ...(container
              ? [
                  {
                    index: 0,
                    inline: true,
                    view: (
                      <PageTreeCreateMenu
                        parentId={item.nodeId}
                        name={item.title}
                      />
                    ),
                  },
                  {
                    index: 1,
                    inline: true,
                    view: (
                      <FolderSortButton
                        name={item.title}
                        mode={sorting.mode}
                        expanded={!collapsed}
                        disabled={!sorting.ready || saving}
                        onChange={sorting.setMode}
                      />
                    ),
                  },
                ]
              : []),
            { index: 2, view: <FolderTreeActions item={item} /> },
            {
              index: 3,
              view: (
                <MenuItem
                  disabled={!item.canOrganize || saving}
                  onClick={() => setMoving(true)}
                >
                  {t['com.affine.localmind.page-tree.move']()}
                </MenuItem>
              ),
            },
            ...(['up', 'down'] as const).map((direction, index) => ({
              index: 3 + index,
              view: (
                <MenuItem
                  disabled={!item.canOrganize || saving}
                  onClick={() =>
                    void reorder(direction).catch(() =>
                      toast(t['com.affine.localmind.page-tree.error']())
                    )
                  }
                >
                  {t[
                    direction === 'up'
                      ? 'com.affine.localmind.project-files.moveUp'
                      : 'com.affine.localmind.project-files.moveDown'
                  ]()}
                </MenuItem>
              ),
            })),
            {
              index: 5,
              view: (
                <MenuItem
                  disabled={!item.canOrganize || saving}
                  onClick={trash}
                >
                  {t['com.affine.localmind.resources.moveToTrash']()}
                </MenuItem>
              ),
            },
          ]}
        >
          {container && !collapsed && (
            <PageTreeChildren
              parentId={item.nodeId}
              fallbackSort={
                item.defaultSortMode === 'name-desc' ? 'name-desc' : 'manual'
              }
            />
          )}
        </NavigationPanelTreeNode>
      </div>
      {moving && (
        <MovePageDialog item={item} onClose={() => setMoving(false)} />
      )}
    </>
  );
}

function PageTreeChildren({
  parentId,
  fallbackSort = 'manual',
}: {
  parentId: string | null;
  fallbackSort?: FolderSortMode;
}) {
  const t = useI18n(),
    service = useService(WorkspacePageTreeService);
  const layer = usePageTreeLayer(parentId),
    sorting = useSorting(parentId, fallbackSort);
  // Sorting a partial page would falsely present a global name order. Load the
  // rest before enabling a name-sorted projection.
  useEffect(() => {
    if (
      sorting.mode !== 'manual' &&
      layer.page?.nextCursor &&
      !layer.loading &&
      !layer.error
    )
      void service.load(parentId, true).catch(console.error);
  }, [layer, sorting.mode, service, parentId]);
  if (layer.error)
    return (
      <div className={styles.treeMessage} role="alert">
        <Button variant="plain" onClick={() => void service.load(parentId)}>
          {t['com.affine.error.retry']()}
        </Button>
      </div>
    );
  if (!layer.page || (sorting.mode !== 'manual' && layer.page.nextCursor))
    return (
      <div className={styles.treeMessage} role="status">
        {t['com.affine.localmind.page-tree.loading']()}
      </div>
    );
  const items = sortFolderChildren(
    layer.page.items.map(item => ({ ...item, id: item.nodeId })),
    sorting.mode,
    item => item.title
  );
  return (
    <>
      {items.map(item => (
        <PageTreeNode key={item.nodeId} item={item} />
      ))}
      {layer.page.nextCursor && (
        <Button
          variant="plain"
          disabled={layer.loading}
          onClick={() => void service.load(parentId, true)}
        >
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
    </>
  );
}

export function PageTreeRootSort({ expanded }: { expanded: boolean }) {
  const t = useI18n(),
    sorting = useSorting(null);
  return (
    <FolderSortButton
      name={t['com.affine.localmind.page-tree.root']()}
      mode={sorting.mode}
      expanded={expanded}
      disabled={!sorting.ready}
      onChange={sorting.setMode}
    />
  );
}

export function WorkspacePageTree() {
  const t = useI18n();
  const service = useService(WorkspacePageTreeService),
    { workspace } = useService(WorkspaceService);
  const sorting = useSorting(null);
  const undo = useLiveData(service.undo$),
    saving = useLiveData(service.saving$);
  const [rootDrop, setRootDrop] = useState(false);
  return (
    <NavigationPanelTreeRoot>
      <div
        role="group"
        className={styles.treeRoot}
        aria-label={t['com.affine.localmind.page-tree.root']()}
        onDragOver={event => {
          if (
            !saving &&
            event.dataTransfer.types.includes(
              'application/x-localmind-page-tree'
            )
          ) {
            event.preventDefault();
            setRootDrop(true);
          }
        }}
        onDragLeave={() => setRootDrop(false)}
        onDrop={event => {
          event.preventDefault();
          setRootDrop(false);
          try {
            const source = JSON.parse(
              event.dataTransfer.getData('application/x-localmind-page-tree')
            ) as { workspaceId?: string; nodeId?: string };
            if (source.workspaceId !== workspace.id || !source.nodeId)
              throw new Error('Invalid drag');
            void service
              .execute({
                action: 'move',
                nodeId: source.nodeId,
                parentNodeId: null,
              })
              .then(() => sorting.setMode('manual'))
              .catch(() => toast(t['com.affine.localmind.page-tree.error']()));
          } catch {
            toast(t['com.affine.localmind.page-tree.error']());
          }
        }}
      >
        {rootDrop && (
          <div role="status" className={styles.treeMessage}>
            {t['com.affine.localmind.page-tree.rootDrop']()}
          </div>
        )}
        {undo && (
          <Button
            variant="plain"
            disabled={saving}
            onClick={() =>
              void service
                .undo()
                .catch(() =>
                  toast(t['com.affine.localmind.page-tree.undoConflict']())
                )
            }
          >
            {t['com.affine.localmind.page-tree.undo']()}
          </Button>
        )}
        <PageTreeChildren parentId={null} />
      </div>
    </NavigationPanelTreeRoot>
  );
}
