import { Button, IconButton, Loading, notify, Tabs } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UserFriendlyError } from '@affine/error';
import {
  controlCopilotTaskMutation,
  copilotTasksGetQuery,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { PageIcon, ResetIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildCopilotTaskControlInput,
  type CopilotTask,
  type CopilotTaskAction,
  type CopilotTaskFilter,
  filterCopilotTasks,
  isCopilotTaskActionDisabled,
} from '../../../../modules/copilot-tasks/utils';
import * as styles from './index.css';

const taskFilters: CopilotTaskFilter[] = ['active', 'approval', 'completed'];

const formatDate = (value: string) => new Date(value).toLocaleString();

export const Component = () => {
  const t = useI18n();
  const workspaceId = useService(WorkspaceService).workspace.id;
  const graphqlService = useService(GraphQLService);
  const workbench = useService(WorkbenchService).workbench;
  const [filter, setFilter] = useState<CopilotTaskFilter>('active');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    action: CopilotTaskAction;
    taskId: string;
  } | null>(null);

  const { data, error, isLoading, mutate } = useQuery(
    {
      query: copilotTasksGetQuery,
      variables: { workspaceId, limit: 100 },
    },
    {
      suspense: false,
      refreshInterval: 5000,
      shouldRetryOnError: false,
    }
  );
  const tasks = useMemo(
    () => data?.currentUser?.copilot.copilotTasks ?? [],
    [data?.currentUser?.copilot.copilotTasks]
  );
  const visibleTasks = useMemo(
    () => filterCopilotTasks(tasks, filter),
    [filter, tasks]
  );
  const selectedTask =
    visibleTasks.find(task => task.id === selectedTaskId) ??
    visibleTasks[0] ??
    null;

  useEffect(() => {
    if (selectedTask?.id !== selectedTaskId) {
      setSelectedTaskId(selectedTask?.id ?? null);
    }
  }, [selectedTask?.id, selectedTaskId]);

  const filterLabel = useCallback(
    (value: CopilotTaskFilter) => {
      switch (value) {
        case 'approval':
          return t['com.affine.localmind.tasks.filter.approval']();
        case 'completed':
          return t['com.affine.localmind.tasks.filter.completed']();
        case 'active':
        default:
          return t['com.affine.localmind.tasks.filter.active']();
      }
    },
    [t]
  );

  const emptyLabel = useCallback(() => {
    switch (filter) {
      case 'approval':
        return t['com.affine.localmind.tasks.empty.approval']();
      case 'completed':
        return t['com.affine.localmind.tasks.empty.completed']();
      case 'active':
      default:
        return t['com.affine.localmind.tasks.empty.active']();
    }
  }, [filter, t]);

  const statusLabel = useCallback(
    (status: string) => {
      switch (status) {
        case 'queued':
          return t['com.affine.localmind.tasks.status.queued']();
        case 'running':
          return t['com.affine.localmind.tasks.status.running']();
        case 'waiting_approval':
          return t['com.affine.localmind.tasks.status.waiting_approval']();
        case 'completed':
          return t['com.affine.localmind.tasks.status.completed']();
        case 'failed':
          return t['com.affine.localmind.tasks.status.failed']();
        case 'cancelled':
          return t['com.affine.localmind.tasks.status.cancelled']();
        default:
          return status;
      }
    },
    [t]
  );

  const stepStatusLabel = useCallback(
    (status: string) => {
      switch (status) {
        case 'pending':
          return t['com.affine.localmind.tasks.step.pending']();
        case 'running':
          return t['com.affine.localmind.tasks.step.running']();
        case 'waiting_approval':
          return t['com.affine.localmind.tasks.step.waiting_approval']();
        case 'completed':
          return t['com.affine.localmind.tasks.step.completed']();
        case 'failed':
          return t['com.affine.localmind.tasks.step.failed']();
        case 'skipped':
          return t['com.affine.localmind.tasks.step.skipped']();
        default:
          return status;
      }
    },
    [t]
  );

  const actionLabel = useCallback(
    (action: CopilotTaskAction) => {
      switch (action) {
        case 'approve':
          return t['com.affine.localmind.tasks.action.approve']();
        case 'reject':
          return t['com.affine.localmind.tasks.action.reject']();
        case 'cancel':
          return t['com.affine.localmind.tasks.action.cancel']();
        case 'resume':
          return t['com.affine.localmind.tasks.action.resume']();
      }
    },
    [t]
  );

  const controlTask = useCallback(
    async (task: CopilotTask, action: CopilotTaskAction) => {
      if (
        isCopilotTaskActionDisabled({
          action,
          availableActions: task.availableActions,
          pendingTaskId: pending?.taskId ?? null,
          taskId: task.id,
        })
      ) {
        return;
      }
      setPending({ action, taskId: task.id });
      try {
        await graphqlService.gql({
          query: controlCopilotTaskMutation,
          variables: {
            input: buildCopilotTaskControlInput(workspaceId, task.id, action),
          },
        });
        await mutate();
        notify.success({
          title: t['com.affine.localmind.tasks.action.success'](),
        });
      } catch (caught) {
        const friendlyError = UserFriendlyError.fromAny(caught);
        notify.error({
          title: t['com.affine.localmind.tasks.action.failed'](),
          message: friendlyError.message,
        });
      } finally {
        setPending(null);
      }
    },
    [graphqlService, mutate, pending?.taskId, t, workspaceId]
  );

  const renderTaskList = () => {
    if (isLoading) {
      return (
        <div className={styles.centerState}>
          <Loading size={24} />
        </div>
      );
    }
    if (error) {
      return (
        <div className={styles.centerState}>
          <span className={styles.errorText}>{error.message}</span>
          <Button onClick={() => void mutate()}>
            {t['com.affine.localmind.tasks.refresh']()}
          </Button>
        </div>
      );
    }
    if (!visibleTasks.length) {
      return <div className={styles.centerState}>{emptyLabel()}</div>;
    }
    return visibleTasks.map(task => (
      <button
        key={task.id}
        type="button"
        className={styles.taskRow}
        data-selected={task.id === selectedTask?.id}
        onClick={() => setSelectedTaskId(task.id)}
      >
        <span className={styles.taskRowTopline}>
          <span className={styles.taskTitle}>
            {task.title ?? t['com.affine.localmind.tasks.untitled']()}
          </span>
          <span className={styles.status} data-status={task.status}>
            {statusLabel(task.status)}
          </span>
        </span>
        <span className={styles.taskMeta}>{formatDate(task.updatedAt)}</span>
      </button>
    ));
  };

  return (
    <>
      <ViewTitle title={t['com.affine.workspaceSubPath.tasks']()} />
      <ViewIcon icon="tasks" />
      <ViewHeader>
        <div className={styles.header}>
          <Tabs.Root
            value={filter}
            onValueChange={value => setFilter(value as CopilotTaskFilter)}
          >
            <Tabs.List className={styles.filters}>
              {taskFilters.map(value => (
                <Tabs.Trigger key={value} value={value}>
                  {filterLabel(value)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <IconButton
            size="20"
            icon={<ResetIcon />}
            tooltip={t['com.affine.localmind.tasks.refresh']()}
            onClick={() => void mutate()}
          />
        </div>
      </ViewHeader>
      <ViewBody>
        <main className={styles.root}>
          <section className={styles.listPane}>{renderTaskList()}</section>
          <section className={styles.detailPane}>
            {selectedTask ? (
              <TaskDetail
                task={selectedTask}
                pending={pending}
                actionLabel={actionLabel}
                statusLabel={statusLabel}
                stepStatusLabel={stepStatusLabel}
                onControl={controlTask}
                onOpenDocument={docId => workbench.openDoc(docId)}
              />
            ) : (
              <div className={styles.centerState}>
                {t['com.affine.localmind.tasks.empty.detail']()}
              </div>
            )}
          </section>
        </main>
      </ViewBody>
    </>
  );
};

const TaskDetail = ({
  task,
  pending,
  actionLabel,
  statusLabel,
  stepStatusLabel,
  onControl,
  onOpenDocument,
}: {
  task: CopilotTask;
  pending: { action: CopilotTaskAction; taskId: string } | null;
  actionLabel: (action: CopilotTaskAction) => string;
  statusLabel: (status: string) => string;
  stepStatusLabel: (status: string) => string;
  onControl: (task: CopilotTask, action: CopilotTaskAction) => Promise<void>;
  onOpenDocument: (docId: string) => void;
}) => {
  const t = useI18n();
  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHeader}>
        <div className={styles.detailHeading}>
          <h1 className={styles.detailTitle}>
            {task.title ?? t['com.affine.localmind.tasks.untitled']()}
          </h1>
          <span className={styles.status} data-status={task.status}>
            {statusLabel(task.status)}
          </span>
        </div>
        <div className={styles.actions}>
          {(task.availableActions as CopilotTaskAction[]).map(action => (
            <Button
              key={action}
              variant={
                action === 'approve' || action === 'resume'
                  ? 'primary'
                  : action === 'reject'
                    ? 'error'
                    : 'secondary'
              }
              loading={pending?.taskId === task.id && pending.action === action}
              disabled={isCopilotTaskActionDisabled({
                action,
                availableActions: task.availableActions,
                pendingTaskId: pending?.taskId ?? null,
                taskId: task.id,
              })}
              onClick={() => void onControl(task, action)}
            >
              {actionLabel(action)}
            </Button>
          ))}
        </div>
      </header>

      <dl className={styles.metadata}>
        <div>
          <dt className={styles.metadataLabel}>
            {t['com.affine.localmind.tasks.created']()}
          </dt>
          <dd className={styles.metadataValue}>{formatDate(task.createdAt)}</dd>
        </div>
        <div>
          <dt className={styles.metadataLabel}>
            {t['com.affine.localmind.tasks.updated']()}
          </dt>
          <dd className={styles.metadataValue}>{formatDate(task.updatedAt)}</dd>
        </div>
      </dl>

      {task.failureMessage ? (
        <section className={styles.detailSection}>
          <h2 className={styles.detailSectionTitle}>
            {t['com.affine.localmind.tasks.failure']()}
          </h2>
          <p className={styles.detailSectionText} data-failure="true">
            {task.failureMessage}
          </p>
        </section>
      ) : null}

      {task.resultSummary ? (
        <section className={styles.detailSection}>
          <h2 className={styles.detailSectionTitle}>
            {t['com.affine.localmind.tasks.result']()}
          </h2>
          <p className={styles.detailSectionText}>{task.resultSummary}</p>
        </section>
      ) : null}

      {task.artifacts.length ? (
        <section className={styles.detailSection}>
          {task.artifacts.map(artifact => (
            <Button
              key={`${artifact.kind}:${artifact.id}`}
              prefix={<PageIcon />}
              onClick={() => onOpenDocument(artifact.id)}
            >
              {t['com.affine.localmind.tasks.openDocument']()}
            </Button>
          ))}
        </section>
      ) : null}

      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>
          {t['com.affine.localmind.tasks.steps']()}
        </h2>
        <ol className={styles.steps}>
          {task.steps.map(step => (
            <li key={step.id} className={styles.step}>
              <span className={styles.stepMarker} data-status={step.status} />
              <span className={styles.stepContent}>
                <strong className={styles.stepTitle}>
                  {step.title ?? step.key}
                </strong>
                <span className={styles.stepStatus}>
                  {stepStatusLabel(step.status)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
