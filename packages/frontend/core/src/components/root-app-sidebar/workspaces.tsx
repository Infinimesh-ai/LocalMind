import { Button, IconButton, Skeleton } from '@affine/component';
import { NavigationPanelOrganize } from '@affine/core/desktop/components/navigation-panel';
import { NavigationPanelDocNode } from '@affine/core/desktop/components/navigation-panel/nodes/doc';
import { AddPageButton } from '@affine/core/modules/app-sidebar/views';
import { DocsService } from '@affine/core/modules/doc';
import { OrganizeService } from '@affine/core/modules/organize';
import { WorkbenchService } from '@affine/core/modules/workbench';
import {
  type WorkspaceMetadata,
  WorkspaceService,
  WorkspacesService,
  WorkspaceSwitchService,
} from '@affine/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@affine/env/constant';
import { useI18n } from '@affine/i18n';
import { ArrowDownSmallIcon, PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import { Guard } from '../guard';
import { useNavigateHelper } from '../hooks/use-navigate-helper';
import { useWorkspaceInfo } from '../hooks/use-workspace-info';
import { WorkspaceAvatar } from '../workspace-avatar';
import * as styles from './index.css';

const ROOT_DOCS_PATH = ['workspace-files'];
const PAGE_SIZE = 50;

export function WorkspaceRootDocs() {
  const t = useI18n();
  const docs = useService(DocsService).list;
  const folderTree = useService(OrganizeService).folderTree;
  const ids = useLiveData(docs.nonTrashDocsIds$);
  const linkedIds = useLiveData(folderTree.linkedDocIds$);
  const available = useLiveData(docs.isAvailable$);
  const foldersLoading = useLiveData(folderTree.isLoading$);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const rootIds = ids.filter(id => !linkedIds.has(id));

  if (!available || foldersLoading)
    return (
      <div className={styles.treeMessage} role="status">
        <Skeleton height={24} />
      </div>
    );

  return (
    <>
      {!ids.length && (
        <div className={styles.treeMessage}>
          {t['com.affine.rootAppSidebar.no-documents']()}
        </div>
      )}
      {rootIds.slice(0, limit).map(docId => (
        <Guard key={docId} docId={docId} permission="Doc_Read">
          {canRead =>
            canRead ? (
              <NavigationPanelDocNode
                docId={docId}
                reorderable={false}
                parentPath={ROOT_DOCS_PATH}
                location={{ at: 'all-docs:list' }}
              />
            ) : null
          }
        </Guard>
      ))}
      {rootIds.length > limit && (
        <Button
          variant="plain"
          onClick={() => setLimit(value => value + PAGE_SIZE)}
        >
          {t['com.affine.quicksearch.load-more']()}
        </Button>
      )}
    </>
  );
}

export function SidebarWorkspaceRow({
  metadata,
  active,
  selected = active,
  pending = false,
  onSelect,
}: {
  metadata: WorkspaceMetadata;
  active: boolean;
  selected?: boolean;
  pending?: boolean;
  onSelect: (metadata: WorkspaceMetadata) => void;
}) {
  const info = useWorkspaceInfo(metadata);
  const t = useI18n();
  const [expanded, setExpanded] = useState(active);
  useEffect(() => setExpanded(active), [active]);
  const name = info?.name ?? UNTITLED_WORKSPACE_NAME;
  const open = active && expanded;
  const treeId = `sidebar-workspace-${metadata.flavour}-${metadata.id}`;

  return (
    <div>
      <div className={styles.workspaceRow} data-active={selected}>
        <button
          type="button"
          className={styles.workspaceButton}
          aria-label={pending ? `${name}, ${t['com.affine.loading']()}` : name}
          aria-expanded={open}
          aria-controls={open ? treeId : undefined}
          aria-current={selected ? 'true' : undefined}
          aria-busy={pending || undefined}
          disabled={pending}
          data-testid={`sidebar-workspace-${metadata.id}`}
          onClick={() => {
            if (active && selected) setExpanded(value => !value);
            else onSelect(metadata);
          }}
        >
          <ArrowDownSmallIcon
            className={styles.workspaceChevron}
            data-expanded={open}
            width={16}
            height={16}
          />
          <WorkspaceAvatar
            meta={metadata}
            name={name}
            size={20}
            rounded={3}
            colorfulFallback
          />
          <span className={styles.workspaceName}>
            {info ? name : <Skeleton width={100} />}
          </span>
          {pending && (
            <span className={styles.workspaceSwitchStatus} role="status">
              {t['com.affine.loading']()}
            </span>
          )}
        </button>
        {active && <AddPageButton className={styles.createDoc} />}
      </div>
      {open && (
        <div id={treeId} className={styles.workspaceFiles}>
          <NavigationPanelOrganize
            sectionPath="workspace-files"
            title={t['com.affine.rootAppSidebar.files']()}
          >
            <WorkspaceRootDocs />
          </NavigationPanelOrganize>
        </div>
      )}
    </div>
  );
}

export function SidebarWorkspaces() {
  const t = useI18n();
  const workspacesService = useService(WorkspacesService);
  const workspaceSwitchService = useService(WorkspaceSwitchService);
  const current = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const workspaces = useLiveData(workspacesService.list.workspaces$);
  const switchState = useLiveData(workspaceSwitchService.state$);
  const { jumpToPage } = useNavigateHelper();
  const pendingWorkspaceId =
    switchState.phase === 'preparing' || switchState.phase === 'local-ready'
      ? switchState.targetWorkspaceId
      : undefined;
  const selectWorkspace = useCallback(
    (metadata: WorkspaceMetadata) => {
      if (workspaceSwitchService.isPending(metadata.id)) {
        return;
      }
      workspaceSwitchService.begin(metadata.id);
      jumpToPage(metadata.id, 'all');
    },
    [jumpToPage, workspaceSwitchService]
  );

  return (
    <section aria-label={t['com.affine.rootAppSidebar.workspaces']()}>
      <div className={styles.workspacesHeading}>
        <span>{t['com.affine.rootAppSidebar.workspaces']()}</span>
        <IconButton
          size="16"
          aria-label={t['com.affine.rootAppSidebar.manage-workspaces']()}
          tooltip={t['com.affine.rootAppSidebar.manage-workspaces']()}
          onClick={() => workbench.setWorkspaceSelectorOpen(true)}
        >
          <PlusIcon />
        </IconButton>
      </div>
      {workspaces.map(metadata => (
        <SidebarWorkspaceRow
          key={`${metadata.flavour}:${metadata.id}`}
          metadata={metadata}
          active={
            metadata.id === current.id && metadata.flavour === current.flavour
          }
          selected={
            pendingWorkspaceId
              ? metadata.id === pendingWorkspaceId
              : metadata.id === current.id &&
                metadata.flavour === current.flavour
          }
          pending={metadata.id === pendingWorkspaceId}
          onSelect={selectWorkspace}
        />
      ))}
    </section>
  );
}
