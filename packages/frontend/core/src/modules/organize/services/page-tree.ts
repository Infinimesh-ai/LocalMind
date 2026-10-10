import { UserFriendlyError } from '@affine/error';
import {
  mutateWorkspacePageTreeMutation,
  WORKSPACE_PAGE_TREE_CONTRACT,
  type WorkspacePageTreeCommandInput,
  workspacePageTreeConversionPreviewQuery,
  workspacePageTreeImpactQuery,
  type WorkspacePageTreeQuery,
  workspacePageTreeQuery,
} from '@affine/graphql';
import { LiveData, Service } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceDBService } from '../../db';
import type { WorkspaceDialogService } from '../../dialogs';
import type { WorkspaceService } from '../../workspace';
import type { WorkspaceResourcesService } from '../../workspace-resources';
import type { LocalPageTreeAdapter } from './page-tree-local';
import { localWorkspacePageTree } from './page-tree-local-workspace';

type Page = WorkspacePageTreeQuery['workspacePageTree'];
export type PageTreeItem = Page['items'][number];
type Layer = { page?: Page; loading: boolean; error: boolean };
const rootKey = '$page-tree-root';
const initial: Layer = { loading: true, error: false };

export class WorkspacePageTreeService extends Service {
  private readonly local?: LocalPageTreeAdapter;
  readonly layers$ = new LiveData<ReadonlyMap<string, Layer>>(new Map());
  readonly enabled$ = new LiveData<boolean | null>(null);
  readonly saving$ = new LiveData(false);
  readonly undo$ = new LiveData<{
    revision: number;
    command: Pick<
      WorkspacePageTreeCommandInput,
      'action' | 'nodeId' | 'parentNodeId' | 'beforeNodeId' | 'siblingOrder'
    >;
  } | null>(null);
  private readonly queries = new Map<
    string,
    {
      parentNodeId?: string | null;
      trash?: boolean;
      resourceId?: string;
      resourceKind?: string;
    }
  >();
  private generation = 0;
  get accountGeneration() {
    return this.generation;
  }
  get localUpload() {
    if (!this.local)
      throw new Error('Only local Workspaces can upload their page tree');
    return this.local;
  }
  private readonly controllers = new Map<string, AbortController>();
  private readonly requests = new Map<string, WorkspacePageTreeCommandInput>();
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly resources: WorkspaceResourcesService,
    db?: WorkspaceDBService,
    private readonly dialogs?: WorkspaceDialogService
  ) {
    super();
    if (workspaceService.workspace.flavour === 'local') {
      if (!db) throw new Error('Local page tree storage unavailable');
      const local = localWorkspacePageTree(workspaceService.workspace, db);
      this.local = local.adapter;
      const refresh = () => {
        if (!this.saving$.value) void this.refresh().catch(console.error);
      };
      workspaceService.workspace.rootYDoc.on('update', refresh);
      this.disposables.push(() => {
        workspaceService.workspace.rootYDoc.off('update', refresh);
        local.dispose();
      });
      void this.load(null).catch(console.error);
      return;
    }
    const subscription = serverService.server$
      .pipe(switchMap(server => server?.account$ ?? of(null)))
      .subscribe(() => {
        this.generation++;
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear();
        this.requests.clear();
        this.queries.clear();
        this.undo$.next(null);
        this.layers$.next(new Map());
        this.enabled$.next(null);
        void this.load(null).catch(console.error);
      });
    const timer = setInterval(() => {
      if (
        !this.saving$.value &&
        this.enabled$.value &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      )
        void this.refresh().catch(console.error);
    }, 15_000);
    this.disposables.push(() => {
      subscription.unsubscribe();
      clearInterval(timer);
      this.generation++;
      for (const controller of this.controllers.values()) controller.abort();
    });
  }
  private remote() {
    const server = this.serverService.server;
    if (!server) throw new Error('Connect to load the page tree');
    return server;
  }
  key(parentId: string | null) {
    return parentId ?? rootKey;
  }
  layer$(parentId: string | null) {
    return this.layers$.map(
      layers => layers.get(this.key(parentId)) ?? initial
    );
  }
  private set(key: string, layer: Layer) {
    const next = new Map(this.layers$.value);
    next.set(key, layer);
    this.layers$.next(next);
  }
  async load(parentNodeId: string | null, more = false) {
    return this.query(this.key(parentNodeId), { parentNodeId }, more);
  }
  resourceKey(kind: string, resourceId: string) {
    return JSON.stringify(['resource', kind, resourceId]);
  }
  loadResource(kind: string, resourceId: string, more = false) {
    return this.query(
      this.resourceKey(kind, resourceId),
      { resourceKind: kind, resourceId },
      more
    );
  }
  loadTrash(more = false) {
    return this.query('$page-tree-trash', { trash: true }, more);
  }
  async locate(kind: string, resourceId: string) {
    if (this.local)
      return this.local.list({ resourceId, resourceKind: kind, trash: true });
    const server = this.serverService.server;
    if (!server) throw new Error('Connect to load the page tree');
    return (
      await server.gql({
        query: workspacePageTreeQuery,
        variables: {
          workspaceId: this.workspaceService.workspace.id,
          clientContract: WORKSPACE_PAGE_TREE_CONTRACT,
          resourceKind: kind,
          resourceId,
          trash: true,
        },
      })
    ).workspacePageTree;
  }
  private async query(
    key: string,
    query: {
      parentNodeId?: string | null;
      trash?: boolean;
      resourceId?: string;
      resourceKind?: string;
    },
    more = false
  ) {
    this.queries.set(key, query);
    const previous = this.layers$.value.get(key);
    this.controllers.get(key)?.abort();
    const controller = new AbortController(),
      generation = this.generation;
    this.controllers.set(key, controller);
    this.set(key, { ...previous, loading: true, error: false });
    try {
      const server = this.serverService.server;
      if (!this.local && !server?.account$.value)
        throw new Error('Sign in to load the page tree');
      const variables = {
        ...query,
        ...(more && previous?.page?.nextCursor
          ? { after: previous.page.nextCursor }
          : {}),
      };
      const result = this.local
        ? { workspacePageTree: await this.local.list(variables) }
        : await this.remote().gql({
            query: workspacePageTreeQuery,
            variables: {
              workspaceId: this.workspaceService.workspace.id,
              clientContract: WORKSPACE_PAGE_TREE_CONTRACT,
              ...variables,
            },
            context: { signal: controller.signal },
          });
      if (controller.signal.aborted || generation !== this.generation) return;
      const page = result.workspacePageTree;
      if (key === rootKey) this.enabled$.next(page.enabled);
      if (more && previous?.page) {
        if (
          previous.page.revision !== page.revision ||
          previous.page.authorizationRevision !== page.authorizationRevision
        )
          throw new Error('Page tree changed while loading');
        page.items = [
          ...new Map(
            [...previous.page.items, ...page.items].map(node => [
              node.nodeId,
              node,
            ])
          ).values(),
        ];
      }
      this.set(key, { page, loading: false, error: false });
    } catch {
      if (!controller.signal.aborted && generation === this.generation)
        this.set(key, { loading: false, error: true });
    } finally {
      if (this.controllers.get(key) === controller)
        this.controllers.delete(key);
    }
  }
  async refresh() {
    await Promise.all(
      [...this.queries].map(([key, query]) => this.query(key, query))
    );
  }
  async undo() {
    const undo = this.undo$.value;
    await this.load(null);
    if (
      !undo ||
      this.layers$.value.get(rootKey)?.page?.revision !== undo.revision
    ) {
      this.undo$.next(null);
      throw new Error(
        'The page tree changed; this move can no longer be undone'
      );
    }
    await this.execute(undo.command);
    this.undo$.next(null);
  }
  async conversionPreview(nodeId: string) {
    const generation = this.generation;
    const result = this.local
      ? await this.local.conversionPreview(nodeId)
      : (
          await this.remote().gql({
            query: workspacePageTreeConversionPreviewQuery,
            variables: {
              workspaceId: this.workspaceService.workspace.id,
              nodeId,
            },
          })
        ).workspacePageTreeConversionPreview;
    if (generation !== this.generation) throw new Error('Account changed');
    return result;
  }
  async lifecyclePreview(
    nodeId: string,
    action: 'trash' | 'restore' | 'delete'
  ) {
    const generation = this.generation;
    const result = this.local
      ? await this.local.lifecyclePreview(nodeId, action)
      : (
          await this.remote().gql({
            query: workspacePageTreeImpactQuery,
            variables: {
              workspaceId: this.workspaceService.workspace.id,
              nodeId,
              action,
            },
          })
        ).workspacePageTreeImpact;
    if (generation !== this.generation) throw new Error('Account changed');
    return result;
  }
  confirmLifecycle(
    action: 'trash' | 'restore' | 'delete',
    nodeId: string,
    expectedParentNodeId?: string | null
  ) {
    const dialogs = this.dialogs;
    if (!dialogs) throw new Error('Workspace confirmation unavailable');
    return new Promise<boolean>(resolve => {
      dialogs.open(
        'page-tree-lifecycle',
        { action, nodeId, expectedParentNodeId },
        result => resolve(result === true)
      );
    });
  }
  async execute(
    command: Pick<
      WorkspacePageTreeCommandInput,
      | 'action'
      | 'nodeId'
      | 'parentNodeId'
      | 'beforeNodeId'
      | 'siblingOrder'
      | 'title'
      | 'primaryMode'
      | 'insertAfterBlockId'
      | 'resourceId'
      | 'expectedResourceVersion'
      | 'expectedParentNodeId'
    >,
    expected?: { revision: number; authorizationRevision: string }
  ) {
    if (this.saving$.value)
      throw new Error('A page tree operation is still saving');
    const server = this.serverService.server;
    const page = this.layers$.value.get(rootKey)?.page;
    if ((!this.local && (!server || !navigator.onLine)) || !page?.enabled)
      throw new Error('Connect to save page tree changes');
    const identity = JSON.stringify([command, expected]),
      generation = this.generation;
    const input = this.requests.get(identity) ?? {
      ...command,
      workspaceId: this.workspaceService.workspace.id,
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: expected?.revision ?? page.revision,
      expectedAuthorizationRevision:
        expected?.authorizationRevision ?? page.authorizationRevision,
      requestKey: nanoid(),
    };
    this.requests.set(identity, input);
    this.saving$.next(true);
    try {
      const result = this.local
        ? { mutateWorkspacePageTree: await this.local.execute(input) }
        : await this.remote().gql({
            query: mutateWorkspacePageTreeMutation,
            variables: { input },
          });
      if (generation !== this.generation)
        throw new Error('Account changed during page tree operation');
      this.requests.delete(identity);
      await this.refresh();
      const receipt = result.mutateWorkspacePageTree;
      if (command.action === 'move')
        this.undo$.next({
          revision: receipt.revision,
          command: {
            action: 'move',
            nodeId: receipt.nodeId,
            parentNodeId: receipt.oldParentNodeId,
            ...(receipt.oldSiblingOrder
              ? { siblingOrder: receipt.oldSiblingOrder }
              : {}),
            ...(receipt.oldBeforeNodeId
              ? { beforeNodeId: receipt.oldBeforeNodeId }
              : {}),
          },
        });
      else if (command.action === 'trash')
        this.undo$.next({
          revision: receipt.revision,
          command: { action: 'restore', nodeId: receipt.nodeId },
        });
      else this.undo$.next(null);
      this.resources.invalidate();
      const workspace = this.workspaceService.workspace;
      for (const id of [workspace.id, 'db$folders'])
        void workspace.engine.doc.requestPull(id).catch(() => {});
      return receipt;
    } catch (error) {
      // A rejected command has no side effects; explicit retry uses the refreshed
      // version. Unknown/network outcomes keep their original idempotency key.
      if (
        [400, 403, 404, 409].includes(UserFriendlyError.fromAny(error).status)
      )
        this.requests.delete(identity);
      await this.refresh();
      throw error;
    } finally {
      this.saving$.next(false);
    }
  }
}
