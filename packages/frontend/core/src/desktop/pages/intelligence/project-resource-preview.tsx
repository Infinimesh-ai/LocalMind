import { Button, IconButton, Loading } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { ProjectEditorGuard } from '@affine/core/modules/project-resources/edit-guard';
import { ProjectResourceEditLeaseProvider } from '@affine/core/modules/project-resources/edit-lease';
import {
  projectErrorMessage,
  reportProjectError,
} from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  ProjectResourceKind,
  projectResourcePathQuery,
  projectResourceQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { AiIcon, CloseIcon, ExpandFullIcon } from '@blocksuite/icons/rc';
import type { OfficeAiContext } from '@localmind/office';
import { useState } from 'react';

import { ProjectDocument } from './project-document';
import { ProjectFile } from './project-file';
import * as styles from './project-files.css';
import { ProjectOffice } from './project-office';
import { ProjectPublicationActions } from './project-publications';
import { ProjectSourceRefresh } from './project-source-refresh';

export function ProjectResourcePreview({
  projectId,
  resourceId,
  onClose,
  onOfficeContextChange,
  fullscreen,
  onToggleFullscreen,
  referenced = false,
  onReference,
}: {
  projectId: string;
  resourceId: string;
  onClose: () => void;
  onOfficeContextChange: (context: OfficeAiContext | undefined) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  referenced?: boolean;
  onReference?: () => Promise<void> | void;
}) {
  const t = useI18n();
  const query = useQuery(
    { query: projectResourceQuery, variables: { projectId, resourceId } },
    { suspense: false, shouldRetryOnError: false }
  );
  const path = useQuery(
    { query: projectResourcePathQuery, variables: { projectId, resourceId } },
    { suspense: false, shouldRetryOnError: false }
  );
  useProjectRefresh(projectId, 'resource', () =>
    Promise.all([query.mutate(), path.mutate()])
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const resource = query.data?.projectResource;
  const queryError = query.error ?? path.error;
  return (
    <ProjectEditorGuard>
      <ProjectResourceEditLeaseProvider
        key={`${projectId}:${resourceId}`}
        projectId={projectId}
        resourceId={resourceId}
        artifactId={resource?.officeArtifactId ?? undefined}
      >
        <section
          className={styles.preview}
          aria-label={
            resource?.title ?? t['com.affine.localmind.project-files.title']()
          }
        >
          <header className={styles.toolbar}>
            <h2
              className={styles.heading}
              title={path.data?.projectResourcePath
                .map(item => item.title)
                .join(' / ')}
            >
              {queryError
                ? t['com.affine.localmind.project-files.title']()
                : resource?.title}
            </h2>
            {resource && !queryError ? (
              <ProjectPublicationActions
                key={`publication:${projectId}:${resourceId}`}
                projectId={projectId}
                resourceId={resourceId}
              />
            ) : null}
            {resource && !queryError ? (
              <ProjectSourceRefresh
                key={`source:${projectId}:${resourceId}`}
                projectId={projectId}
                resourceId={resourceId}
                onRefreshed={() => {
                  setRefreshVersion(value => value + 1);
                  void query.mutate().catch(reportProjectError);
                }}
              />
            ) : null}
            {resource && !queryError && onReference ? (
              <Button disabled={referenced} onClick={() => void onReference()}>
                {t[
                  referenced
                    ? 'com.affine.localmind.workbench.v9.referenced'
                    : 'com.affine.localmind.workbench.v9.referenceResource'
                ]()}
              </Button>
            ) : null}
            <IconButton
              size="20"
              icon={fullscreen ? <AiIcon /> : <ExpandFullIcon />}
              tooltip={t[
                fullscreen
                  ? 'com.affine.localmind.project-files.exitFullscreen'
                  : 'com.affine.localmind.project-files.fullscreen'
              ]()}
              aria-label={t[
                fullscreen
                  ? 'com.affine.localmind.project-files.exitFullscreen'
                  : 'com.affine.localmind.project-files.fullscreen'
              ]()}
              aria-pressed={fullscreen}
              onClick={onToggleFullscreen}
            />
            <IconButton
              size="20"
              icon={<CloseIcon />}
              tooltip={t['com.affine.localmind.project-files.close']()}
              aria-label={t['com.affine.localmind.project-files.close']()}
              onClick={onClose}
            />
          </header>
          {query.isLoading ? (
            <div className={styles.state}>
              <Loading size={24} />
            </div>
          ) : queryError || !resource ? (
            <div className={styles.state} role="alert">
              <span>
                {queryError
                  ? projectErrorMessage(queryError)
                  : t['com.affine.localmind.project-files.empty']()}
              </span>
              <Button
                onClick={() => {
                  query.mutate().catch(reportProjectError);
                  path.mutate().catch(reportProjectError);
                }}
              >
                {t['com.affine.localmind.project-files.retry']()}
              </Button>
            </div>
          ) : resource.officeArtifactId ? (
            <ProjectOffice
              key={`${resourceId}:${refreshVersion}`}
              projectId={projectId}
              artifactId={resource.officeArtifactId}
              onContextChange={onOfficeContextChange}
            />
          ) : resource.kind === ProjectResourceKind.page ||
            resource.kind === ProjectResourceKind.edgeless ? (
            <ProjectDocument
              key={`${resourceId}:${refreshVersion}`}
              projectId={projectId}
              resourceId={resourceId}
              title={resource.title}
              mode={
                resource.kind === ProjectResourceKind.edgeless
                  ? 'edgeless'
                  : 'page'
              }
            />
          ) : (
            <ProjectFile
              key={`${resourceId}:${resource.contentVersion}`}
              projectId={projectId}
              resourceId={resourceId}
              title={resource.title}
            />
          )}
        </section>
      </ProjectResourceEditLeaseProvider>
    </ProjectEditorGuard>
  );
}
