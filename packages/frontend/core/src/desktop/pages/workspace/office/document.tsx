import { Button } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { WorkspaceNativeActions } from '@affine/core/components/native-files/workspace-actions';
import { OfficeCommentsPanel } from '@affine/core/components/office/comments';
import { createOfficeResourceAdapter } from '@affine/core/components/office/resource-adapter';
import { useOfficeResourceSession } from '@affine/core/components/office/resource-session';
import { OfficeResourceSurface } from '@affine/core/components/office/resource-surface';
import { GraphQLService } from '@affine/core/modules/cloud';
import { NbstoreService } from '@affine/core/modules/storage';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewService,
  ViewSidebarTab,
  ViewTitle,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  type WorkspaceNativeResourceQuery,
  workspaceNativeResourceQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { AiIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { merge } from 'rxjs';

import { OfficeChatPanel } from './chat';
import * as styles from './document.css';
export { DocumentEditor } from '@affine/core/components/office/document-editor';
export { revisionCompareChanges } from '@affine/core/components/office/revision-history';

function WorkspaceOffice({
  workspaceId,
  artifactId,
  nativeResource,
  refreshLifecycle,
  unavailable = false,
}: {
  workspaceId: string;
  artifactId: string;
  nativeResource: WorkspaceNativeResourceQuery['workspaceNativeResource'];
  refreshLifecycle: () => void;
  unavailable?: boolean;
}) {
  const graphql = useService(GraphQLService);
  const t = useI18n();
  const canEdit = !unavailable && nativeResource.canEdit === true;
  const realtime = useService(NbstoreService).realtime;
  const workbench = useService(WorkbenchService).workbench;
  const view = useService(ViewService).view;
  const adapter = useMemo(
    () =>
      createOfficeResourceAdapter(
        graphql,
        { kind: 'workspace', workspaceId },
        artifactId
      ),
    [graphql, workspaceId, artifactId]
  );
  const session = useOfficeResourceSession(adapter);
  const { dirty, confirmUnsaved, unsaved, report } = session;
  useEffect(() => {
    if (!unsaved) return;
    const unblock = view.history.block(transition => {
      void (dirty() ? confirmUnsaved() : Promise.resolve(true))
        .then(allowed => {
          if (allowed) {
            unblock();
            transition.retry();
          }
        })
        .catch(report);
    });
    return unblock;
  }, [view, unsaved, dirty, confirmUnsaved, report]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const { artifact, revision } = session;
  return (
    <>
      <ViewTitle title={artifact?.title ?? 'LocalMind Office'} />
      <ViewIcon icon="doc" />
      <OfficeResourceSurface
        adapter={adapter}
        session={session}
        graphql={graphql}
        capabilities={{
          canEdit,
          canDownload: !unavailable,
          canPrint: !unavailable,
          canExportPdf: !unavailable && artifact?.kind === 'document',
          canViewHistory: !unavailable,
          canComment: !unavailable,
          canUseAI: !unavailable,
        }}
        actionsEnd={
          artifact && (!unavailable || nativeResource.trashedAt) ? (
            <WorkspaceNativeActions
              workspaceId={workspaceId}
              resourceId={artifactId}
              kind="office"
              title={artifact.title}
              trashed={!!nativeResource.trashedAt}
              beforeChange={session.confirmUnsaved}
              capabilities={nativeResource}
              onChanged={() => {
                refreshLifecycle();
                void session.refresh().catch(() => undefined);
              }}
            />
          ) : undefined
        }
        onAI={() => {
          workbench.openSidebar();
          view.activeSidebarTab('chat');
        }}
        onComments={() => setCommentsOpen(true)}
      >
        {({ header, body, overlays }) => (
          <>
            {BUILD_CONFIG.isMobileWeb ? (
              <div className={styles.mobileRoot}>
                {header}
                {unavailable && (
                  <p role="alert">
                    {t[
                      nativeResource.trashedAt
                        ? 'com.affine.localmind.resources.inTrash'
                        : 'com.affine.localmind.resources.unavailable'
                    ]()}
                    {unsaved &&
                      ` ${t['com.affine.localmind.resources.draftWarning']()}`}
                  </p>
                )}
                <div
                  hidden={unavailable}
                  style={{ display: unavailable ? 'none' : 'contents' }}
                >
                  {body}
                </div>
              </div>
            ) : (
              <>
                <ViewHeader>{header}</ViewHeader>
                <ViewBody>
                  {unavailable && (
                    <p role="alert">
                      {t[
                        nativeResource.trashedAt
                          ? 'com.affine.localmind.resources.inTrash'
                          : 'com.affine.localmind.resources.unavailable'
                      ]()}
                      {unsaved &&
                        ` ${t['com.affine.localmind.resources.draftWarning']()}`}
                    </p>
                  )}
                  <div
                    hidden={unavailable}
                    style={{ display: unavailable ? 'none' : 'contents' }}
                  >
                    {body}
                  </div>
                </ViewBody>
              </>
            )}
            {overlays}
          </>
        )}
      </OfficeResourceSurface>
      {!unavailable && artifact && revision ? (
        <>
          <ViewSidebarTab
            tabId="chat"
            icon={<AiIcon />}
            unmountOnInactive={false}
          >
            <OfficeChatPanel
              workspaceId={workspaceId}
              artifact={artifact}
              revision={revision}
              selection={session.selection}
              selectionNotice={session.selectionNotice}
              autoRefreshEnabled={!session.historical && !session.conflict}
              onClearSelection={() => session.setSelection(null)}
              onTaskRevision={session.onTaskRevision}
            />
          </ViewSidebarTab>
          <OfficeCommentsPanel
            open={commentsOpen}
            workspaceId={workspaceId}
            artifactId={artifactId}
            anchor={session.historical ? null : session.commentAnchor}
            readOnly={session.historical || !canEdit}
            graphql={graphql}
            realtime={realtime}
            onOpenChange={setCommentsOpen}
          />
        </>
      ) : null}
    </>
  );
}
export const Component = () => {
  const { artifactId = '' } = useParams<{ artifactId: string }>();
  const workspaceId = useService(WorkspaceService).workspace.id;
  const realtime = useService(NbstoreService).realtime;
  const t = useI18n();
  const query = useQuery(
    {
      query: workspaceNativeResourceQuery,
      variables: {
        input: { workspaceId, resourceId: artifactId, kind: 'office' },
        trash: true,
      },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const { mutate } = query;
  useEffect(() => {
    const subscription = merge(
      realtime.subscribe('workspace.nativeResources.changed', { workspaceId }),
      realtime.subscribe('workspace.access.changed', { workspaceId }),
      realtime.subscribe('workspace.directory-policy.changed', { workspaceId })
    ).subscribe({
      next: () => void mutate().catch(() => undefined),
      error: () => void mutate().catch(() => undefined),
    });
    return () => subscription.unsubscribe();
  }, [realtime, workspaceId, mutate]);
  const resource = query.data?.workspaceNativeResource;
  // Keep an already opened editor mounted so a remote trash/revocation cannot
  // silently discard local drafts. Its content and write controls are hidden.
  const retained = useRef<{
    key: string;
    resource: NonNullable<typeof resource>;
  } | null>(null);
  const identity = `${workspaceId}:${artifactId}`;
  if (resource && !resource.trashedAt && !query.error)
    retained.current = { key: identity, resource };
  if (retained.current?.key === identity) {
    return (
      <WorkspaceOffice
        key={identity}
        workspaceId={workspaceId}
        artifactId={artifactId}
        nativeResource={resource ?? retained.current.resource}
        unavailable={!!query.error || !!resource?.trashedAt}
        refreshLifecycle={() => void mutate().catch(() => undefined)}
      />
    );
  }
  if (query.error)
    return (
      <ViewBody>
        <p role="alert">{t['com.affine.localmind.resources.unavailable']()}</p>
        <Button onClick={() => void mutate()}>
          {t['com.affine.error.retry']()}
        </Button>
      </ViewBody>
    );
  if (!resource)
    return (
      <ViewBody>
        <p role="status">{t['Loading']()}</p>
      </ViewBody>
    );
  if (resource.trashedAt)
    return (
      <>
        <ViewTitle title={resource.title} />
        <ViewBody>
          <p>{resource.title}</p>
          <p>{t['com.affine.localmind.resources.inTrash']()}</p>
          <WorkspaceNativeActions
            workspaceId={workspaceId}
            resourceId={artifactId}
            kind="office"
            title={resource.title}
            trashed
            capabilities={resource}
            onChanged={() => void mutate()}
          />
        </ViewBody>
      </>
    );
  return (
    <WorkspaceOffice
      key={`${workspaceId}:${artifactId}`}
      workspaceId={workspaceId}
      artifactId={artifactId}
      nativeResource={resource}
      refreshLifecycle={() => void mutate()}
    />
  );
};
