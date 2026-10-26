import { DebugLogger } from '@affine/debug';
import type { WorkerInitOptions } from '@affine/nbstore/worker/client';
import { ObjectPool, type RcRef, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { combineLatest, from, map, of, switchMap } from 'rxjs';

import type { Workspace } from '../entities/workspace';
import { WorkspaceInitialized } from '../events';
import type { WorkspaceOpenOptions } from '../open-options';
import type { WorkspaceFlavourProvider } from '../providers/flavour';
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
  private readonly identityEpochs = new Map<string, number>();
  private readonly activeLeases = new Map<string, number>();
  // Framework constructors receive the resolver after their declared services.
  // Keep cache settings out of that argument slot so defaults cannot be replaced.
  protected readonly warmCacheOptions: WarmCacheOptions = {
    ttlMs: DEFAULT_WARM_CACHE_TTL,
    capacity: DEFAULT_WARM_CACHE_CAPACITY,
  };

  constructor(
    private readonly flavoursService: WorkspaceFlavoursService,
    private readonly profileRepo: WorkspaceProfileService,
    private readonly workspacesListService: WorkspaceListService
  ) {
    super();
    const listSubscription =
      this.workspacesListService.list.workspaces$.subscribe(workspaces => {
        const available = new Set(
          workspaces.map(metadata => this.getPoolKey({ metadata }))
        );
        for (const key of this.warmEntries.keys()) {
          if (!available.has(key)) this.evictWarmWorkspace(key);
        }
      });
    let identities = new Map<
      string,
      { provider: WorkspaceFlavourProvider; identity: string | null }
    >();
    const identitySubscription = this.flavoursService.flavours$
      .pipe(
        switchMap(providers =>
          providers.length
            ? combineLatest(
                providers.map(provider =>
                  from(provider.cacheIdentity$ ?? of(null)).pipe(
                    map(identity => ({ provider, identity }))
                  )
                )
              )
            : of([])
        )
      )
      .subscribe(entries => {
        const next = new Map(
          entries.map(entry => [entry.provider.flavour, entry])
        );
        for (const [flavour, previous] of identities) {
          const current = next.get(flavour);
          if (
            current?.provider === previous.provider &&
            current.identity === previous.identity
          )
            continue;
          // An old active lease can finish safely, but cannot be acquired by a new identity.
          this.identityEpochs.set(
            flavour,
            (this.identityEpochs.get(flavour) ?? 0) + 1
          );
          for (const [key, entry] of this.warmEntries) {
            if (entry.ref.obj.flavour === flavour) this.evictWarmWorkspace(key);
          }
        }
        identities = next;
      });
    this.disposables.push(() => {
      listSubscription.unsubscribe();
      identitySubscription.unsubscribe();
    });
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
      return this.activate(poolKey, exist, true);
    }

    const workspace = this.instantiate(options, customEngineWorkerInitOptions);

    const ref = this.pool.put(poolKey, workspace);

    return this.activate(poolKey, ref, false);
  };

  private getPoolKey(options: WorkspaceOpenOptions) {
    return `workspace:${options.metadata.flavour}:${options.metadata.id}:${this.identityEpochs.get(options.metadata.flavour) ?? 0}`;
  }

  private activate(poolKey: string, ref: RcRef<Workspace>, reused: boolean) {
    const warmEntry = this.warmEntries.get(poolKey);
    this.activeLeases.set(poolKey, (this.activeLeases.get(poolKey) ?? 0) + 1);
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
        const remaining = (this.activeLeases.get(poolKey) ?? 1) - 1;
        if (remaining) this.activeLeases.set(poolKey, remaining);
        else this.activeLeases.delete(poolKey);
        const currentIdentity =
          poolKey === this.getPoolKey({ metadata: ref.obj.meta });
        if (!remaining && options?.warm !== false && currentIdentity) {
          this.retainWarm(poolKey, ref.obj);
        }
        ref.release();
        if (options?.warm === false || !currentIdentity) {
          this.evictWarmWorkspace(poolKey);
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
