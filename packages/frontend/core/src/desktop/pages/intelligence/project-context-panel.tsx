import { Button, Loading } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import {
  copilotCollaborationGraphGetQuery,
  projectResourceQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { PageIcon } from '@blocksuite/icons/rc';
import { useMemo } from 'react';

import * as styles from './project-context-panel.css';
import { ProjectTasks } from './project-tasks';
import type { WorkbenchContextPanelState } from './workbench-conversation';

function ContextResource({
  projectId,
  resourceId,
  onOpen,
}: {
  projectId: string;
  resourceId: string;
  onOpen: (resourceId: string) => void;
}) {
  const t = useI18n();
  const query = useQuery(
    { query: projectResourceQuery, variables: { projectId, resourceId } },
    { suspense: false, shouldRetryOnError: false }
  );
  return (
    <li>
      <button
        type="button"
        data-project-context-resource-id={resourceId}
        onClick={() => onOpen(resourceId)}
      >
        <PageIcon />
        <span>
          {query.isLoading
            ? t['Loading']()
            : (query.data?.projectResource.title ?? resourceId)}
        </span>
      </button>
    </li>
  );
}

export function ProjectContextPanel({
  projectId,
  sessionId,
  state,
  onOpenResource,
  onDocumentsChanged,
}: {
  projectId: string;
  sessionId: string | null;
  state: WorkbenchContextPanelState | null;
  onOpenResource: (resourceId: string) => void;
  onDocumentsChanged: () => Promise<unknown>;
}) {
  const t = useI18n();
  const graphQuery = useQuery(
    { query: copilotCollaborationGraphGetQuery },
    { suspense: false, shouldRetryOnError: false }
  );
  const graph = graphQuery.data?.currentUser?.copilot.myCollaborationGraph;
  const sessionRelations = useMemo(() => {
    if (!graph || !sessionId) return [];
    const labels = new Map(graph.nodes.map(node => [node.id, node.label]));
    return graph.edges
      .filter(edge => edge.ownSessionId === sessionId)
      .map(edge => ({
        ...edge,
        fromLabel: labels.get(edge.from) ?? edge.from,
        toLabel: labels.get(edge.to) ?? edge.to,
      }));
  }, [graph, sessionId]);
  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.v9.contextPanel']()}
    >
      <header className={styles.header}>
        <div>
          <h2>{t['com.affine.localmind.workbench.v9.contextPanel']()}</h2>
          <p>{t['com.affine.localmind.workbench.v9.contextHelp']()}</p>
        </div>
        <Button disabled={!state || state.loading} onClick={state?.openPicker}>
          {t['com.affine.localmind.aiContext.selectDocuments']()}
        </Button>
      </header>
      <div className={styles.memoryNotice}>
        <strong>{t['com.affine.localmind.aiContext.memories.title']()}</strong>
        <span>
          {t['com.affine.localmind.workbench.v9.projectMemoryHelp']()}
        </span>
      </div>
      <section
        className={styles.roles}
        aria-labelledby="project-context-collaboration-roles"
      >
        <h3 id="project-context-collaboration-roles">
          {t['com.affine.localmind.workbench.v9.collaborationRoles']()}
        </h3>
        <p>{t['com.affine.localmind.workbench.v9.collaborationRolesHelp']()}</p>
        {graphQuery.isLoading ? (
          <Loading size={16} />
        ) : graphQuery.error ? (
          <div className={styles.rolesError} role="alert">
            <span>
              {t['com.affine.localmind.workbench.v9.rolesLoadFailed']()}
            </span>
            <Button onClick={() => void graphQuery.mutate()}>
              {t['Retry']()}
            </Button>
          </div>
        ) : sessionRelations.length ? (
          <ul>
            {sessionRelations.map(relation => (
              <li key={relation.id}>
                <strong>{relation.fromLabel}</strong>
                <span aria-hidden="true">→</span>
                <strong>{relation.toLabel}</strong>
                <span>{relation.label}</span>
                <span>{relation.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={styles.rolesEmpty}>
            {t['com.affine.localmind.workbench.v9.noCollaborationRoles']()}
          </span>
        )}
      </section>
      {!state || state.loading ? (
        <div className={styles.state}>
          <Loading size={20} />
        </div>
      ) : state.resourceIds.length ? (
        <ul className={styles.resources}>
          {state.resourceIds.map(resourceId => (
            <ContextResource
              key={resourceId}
              projectId={projectId}
              resourceId={resourceId}
              onOpen={onOpenResource}
            />
          ))}
        </ul>
      ) : (
        <div className={styles.state}>
          {t['com.affine.localmind.workbench.v9.contextEmpty']()}
        </div>
      )}
      <div className={styles.projectActivity}>
        <ProjectTasks
          key={`${projectId}:${sessionId ?? ''}`}
          projectId={projectId}
          sessionId={sessionId ?? undefined}
          onCompleted={() => onDocumentsChanged()}
          onOpenResource={onOpenResource}
        />
      </div>
    </section>
  );
}
