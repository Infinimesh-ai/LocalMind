import type { WorkerInitOptions } from '@affine/nbstore/worker/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  Workspace,
  WorkspacesService,
  WorkspaceSwitchService,
} from '../../../modules/workspace';
import type { WorkspaceOpenOptions } from '../../../modules/workspace/open-options';

export type OpenedWorkspace = {
  workspace: Workspace;
  switchId: string;
  dispose: (options?: { warm?: boolean }) => void;
  reused: boolean;
  validateAccess?: (signal?: AbortSignal) => Promise<void>;
  lastSyncState?: {
    ready: boolean;
    synced: boolean;
    syncing: boolean;
    syncRetrying: boolean;
    syncErrorMessage: string | null;
  };
  remoteConnectedMarked?: boolean;
};

export function useOpenWorkspace(
  workspacesService: WorkspacesService,
  workspaceSwitchService: WorkspaceSwitchService,
  openOptions: WorkspaceOpenOptions,
  workerInitOptions?: WorkerInitOptions,
  switchRequestId?: string
) {
  const [active, setActive] = useState<OpenedWorkspace | null>(null);
  const activeRef = useRef<OpenedWorkspace | null>(null);
  const retiredRef = useRef<OpenedWorkspace[]>([]);

  useLayoutEffect(() => {
    const switchId = workspaceSwitchService.routeCommitted(
      openOptions.metadata.id
    );
    workspaceSwitchService.phase(switchId, 'preparing');
    workspaceSwitchService.engineStarted(switchId);
    let cancelled = false;
    let committed = false;
    let failed = false;
    let candidate: OpenedWorkspace;
    try {
      const ref = workspacesService.open(openOptions, workerInitOptions);
      candidate = { ...ref, switchId };
    } catch (error) {
      workspaceSwitchService.fail(switchId, 'open', error);
      return;
    }

    const accessAbort = new AbortController();
    let accessValidated = !candidate.reused || !candidate.validateAccess;
    const failBeforeCommit = (failurePhase: string, error: unknown) => {
      if (cancelled || committed || failed) {
        return;
      }
      failed = true;
      accessAbort.abort(error);
      candidate.dispose({ warm: false });
      workspaceSwitchService.fail(switchId, failurePhase, error);
    };
    const commitIfReady = () => {
      if (
        committed ||
        failed ||
        !accessValidated ||
        !(
          candidate.workspace.localRootReady || candidate.lastSyncState?.ready
        ) ||
        cancelled ||
        !workspaceSwitchService.isCurrent(switchId)
      ) {
        return;
      }

      committed = true;
      workspaceSwitchService.phase(switchId, 'local-ready');
      const previous = activeRef.current;
      activeRef.current = candidate;
      if (previous && previous !== candidate) {
        retiredRef.current.push(previous);
      }
      setActive(candidate);
    };

    const subscription = candidate.workspace.engine.doc
      .docState$(candidate.workspace.id)
      .subscribe({
        next: state => {
          if (cancelled || failed) return;
          candidate.lastSyncState = state;
          if (state.ready) {
            candidate.workspace.markLocalRootReady();
          }
          if (cancelled || !workspaceSwitchService.isCurrent(switchId)) {
            return;
          }

          if (
            !candidate.remoteConnectedMarked &&
            candidate.workspace.flavour !== 'local' &&
            (state.syncing || state.synced)
          ) {
            candidate.remoteConnectedMarked = true;
            workspaceSwitchService.remoteConnected(switchId);
          }

          // Keep the engine alive while its remote connection is retrying.
          // Disposing here prevents recovery after a server restart, even when
          // the local root can still finish loading.
          if (
            !committed &&
            !candidate.workspace.localRootReady &&
            state.syncErrorMessage &&
            !state.syncRetrying &&
            !state.ready
          ) {
            failBeforeCommit(
              'local-root',
              new Error('Workspace root is unavailable')
            );
            return;
          }

          if (!committed) {
            commitIfReady();
            return;
          }

          if (!committed || activeRef.current !== candidate) {
            return;
          }
          if (state.syncErrorMessage) {
            workspaceSwitchService.fail(
              switchId,
              'remote-sync',
              new Error('Workspace remote sync failed')
            );
          } else if (state.synced) {
            workspaceSwitchService.phase(switchId, 'ready');
          } else if (state.syncing || state.syncRetrying) {
            workspaceSwitchService.phase(switchId, 'syncing');
          }
        },
        error: error => {
          if (cancelled || committed) {
            return;
          }
          failBeforeCommit('local-root', error);
        },
      });

    // Readiness is an edge, not a throttled sync-progress update.
    if (!candidate.workspace.localRootReady) {
      void candidate.workspace.engine.doc
        .waitForDocReady(candidate.workspace.id, accessAbort.signal)
        .then(
          () => {
            if (cancelled || failed) return;
            candidate.workspace.markLocalRootReady();
            commitIfReady();
          },
          error => failBeforeCommit('local-root', error)
        );
    }
    commitIfReady();

    if (!accessValidated) {
      void candidate.validateAccess?.(accessAbort.signal).then(
        () => {
          accessValidated = true;
          commitIfReady();
        },
        error => {
          if (!cancelled) {
            failBeforeCommit('access-check', error);
          }
        }
      );
    }

    return () => {
      cancelled = true;
      accessAbort.abort(new Error('Workspace switch superseded'));
      subscription.unsubscribe();
      if (!committed && !failed) {
        // Effect replay and navigation cancellation release the caller's lease.
        // Only an actual initialization/access failure invalidates the instance.
        candidate.dispose();
      }
    };
  }, [
    workerInitOptions,
    openOptions,
    switchRequestId,
    workspacesService,
    workspaceSwitchService,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }
    for (const retired of retiredRef.current.splice(0)) {
      retired.dispose();
    }
    workspaceSwitchService.phase(active.switchId, 'committed');
    if (active.lastSyncState?.syncErrorMessage) {
      workspaceSwitchService.fail(
        active.switchId,
        'remote-sync',
        new Error('Workspace remote sync failed')
      );
    } else if (active.lastSyncState?.synced) {
      workspaceSwitchService.phase(active.switchId, 'ready');
    } else {
      workspaceSwitchService.phase(active.switchId, 'syncing');
    }
  }, [active, workspaceSwitchService]);

  useEffect(
    () => () => {
      activeRef.current?.dispose();
      activeRef.current = null;
      for (const retired of retiredRef.current.splice(0)) {
        retired.dispose();
      }
    },
    []
  );

  return active;
}
