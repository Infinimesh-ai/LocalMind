import { UserFriendlyError } from '@affine/error';
import {
  type MutateWorkspacePageTreeMutation,
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
import { distinctUntilChanged, of, switchMap } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceDBService } from '../../db';
import type { WorkspaceDialogService } from '../../dialogs';
import type { WorkspaceService } from '../../workspace';
import type { WorkspaceResourcesService } from '../../workspace-resources';
import type { LocalPageTreeAdapter } from './page-tree-local';
import { localWorkspacePageTree } from './page-tree-local-workspace';

type Page = WorkspacePageTreeQuery['workspacePageTree'];
type Receipt = MutateWorkspacePageTreeMutation['mutateWorkspacePageTree'];
export type PageTreeItem = Page['items'][number];
type Layer = {
  page?: Page;
  loading: boolean;
  error: boolean;
  rateLimited?: boolean;
};
type LayerQuery = {
  parentNodeId?: string | null;
  trash?: boolean;
  resourceId?: string;
  resourceKind?: string;
};
const rootKey = '$page-tree-root';
const initial: Layer = { loading: true, error: false };
const freshness = 30_000;
const pollBatchSize = 4;

export class WorkspacePageTreeService extends Service {
  private readonly local?: LocalPageTreeAdapter;
  readonly layers$ = new LiveData<ReadonlyMap<string, Layer>>(new Map());
  readonly enabled$ = new LiveData<boolean | null>(null);
  readonly saving$ = new LiveData(false);
  readonly syncing$ = new LiveData(false);
  readonly writeBlocked$ = LiveData.computed(
    get => get(this.saving$) || get(this.syncing$)
  );
  readonly undo$ = new LiveData<{
    revision: number;
    command: Pick<
      WorkspacePageTreeCommandInput,
      | 'action'
      | 'nodeId'
      | 'parentNodeId'
      | 'beforeNodeId'
      | 'siblingOrder'
      | 'targetSiblingOrder'
      | 'sourceSiblingOrder'
    >;
  } | null>(null);
  private readonly observers = new Map<
    string,
    { query: LayerQuery; count: number }
  >();
  private readonly inFlight = new Map<
    string,
    { more: boolean; promise: Promise<void> }
  >();
  private readonly loadedAt = new Map<string, number>();
  private readonly attemptedAt = new Map<string, number>();
  private readonly failures = new Map<
    string,
    { count: number; retryAt: number }
  >();
  private rateLimitedUntil = 0;
  private rateLimitCount = 0;
  private rateLimitEpoch = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private committedRevision = 0;
  private readonly aliases = new Map<string, string>();
  private polling = false;
  private stopped = false;
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
    this.disposables.push(() => {
      this.stopped = true;
      this.generation++;
      for (const controller of this.controllers.values()) controller.abort();
      this.inFlight.clear();
      this.observers.clear();
      clearTimeout(this.retryTimer);
    });
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
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear();
        this.requests.clear();
        this.inFlight.clear();
        this.loadedAt.clear();
        this.attemptedAt.clear();
        this.failures.clear();
        this.aliases.clear();
        clearTimeout(this.retryTimer);
        this.rateLimitedUntil = 0;
        this.rateLimitCount = 0;
        this.rateLimitEpoch = 0;
        this.committedRevision = 0;
        this.syncing$.next(false);
        this.undo$.next(null);
        this.layers$.next(new Map());
        this.enabled$.next(null);
        void this.load(null).catch(console.error);
      });
    const timer = setInterval(() => {
      if (
        !this.saving$.value &&
        !this.polling &&
        this.enabled$.value !== false &&
        serverService.server?.account$.value &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      )
        void this.poll().catch(console.error);
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
  observe(parentNodeId: string | null) {
    return this.observeQuery(this.key(parentNodeId), { parentNodeId });
  }
  observeResource(kind: string, resourceId: string) {
    return this.observeQuery(this.resourceKey(kind, resourceId), {
      resourceKind: kind,
      resourceId,
    });
  }
  observeTrash() {
    return this.observeQuery('$page-tree-trash', { trash: true });
  }
  private observeQuery(key: string, query: LayerQuery) {
    const entry = this.observers.get(key) ?? { query, count: 0 };
    this.observers.set(key, entry);
    entry.count++;
    // Mounting another consumer (or reopening a branch) can reuse a fresh layer.
    if (
      !this.unchangedSinceRoot(key) &&
      Date.now() - (this.loadedAt.get(this.resolveKey(key)) ?? -Infinity) >=
        freshness
    )
      void this.query(key, query).catch(console.error);
    return () => {
      if (--entry.count === 0) this.observers.delete(key);
    };
  }
  private set(key: string, layer: Layer) {
    key = this.resolveKey(key);
    const next = new Map(this.layers$.value);
    next.set(key, layer);
    for (const [alias, target] of this.aliases)
      if (target === key) next.set(alias, layer);
    this.layers$.next(next);
  }
  private resolveKey(key: string) {
    return this.aliases.get(key) ?? key;
  }
  private registerLocation(key: string, page: Page) {
    if (!page.parent) return key;
    const canonical = this.key(page.parent.nodeId);
    const resource = this.resourceKey(page.parent.kind, page.parent.resourceId);
    this.aliases.set(resource, canonical);
    if (key !== canonical) this.aliases.set(key, canonical);
    return canonical;
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
  private query(key: string, query: LayerQuery, more = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const resolved = this.resolveKey(key);
    if (resolved !== key) {
      key = resolved;
      query = { parentNodeId: key };
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      if (pending.more === more) return pending.promise;
      const generation = this.generation;
      return pending.promise.then(() => {
        if (generation === this.generation) return this.query(key, query, more);
        return undefined;
      });
    }
    if (Date.now() < this.rateLimitedUntil) {
      this.set(key, {
        ...this.layers$.value.get(key),
        loading: false,
        error: true,
        rateLimited: true,
      });
      return Promise.resolve();
    }
    if (Date.now() < (this.failures.get(key)?.retryAt ?? 0))
      return Promise.resolve();
    if (more && !this.layers$.value.get(key)?.page?.nextCursor)
      return Promise.resolve();
    const page = this.layers$.value.get(key)?.page;
    const root = this.layers$.value.get(rootKey)?.page;
    if (
      more &&
      page &&
      root &&
      key !== rootKey &&
      (page.revision < root.revision ||
        (page.revision === root.revision &&
          page.authorizationRevision !== root.authorizationRevision))
    )
      return this.query(key, query);
    const promise = this.fetchLayer(key, query, more).finally(() => {
      if (this.inFlight.get(key)?.promise === promise)
        this.inFlight.delete(key);
    });
    this.inFlight.set(key, { more, promise });
    return promise;
  }
  private async fetchLayer(key: string, query: LayerQuery, more: boolean) {
    const previous = this.layers$.value.get(key);
    const controller = new AbortController(),
      generation = this.generation;
    const rateLimitEpoch = this.rateLimitEpoch;
    this.controllers.set(key, controller);
    this.attemptedAt.set(key, Date.now());
    this.set(key, {
      ...previous,
      loading: true,
      error: false,
      rateLimited: false,
    });
    let discardPrevious = false;
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
      const canonical = this.registerLocation(key, page);
      const current = this.layers$.value.get(canonical);
      // Another identity may have completed a newer read while this one was running.
      if (
        page.enabled &&
        current?.page &&
        current.page.revision > page.revision
      ) {
        this.set(canonical, current);
        if (
          canonical === rootKey &&
          current.page.revision >= this.committedRevision
        )
          this.syncing$.next(false);
        return;
      }
      if (key === rootKey) this.enabled$.next(page.enabled);
      if (more && previous?.page) {
        if (
          previous.page.revision !== page.revision ||
          previous.page.authorizationRevision !== page.authorizationRevision
        ) {
          discardPrevious = true;
          throw new Error('Page tree changed while loading');
        }
        page.items = [
          ...new Map(
            [...previous.page.items, ...page.items].map(node => [
              node.nodeId,
              node,
            ])
          ).values(),
        ];
      }
      this.loadedAt.set(canonical, Date.now());
      this.failures.delete(canonical);
      if (Date.now() >= this.rateLimitedUntil) this.rateLimitCount = 0;
      this.set(canonical, { page, loading: false, error: false });
      if (canonical === rootKey && page.revision >= this.committedRevision)
        this.syncing$.next(false);
    } catch (caught) {
      if (!controller.signal.aborted && generation === this.generation) {
        const error = UserFriendlyError.fromAny(caught);
        const rateLimited =
          error.status === 429 || error.is('TOO_MANY_REQUEST');
        const transient =
          rateLimited || error.status >= 500 || error.isNetworkError();
        const canonical = this.resolveKey(key);
        this.loadedAt.delete(canonical);
        const count = (this.failures.get(canonical)?.count ?? 0) + 1;
        if (rateLimited && rateLimitEpoch === this.rateLimitEpoch) {
          this.rateLimitEpoch++;
          this.rateLimitedUntil =
            Date.now() +
            (error.retryAfterMs ??
              Math.min(300_000, 60_000 * 2 ** this.rateLimitCount++));
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(
            () => {
              if (generation !== this.generation || this.stopped) return;
              for (const [key, layer] of this.layers$.value)
                if (layer.rateLimited)
                  this.set(key, { ...layer, rateLimited: false });
              if (
                typeof document !== 'undefined' &&
                document.visibilityState === 'visible' &&
                !this.saving$.value
              )
                void this.poll().catch(console.error);
            },
            Math.max(1000, this.rateLimitedUntil - Date.now())
          );
        }
        this.failures.set(canonical, {
          count,
          retryAt: rateLimited
            ? this.rateLimitedUntil
            : Date.now() + Math.min(60_000, 15_000 * 2 ** (count - 1)),
        });
        // A temporary transport failure must not unmount the expanded subtree.
        // Access failures and mixed pagination snapshots still discard cached data.
        const cached =
          this.layers$.value.get(canonical)?.page ?? previous?.page;
        this.set(canonical, {
          ...(transient && !discardPrevious && cached ? { page: cached } : {}),
          loading: false,
          error: true,
          ...(rateLimited ? { rateLimited: true } : {}),
        });
      }
    } finally {
      if (this.controllers.get(key) === controller)
        this.controllers.delete(key);
    }
  }
  private activeQueries() {
    const queries = new Map<string, LayerQuery>([
      [rootKey, { parentNodeId: null }],
    ]);
    for (const [key, entry] of this.observers) {
      const resolved = this.resolveKey(key);
      queries.set(
        resolved,
        resolved === key ? entry.query : { parentNodeId: resolved }
      );
    }
    return queries;
  }
  private unchangedSinceRoot(key: string) {
    key = this.resolveKey(key);
    if (key === rootKey) return false;
    const root = this.layers$.value.get(rootKey);
    const layer = this.layers$.value.get(key);
    return (
      !root?.error &&
      !layer?.error &&
      !!root?.page?.snapshotRevision &&
      root.page.snapshotRevision === layer?.page?.snapshotRevision &&
      Date.now() - (this.loadedAt.get(rootKey) ?? -Infinity) < freshness
    );
  }
  private async poll() {
    if (Date.now() < this.rateLimitedUntil) return;
    this.polling = true;
    const generation = this.generation;
    try {
      // Read the complete snapshot version first. An unchanged root proves that
      // cached child layers (including their titles and rights) remain current.
      // Legacy/local responses without a snapshot version retain normal polling.
      let budget = pollBatchSize;
      if (
        Date.now() >= (this.failures.get(rootKey)?.retryAt ?? 0) &&
        Date.now() - (this.loadedAt.get(rootKey) ?? -Infinity) >= freshness
      ) {
        await this.query(rootKey, { parentNodeId: null });
        budget--;
      }
      // Bound background traffic even when many branches are open. Oldest layers
      // go first, so every visible layer eventually refreshes without a burst.
      const queries = [...this.activeQueries()]
        .filter(
          ([key]) =>
            !this.inFlight.has(key) &&
            !this.unchangedSinceRoot(key) &&
            Date.now() >= (this.failures.get(key)?.retryAt ?? 0) &&
            Date.now() - (this.loadedAt.get(key) ?? -Infinity) >= freshness
        )
        .sort(
          ([a], [b]) =>
            (this.attemptedAt.get(a) ?? 0) - (this.attemptedAt.get(b) ?? 0)
        )
        .slice(0, budget);
      for (const [key, query] of queries) {
        if (
          this.stopped ||
          generation !== this.generation ||
          Date.now() < this.rateLimitedUntil
        )
          break;
        if (this.activeQueries().has(key)) await this.query(key, query);
      }
    } finally {
      this.polling = false;
    }
  }
  async refresh(parentNodeId?: string | null) {
    const queries = this.activeQueries();
    if (parentNodeId !== undefined) {
      const affected = new Set([rootKey, this.key(parentNodeId)]);
      await this.refreshQueries(
        new Map([...queries].filter(([key]) => affected.has(key)))
      );
    } else await this.refreshQueries(queries);
  }
  private async refreshQueries(queries: Map<string, LayerQuery>) {
    const generation = this.generation;
    for (const key of queries.keys()) this.loadedAt.delete(key);
    for (const [key, query] of queries) {
      // A mutation needs a read started after it completed, not a stale in-flight read.
      await this.inFlight.get(key)?.promise;
      if (this.stopped || generation !== this.generation) return;
      await this.query(key, query);
    }
  }
  private mutationQueries(
    command: WorkspacePageTreeCommandInput,
    receipt?: Receipt
  ) {
    const active = this.activeQueries();
    const affected = new Set<string>([rootKey]);
    if (['trash', 'restore', 'delete'].includes(command.action))
      affected.add('$page-tree-trash');
    const parents = new Set<string | null>();
    if (command.parentNodeId !== undefined) parents.add(command.parentNodeId);
    if (receipt) {
      parents.add(receipt.parentNodeId);
      parents.add(receipt.oldParentNodeId);
    }
    const nodeId = receipt?.nodeId ?? command.nodeId;
    for (const [key, layer] of this.layers$.value) {
      const page = layer.page;
      const source = page?.items.find(item => item.nodeId === nodeId);
      if (source) parents.add(source.parentNodeId);
      const parent = page?.parent;
      if (parent && parent.nodeId === nodeId) parents.add(parent.parentNodeId);
      if (
        nodeId &&
        (key === nodeId ||
          page?.parent?.nodeId === nodeId ||
          page?.ancestors.some(ancestor => ancestor.nodeId === nodeId))
      ) {
        affected.add(this.resolveKey(key));
        if (command.action === 'trash' || command.action === 'delete')
          this.set(key, { loading: true, error: false });
      }
    }
    for (const parent of parents) affected.add(this.key(parent));
    for (const key of affected) this.loadedAt.delete(key);
    return new Map([...active].filter(([key]) => affected.has(key)));
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
      | 'targetSiblingOrder'
      | 'sourceSiblingOrder'
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
    if (this.syncing$.value)
      throw new Error('Wait for page tree synchronization before editing');
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
      const receipt = result.mutateWorkspacePageTree;
      this.committedRevision = Math.max(
        this.committedRevision,
        receipt.revision
      );
      this.syncing$.next(true);
      await this.refreshQueries(this.mutationQueries(input, receipt));
      if (generation !== this.generation) throw new Error('Account changed');
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
            ...(receipt.oldTargetSiblingOrder != null
              ? { sourceSiblingOrder: receipt.oldTargetSiblingOrder }
              : {}),
            ...(receipt.oldSourceSiblingOrder != null
              ? { targetSiblingOrder: receipt.oldSourceSiblingOrder }
              : {}),
            ...(!receipt.oldSiblingOrder &&
            receipt.oldSourceSiblingOrder == null &&
            receipt.oldBeforeNodeId
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
      const status = UserFriendlyError.fromAny(error).status;
      if (generation === this.generation && status !== 400 && status !== 429)
        await this.refreshQueries(this.mutationQueries(input));
      throw error;
    } finally {
      this.saving$.next(false);
    }
  }
}
