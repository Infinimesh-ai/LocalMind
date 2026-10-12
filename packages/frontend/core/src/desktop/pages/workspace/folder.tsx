import * as styles from '@affine/core/components/native-files/resource-explorer.css';
import {
  PageTreeBreadcrumbs,
  PageTreeChildrenList,
} from '@affine/core/components/page-tree/children';
import { folderBody } from '@affine/core/components/page-tree/children.css';
import { FolderResourceActions } from '@affine/core/components/page-tree/folder-row';
import { PageTreeLoadError } from '@affine/core/components/page-tree/load-error';
import { usePageTreeLayer } from '@affine/core/components/root-app-sidebar/page-tree';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import {
  ViewBody,
  ViewHeader,
  ViewTitle,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

export function Component() {
  const { nodeId = '' } = useParams();
  const layer = usePageTreeLayer(nodeId);
  const tree = useService(WorkspacePageTreeService);
  const item = layer.page?.parent;
  const workbench = useService(WorkbenchService).workbench;
  const t = useI18n();
  useEffect(() => {
    if (item && item.kind !== 'folder')
      workbench.openTreeResource(item, { replaceHistory: true });
  }, [item, workbench]);
  return (
    <>
      <ViewTitle
        title={
          item?.title ??
          t['com.affine.localmind.resource-display.type.folder']()
        }
      />
      <ViewHeader>
        <div className={styles.toolbar}>
          <strong className={styles.name}>{item?.title}</strong>
          {item?.kind === 'folder' && <FolderResourceActions item={item} />}
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={folderBody}>
          <PageTreeBreadcrumbs
            kind="folder"
            resourceId={item?.resourceId ?? ''}
            parentNodeId={nodeId}
          />
          {item?.kind === 'folder' ? (
            <PageTreeChildrenList parentNodeId={nodeId} />
          ) : layer.error ? (
            <PageTreeLoadError
              {...layer}
              retry={() => void tree.load(nodeId)}
            />
          ) : (
            <p role="status">{t['Loading']()}</p>
          )}
        </div>
      </ViewBody>
    </>
  );
}
