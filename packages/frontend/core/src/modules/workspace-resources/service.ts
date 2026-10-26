import { UserFriendlyError } from '@affine/error';
import {
  type ChangeWorkspaceNativeResourceInput,
  changeWorkspaceNativeResourceMutation,
  workspaceDirectoryQuery,
  workspaceDocumentTypes,
  workspaceNativeResourceQuery,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { distinctUntilChanged, map, merge, of, switchMap } from 'rxjs';
import { z } from 'zod';

import type { WorkspaceServerService } from '../cloud';
import type { NbstoreService } from '../storage';
import type { WorkspaceService } from '../workspace';

export const nativeResourceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  kind: z.enum(['file', 'office']),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  contentVersion: z.number(),
  metadataVersion: z.number(),
  documentType: z.enum(workspaceDocumentTypes),
  createdBy: z.string().nullable(),
  lastUpdatedAt: z.string().nullable(),
  lastUpdatedBy: z.string().nullable(),
  lastUpdateActor: z.enum(['unknown', 'user', 'system']),
  tags: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() })
  ),
  canEditTags: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  trashedAt: z.string().nullable(),
  canEdit: z.boolean().optional(),
  canManage: z.boolean().optional(),
  canRename: z.boolean().optional(),
  canMove: z.boolean().optional(),
  canCopy: z.boolean().optional(),
  canTrash: z.boolean().optional(),
  canRestore: z.boolean().optional(),
  canDeletePermanently: z.boolean().optional(),
  folderIds: z.array(z.string()).default([]),
  folderPaths: z.array(z.string()).default([]),
  atRoot: z.boolean().default(false),
  searchStatus: z.string().optional(),
});
export type NativeResource = z.infer<typeof nativeResourceSchema>;
const pageSchema = z.object({
  items: z.array(nativeResourceSchema),
  nextCursor: z.string().nullish(),
});
export type ResourceState = {
  items: NativeResource[];
  loading: boolean;
  error: boolean;
  ready: boolean;
};
const empty = (): ResourceState => ({
  items: [],
  loading: false,
  error: false,
  ready: false,
});
const freshness = 15_000;

class ResourceListError extends Error {
  constructor(readonly status: number) {
    super('Resource list unavailable');
  }
}

/** A bounded, derived catalog shared by the tree, explorer and Trash. */
export class WorkspaceResourcesService extends Service {
  readonly invalidated$ = new LiveData(0);
  readonly active$ = new LiveData<ResourceState>(empty());
  readonly trash$ = new LiveData<ResourceState>(empty());
  private readonly controllers = new Map<boolean, AbortController>();
  private readonly observers = new Map<boolean, number>();
  private generation = 0;
  private readonly moves = new Map<
    string,
    ChangeWorkspaceNativeResourceInput
  >();
  private readonly moving = new Set<string>();
  private readonly pendingRefresh = new Set<boolean>();
  private readonly dirty = new Set<boolean>();
  private readonly loadedAt = new Map<boolean, number>();
  private tagSignature?: string;
  get online() {
    return this.workspaceService.workspace.flavour !== 'local';
  }

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    nbstore: NbstoreService
  ) {
    super();
    const refresh = () => {
      if (
        typeof document !== 'undefined' &&
        (document.visibilityState === 'hidden' || !navigator.onLine)
      )
        return;
      // Search sessions own their query results and still need the fallback signal.
      this.invalidated$.next(this.invalidated$.value + 1);
      for (const trash of [false, true]) {
        if (this.observers.get(trash) && this.isStale(trash))
          void this.refresh(trash).catch(() => undefined);
      }
    };
    const subscription = serverService.server$
      .pipe(
        switchMap(server =>
          server
            ? server.account$.pipe(
                distinctUntilChanged(
                  (previous, next) => previous?.id === next?.id
                )
              )
            : of(null)
        )
      )
      .subscribe(() => {
        this.generation++;
        this.moves.clear();
        this.invalidate(true);
      });
    const workspaceId = workspaceService.workspace.id;
    const changes = merge(
      nbstore.realtime
        .subscribe('workspace.nativeResources.changed', { workspaceId })
        .pipe(map(() => false)),
      nbstore.realtime
        .subscribe('workspace.access.changed', { workspaceId })
        .pipe(map(() => true)),
      nbstore.realtime
        .subscribe('workspace.directory-policy.changed', { workspaceId })
        .pipe(map(() => true))
    ).subscribe({ next: clear => this.invalidate(clear), error: refresh });
    const timer = setInterval(refresh, freshness);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
      document.addEventListener('visibilitychange', refresh);
    }
    this.disposables.push(() => {
      subscription.unsubscribe();
      changes.unsubscribe();
      clearInterval(timer);
      this.controllers.forEach(controller => controller.abort());
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('online', refresh);
        document.removeEventListener('visibilitychange', refresh);
      }
    });
  }

  state(trash = false) {
    return trash ? this.trash$ : this.active$;
  }
  private isStale(trash: boolean) {
    return (
      !this.state(trash).value.ready ||
      this.state(trash).value.error ||
      this.dirty.has(trash) ||
      Date.now() - (this.loadedAt.get(trash) ?? -Infinity) >= freshness
    );
  }
  reconcileTagMetadata(
    tags: readonly { id: string; name: string; color: string }[]
  ) {
    const signature = JSON.stringify(
      tags
        .map(({ id, name, color }) => [id, name, color])
        .sort((a, b) => a[0].localeCompare(b[0]))
    );
    const changed =
      this.tagSignature !== undefined && this.tagSignature !== signature;
    this.tagSignature = signature;
    if (changed) this.invalidate();
  }
  watch(trash = false) {
    this.observers.set(trash, (this.observers.get(trash) ?? 0) + 1);
    if (this.isStale(trash)) void this.refresh(trash).catch(() => undefined);
    return () => {
      this.observers.set(
        trash,
        Math.max(0, (this.observers.get(trash) ?? 1) - 1)
      );
    };
  }
  invalidate(clear = false) {
    this.invalidated$.next(this.invalidated$.value + 1);
    for (const trash of [false, true]) {
      this.dirty.add(trash);
      if (clear) {
        this.controllers.get(trash)?.abort();
        this.controllers.delete(trash);
        this.pendingRefresh.delete(trash);
        this.loadedAt.delete(trash);
        this.state(trash).next(empty());
      }
      if (this.controllers.has(trash)) this.pendingRefresh.add(trash);
      else if (this.observers.get(trash))
        void this.refresh(trash).catch(() => undefined);
    }
  }
  async move(
    identity: {
      workspaceId: string;
      resourceId: string;
      kind: 'file' | 'office';
    },
    folderId: string | null
  ) {
    if (identity.workspaceId !== this.workspaceService.workspace.id)
      throw new Error('Cross-workspace drag is unavailable');
    const server = this.serverService.server;
    if (!server?.account$.value)
      throw new Error('Sign in before moving resources');
    const generation = this.generation;
    const id = `${identity.kind}:${identity.resourceId}:${folderId ?? ''}`;
    if (this.moving.has(id))
      throw new Error('Resource move is already pending');
    this.moving.add(id);
    try {
      let input = this.moves.get(id);
      if (!input) {
        const [resource, directory] = await Promise.all([
          server.gql({
            query: workspaceNativeResourceQuery,
            variables: { input: identity },
          }),
          server.gql({
            query: workspaceDirectoryQuery,
            variables: { workspaceId: identity.workspaceId },
          }),
        ]);
        if (generation !== this.generation) throw new Error('Account changed');
        input = {
          ...identity,
          action: 'move',
          folderId,
          expectedVersion: resource.workspaceNativeResource.metadataVersion,
          expectedDirectoryVersion: directory.workspaceDirectory.revision,
          requestKey: nanoid(),
        };
        this.moves.set(id, input);
      }
      await server.gql({
        query: changeWorkspaceNativeResourceMutation,
        variables: { input },
      });
      if (generation !== this.generation) throw new Error('Account changed');
      this.moves.delete(id);
      this.invalidate();
    } catch (error) {
      if (
        [400, 403, 404, 409].includes(UserFriendlyError.fromAny(error).status)
      )
        this.moves.delete(id);
      throw error;
    } finally {
      this.moving.delete(id);
    }
  }
  async list(query: string, trash: boolean, signal: AbortSignal) {
    const server = this.serverService.server;
    if (!server?.account$.value) throw new Error('Sign in to load resources');
    const items = new Map<string, NativeResource>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    // Publish a complete bounded snapshot so mixed sorting never drops later pages.
    do {
      const params = new URLSearchParams({
        query,
        trash: String(trash),
        ...(cursor ? { cursor } : {}),
      });
      const response = await server.fetch(
        `/api/workspaces/${encodeURIComponent(this.workspaceService.workspace.id)}/files?${params}`,
        { signal, credentials: 'include' }
      );
      if (!response.ok) throw new ResourceListError(response.status);
      const page = pageSchema.parse(await response.json());
      for (const item of page.items) items.set(`${item.kind}:${item.id}`, item);
      cursor = page.nextCursor ?? undefined;
      if (
        items.size > 10000 ||
        (cursor && (cursors.has(cursor) || cursors.size >= 199))
      )
        throw new Error('Resource listing exceeds its supported limit');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...items.values()];
  }
  async refresh(trash = false) {
    const state$ = this.state(trash);
    if (!this.online) {
      state$.next({ ...empty(), ready: true });
      return;
    }
    if (this.controllers.has(trash)) {
      return;
    }
    const controller = new AbortController();
    this.controllers.set(trash, controller);
    this.dirty.delete(trash);
    state$.next({ ...state$.value, loading: true, error: false });
    try {
      const items = await this.list('', trash, controller.signal);
      if (!controller.signal.aborted) {
        this.loadedAt.set(trash, Date.now());
        state$.next({ items, loading: false, error: false, ready: true });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.dirty.add(trash);
        const status =
          error instanceof ResourceListError
            ? error.status
            : UserFriendlyError.fromAny(error).status;
        const denied = [401, 403, 404].includes(status);
        state$.next({
          ...(denied ? empty() : state$.value),
          loading: false,
          error: true,
        });
      }
    } finally {
      if (this.controllers.get(trash) === controller) {
        this.controllers.delete(trash);
        if (this.pendingRefresh.delete(trash) && this.observers.get(trash))
          void this.refresh(trash).catch(() => undefined);
      }
    }
  }
}
