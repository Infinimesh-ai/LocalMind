import { UserFriendlyError } from '@affine/error';
import {
  backoffRetry,
  effect,
  exhaustMapWithTrailing,
  fromPromise,
  LiveData,
  Service,
} from '@toeverything/infra';
import {
  catchError,
  combineLatest,
  defer,
  EMPTY,
  exhaustMap,
  groupBy,
  map,
  mergeMap,
  Observable,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import type { WorkspaceService } from '../../workspace';
import type {
  DocPermissionActions,
  GuardStore,
  WorkspacePermissionActions,
} from '../stores/guard';
import type { WorkspacePermissionService } from './permission';

const DOCUMENT_SCOPE_READ_ACTIONS = new Set<DocPermissionActions>([
  'Doc_Read',
  'Doc_Properties_Read',
  'Doc_Users_Read',
  'Doc_Comments_Read',
]);

// Opened documents keep a short ACL refresh; list, sidebar and search rows only
// need an eventually consistent hint because the server checks every access.
export const ACTIVE_DOC_PERMISSION_REFRESH_MS = 5_000;
export const LISTED_DOC_PERMISSION_REFRESH_MS = 60_000;
export const MAX_CONCURRENT_DOC_PERMISSION_LOADS = 4;
/** Matches the server's limit for `workspace.readableDocIds`. */
export const READ_CHECK_BATCH_MAX = 100;
/** Read checks from all callers share at most this many requests in flight. */
export const MAX_IN_FLIGHT_READ_CHECK_BATCHES = 2;
/** Collects read checks from components mounting over a few renders. */
export const READ_CHECK_BATCH_WINDOW_MS = 16;
const DOC_PERMISSION_RETRY_COUNT = 3;

type DocPermissions = Partial<Record<DocPermissionActions, boolean>>;

type ReadCheckWaiter = {
  resolve: (readable: boolean) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
};

type ReadCheckBatch = {
  waiters: Map<string, ReadCheckWaiter[]>;
  live: number;
  controller: AbortController;
};

/**
 * `checking` until the first ACL check of the candidates finishes; `failed`
 * when some candidates could not be checked (they stay hidden).
 */
export type ReadableDocsState = {
  status: 'checking' | 'ready' | 'failed';
  readable: ReadonlySet<string>;
};

const CHECKING_READABLE_DOCS: ReadableDocsState = {
  status: 'checking',
  readable: new Set(),
};

export class GuardService extends Service {
  private readonly documentScopePollTimer?: ReturnType<typeof setInterval>;
  private readonly observedDocs = new Map<string, number>();
  private readonly listedDocs = new Map<string, number>();
  private lastListedRefreshAt = Date.now();
  private readonly pendingDocLoads = new Map<string, Promise<DocPermissions>>();
  private activeDocLoads = 0;
  private readonly docLoadWaiters: (() => void)[] = [];
  // Set when the server lacks the batch query; checks then go one by one.
  private batchUnsupported = false;
  private readonly queuedReadChecks = new Map<string, ReadCheckWaiter[]>();
  private readonly inFlightReadChecks = new Map<string, ReadCheckBatch>();
  private inFlightReadBatches = 0;
  private readCheckTimer?: ReturnType<typeof setTimeout>;
  private readonly refreshObservedPermissions = () => {
    if (this.isAdmin$.value === true || isPageHidden()) return;
    const docIds = new Set(this.observedDocs.keys());
    const scopedDoc = this.workspaceService.workspace.openOptions.docScopeId;
    if (scopedDoc) docIds.add(scopedDoc);
    docIds.forEach(docId => this.revalidateDocPermission(docId));
    const now = Date.now();
    if (now - this.lastListedRefreshAt >= LISTED_DOC_PERMISSION_REFRESH_MS) {
      this.lastListedRefreshAt = now;
      const listed = [...this.listedDocs.keys()].filter(id => !docIds.has(id));
      if (listed.length) {
        this.loadDocPermissions(listed).catch(() => {
          // The next refresh retries; a failed check keeps the last result.
        });
      }
    }
  };

  constructor(
    private readonly guardStore: GuardStore,
    private readonly workspaceService: WorkspaceService,
    private readonly workspacePermissionService: WorkspacePermissionService
  ) {
    super();
    if (this.workspaceService.workspace.flavour !== 'local') {
      this.documentScopePollTimer = setInterval(
        this.refreshObservedPermissions,
        ACTIVE_DOC_PERMISSION_REFRESH_MS
      );
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', this.refreshObservedPermissions);
        window.addEventListener('online', this.refreshObservedPermissions);
      }
      if (typeof document !== 'undefined') {
        document.addEventListener(
          'visibilitychange',
          this.refreshObservedPermissions
        );
      }
    }
  }

  private readonly workspacePermissions$ = new LiveData<
    Partial<Record<WorkspacePermissionActions, boolean>>
  >({});

  private readonly docPermissions$ = new LiveData<
    Record<string, Partial<Record<DocPermissionActions, boolean>>>
  >({});

  private readonly isAdmin$ = LiveData.computed(get => {
    const isOwner = get(this.workspacePermissionService.permission.isOwner$);
    const isAdmin = get(this.workspacePermissionService.permission.isAdmin$);
    if (isOwner === null && isAdmin === null) {
      return null;
    }
    return isOwner || isAdmin;
  });

  private isDeniedByDocumentScope(
    action: WorkspacePermissionActions | DocPermissionActions,
    docId?: string
  ) {
    const { docScopeId, docScopeAccess } =
      this.workspaceService.workspace.openOptions;
    if (!docScopeId) {
      return false;
    }
    if (!docId || docId !== docScopeId) {
      return true;
    }
    return (
      docScopeAccess === 'read' &&
      !DOCUMENT_SCOPE_READ_ACTIONS.has(action as DocPermissionActions)
    );
  }

  /**
   * @example
   * ```ts
   * guardService.can$('Workspace_Properties_Update');
   * guardService.can$('Doc_Update', docId);
   * ```
   *
   * @returns LiveData<boolean | undefined> the value is undefined if the permission is loading
   */
  can$<T extends WorkspacePermissionActions | DocPermissionActions>(
    action: T,
    ...args: T extends DocPermissionActions ? [string] : []
  ): LiveData<boolean | undefined> {
    return LiveData.from(
      this.watch$(action, args[0], this.observedDocs),
      undefined
    );
  }

  private watch$(
    action: WorkspacePermissionActions | DocPermissionActions,
    docId: string | undefined,
    pool: Map<string, number>
  ): Observable<boolean | undefined> {
    return new Observable(subscriber => {
      let prev: boolean | undefined = undefined;
      // Keep ACLs for subscribed documents fresh, without polling every cached doc.
      if (docId) {
        pool.set(docId, (pool.get(docId) ?? 0) + 1);
      }

      const subscription = combineLatest([
        (docId
          ? this.docPermissions$.pipe(
              map(permissions => permissions[docId] ?? {})
            )
          : this.workspacePermissions$.asObservable()) as Observable<
          Record<string, boolean>
        >,
        this.isAdmin$,
      ]).subscribe(([permissions, isAdmin]) => {
        if (isAdmin) {
          prev = true;
          return subscriber.next(true);
        }
        const current = this.isDeniedByDocumentScope(action, docId)
          ? false
          : (permissions[action] ?? undefined);
        if (current !== prev) {
          prev = current;
          subscriber.next(current);
        }
      });

      return () => {
        subscription.unsubscribe();
        if (docId) {
          const remaining = (pool.get(docId) ?? 1) - 1;
          if (remaining > 0) pool.set(docId, remaining);
          else pool.delete(docId);
        }
      };
    });
  }

  async can<T extends WorkspacePermissionActions | DocPermissionActions>(
    action: T,
    ...args: T extends DocPermissionActions ? [string] : []
  ): Promise<boolean> {
    const docId = args[0];

    if (this.isDeniedByDocumentScope(action, docId)) {
      return false;
    }

    if (this.isAdmin$.value === null) {
      await this.workspacePermissionService.permission.waitForRevalidation();
    }

    if (this.isAdmin$.value === true) {
      return true;
    }

    const permissions = await (docId
      ? this.loadDocPermission(docId)
      : this.loadWorkspacePermission());

    return permissions[action as keyof typeof permissions] ?? false;
  }

  /** Search must not reveal cached content before its current ACL is checked. */
  readableDocIds$(docIds: readonly string[]): Observable<ReadonlySet<string>> {
    return this.readableDocsState$(docIds).pipe(map(state => state.readable));
  }

  /** Same as `readableDocIds$`, plus whether the check is pending or failed. */
  readableDocsState$(docIds: readonly string[]): Observable<ReadableDocsState> {
    const ids = [...new Set(docIds)];
    if (!ids.length) {
      return of<ReadableDocsState>({ status: 'ready', readable: new Set() });
    }
    if (this.workspaceService.workspace.flavour === 'local') {
      return of<ReadableDocsState>({ status: 'ready', readable: new Set(ids) });
    }
    return defer(() =>
      fromPromise(async signal => {
        await this.workspacePermissionService.permission.waitForRevalidation(
          signal
        );
        const { docScopeId, isSharedMode } =
          this.workspaceService.workspace.openOptions;
        if (this.isAdmin$.value === true || docScopeId || isSharedMode) {
          return await this.checkEach(ids, signal);
        }
        try {
          return await this.loadDocPermissions(ids, signal);
        } catch {
          // A failed check cannot authorize a locally indexed result.
          return { checked: new Set<string>(), failed: ids.length };
        }
      })
    ).pipe(
      switchMap(({ checked, failed }): Observable<ReadableDocsState> => {
        const status: ReadableDocsState['status'] = failed ? 'failed' : 'ready';
        if (!checked.size) {
          return of<ReadableDocsState>({ status, readable: new Set() });
        }
        const checkedIds = [...checked];
        // Listed candidates follow the slower refresh pool; opening a document
        // still subscribes it to the active pool through can$.
        return combineLatest(
          checkedIds.map(id => this.watch$('Doc_Read', id, this.listedDocs))
        ).pipe(
          map(
            (permissions): ReadableDocsState => ({
              status,
              readable: new Set(
                checkedIds.filter((_, i) => permissions[i] === true)
              ),
            })
          )
        );
      }),
      startWith(CHECKING_READABLE_DOCS)
    );
  }

  private async checkEach(ids: string[], signal: AbortSignal) {
    const checked = new Set<string>();
    let failed = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length && !signal.aborted) {
          const id = ids[next++];
          try {
            await this.can('Doc_Read', id);
            checked.add(id);
          } catch {
            // A failed check cannot authorize a locally indexed result.
            failed++;
          }
        }
      })
    );
    return { checked, failed };
  }

  /**
   * Checks `Doc_Read` for many documents through the shared read-check batcher
   * and returns the IDs whose result is known.
   */
  private async loadDocPermissions(
    docIds: readonly string[],
    signal?: AbortSignal
  ) {
    const ids = [...new Set(docIds)];
    const results = await Promise.allSettled(
      ids.map(id => this.checkReadable(id, signal))
    );
    const checked = new Set<string>();
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') checked.add(ids[index]);
      else if (!signal?.aborted) failed++;
    });
    return { checked, failed };
  }

  /**
   * DataLoader-style read check: calls from every list, sidebar node and
   * search within a short window are merged into requests of at most 100 IDs,
   * with at most two requests in flight. A check for a document already in
   * flight joins that request. A request is aborted only after all of its
   * waiters were aborted. Results only update `Doc_Read`; opened documents
   * still load their full permissions.
   */
  private checkReadable(docId: string, signal?: AbortSignal) {
    return new Promise<boolean>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const waiter: ReadCheckWaiter = { resolve, reject, signal };
      const inFlight = this.inFlightReadChecks.get(docId);
      if (inFlight && !inFlight.controller.signal.aborted) {
        inFlight.waiters.get(docId)?.push(waiter);
        inFlight.live++;
      } else {
        const queued = this.queuedReadChecks.get(docId) ?? [];
        queued.push(waiter);
        this.queuedReadChecks.set(docId, queued);
      }
      signal?.addEventListener(
        'abort',
        () => this.abortReadCheck(docId, waiter),
        { once: true }
      );
      this.scheduleReadChecks();
    });
  }

  private abortReadCheck(docId: string, waiter: ReadCheckWaiter) {
    const queued = this.queuedReadChecks.get(docId);
    if (queued?.includes(waiter)) {
      const rest = queued.filter(item => item !== waiter);
      if (rest.length) this.queuedReadChecks.set(docId, rest);
      else this.queuedReadChecks.delete(docId);
    } else {
      const batch = this.inFlightReadChecks.get(docId);
      const waiters = batch?.waiters.get(docId);
      if (!batch || !waiters?.includes(waiter)) return;
      batch.waiters.set(
        docId,
        waiters.filter(item => item !== waiter)
      );
      if (--batch.live === 0) batch.controller.abort();
    }
    waiter.reject(abortReason(waiter.signal));
  }

  private scheduleReadChecks() {
    if (this.readCheckTimer || !this.queuedReadChecks.size) return;
    this.readCheckTimer = setTimeout(() => {
      this.readCheckTimer = undefined;
      this.startReadChecks();
    }, READ_CHECK_BATCH_WINDOW_MS);
  }

  private startReadChecks() {
    while (
      this.queuedReadChecks.size &&
      this.inFlightReadBatches < MAX_IN_FLIGHT_READ_CHECK_BATCHES
    ) {
      const waiters = new Map<string, ReadCheckWaiter[]>();
      for (const [docId, queued] of this.queuedReadChecks) {
        waiters.set(docId, queued);
        if (waiters.size >= READ_CHECK_BATCH_MAX) break;
      }
      waiters.forEach((_, docId) => this.queuedReadChecks.delete(docId));
      const batch: ReadCheckBatch = {
        waiters,
        live: [...waiters.values()].reduce((sum, list) => sum + list.length, 0),
        controller: new AbortController(),
      };
      waiters.forEach((_, docId) => this.inFlightReadChecks.set(docId, batch));
      this.inFlightReadBatches++;
      this.runReadCheckBatch(batch)
        .catch(() => undefined)
        .finally(() => {
          waiters.forEach((_, docId) => {
            if (this.inFlightReadChecks.get(docId) === batch) {
              this.inFlightReadChecks.delete(docId);
            }
          });
          this.inFlightReadBatches--;
          this.scheduleReadChecks();
        });
    }
  }

  private async runReadCheckBatch(batch: ReadCheckBatch) {
    const ids = [...batch.waiters.keys()];
    const settle = (docId: string, result: boolean | { error: unknown }) => {
      for (const waiter of batch.waiters.get(docId) ?? []) {
        if (typeof result === 'boolean') waiter.resolve(result);
        else waiter.reject(result.error);
      }
    };
    if (this.batchUnsupported) {
      await this.readChecksOneByOne(ids, settle);
      return;
    }
    let readable: Set<string>;
    try {
      readable = new Set(
        await this.guardStore.getReadableDocIds(ids, batch.controller.signal)
      );
    } catch (error) {
      if (batch.controller.signal.aborted) return;
      if (isUnsupportedBatch(error)) {
        this.batchUnsupported = true;
        await this.readChecksOneByOne(ids, settle);
        return;
      }
      // Do not fall back to one request per document on transient failure.
      ids.forEach(docId => settle(docId, { error }));
      return;
    }
    const next = { ...this.docPermissions$.value };
    for (const docId of ids) {
      next[docId] = readable.has(docId)
        ? { ...next[docId], Doc_Read: true }
        : revokedPermissions(next[docId]);
    }
    this.docPermissions$.next(next);
    ids.forEach(docId => settle(docId, readable.has(docId)));
  }

  /** Older servers: full single-doc checks, still bounded by the load slots. */
  private async readChecksOneByOne(
    ids: string[],
    settle: (docId: string, result: boolean | { error: unknown }) => void
  ) {
    await Promise.all(
      ids.map(async docId => {
        try {
          const permissions = await this.loadDocPermission(docId);
          settle(docId, permissions.Doc_Read === true);
        } catch (error) {
          settle(docId, { error });
        }
      })
    );
  }

  revalidateCan<T extends WorkspacePermissionActions | DocPermissionActions>(
    _action: T,
    ...args: T extends DocPermissionActions ? [string] : []
  ) {
    const docId = args[0];
    if (this.isDeniedByDocumentScope(_action, docId)) {
      return;
    }

    // revalidate workspace permission if it's not initialized
    if (this.isAdmin$.value === null) {
      this.workspacePermissionService.permission.revalidate();
    }

    // Workspace ACL still needs to load if a cached admin role is corrected.
    if (docId && this.isAdmin$.value === true) {
      return;
    }

    // revalidate permission
    if (docId) {
      this.revalidateDocPermission(docId);
    } else {
      this.revalidateWorkspacePermission();
    }
  }

  private readonly revalidateWorkspacePermission = effect(
    exhaustMapWithTrailing(() =>
      fromPromise(() => this.loadWorkspacePermission()).pipe(
        backoffRetry({
          count: Infinity,
        })
      )
    )
  );

  private readonly revalidateDocPermission = effect(
    groupBy((docId: string) => docId),
    mergeMap(doc$ =>
      doc$.pipe(
        exhaustMap((docId: string) =>
          fromPromise(() => this.loadDocPermission(docId)).pipe(
            backoffRetry({
              count: DOC_PERMISSION_RETRY_COUNT,
            }),
            // The next poll or focus retries; an error must not stop the effect.
            catchError(() => EMPTY)
          )
        )
      )
    )
  );

  private readonly loadWorkspacePermission = async () => {
    if (this.workspaceService.workspace.flavour === 'local') {
      return {} as Record<WorkspacePermissionActions, boolean>;
    }
    if (this.workspaceService.workspace.openOptions.isSharedMode) {
      return {};
    }
    if (this.workspaceService.workspace.openOptions.docScopeId) {
      return {};
    }
    const permissions = await this.guardStore.getWorkspacePermissions();
    this.workspacePermissions$.next(permissions);
    return permissions;
  };

  /** Coalesces concurrent checks of one document and bounds total requests. */
  private readonly loadDocPermission = (docId: string) => {
    const pending = this.pendingDocLoads.get(docId);
    if (pending) return pending;
    const load = this.withDocLoadSlot(() =>
      this.fetchDocPermission(docId)
    ).finally(() => this.pendingDocLoads.delete(docId));
    this.pendingDocLoads.set(docId, load);
    return load;
  };

  private async withDocLoadSlot<T>(task: () => Promise<T>) {
    while (this.activeDocLoads >= MAX_CONCURRENT_DOC_PERMISSION_LOADS) {
      await new Promise<void>(resolve => this.docLoadWaiters.push(resolve));
    }
    this.activeDocLoads++;
    try {
      return await task();
    } finally {
      this.activeDocLoads--;
      this.docLoadWaiters.shift()?.();
    }
  }

  private readonly fetchDocPermission = async (
    docId: string
  ): Promise<DocPermissions> => {
    if (this.workspaceService.workspace.flavour === 'local') {
      return {} as Record<DocPermissionActions, boolean>;
    }
    if (this.workspaceService.workspace.openOptions.isSharedMode) {
      return {};
    }
    const docScopeId = this.workspaceService.workspace.openOptions.docScopeId;
    if (docScopeId && docId !== docScopeId) {
      return {};
    }
    let permissions: DocPermissions;
    try {
      permissions = await this.guardStore.getDocPermissions(docId);
    } catch (error) {
      if (![401, 403, 404].includes(UserFriendlyError.fromAny(error).status)) {
        throw error;
      }
      // A revoked document must not retain the last successful write grant.
      // Transient/offline failures still follow the existing retry behaviour.
      permissions = revokedPermissions(this.docPermissions$.value[docId]);
    }
    this.docPermissions$.next({
      ...this.docPermissions$.value,
      [docId]: permissions,
    });
    return permissions;
  };

  override dispose() {
    if (this.documentScopePollTimer) {
      clearInterval(this.documentScopePollTimer);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.refreshObservedPermissions);
      window.removeEventListener('online', this.refreshObservedPermissions);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.refreshObservedPermissions
      );
    }
    this.observedDocs.clear();
    this.listedDocs.clear();
    this.revalidateWorkspacePermission.unsubscribe();
    this.revalidateDocPermission.unsubscribe();
  }
}

function isPageHidden() {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
}

/** Every known grant becomes false, plus the read/write keys callers check. */
function revokedPermissions(previous?: DocPermissions): DocPermissions {
  return {
    ...Object.fromEntries(Object.keys(previous ?? {}).map(key => [key, false])),
    Doc_Read: false,
    Doc_Update: false,
  };
}

/** An older server without `docsPermissions` rejects the query as invalid. */
function isUnsupportedBatch(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.message.includes('readableDocIds')) {
    return true;
  }
  return UserFriendlyError.fromAny(error).status === 400;
}

function abortReason(signal?: AbortSignal) {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError');
}
