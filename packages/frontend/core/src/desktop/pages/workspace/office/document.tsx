import { OfficeCommentsPanel } from '@affine/core/components/office/comments';
import { createOfficeResourceAdapter } from '@affine/core/components/office/resource-adapter';
import { useOfficeResourceSession } from '@affine/core/components/office/resource-session';
import { OfficeResourceSurface } from '@affine/core/components/office/resource-surface';
import { GraphQLService } from '@affine/core/modules/cloud';
import { GuardService } from '@affine/core/modules/permissions';
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
import { AiIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { OfficeChatPanel } from './chat';
import * as styles from './document.css';
export { DocumentEditor } from '@affine/core/components/office/document-editor';
export { revisionCompareChanges } from '@affine/core/components/office/revision-history';

function WorkspaceOffice({
  workspaceId,
  artifactId,
}: {
  workspaceId: string;
  artifactId: string;
}) {
  const graphql = useService(GraphQLService);
  const canEdit =
    useLiveData(useService(GuardService).can$('Workspace_Blobs_Write')) ===
    true;
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
          canDownload: true,
          canPrint: true,
          canExportPdf: artifact?.kind === 'document',
          canViewHistory: true,
          canComment: true,
          canUseAI: true,
        }}
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
                {body}
              </div>
            ) : (
              <>
                <ViewHeader>{header}</ViewHeader>
                <ViewBody>{body}</ViewBody>
              </>
            )}
            {overlays}
          </>
        )}
      </OfficeResourceSurface>
      {artifact && revision ? (
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
  return (
    <WorkspaceOffice
      key={`${workspaceId}:${artifactId}`}
      workspaceId={workspaceId}
      artifactId={artifactId}
    />
  );
};
