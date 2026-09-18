import { DebugLogger } from '@affine/debug';
import { LiveData, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';

const logger = new DebugLogger('affine:workspace-switch');

export type WorkspaceSwitchPhase =
  | 'preparing'
  | 'local-ready'
  | 'committed'
  | 'syncing'
  | 'ready'
  | 'failed';

export type WorkspaceSwitchState =
  | { phase: 'idle' }
  | {
      phase: WorkspaceSwitchPhase;
      switchId: string;
      targetWorkspaceId: string;
      startedAt: number;
      source: 'click' | 'route';
      failurePhase?: string;
      errorType?: string;
    };

const pendingPhases = new Set<WorkspaceSwitchPhase>([
  'preparing',
  'local-ready',
]);

const mark = (name: string, switchId: string) => {
  if (typeof performance === 'undefined') {
    return;
  }
  performance.mark(name, { detail: { switchId } });
};

/**
 * Coordinates the user-visible lifecycle of a workspace route change.
 *
 * The route remains the source of truth. This service only supplies latest-wins
 * correlation and progress state shared by the stable shell and workspace page.
 */
export class WorkspaceSwitchService extends Service {
  readonly state$ = new LiveData<WorkspaceSwitchState>({ phase: 'idle' });

  begin(targetWorkspaceId: string) {
    const current = this.state$.value;
    if (
      current.phase !== 'idle' &&
      current.targetWorkspaceId === targetWorkspaceId &&
      pendingPhases.has(current.phase)
    ) {
      return current.switchId;
    }

    const switchId = this.createSwitch(targetWorkspaceId, 'click');
    mark('workspace-switch-click', switchId);
    return switchId;
  }

  routeCommitted(targetWorkspaceId: string) {
    const current = this.state$.value;
    const switchId =
      current.phase !== 'idle' &&
      current.targetWorkspaceId === targetWorkspaceId &&
      pendingPhases.has(current.phase)
        ? current.switchId
        : this.createSwitch(targetWorkspaceId, 'route');
    mark('workspace-switch-route-committed', switchId);
    return switchId;
  }

  isCurrent(switchId: string) {
    const current = this.state$.value;
    return current.phase !== 'idle' && current.switchId === switchId;
  }

  isPending(targetWorkspaceId: string) {
    const current = this.state$.value;
    return (
      current.phase !== 'idle' &&
      current.targetWorkspaceId === targetWorkspaceId &&
      pendingPhases.has(current.phase)
    );
  }

  phase(switchId: string, phase: Exclude<WorkspaceSwitchPhase, 'failed'>) {
    const current = this.state$.value;
    if (
      current.phase === 'idle' ||
      current.phase === 'failed' ||
      current.switchId !== switchId
    ) {
      return false;
    }

    this.state$.setValue({ ...current, phase });
    const markName =
      phase === 'preparing'
        ? 'workspace-switch-open-start'
        : phase === 'local-ready'
          ? 'workspace-switch-local-root-ready'
          : phase === 'committed'
            ? 'workspace-switch-ui-committed'
            : phase === 'ready'
              ? 'workspace-switch-sync-ready'
              : undefined;
    if (markName) {
      mark(markName, switchId);
    }
    logger.info('workspace switch phase', {
      switchId,
      phase,
      elapsedMs: Math.round(performance.now() - current.startedAt),
    });
    return true;
  }

  engineStarted(switchId: string) {
    if (!this.isCurrent(switchId)) {
      return false;
    }
    mark('workspace-switch-engine-start', switchId);
    return true;
  }

  remoteConnected(switchId: string) {
    if (!this.isCurrent(switchId)) {
      return false;
    }
    mark('workspace-switch-remote-connected', switchId);
    return true;
  }

  fail(switchId: string, failurePhase: string, error: unknown) {
    const current = this.state$.value;
    if (
      current.phase === 'idle' ||
      current.phase === 'failed' ||
      current.switchId !== switchId
    ) {
      return false;
    }

    const errorType = error instanceof Error ? error.name : typeof error;
    this.state$.setValue({
      ...current,
      phase: 'failed',
      failurePhase,
      errorType,
    });
    mark('workspace-switch-failed', switchId);
    logger.warn('workspace switch failed', {
      switchId,
      phase: failurePhase,
      errorType,
      elapsedMs: Math.round(performance.now() - current.startedAt),
    });
    return true;
  }

  private createSwitch(targetWorkspaceId: string, source: 'click' | 'route') {
    const previous = this.state$.value;
    if (previous.phase !== 'idle' && pendingPhases.has(previous.phase)) {
      logger.info('workspace switch superseded', {
        switchId: previous.switchId,
        elapsedMs: Math.round(performance.now() - previous.startedAt),
      });
    }

    const switchId = nanoid();
    this.state$.setValue({
      phase: 'preparing',
      switchId,
      targetWorkspaceId,
      startedAt: performance.now(),
      source,
    });
    return switchId;
  }
}
