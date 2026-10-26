import {
  Button,
  MenuItem,
  MenuSub,
  Modal,
  toast,
  useConfirmModal,
  usePromptModal,
} from '@affine/component';
import {
  FolderSortButton,
  FolderSortMenu,
} from '@affine/core/desktop/components/navigation-panel/nodes/folder/sort-menu';
import {
  NavigationPanelTreeNode,
  NavigationPanelTreeRoot,
} from '@affine/core/desktop/components/navigation-panel/tree';
import { DocsService } from '@affine/core/modules/doc/services/docs';
import {
  CreatedResourceService,
  NavigationPanelService,
} from '@affine/core/modules/navigation-panel';
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
import {
  createContext,
  type DragEvent as ReactDragEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { WorkspaceCreateMenu } from '../native-files/create-menu';
import { ResourceTypeIcon } from '../native-files/resource-rows';
import {
  useCreatedResourceFocus,
  useCreatedResourceNavigation,
} from '../page-tree/created-resource';
import { PageTreeLoadError } from '../page-tree/load-error';
import * as styles from './index.css';
import {
  type PageTreeDropPlacement,
  type PageTreeDropTarget,
  pageTreeDropTarget,
  pageTreeReorder,
  pageTreeReorderIsNoop,
  samePageTreeOrder,
} from './page-tree-drag';

const dragType = 'application/x-localmind-page-tree';
const dragSchema = z.object({
  workspaceId: z.string().min(1).max(512),
  nodeId: z.string().min(1).max(512),
});
type PageTreeDragRow = {
  element: HTMLDivElement;
  container: boolean;
  accepts: (placement: PageTreeDropPlacement) => boolean;
  drop: (placement: PageTreeDropPlacement, sourceId: string) => Promise<void>;
};
const PageTreeDragContext = createContext<{
  rows: Map<string, PageTreeDragRow>;
  source: PageTreeItem | null;
  setSource: (item: PageTreeItem | null) => void;
  target: PageTreeDropTarget | null;
  setTarget: (target: PageTreeDropTarget | null) => void;
  clearTarget: (nodeId?: string | null) => void;
}>({
  rows: new Map(),
  source: null,
  setSource: () => {},
  target: null,
  setTarget: () => {},
  clearTarget: () => {},
});

export function usePageTreeLayer(parentId: string | null) {
  const service = useService(WorkspacePageTreeService);
  const layer$ = useMemo(() => service.layer$(parentId), [service, parentId]);
  const layer = useLiveData(layer$);
  useEffect(() => {
    return service.observe(parentId);
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
  const docs = useService(DocsService);
  const beginCreation = useCreatedResourceNavigation();
  const saving = useLiveData(service.writeBlocked$);
  const { openPromptModal } = usePromptModal();
  const create = (primaryMode: 'page' | 'edgeless') =>
    openPromptModal({
      title:
        primaryMode === 'page'
          ? t['com.affine.localmind.page-tree.newPage']()
          : t['Edgeless'](),
      inputOptions: { placeholder: t['Untitled']() },
      confirmText: t['Save'](),
      cancelText: t['Cancel'](),
      onConfirm: async title => {
        const complete = beginCreation();
        const result = await service.execute({
          action: 'create',
          title,
          primaryMode,
          parentNodeId: parentId,
        });
        await complete([{ ...result, kind: 'doc' }]);
      },
    });
  const rootLayer$ = useMemo(() => service.layer$(null), [service]);
  const root = useLiveData(rootLayer$).page;
  const targetLayer = usePageTreeLayer(parentId);
  if (!root) return null;
  return (
    <WorkspaceCreateMenu
      parentId={parentId}
      onFolder={() =>
        openPromptModal({
          title: t['com.affine.rootAppSidebar.organize.new-folders'](),
          inputOptions: { placeholder: t['Untitled'](), maxLength: 512 },
          confirmText: t['Save'](),
          cancelText: t['Cancel'](),
          onConfirm: async title => {
            const complete = beginCreation();
            const result = await service.execute({
              action: 'create-folder',
              title,
              parentNodeId: parentId,
            });
            await complete([{ ...result, kind: 'folder' }]);
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
                  const complete = beginCreation();
                  void docs
                    .duplicateFromTemplate(id)
                    .then(id => complete([{ resourceId: id, kind: 'doc' }]))
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
      onNativeCreated={() => void service.refresh(parentId ?? null)}
    />
  );
}

export function FolderTreeActions({ item }: { item: PageTreeItem }) {
  const service = useService(WorkspacePageTreeService);
  const workbench = useService(WorkbenchService).workbench;
  const saving = useLiveData(service.writeBlocked$);
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
            confirmText: t['Save'](),
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
      {!item.canConvertToPage && item.convertToPageUnavailableReason && (
        <MenuItem
          disabled
          aria-description={convertToPageUnavailableText(
            t,
            item.convertToPageUnavailableReason
          )}
        >
          <div className={styles.menuItemWithHint}>
            {t['com.affine.localmind.page-tree.convertToPage']()}
            <span className={styles.menuItemHint}>
              {convertToPageUnavailableText(
                t,
                item.convertToPageUnavailableReason
              )}
            </span>
          </div>
        </MenuItem>
      )}
    </>
  );
}

function convertToPageUnavailableText(
  t: ReturnType<typeof useI18n>,
  reason: string
) {
  switch (reason) {
    case 'trashed':
      return t[
        'com.affine.localmind.page-tree.convertToPageUnavailable.trashed'
      ]();
    case 'missing_rights':
      return t[
        'com.affine.localmind.page-tree.convertToPageUnavailable.missingRights'
      ]();
    case 'public_workspace':
      return t[
        'com.affine.localmind.page-tree.convertToPageUnavailable.publicWorkspace'
      ]();
    case 'default_role_not_manager':
      return t[
        'com.affine.localmind.page-tree.convertToPageUnavailable.defaultRole'
      ]();
    default:
      return t[
        'com.affine.localmind.page-tree.convertToPageUnavailable.other'
      ]();
  }
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
  const writeBlocked = useLiveData(service.writeBlocked$);
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
        <PageTreeLoadError {...layer} retry={() => void service.load(target)} />
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
          writeBlocked ||
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

function PageTreeChildSortMenu({ item }: { item: PageTreeItem }) {
  // Menu content mounts on demand, so collapsed containers are checked without
  // loading every branch just to render the sidebar.
  const layer = usePageTreeLayer(item.nodeId);
  const sorting = useSorting(
    item.nodeId,
    item.defaultSortMode === 'name-desc' ? 'name-desc' : 'manual'
  );
  const saving = useLiveData(
    useService(WorkspacePageTreeService).writeBlocked$
  );
  if (layer.error || (layer.page?.items.length ?? 0) < 2) return null;
  return (
    <FolderSortMenu
      mode={sorting.mode}
      disabled={!sorting.ready || saving || layer.loading}
      onChange={sorting.setMode}
    />
  );
}

function PageTreeNode({
  item,
  siblingIds,
}: {
  item: PageTreeItem;
  siblingIds: readonly string[];
}) {
  const t = useI18n(),
    service = useService(WorkspacePageTreeService);
  const { workspace } = useService(WorkspaceService);
  const { workbench } = useService(WorkbenchService);
  const navigation = useService(NavigationPanelService);
  const created = useLiveData(useService(CreatedResourceService).reveal$);
  const createdFocusRef = useCreatedResourceFocus(
    'folder',
    item.resourceId,
    'a'
  );
  const rowRef = useRef<HTMLDivElement | null>(null);
  const attachRow = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element;
      createdFocusRef(element);
    },
    [createdFocusRef]
  );
  const revealedToken = useRef<number | null>(null);
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (!created?.nodeIds.includes(item.nodeId)) {
      setHighlight(false);
      return;
    }
    if (revealedToken.current === created.token) return;
    revealedToken.current = created.token;
    setHighlight(true);
    const frame = requestAnimationFrame(() => {
      if (created.nodeIds[0] !== item.nodeId) return;
      const link = rowRef.current?.querySelector<HTMLAnchorElement>('a');
      link?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    const timer = setTimeout(() => setHighlight(false), 2400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [created, item.nodeId, rowRef]);
  const store = useService(FolderSortingStore);
  const path = useMemo(() => ['page-tree', item.nodeId], [item.nodeId]);
  const collapsed = useLiveData(navigation.collapsed$(path));
  const saving = useLiveData(service.writeBlocked$);
  const [moving, setMoving] = useState(false);
  const drag = useContext(PageTreeDragContext);
  const placement =
    drag.target?.nodeId === item.nodeId ? drag.target.placement : null;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const attachContent = useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element;
  }, []);
  const container = item.isContainer;
  const open = () => workbench.openTreeResource(item);
  const reorder = async (
    direction: 'up' | 'down' | 'before' | 'after',
    sourceId = item.nodeId
  ) => {
    if (
      saving ||
      (sourceId === item.nodeId && ['before', 'after'].includes(direction))
    )
      return;
    const generation = service.accountGeneration;
    await service.load(item.parentNodeId);
    let layer = service.layer$(item.parentNodeId).value;
    while (layer.page?.nextCursor && !layer.error) {
      await service.load(item.parentNodeId, true);
      layer = service.layer$(item.parentNodeId).value;
    }
    if (
      generation !== service.accountGeneration ||
      layer.error ||
      !layer.page ||
      layer.page.nextCursor
    )
      throw new Error('Sibling level unavailable');
    const page = layer.page;
    const mode =
      (await firstValueFrom(store.watchMode(service.key(item.parentNodeId)))) ??
      (page.parent?.defaultSortMode === 'name-desc' ? 'name-desc' : 'manual');
    const siblings = sortFolderChildren(
      page.items.map(node => ({ ...node, id: node.nodeId })),
      mode,
      node => node.title
    );
    const index = siblings.findIndex(node => node.nodeId === item.nodeId);
    const target =
      direction === 'up'
        ? siblings[index - 1]
        : direction === 'down'
          ? siblings[index + 1]
          : item;
    if (index < 0 || !target) return;
    const order = pageTreeReorder(
      siblings.map(node => node.nodeId),
      sourceId,
      target.nodeId,
      direction === 'up' || direction === 'before' ? 'before' : 'after'
    );
    if (!order) return;
    const sameParent = page.items.some(node => node.nodeId === sourceId);
    if (
      sameParent &&
      samePageTreeOrder(
        order,
        siblings.map(node => node.nodeId)
      )
    )
      return;
    if (
      !sameParent ||
      !samePageTreeOrder(
        order,
        page.items.map(node => node.nodeId)
      )
    ) {
      await service.execute(
        {
          action: 'move',
          nodeId: sourceId,
          parentNodeId: item.parentNodeId,
          ...(sameParent
            ? { siblingOrder: order }
            : { targetSiblingOrder: order }),
        },
        {
          revision: page.revision,
          authorizationRevision: page.authorizationRevision,
        }
      );
    }
    if (generation === service.accountGeneration)
      store.setMode(service.key(item.parentNodeId), 'manual');
  };
  const accepts = (next: PageTreeDropPlacement) => {
    if (
      saving ||
      !item.canOrganize ||
      !contentRef.current ||
      !drag.source ||
      drag.source?.nodeId === item.nodeId
    )
      return false;
    const layer = service.layer$(item.parentNodeId).value.page;
    if (
      drag.source &&
      [
        ...(layer?.ancestors ?? []),
        ...(layer?.parent ? [layer.parent] : []),
      ].some(node => node.nodeId === drag.source?.nodeId)
    )
      return false;
    if (
      next !== 'inside' &&
      drag.source.parentNodeId === item.parentNodeId &&
      pageTreeReorderIsNoop(siblingIds, drag.source.nodeId, item.nodeId, next)
    )
      return false;
    return next !== 'inside' || container;
  };
  // Keep the visible row registry current with permissions, sorting and source.
  // The root resolves a single slot regardless of which nested element receives
  // the native drag event.
  useEffect(() => {
    if (!contentRef.current) return;
    const rows = drag.rows;
    rows.set(item.nodeId, {
      element: contentRef.current,
      container,
      accepts,
      drop: async (placement, sourceId) => {
        if (placement !== 'inside') {
          await reorder(placement, sourceId);
          return;
        }
        await service.execute({
          action: 'move',
          nodeId: sourceId,
          parentNodeId: item.nodeId,
        });
        navigation.setCollapsed(path, false);
      },
    });
    return () => {
      rows.delete(item.nodeId);
    };
  });
  const trash = () => void service.confirmLifecycle('trash', item.nodeId);
  return (
    <>
      <div
        ref={attachRow}
        className={styles.treeNode}
        data-page-tree-node-id={item.nodeId}
        data-page-tree-drop-placement={placement ?? undefined}
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
          if (saving || !item.canOrganize) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          drag.setSource(item);
          event.dataTransfer.setData(
            dragType,
            JSON.stringify({ workspaceId: workspace.id, nodeId: item.nodeId })
          );
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          drag.setSource(null);
        }}
      >
        <NavigationPanelTreeNode
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          rowRef={attachContent}
          dropInsideLabel={t['com.affine.localmind.page-tree.moveTarget']({
            name: item.title || t['Untitled'](),
          })}
          dropInstruction={
            placement
              ? {
                  type:
                    placement === 'inside'
                      ? 'make-child'
                      : placement === 'before'
                        ? 'reorder-above'
                        : 'reorder-below',
                  currentLevel:
                    (service.layer$(item.parentNodeId).value.page?.ancestors
                      .length ?? -1) + 1,
                  indentPerLevel: 20,
                }
              : null
          }
          active={
            highlight ||
            (created?.batch && created.nodeIds.includes(item.nodeId)) ||
            undefined
          }
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
                    view: <PageTreeChildSortMenu item={item} />,
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
  if (layer.error && !layer.page)
    return (
      <div className={styles.treeMessage}>
        <PageTreeLoadError
          {...layer}
          retry={() => void service.load(parentId)}
        />
      </div>
    );
  if (!layer.page || (sorting.mode !== 'manual' && layer.page.nextCursor))
    return (
      <div className={styles.treeMessage}>
        {layer.error ? (
          <PageTreeLoadError
            {...layer}
            retry={() => void service.load(parentId)}
          />
        ) : (
          <span role="status">
            {t['com.affine.localmind.page-tree.loading']()}
          </span>
        )}
      </div>
    );
  const items = sortFolderChildren(
    layer.page.items.map(item => ({ ...item, id: item.nodeId })),
    sorting.mode,
    item => item.title
  );
  const siblingIds = items.map(item => item.nodeId);
  return (
    <>
      {layer.error && (
        <div className={styles.treeMessage}>
          <PageTreeLoadError
            {...layer}
            retry={() => void service.load(parentId)}
          />
        </div>
      )}
      {items.map(item => (
        <PageTreeNode key={item.nodeId} item={item} siblingIds={siblingIds} />
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
  const writeBlocked = useLiveData(
    useService(WorkspacePageTreeService).writeBlocked$
  );
  return (
    <FolderSortButton
      name={t['com.affine.localmind.page-tree.root']()}
      mode={sorting.mode}
      expanded={expanded}
      disabled={!sorting.ready || writeBlocked}
      onChange={sorting.setMode}
    />
  );
}

export function WorkspacePageTree() {
  const t = useI18n();
  const service = useService(WorkspacePageTreeService),
    { workspace } = useService(WorkspaceService);
  const undo = useLiveData(service.undo$),
    saving = useLiveData(service.writeBlocked$);
  const syncing = useLiveData(service.syncing$);
  const rows = useRef(new Map<string, PageTreeDragRow>()).current;
  const [source, updateSource] = useState<PageTreeItem | null>(null);
  const [target, updateTarget] = useState<PageTreeDropTarget | null>(null);
  const setSource = useCallback((item: PageTreeItem | null) => {
    updateSource(item);
    updateTarget(null);
  }, []);
  const setTarget = useCallback((next: PageTreeDropTarget | null) => {
    updateTarget(current =>
      current?.nodeId === next?.nodeId && current?.placement === next?.placement
        ? current
        : next
    );
  }, []);
  const clearTarget = useCallback((nodeId?: string | null) => {
    updateTarget(current =>
      nodeId === undefined || current?.nodeId === nodeId ? null : current
    );
  }, []);
  useEffect(() => {
    setSource(null);
  }, [workspace.id, saving, setSource]);
  useEffect(() => {
    if (!source) return;
    const end = () => setSource(null);
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end();
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    window.addEventListener('blur', end);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
      window.removeEventListener('blur', end);
      window.removeEventListener('keydown', cancel);
    };
  }, [source, setSource]);
  const dragContext = useMemo(
    () => ({ rows, source, setSource, target, setTarget, clearTarget }),
    [rows, source, setSource, target, setTarget, clearTarget]
  );
  const resolveTarget = (y: number) => {
    if (!source || saving) return null;
    const visible = [...rows]
      .flatMap(([nodeId, row]) => {
        const rect = row.element.getBoundingClientRect();
        return rect.height
          ? [
              {
                nodeId,
                container: row.container,
                top: rect.top,
                bottom: rect.bottom,
              },
            ]
          : [];
      })
      .sort((a, b) => a.top - b.top);
    const next = pageTreeDropTarget(y, visible);
    return next?.nodeId && rows.get(next.nodeId)?.accepts(next.placement)
      ? next
      : null;
  };
  const canDropAtRoot = !!source && source.parentNodeId !== null && !saving;
  const rootDrop = target?.nodeId === null;
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.stopPropagation();
    const next = resolveTarget(event.clientY);
    setTarget(next);
    event.dataTransfer.dropEffect = next ? 'move' : 'none';
    if (next) event.preventDefault();
  };
  const handleRootDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.stopPropagation();
    setTarget(canDropAtRoot ? { nodeId: null, placement: 'inside' } : null);
    event.dataTransfer.dropEffect = canDropAtRoot ? 'move' : 'none';
    if (canDropAtRoot) event.preventDefault();
  };
  return (
    <PageTreeDragContext.Provider value={dragContext}>
      <NavigationPanelTreeRoot>
        <div
          role="group"
          className={styles.treeRoot}
          aria-label={t['com.affine.localmind.page-tree.root']()}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDrop={event => {
            const value = event.dataTransfer.getData(dragType);
            if (!value) return;
            event.preventDefault();
            event.stopPropagation();
            const next = resolveTarget(event.clientY);
            setSource(null);
            try {
              if (value.length > 4096) throw new Error('Invalid drag');
              const dropped = dragSchema.parse(JSON.parse(value));
              if (
                dropped.workspaceId !== workspace.id ||
                dropped.nodeId !== source?.nodeId
              )
                throw new Error('Invalid drag');
              if (!next?.nodeId) return;
              void rows
                .get(next.nodeId)
                ?.drop(next.placement, dropped.nodeId)
                .catch(() =>
                  toast(t['com.affine.localmind.page-tree.error']())
                );
            } catch {
              toast(t['com.affine.localmind.page-tree.error']());
            }
          }}
          onDragLeave={event => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              clearTarget();
          }}
        >
          {syncing && (
            <div role="status" className={styles.treeMessage}>
              {t['com.affine.localmind.page-tree.syncing']()}
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
          <div
            className={styles.treeRootDropZone}
            data-testid="page-tree-root-drop"
            data-active={rootDrop}
            onDragEnter={handleRootDragOver}
            onDragOver={handleRootDragOver}
            onDragLeave={event => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                clearTarget(null);
            }}
            onDrop={event => {
              event.preventDefault();
              event.stopPropagation();
              setSource(null);
              try {
                if (!canDropAtRoot) return;
                const value = event.dataTransfer.getData(dragType);
                if (!value || value.length > 4096) return;
                const dropped = dragSchema.parse(JSON.parse(value));
                if (
                  dropped.workspaceId !== workspace.id ||
                  dropped.nodeId !== source?.nodeId
                )
                  throw new Error('Invalid drag');
                void service
                  .execute({
                    action: 'move',
                    nodeId: dropped.nodeId,
                    parentNodeId: null,
                  })
                  .catch(() =>
                    toast(t['com.affine.localmind.page-tree.error']())
                  );
              } catch {
                toast(t['com.affine.localmind.page-tree.error']());
              }
            }}
          >
            {rootDrop && (
              <span role="status" className={styles.treeRootDropLabel}>
                {t['com.affine.localmind.page-tree.rootDrop']()}
              </span>
            )}
          </div>
        </div>
      </NavigationPanelTreeRoot>
    </PageTreeDragContext.Provider>
  );
}
