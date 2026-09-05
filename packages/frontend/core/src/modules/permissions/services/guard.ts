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
  exhaustMap,
  groupBy,
  map,
  mergeMap,
  Observable,
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

  constructor(
    private readonly guardStore: GuardStore,
    private readonly workspaceService: WorkspaceService,
    private readonly workspacePermissionService: WorkspacePermissionService
  ) {
    super();
    const docScopeId = this.workspaceService.workspace.openOptions.docScopeId;
    if (docScopeId) {
      this.documentScopePollTimer = setInterval(() => {
        this.revalidateDocPermission(docScopeId);
      }, 5000);
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

    if (this.isAdmin$.value === true) {
      // if the user is admin, the permission is always true
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
      fromPromise(() => this.guardStore.getWorkspacePermissions()).pipe(
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
    const permissions = await this.guardStore.getDocPermissions(docId);
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
    this.revalidateWorkspacePermission.unsubscribe();
    this.revalidateDocPermission.unsubscribe();
  }
}
