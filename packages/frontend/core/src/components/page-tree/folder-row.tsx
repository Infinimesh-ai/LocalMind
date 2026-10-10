import { Button, Menu, MenuItem } from '@affine/component';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import type { PageTreeItem } from '@affine/core/modules/organize/services/page-tree';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { resourceDate } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { FolderIcon, MoreHorizontalIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useContext, useState } from 'react';

import { DocExplorerContext } from '../explorer/context';
import { defaultResourceProperties } from '../explorer/resource-preferences';
import { ResourceMetadata } from '../native-files/resource-metadata';
import { ResourceRowShell } from '../native-files/resource-row-shell';
import {
  FolderTreeActions,
  MovePageDialog,
} from '../root-app-sidebar/page-tree';

export function FolderResourceActions({ item }: { item: PageTreeItem }) {
  const tree = useService(WorkspacePageTreeService);
  const saving = useLiveData(tree.saving$);
  const t = useI18n();
  const [moving, setMoving] = useState(false);
  return (
    <>
      <Menu
        items={
          <>
            <FolderTreeActions item={item} />
            <MenuItem
              disabled={saving || !item.canOrganize}
              onClick={() => setMoving(true)}
            >
              {t['com.affine.localmind.page-tree.move']()}
            </MenuItem>
            <MenuItem
              disabled={saving || !item.canOrganize}
              onClick={() => void tree.confirmLifecycle('trash', item.nodeId)}
            >
              {t['com.affine.localmind.resources.moveToTrash']()}
            </MenuItem>
          </>
        }
      >
        <Button
          variant="plain"
          aria-label={t['com.affine.localmind.native-files.manage']()}
        >
          <MoreHorizontalIcon />
        </Button>
      </Menu>
      {moving && (
        <MovePageDialog item={item} onClose={() => setMoving(false)} />
      )}
    </>
  );
}

export function FolderResourceRow({ item }: { item: PageTreeItem }) {
  const preference = useLiveData(
    useContext(DocExplorerContext).displayPreference$
  );
  const workbench = useService(WorkbenchService).workbench;
  return (
    <ResourceRowShell
      id={`folder:${item.nodeId}`}
      title={item.title}
      icon={<FolderIcon />}
      onOpen={() => workbench.openTreeResource(item)}
      actions={<FolderResourceActions item={item} />}
    >
      <ResourceMetadata
        properties={preference.resourceProperties ?? defaultResourceProperties}
        tags={[]}
        documentType="folder"
        createdAt={resourceDate(item.folder?.createdAt)}
        createdBy={item.folder?.createdBy}
        updatedAt={resourceDate(item.folder?.updatedAt)}
        updatedBy={item.folder?.updatedBy}
      />
    </ResourceRowShell>
  );
}
