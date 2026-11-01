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
/** Matches the server's batch limit for `docsPermissions`. */
export const DOC_PERMISSION_BATCH_MAX = 100;
const DOC_PERMISSION_RETRY_COUNT = 3;

type DocPermissions = Partial<Record<DocPermissionActions, boolean>>;

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
    const ids = [...new Set(docIds)];
    if (!ids.length) return of(new Set<string>());
    if (this.workspaceService.workspace.flavour === 'local') {
      return of(new Set(ids));
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
          return new Set<string>();
        }
      })
    ).pipe(
      switchMap(checked => {
        if (!checked.size) return of(new Set<string>());
        const checkedIds = [...checked];
        // Listed candidates follow the slower refresh pool; opening a document
        // still subscribes it to the active pool through can$.
        return combineLatest(
          checkedIds.map(id => this.watch$('Doc_Read', id, this.listedDocs))
        ).pipe(
          map(
            permissions =>
              new Set(checkedIds.filter((_, i) => permissions[i] === true))
          )
        );
      }),
      startWith(new Set<string>())
    );
  }

  private async checkEach(ids: string[], signal: AbortSignal) {
    const checked = new Set<string>();
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
          }
        }
      })
    );
    return checked;
  }

  /**
   * Loads the live ACL of many documents with one request per 100 IDs and
   * returns the IDs whose result is known. Documents the server has no record
   * of, and servers without the batch query, use the single-doc check.
   */
  private async loadDocPermissions(
    docIds: readonly string[],
    signal?: AbortSignal
  ) {
    const ids = [...new Set(docIds)];
    const checked = new Set<string>();
    const single = async (pending: string[]) => {
      await Promise.all(
        pending.map(async id => {
          try {
            await this.loadDocPermission(id);
            checked.add(id);
          } catch {
            // Unknown results stay hidden until a later check succeeds.
          }
        })
      );
    };
    for (
      let offset = 0;
      offset < ids.length && !signal?.aborted;
      offset += DOC_PERMISSION_BATCH_MAX
    ) {
      const chunk = ids.slice(offset, offset + DOC_PERMISSION_BATCH_MAX);
      if (this.batchUnsupported) {
        await single(chunk);
        continue;
      }
      let checks;
      try {
        checks = await this.withDocLoadSlot(() =>
          this.guardStore.getDocsPermissions(chunk)
        );
      } catch (error) {
        if (!isUnsupportedBatch(error)) throw error;
        this.batchUnsupported = true;
        await single(chunk);
        continue;
      }
      const next = { ...this.docPermissions$.value };
      const missing: string[] = [];
      for (const check of checks) {
        if (check.status === 'granted' && check.permissions) {
          next[check.docId] = check.permissions;
          checked.add(check.docId);
        } else if (check.status === 'denied') {
          next[check.docId] = revokedPermissions(next[check.docId]);
          checked.add(check.docId);
        } else {
          missing.push(check.docId);
        }
      }
      this.docPermissions$.next(next);
      await single(missing);
    }
    return checked;
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
  if (error instanceof Error && error.message.includes('docsPermissions')) {
    return true;
  }
  return UserFriendlyError.fromAny(error).status === 400;
}
