import { useI18n } from '@affine/i18n';
import { ArrowRightSmallIcon, CloseIcon, DoneIcon } from '@blocksuite/icons/rc';
import { useId, useState } from 'react';

import * as styles from './execution-path.css';
import type { WorkbenchRun, WorkbenchTask } from './types';

type ExecutionStep = WorkbenchRun['steps'][number];

const ACTIVE_RUN_STATUSES = new Set([
  'queued',
  'pending',
  'running',
  'waiting_approval',
]);

/**
 * Picks the AI task run bound to a conversation session. Active runs win over
 * finished ones; otherwise the most recently updated run is shown.
 */
export function findSessionRun(
  tasks: readonly WorkbenchTask[],
  sessionId: string | null | undefined
): WorkbenchRun | null {
  if (!sessionId) return null;
  const runs = new Map<string, WorkbenchRun>();
  for (const task of tasks)
    if (task.run?.sessionId === sessionId && task.run.steps.length)
      runs.set(task.run.id, task.run);
  return (
    [...runs.values()].sort((left, right) => {
      const activeDelta =
        Number(ACTIVE_RUN_STATUSES.has(right.status)) -
        Number(ACTIVE_RUN_STATUSES.has(left.status));
      if (activeDelta) return activeDelta;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })[0] ?? null
  );
}

const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const stepTime = (step: ExecutionStep) => {
  const started = step.startedAt ? Date.parse(step.startedAt) : NaN;
  const completed = step.completedAt ? Date.parse(step.completedAt) : NaN;
  if (Number.isFinite(started) && Number.isFinite(completed))
    return formatDuration(completed - started);
  if (Number.isFinite(started))
    return new Date(started).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  return null;
};

export function ExecutionPath({ run }: { run: WorkbenchRun | null }) {
  const t = useI18n();
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  if (!run?.steps.length) return null;

  const steps = [...run.steps].sort((left, right) => left.order - right.order);
  const completed = steps.filter(step => step.status === 'completed').length;
  const statusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return t['com.affine.localmind.workbench.executionPath.completed']();
      case 'running':
        return t['com.affine.localmind.workbench.executionPath.running']();
      case 'pending':
        return t['com.affine.localmind.workbench.executionPath.pending']();
      case 'waiting_approval':
        return t[
          'com.affine.localmind.workbench.executionPath.waitingApproval'
        ]();
      case 'failed':
        return t['com.affine.localmind.workbench.executionPath.failed']();
      case 'skipped':
        return t['com.affine.localmind.workbench.executionPath.skipped']();
      default:
        return status;
    }
  };

  return (
    <section
      className={styles.root}
      data-testid="project-execution-path"
      aria-label={t['com.affine.localmind.workbench.executionPath.title']()}
    >
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(value => !value)}
      >
        <ArrowRightSmallIcon className={styles.chevron} aria-hidden="true" />
        <span className={styles.heading}>
          {t['com.affine.localmind.workbench.executionPath.title']()}
        </span>
        <span className={styles.progress}>
          {completed}/{steps.length}
        </span>
      </button>
      {expanded ? (
        <ol id={listId} className={styles.list}>
          {steps.map((step, index) => {
            const approval =
              step.status === 'waiting_approval' &&
              run.approval?.stepId === step.id
                ? run.approval.title
                : null;
            const time = stepTime(step);
            return (
              <li
                key={step.id}
                className={styles.step}
                data-status={step.status}
              >
                <span
                  className={styles.dot}
                  data-status={step.status}
                  aria-hidden="true"
                >
                  {step.status === 'completed' ? (
                    <DoneIcon />
                  ) : step.status === 'failed' ? (
                    <CloseIcon />
                  ) : step.status === 'running' ? (
                    <span className={styles.pulseCenter} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={styles.copy}>
                  <span className={styles.stepTitle} title={step.title ?? ''}>
                    {step.title || step.key}
                  </span>
                  <span className={styles.stepMeta}>
                    {statusLabel(step.status)}
                    {approval ? ` · ${approval}` : null}
                  </span>
                </span>
                {time ? <span className={styles.time}>{time}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
