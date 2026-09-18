import { DebugLogger } from '@affine/debug';
import type { WorkerInitOptions } from '@affine/nbstore/worker/client';
import { ObjectPool, type RcRef, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';

import type { Workspace } from '../entities/workspace';
import { WorkspaceInitialized } from '../events';
import type { WorkspaceOpenOptions } from '../open-options';
import { WorkspaceScope } from '../scopes/workspace';
import type { WorkspaceFlavoursService } from './flavours';
import type { WorkspaceListService } from './list';
import type { WorkspaceProfileService } from './profile';
import { WorkspaceService } from './workspace';

const logger = new DebugLogger('affine:workspace-repository');

const DEFAULT_WARM_CACHE_TTL = 60_000;
const DEFAULT_WARM_CACHE_CAPACITY = 3;

type WarmCacheOptions = {
  ttlMs: number;
  capacity: number;
};

type WarmEntry = {
  ref: RcRef<Workspace>;
  timer: ReturnType<typeof setTimeout>;
  lastUsedAt: number;
};

export class WorkspaceRepositoryService extends Service {
  constructor(
    private readonly flavoursService: WorkspaceFlavoursService,
    private readonly profileRepo: WorkspaceProfileService,
    private readonly workspacesListService: WorkspaceListService,
    private readonly warmCacheOptions: WarmCacheOptions = {
      ttlMs: DEFAULT_WARM_CACHE_TTL,
      capacity: DEFAULT_WARM_CACHE_CAPACITY,
    }
  ) {
    super();
    const identityBoundarySubscription =
      this.workspacesListService.list.workspaces$.subscribe(() => {
        // Cloud providers emit a fresh account-scoped list on account changes.
        // Evicting all inactive leases here prevents reuse across account or
        // server-list boundaries, even if workspace ids happen to overlap.
        this.evictWarmWorkspaces();
      });
    this.disposables.push(() => identityBoundarySubscription.unsubscribe());
    if (typeof window !== 'undefined') {
      window.addEventListener('memorypressure', this.evictWarmWorkspaces);
      this.disposables.push(() => {
        window.removeEventListener('memorypressure', this.evictWarmWorkspaces);
      });
    }
  }
  pool = new ObjectPool<string, Workspace>({
    onDelete(workspace) {
      workspace.scope.dispose();
    },
    onDangling(workspace) {
      return workspace.canGracefulStop;
    },
  });

  /**
   * open workspace reference by metadata.
   *
   * You basically don't need to call this function directly, use the react hook `useWorkspace(metadata)` instead.
   *
   * @returns the workspace reference and a release function, don't forget to call release function when you don't
   * need the workspace anymore.
   */
  open = (
    options: WorkspaceOpenOptions,
    customEngineWorkerInitOptions?: WorkerInitOptions
  ): {
    workspace: Workspace;
    dispose: (options?: { warm?: boolean }) => void;
    reused: boolean;
    validateAccess?: (signal?: AbortSignal) => Promise<void>;
  } => {
    if (options.isSharedMode || options.docScopeId) {
      const workspace = this.instantiate(
        options,
        customEngineWorkerInitOptions
      );
      return {
        workspace,
        reused: false,
        dispose: () => {
          workspace.scope.dispose();
        },
      };
    }

    const poolKey = this.getPoolKey(options);
    const exist = this.pool.get(poolKey);
    if (exist) {
      return this.activate(poolKey, exist);
    }

    const workspace = this.instantiate(options, customEngineWorkerInitOptions);

    const ref = this.pool.put(poolKey, workspace);

    return this.activate(poolKey, ref);
  };

  private getPoolKey(options: WorkspaceOpenOptions) {
    return `workspace:${options.metadata.flavour}:${options.metadata.id}`;
  }

  private activate(poolKey: string, ref: RcRef<Workspace>) {
    const warmEntry = this.warmEntries.get(poolKey);
    const reused = !!warmEntry;
    if (warmEntry) {
      clearTimeout(warmEntry.timer);
      this.warmEntries.delete(poolKey);
      warmEntry.ref.release();
    }
    void ref.obj.resumeBackgroundWork().catch(error => {
      logger.warn('failed to resume warm workspace', error);
    });

    let disposed = false;
    const flavourProvider = this.flavoursService.flavours$.value.find(
      provider => provider.flavour === ref.obj.flavour
    );
    return {
      workspace: ref.obj,
      reused,
      validateAccess: flavourProvider?.validateWorkspaceAccess
        ? (signal?: AbortSignal) =>
            flavourProvider.validateWorkspaceAccess?.(ref.obj.id, signal) ??
            Promise.resolve()
        : undefined,
      dispose: (options?: { warm?: boolean }) => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (options?.warm !== false) {
          this.retainWarm(poolKey, ref.obj);
        }
        ref.release();
        if (options?.warm === false) {
          this.pool.delete(poolKey);
        }
      },
    };
  }

  private readonly warmEntries = new Map<string, WarmEntry>();

  private retainWarm(poolKey: string, workspace: Workspace) {
    if (
      this.warmCacheOptions.capacity <= 0 ||
      this.warmCacheOptions.ttlMs <= 0 ||
      this.warmEntries.has(poolKey)
    ) {
      return;
    }

    const ref = this.pool.get(poolKey);
    if (!ref) {
      return;
    }
    void workspace.suspendBackgroundWork().catch(error => {
      logger.warn('failed to suspend warm workspace', error);
    });
    const entry: WarmEntry = {
      ref,
      lastUsedAt: Date.now(),
      timer: setTimeout(() => {
        this.evictWarmWorkspace(poolKey, entry);
      }, this.warmCacheOptions.ttlMs),
    };
    this.warmEntries.set(poolKey, entry);
    this.enforceWarmCapacity();
  }

  private enforceWarmCapacity() {
    while (this.warmEntries.size > this.warmCacheOptions.capacity) {
      const oldest = [...this.warmEntries.entries()].reduce((a, b) =>
        a[1].lastUsedAt <= b[1].lastUsedAt ? a : b
      );
      this.evictWarmWorkspace(oldest[0], oldest[1]);
    }
  }

  private evictWarmWorkspace(poolKey: string, expected?: WarmEntry) {
    const entry = this.warmEntries.get(poolKey);
    if (!entry || (expected && entry !== expected)) {
      return;
    }
    clearTimeout(entry.timer);
    this.warmEntries.delete(poolKey);
    entry.ref.release();
    this.pool.delete(poolKey);
  }

  evictWarmWorkspaces = () => {
    for (const [poolKey, entry] of this.warmEntries) {
      this.evictWarmWorkspace(poolKey, entry);
    }
  };

  openByWorkspaceId = (workspaceId: string) => {
    const workspaceMetadata =
      this.workspacesListService.list.workspace$(workspaceId).value;
    return workspaceMetadata && this.open({ metadata: workspaceMetadata });
  };

  instantiate(
    openOptions: WorkspaceOpenOptions,
    customEngineWorkerInitOptions?: WorkerInitOptions
  ) {
    logger.info(
      `open workspace [${openOptions.metadata.flavour}] ${openOptions.metadata.id} `
    );
    const flavourProvider = this.flavoursService.flavours$.value.find(
      p => p.flavour === openOptions.metadata.flavour
    );
    const engineWorkerInitOptions =
      customEngineWorkerInitOptions ??
      flavourProvider?.getEngineWorkerInitOptions(openOptions.metadata.id);
    if (!engineWorkerInitOptions) {
      throw new Error(
        `Unknown workspace flavour: ${openOptions.metadata.flavour}`
      );
    }

    const workspaceScope = this.framework.createScope(WorkspaceScope, {
      openOptions,
      engineWorkerInitOptions,
      engineStoreKey: openOptions.docScopeId
        ? `document-scope:${openOptions.metadata.flavour}:${openOptions.metadata.id}:${openOptions.docScopeId}:${nanoid()}`
        : undefined,
    });

    const workspace = workspaceScope.get(WorkspaceService).workspace;

    workspace.engine.start();
    workspace.startLifecycleTracking();

    workspaceScope.emitEvent(WorkspaceInitialized, workspace);

    flavourProvider?.onWorkspaceInitialized?.(workspace);

    if (!openOptions.docScopeId) {
      this.profileRepo
        .getProfile(openOptions.metadata)
        .syncWithWorkspace(workspace);
    }

    return workspace;
  }

  override dispose(): void {
    this.evictWarmWorkspaces();
    this.pool.clear();
    super.dispose();
  }
}
