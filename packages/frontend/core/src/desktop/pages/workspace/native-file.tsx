import { Button, useConfirmModal } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import * as styles from '@affine/core/components/native-files/resource-explorer.css';
import { WorkspaceNativeActions } from '@affine/core/components/native-files/workspace-actions';
import { WorkspaceNativeFileEditor } from '@affine/core/components/native-files/workspace-file-editor';
import { NbstoreService } from '@affine/core/modules/storage';
import {
  ViewBody,
  ViewHeader,
  ViewTitle,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';
import { workspaceNativeResourceQuery } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { merge } from 'rxjs';

export function Component() {
  const { resourceId = '' } = useParams();
  const workspaceId = useService(WorkspaceService).workspace.id;
  const workbench = useService(WorkbenchService).workbench;
  const catalog = useService(WorkspaceResourcesService);
  const realtime = useService(NbstoreService).realtime;
  const t = useI18n();
  const [dirty, setDirty] = useState(false);
  const { openConfirmModal } = useConfirmModal();
  const beforeChange = () =>
    !dirty
      ? Promise.resolve(true)
      : new Promise<boolean>(resolve =>
          openConfirmModal({
            title: t['com.affine.localmind.resources.draftWarning'](),
            confirmText: t['Confirm'](),
            cancelText: t['Cancel'](),
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          })
        );
  const query = useQuery(
    {
      query: workspaceNativeResourceQuery,
      variables: {
        input: { workspaceId, resourceId, kind: 'file' },
        trash: true,
      },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const { mutate } = query;
  useEffect(() => {
    const sub = merge(
      realtime.subscribe('workspace.nativeResources.changed', { workspaceId }),
      realtime.subscribe('workspace.access.changed', { workspaceId }),
      realtime.subscribe('workspace.directory-policy.changed', { workspaceId })
    ).subscribe({
      next: () => void mutate().catch(() => undefined),
      error: () => void mutate().catch(() => undefined),
    });
    return () => sub.unsubscribe();
  }, [realtime, workspaceId, mutate]);
  const resource = query.data?.workspaceNativeResource;
  return (
    <>
      <ViewTitle
        title={resource?.title ?? t['com.affine.rootAppSidebar.files']()}
      />
      <ViewHeader>
        <div className={styles.toolbar}>
          <strong className={styles.name}>{resource?.title}</strong>
          {resource && !query.error && (
            <WorkspaceNativeActions
              workspaceId={workspaceId}
              resourceId={resourceId}
              kind="file"
              title={resource.title}
              trashed={!!resource.trashedAt}
              capabilities={resource}
              beforeChange={beforeChange}
              onChanged={() => {
                catalog.invalidate();
                void mutate().catch(() => undefined);
              }}
            />
          )}
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={styles.editorBody}>
          {query.error && (
            <p role="alert">
              {t['com.affine.localmind.resources.unavailable']()}
            </p>
          )}
          {resource?.trashedAt && (
            <p>{t['com.affine.localmind.resources.inTrash']()}</p>
          )}
          {!resource && !query.error && <p role="status">{t['Loading']()}</p>}
          {resource && ((!resource.trashedAt && !query.error) || dirty) && (
            <WorkspaceNativeFileEditor
              key={resourceId}
              embedded
              resourceId={resourceId}
              title={resource.title}
              unavailable={!!resource.trashedAt || !!query.error}
              onDirtyChange={setDirty}
              onClose={() => workbench.openAll()}
              onChanged={() => {
                catalog.invalidate();
                void mutate().catch(() => undefined);
              }}
            />
          )}
          {query.error && (
            <Button onClick={() => void mutate()}>
              {t['com.affine.error.retry']()}
            </Button>
          )}
        </div>
      </ViewBody>
    </>
  );
}
