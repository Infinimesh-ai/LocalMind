import { LiveData, Service } from '@toeverything/infra';

import type { WorkspacePageTreeService } from '../../organize';
import type { WorkbenchService } from '../../workbench';
import type { NavigationPanelService } from './navigation-panel';

export type CreatedResource = {
  kind: string;
  resourceId: string;
  nodeId?: string;
};
export type CreatedResourceReveal = {
  token: number;
  nodeIds: string[];
  resources: CreatedResource[];
  parentNodeId: string | null;
  focusTree: boolean;
  batch: boolean;
};

/** Transient UI intent; resource ownership and permissions remain in the tree service. */
export class CreatedResourceService extends Service {
  readonly reveal$ = new LiveData<CreatedResourceReveal | null>(null);
  readonly editorFocus$ = new LiveData<CreatedResource | null>(null);
  private navigationVersion = 0;
  private token = 0;
  private disposed = false;

  constructor(
    private readonly tree: WorkspacePageTreeService,
    private readonly navigation: NavigationPanelService,
    private readonly workbenchService: WorkbenchService
  ) {
    super();
    const subscription = workbenchService.workbench.location$.subscribe(() => {
      this.navigationVersion++;
      this.reveal$.next(null);
      this.editorFocus$.next(null);
    });
    let generation = tree.accountGeneration;
    const identity = tree.enabled$.subscribe(() => {
      if (generation !== tree.accountGeneration) {
        generation = tree.accountGeneration;
        this.reveal$.next(null);
        this.editorFocus$.next(null);
      }
    });
    this.disposables.push(() => {
      this.disposed = true;
      subscription.unsubscribe();
      identity.unsubscribe();
    });
  }

  begin() {
    const version = this.navigationVersion;
    const generation = this.tree.accountGeneration;
    const sameAccount = () =>
      !this.disposed && generation === this.tree.accountGeneration;
    return {
      sameAccount,
      isCurrent: () => sameAccount() && version === this.navigationVersion,
    };
  }

  async reveal(
    resources: CreatedResource[],
    isCurrent: () => boolean,
    focusEditor = true,
    batch = resources.length > 1
  ) {
    if (!resources.length || !isCurrent()) return false;
    const first = resources[0];
    if (this.tree.enabled$.value === false) {
      if (!batch)
        this.workbenchService.workbench.openTreeResource({
          ...first,
          nodeId: first.nodeId ?? '',
        });
      return true;
    }
    await this.tree.loadResource(first.kind, first.resourceId);
    if (!isCurrent()) return false;
    const location = this.tree.layers$.value.get(
      this.tree.resourceKey(first.kind, first.resourceId)
    );
    if (location?.error || !location?.page?.parent)
      throw new Error('Created resource location unavailable');
    const { parent: item, ancestors } = location.page;
    const parentNodeId = item.parentNodeId ?? null;
    const targetIds = new Set(
      resources.map(resource => `${resource.kind}:${resource.resourceId}`)
    );
    // Load only the path and direct sibling pages needed to reveal the new items.
    // Never invent an item or append it outside the user's selected sort order.
    for (const node of [...ancestors, item]) {
      const parentId = node.parentNodeId ?? null;
      const containsTargets = () => {
        const layer = this.tree.layer$(parentId).value;
        if (layer.error || !layer.page) return false;
        const page = layer.page;
        if (parentId !== parentNodeId)
          return layer.page.items.some(child => child.nodeId === node.nodeId);
        return [...targetIds].every(id =>
          page.items.some(child => `${child.kind}:${child.resourceId}` === id)
        );
      };
      if (!containsTargets()) await this.tree.load(parentId);
      for (let count = 0; count < 100 && !containsTargets(); count++) {
        if (!isCurrent()) return false;
        const layer = this.tree.layer$(parentId).value;
        const cursor = layer.page?.nextCursor;
        if (layer.error || !cursor) break;
        await this.tree.load(parentId, true);
        if (this.tree.layer$(parentId).value.page?.nextCursor === cursor) break;
      }
      if (!isCurrent()) return false;
      if (!containsTargets())
        throw new Error('Created resource is not visible in its parent');
    }
    for (const ancestor of ancestors)
      this.navigation.setCollapsed(['page-tree', ancestor.nodeId], false);
    const siblings = this.tree.layer$(parentNodeId).value.page?.items ?? [];
    const nodeIds = siblings
      .filter(node => targetIds.has(`${node.kind}:${node.resourceId}`))
      .map(node => node.nodeId);
    const workbench = this.workbenchService.workbench;
    if (batch) {
      const parent = ancestors.at(-1);
      if (parent) workbench.openTreeResource(parent);
      else workbench.openAll();
    } else {
      workbench.openTreeResource(item);
    }
    this.reveal$.next({
      token: ++this.token,
      nodeIds,
      resources,
      parentNodeId,
      focusTree: !batch && item.kind === 'folder',
      batch,
    });
    if (!batch && focusEditor) this.editorFocus$.next(first);
    return true;
  }

  consumeEditorFocus(kind: string, resourceId: string) {
    const request = this.editorFocus$.value;
    if (request?.kind !== kind || request.resourceId !== resourceId)
      return false;
    this.editorFocus$.next(null);
    return true;
  }
}
