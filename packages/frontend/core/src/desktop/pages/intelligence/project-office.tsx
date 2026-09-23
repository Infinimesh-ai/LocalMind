import { IconButton } from '@affine/component';
import { OfficeCommentsPanel } from '@affine/core/components/office/comments';
import { createOfficeResourceAdapter } from '@affine/core/components/office/resource-adapter';
import { useOfficeResourceSession } from '@affine/core/components/office/resource-session';
import { OfficeResourceSurface } from '@affine/core/components/office/resource-surface';
import { officeSelectionLabel } from '@affine/core/components/office/selection-label';
import { GraphQLService } from '@affine/core/modules/cloud';
import { useProjectEditGuard } from '@affine/core/modules/project-resources/edit-guard';
import { useProjectEditLease } from '@affine/core/modules/project-resources/edit-lease';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import { NbstoreService } from '@affine/core/modules/storage';
import { useI18n } from '@affine/i18n';
import { ResetIcon } from '@blocksuite/icons/rc';
import type { OfficeAiContext } from '@localmind/office';
import { useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './project-files.css';

type Props = {
  projectId: string;
  artifactId: string;
  onContextChange: (context: OfficeAiContext | undefined) => void;
};
function ProjectOfficeSession({
  projectId,
  artifactId,
  onContextChange,
}: Props) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const realtime = useService(NbstoreService).realtime;
  const lease = useProjectEditLease();
  const adapter = useMemo(
    () =>
      createOfficeResourceAdapter(
        graphql,
        { kind: 'project', projectId },
        artifactId
      ),
    [graphql, projectId, artifactId]
  );
  const session = useOfficeResourceSession(adapter);
  useProjectRefresh(projectId, 'resource', session.refresh);
  useProjectEditGuard({
    get hasUnsavedChanges() {
      return session.dirty();
    },
    save: session.save,
    discard: session.discard,
  });
  const { artifact, revision, historical, conflict, selection } = session;
  const context = useMemo<OfficeAiContext | undefined>(
    () =>
      artifact && revision && !historical && !conflict
        ? {
            version: 'localmind-project-office-ai-context/v1',
            projectId,
            artifactId,
            artifactKind: artifact.kind,
            revisionId: revision.id,
            ...(selection?.kind === artifact.kind ? { selection } : {}),
          }
        : undefined,
    [artifact, revision, historical, conflict, projectId, artifactId, selection]
  );
  useEffect(() => {
    onContextChange(context);
    return () => onContextChange(undefined);
  }, [context, onContextChange]);
  return (
    <div className={styles.preview}>
      <OfficeResourceSurface
        adapter={adapter}
        session={session}
        owner={{
          kind: 'project',
          projectId,
          editLease: lease?.proof ?? undefined,
        }}
        graphql={graphql}
        onComments={() => setCommentsOpen(true)}
        capabilities={{
          canEdit: !!lease?.proof,
          canDownload: true,
          canPrint: true,
          canExportPdf: artifact?.kind === 'document',
          canViewHistory: true,
          canComment: true,
          canUseAI: true,
        }}
      >
        {({ header, body, overlays }) => (
          <>
            {header}
            {selection && !historical ? (
              <div className={styles.toolbar}>
                <span className={styles.heading}>
                  {officeSelectionLabel(selection)}
                </span>
                <IconButton
                  size="20"
                  icon={<ResetIcon />}
                  tooltip={t[
                    'com.affine.localmind.project-files.clearSelection'
                  ]()}
                  aria-label={t[
                    'com.affine.localmind.project-files.clearSelection'
                  ]()}
                  onClick={() => session.setSelection(null)}
                />
              </div>
            ) : null}
            <div className={styles.officeBody}>
              <div className={styles.officeEditor}>{body}</div>
            </div>
            {overlays}
            <OfficeCommentsPanel
              open={commentsOpen}
              owner={adapter.owner}
              artifactId={artifactId}
              anchor={historical ? null : session.commentAnchor}
              readOnly={historical}
              graphql={graphql}
              realtime={realtime}
              onOpenChange={setCommentsOpen}
            />
          </>
        )}
      </OfficeResourceSurface>
    </div>
  );
}
export function ProjectOffice(props: Props) {
  return (
    <ProjectOfficeSession
      key={`${props.projectId}:${props.artifactId}`}
      {...props}
    />
  );
}
