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
  combineLatest,
  defer,
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

export class GuardService extends Service {
  private readonly documentScopePollTimer?: ReturnType<typeof setInterval>;
  private readonly observedDocs = new Map<string, number>();
  private readonly refreshObservedPermissions = () => {
    if (this.isAdmin$.value === true) return;
    const docIds = new Set(this.observedDocs.keys());
    const scopedDoc = this.workspaceService.workspace.openOptions.docScopeId;
    if (scopedDoc) docIds.add(scopedDoc);
    docIds.forEach(docId => this.revalidateDocPermission(docId));
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
        5000
      );
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', this.refreshObservedPermissions);
        window.addEventListener('online', this.refreshObservedPermissions);
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
    const docId = args[0];
    return LiveData.from(
      new Observable(subscriber => {
        let prev: boolean | undefined = undefined;
        // Keep ACLs for visible documents fresh, without polling every cached doc.
        if (docId) {
          this.observedDocs.set(docId, (this.observedDocs.get(docId) ?? 0) + 1);
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
            const remaining = (this.observedDocs.get(docId) ?? 1) - 1;
            if (remaining > 0) this.observedDocs.set(docId, remaining);
            else this.observedDocs.delete(docId);
          }
        };
      }),
      undefined
    );
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
      })
    ).pipe(
      switchMap(checked => {
        if (!checked.size) return of(new Set<string>());
        const checkedIds = [...checked];
        return combineLatest(
          checkedIds.map(id => this.can$('Doc_Read', id))
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
              count: Infinity,
            })
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

  private readonly loadDocPermission = async (docId: string) => {
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
    let permissions: Partial<Record<DocPermissionActions, boolean>>;
    try {
      permissions = await this.guardStore.getDocPermissions(docId);
    } catch (error) {
      if (![401, 403, 404].includes(UserFriendlyError.fromAny(error).status)) {
        throw error;
      }
      // A revoked document must not retain the last successful write grant.
      // Transient/offline failures still follow the existing retry behaviour.
      permissions = {
        ...Object.fromEntries(
          Object.keys(this.docPermissions$.value[docId] ?? {}).map(key => [
            key,
            false,
          ])
        ),
        Doc_Read: false,
        Doc_Update: false,
      };
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
    this.observedDocs.clear();
    this.revalidateWorkspacePermission.unsubscribe();
    this.revalidateDocPermission.unsubscribe();
  }
}
