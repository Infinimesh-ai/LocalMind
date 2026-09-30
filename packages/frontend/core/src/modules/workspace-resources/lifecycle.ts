import { UserFriendlyError } from '@affine/error';
import {
  type ChangeWorkspaceLifecycleInput,
  changeWorkspaceLifecycleMutation,
  workspaceLifecycleResourceQuery,
  workspaceTrashedFoldersQuery,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../cloud';
import type { WorkspaceService } from '../workspace';
import type { WorkspaceResourcesService } from './service';

export type LifecycleKind = 'doc' | 'folder';
export type LifecycleAction = 'trash' | 'restore' | 'delete';
export class WorkspaceLifecycleService extends Service {
  readonly changes$ = new LiveData(0);
  private readonly requests = new Map<string, ChangeWorkspaceLifecycleInput>();
  private generation = 0;
  private readonly pending = new Set<string>();
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly resources: WorkspaceResourcesService
  ) {
    super();
    const subscription = serverService.server$
      .pipe(switchMap(server => server?.account$ ?? of(null)))
      .subscribe(() => {
        this.generation++;
        this.requests.clear();
      });
    this.disposables.push(() => subscription.unsubscribe());
  }
  get online() {
    return this.workspaceService.workspace.flavour !== 'local';
  }
  private get server() {
    const server = this.serverService.server;
    if (!server?.account$.value)
      throw new Error('Sign in before changing resources');
    return server;
  }
  async get(kind: LifecycleKind, resourceId: string) {
    return (
      await this.server.gql({
        query: workspaceLifecycleResourceQuery,
        variables: {
          input: {
            workspaceId: this.workspaceService.workspace.id,
            resourceId,
            kind,
          },
        },
      })
    ).workspaceLifecycleResource;
  }
  async folders(signal: AbortSignal) {
    return (
      await this.server.gql({
        query: workspaceTrashedFoldersQuery,
        variables: { workspaceId: this.workspaceService.workspace.id },
        context: { signal },
      })
    ).workspaceTrashedFolders;
  }
  async change(
    kind: LifecycleKind,
    resourceId: string,
    action: LifecycleAction,
    local?: () => void
  ) {
    if (!this.online) {
      if (!local) throw new Error('This action requires an online workspace');
      local();
      return;
    }
    const id = `${kind}:${resourceId}:${action}`;
    if (this.pending.has(id))
      throw new Error('Operation is already in progress');
    this.pending.add(id);
    try {
      const server = this.server;
      const generation = this.generation;
      let request = this.requests.get(id);
      if (!request) {
        const current = await this.get(kind, resourceId);
        if (generation !== this.generation) throw new Error('Account changed');
        request = {
          workspaceId: this.workspaceService.workspace.id,
          kind,
          resourceId,
          action,
          expectedVersion: current.version,
          requestKey: nanoid(),
        };
        this.requests.set(id, request);
      }
      await server.gql({
        query: changeWorkspaceLifecycleMutation,
        variables: { input: request },
      });
      if (generation !== this.generation) return;
      this.requests.delete(id);
      this.resources.invalidate();
      this.changes$.next(this.changes$.value + 1);
    } catch (error) {
      // A definite rejection may be retried against a fresh version; timeouts reuse the receipt key.
      if (
        [400, 403, 404, 409].includes(UserFriendlyError.fromAny(error).status)
      )
        this.requests.delete(id);
      throw error;
    } finally {
      this.pending.delete(id);
    }
  }
  discardRetry(
    kind: LifecycleKind,
    resourceId: string,
    action: LifecycleAction
  ) {
    this.requests.delete(`${kind}:${resourceId}:${action}`);
  }
}
