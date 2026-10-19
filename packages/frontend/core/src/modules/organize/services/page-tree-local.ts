import {
  isPageTreeContainer,
  isPageTreeFolderMetadata,
  movePageTreeNode,
  pageTreeAncestors,
  type PageTreeNode,
  pageTreeNodeId,
  type PageTreeResource,
  pageTreeSiblingOrder,
  pageTreeSubtree,
  reorderPageTreeLevel,
  validatePageTree,
  WORKSPACE_PAGE_TREE_CONTRACT,
  WORKSPACE_PAGE_TREE_V1_CONTRACT,
  type WorkspacePageTreeCommandInput,
  type WorkspacePageTreeQuery,
} from '@affine/graphql';
import { generateFractionalIndexingKeyBetween } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import type { Doc as YDoc, Map as YMap } from 'yjs';
import { Array as YArray } from 'yjs';

type Page = WorkspacePageTreeQuery['workspacePageTree'];
type LocalReceipt = {
  operationId: string;
  nodeId: string;
  resourceId: string;
  parentNodeId: string | null;
  revision: number;
  oldParentNodeId: string | null;
  oldBeforeNodeId: string | null;
  oldSiblingOrder: string[] | null;
  oldTargetSiblingOrder: string[] | null;
  oldSourceSiblingOrder: string[] | null;
};
type Creation = {
  id: string;
  title: string;
  primaryMode: 'page' | 'edgeless';
  at: number;
};
type Pending = {
  key: string;
  fingerprint: string;
  nodes: PageTreeNode[];
  retired: string[];
  deletedResources: string[];
  create: Creation[];
  revision: number;
  receipt?: LocalReceipt;
  conversion?: { sourceKind: string; sourceId: string; nodeId: string };
  insert?: {
    parentId: string;
    after: string;
    resourceId: string;
    blockId: string;
  };
};
export type LocalPageTreePorts = {
  workspaceId: string;
  root: YDoc;
  folders: YDoc;
  properties: YDoc;
  journal: YDoc;
  ready(): Promise<void>;
  persist(): Promise<void>;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  create(input: Creation): Promise<void>;
  delete(resourceId: string): Promise<void>;
  insert?(input: NonNullable<Pending['insert']>): Promise<void>;
  validateInsert?(parentId: string, after: string): Promise<void>;
};
const stateKey = WORKSPACE_PAGE_TREE_CONTRACT;
const localAuthority = '0'.repeat(64);

/** folders remains the sole parent authority. The separate local journal only
 * stores immutable plans/receipts and the pending recovery operation. */
export class LocalPageTreeAdapter {
  constructor(private readonly ports: LocalPageTreePorts) {}
  async uploadSnapshot() {
    return this.ports.exclusive(async () => {
      await this.recover();
      await this.ports.persist();
      return this.graph().map(node => ({
        nodeId: node.nodeId,
        kind: node.resource.kind as 'doc' | 'folder',
        trashed: node.resource.trashed,
        ...(node.folder ? { folder: node.folder } : {}),
        resourceId: node.resource.resourceId,
        parentNodeId: node.parentNodeId,
        order: node.order,
        ...(node.defaultSortMode
          ? { defaultSortMode: node.defaultSortMode }
          : {}),
        ...(node.trashRootNodeId
          ? { trashRootNodeId: node.trashRootNodeId }
          : {}),
      }));
    });
  }
  get uploadTarget():
    | { id: string; flavour: string; actorId: string; fingerprint: string }
    | undefined {
    return this.state.get('uploadTarget') as
      | { id: string; flavour: string; actorId: string; fingerprint: string }
      | undefined;
  }
  async saveUploadTarget(
    target: NonNullable<LocalPageTreeAdapter['uploadTarget']>
  ) {
    this.state.set('uploadTarget', target);
    await this.ports.persist();
  }
  private get state() {
    return this.ports.journal.getMap(stateKey);
  }
  private pages() {
    const pages = this.ports.root.getMap('meta').get('pages');
    if (!(pages instanceof YArray))
      throw new Error('Workspace root is not ready');
    return pages as YArray<YMap<unknown>>;
  }
  private inventory() {
    const resources: PageTreeResource[] = this.pages().map(page => {
      const resourceId = page.get('id');
      if (typeof resourceId !== 'string')
        throw new Error('Invalid local document');
      const mode = this.ports.properties.getMap(resourceId).get('primaryMode');
      return {
        kind: 'doc' as const,
        resourceId,
        primaryMode:
          mode === 'edgeless' ? ('edgeless' as const) : ('page' as const),
        trashed: page.get('trash') === true,
      };
    });
    for (const [id] of this.ports.folders.share) {
      const row = this.ports.folders.getMap(id);
      if (
        row.get('type') === 'folder' &&
        row.get('$pageTreeContract') === stateKey &&
        row.get('$pageTreeRetired') !== true
      ) {
        if (!isPageTreeFolderMetadata(row.get('$pageTreeFolder')))
          throw new Error('Invalid local folder metadata');
        resources.push({
          kind: 'folder',
          resourceId: String(row.get('data')),
          trashed: row.get('$$DELETED') === true,
        });
      }
    }
    return resources;
  }
  private graph() {
    const inventory = this.inventory();
    const byId = new Map(inventory.map(item => [item.resourceId, item]));
    const nodes: PageTreeNode[] = [];
    for (const [id] of this.ports.folders.share) {
      const row = this.ports.folders.getMap(id);
      if (row.get('$pageTreeRetired') === true) continue;
      const resource = byId.get(String(row.get('data')));
      if (!resource || row.get('type') !== resource.kind)
        throw new Error('Local page tree requires repair');
      nodes.push({
        nodeId: id,
        resource,
        ...(resource.kind === 'folder'
          ? { folder: row.get('$pageTreeFolder') as PageTreeNode['folder'] }
          : {}),
        parentNodeId:
          typeof row.get('parentId') === 'string'
            ? String(row.get('parentId'))
            : null,
        order: String(row.get('index') ?? ''),
        ...(row.get('defaultSortMode') === 'name-desc'
          ? { defaultSortMode: 'name-desc' as const }
          : {}),
        ...(typeof row.get('$pageTreeTrashRoot') === 'string'
          ? { trashRootNodeId: String(row.get('$pageTreeTrashRoot')) }
          : {}),
      });
    }
    validatePageTree(nodes, inventory);
    return nodes;
  }
  private async migration() {
    const rows: (Record<string, unknown> & { id: string })[] = [
      ...this.ports.folders.share.keys(),
    ].map(id => ({ ...this.ports.folders.getMap(id).toJSON(), id }));
    const folders = rows.filter(
      row => row.type === 'folder' && !row.$pageTreeRetired
    );
    const folderMap = new Map(folders.map(row => [row.id, row]));
    const paths = (row: (typeof rows)[number]): string[] => {
      const seen = new Set<string>();
      const path = [String(row.index ?? ''), row.id];
      let parent: unknown = row.parentId;
      while (typeof parent === 'string') {
        if (seen.has(parent) || seen.size >= 64)
          throw new Error('Invalid local folder hierarchy');
        seen.add(parent);
        const item = folderMap.get(parent);
        if (!item) throw new Error('Missing local parent folder');
        path.unshift(String(item.index ?? ''), item.id);
        parent = item.parentId;
      }
      return path;
    };
    const compare = (
      left: (typeof rows)[number],
      right: (typeof rows)[number]
    ) => {
      const a = paths(left),
        b = paths(right);
      for (let i = 0; i < Math.min(a.length, b.length); i++)
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      return a.length - b.length;
    };
    const create: Creation[] = [];
    const nodes: PageTreeNode[] = [];
    for (const folder of folders) {
      paths(folder);
      nodes.push({
        nodeId: folder.id,
        folder: {
          title: String(folder.data).trim() || 'Untitled folder',
          metadataVersion: 1,
          createdAt: null,
          createdBy: null,
          updatedAt: null,
          updatedBy: null,
        },
        resource: {
          kind: 'folder',
          resourceId: folder.id,
          trashed: folder.$$DELETED === true,
        },
        parentNodeId:
          typeof folder.parentId === 'string' ? folder.parentId : null,
        order: String(folder.index),
        ...(folder.defaultSortMode === 'name-desc'
          ? { defaultSortMode: 'name-desc' as const }
          : {}),
        ...(folder.$$DELETED === true ? { trashRootNodeId: folder.id } : {}),
      });
    }
    let order: string | null = null;
    for (const resource of this.inventory()) {
      const placements = rows
        .filter(
          row =>
            row.type === 'doc' &&
            row.data === resource.resourceId &&
            !row.$pageTreeRetired
        )
        .sort(compare);
      const placement = placements[0];
      order = generateFractionalIndexingKeyBetween(order, null);
      nodes.push({
        nodeId: pageTreeNodeId(resource),
        resource,
        parentNodeId:
          placement && typeof placement.parentId === 'string'
            ? placement.parentId
            : null,
        order: placement ? String(placement.index) : order,
        ...(resource.trashed
          ? { trashRootNodeId: pageTreeNodeId(resource) }
          : {}),
      });
    }
    // Older local folders had no server ACL. Preserve earlier independent trash,
    // and never revive a descendant while converting a deleted container.
    for (const node of nodes) {
      if (node.resource.trashed) continue;
      let parent = node.parentNodeId;
      const seen = new Set<string>();
      while (parent) {
        if (seen.has(parent)) throw new Error('Local folder cycle');
        seen.add(parent);
        const ancestor = nodes.find(item => item.nodeId === parent);
        if (!ancestor) throw new Error('Missing local folder');
        if (ancestor.resource.trashed) {
          node.resource = { ...node.resource, trashed: true };
          node.trashRootNodeId = ancestor.trashRootNodeId ?? ancestor.nodeId;
          break;
        }
        parent = ancestor.parentNodeId;
      }
    }
    validatePageTree(nodes);
    return {
      key: 'migration',
      fingerprint: JSON.stringify(rows),
      nodes,
      create,
      retired: rows.map(row => row.id),
      deletedResources: [],
      revision: 1,
    } satisfies Pending;
  }
  private writeNodes(pending: Pending) {
    this.ports.folders.transact(() => {
      const active = new Set(pending.nodes.map(node => node.nodeId));
      for (const id of pending.retired)
        if (!active.has(id)) {
          const row = this.ports.folders.getMap(id);
          row.set('$$DELETED', true);
          row.set('$pageTreeRetired', true);
        }
      for (const node of pending.nodes) {
        const row = this.ports.folders.getMap(node.nodeId);
        const values = {
          id: node.nodeId,
          type: node.resource.kind,
          $pageTreeContract: stateKey,
          $pageTreeFolder: node.folder,
          data: node.resource.resourceId,
          parentId: node.parentNodeId,
          index: node.order,
          $$DELETED: node.resource.trashed,
          $pageTreeTrashRoot: node.trashRootNodeId,
          defaultSortMode: node.defaultSortMode,
        };
        for (const [key, value] of Object.entries(values))
          if (value === undefined) row.delete(key);
          else if (JSON.stringify(row.get(key)) !== JSON.stringify(value))
            row.set(key, value);
      }
    });
  }
  private async apply(pending: Pending) {
    for (const creation of pending.create) await this.ports.create(creation);
    for (const node of pending.nodes) {
      if (node.resource.kind === 'folder') continue;
      const page = this.pages()
        .toArray()
        .find(page => page.get('id') === node.resource.resourceId);
      if (!page) throw new Error('Local resource disappeared during operation');
      if (page.get('trash') !== node.resource.trashed)
        page.set('trash', node.resource.trashed);
    }
    for (const id of pending.deletedResources) await this.ports.delete(id);
    if (pending.insert) {
      if (!this.ports.insert)
        throw new Error('Subpage entry adapter unavailable');
      await this.ports.insert(pending.insert);
    }
    this.writeNodes(pending);
    validatePageTree(this.graph(), this.inventory());
    await this.ports.persist();
    this.ports.journal.transact(() => {
      this.state.set('revision', pending.revision);
      this.state.set('enabled', true);
      this.ports.journal.getMap('receipts').set(pending.key, {
        fingerprint: pending.fingerprint,
        receipt: pending.receipt ?? null,
      });
      if (pending.conversion)
        this.ports.journal
          .getMap('conversions')
          .set(
            JSON.stringify([
              pending.conversion.sourceKind,
              pending.conversion.sourceId,
            ]),
            pending.conversion.nodeId
          );
      this.state.delete('pending');
    });
    await this.ports.persist();
  }
  private async recover() {
    await this.ports.ready();
    let pending = this.state.get('pending') as Pending | undefined;
    if (!pending && this.state.get('enabled') !== true) {
      const old = this.ports.journal.getMap(WORKSPACE_PAGE_TREE_V1_CONTRACT);
      if (old.get('pending')) pending = old.get('pending') as Pending;
      else if (old.get('enabled') === true)
        pending = {
          key: 'upgrade-v2',
          fingerprint: WORKSPACE_PAGE_TREE_V1_CONTRACT,
          nodes: this.graph(),
          retired: [],
          deletedResources: [],
          create: [],
          revision: Number(old.get('revision')) + 1,
        };
      else pending = await this.migration();
      this.state.set('pending', pending);
      await this.ports.persist();
    }
    if (pending) await this.apply(pending);
  }
  async list(query: {
    parentNodeId?: string | null;
    resourceId?: string;
    resourceKind?: string;
    trash?: boolean;
    after?: string;
  }): Promise<Page> {
    return this.ports.exclusive(async () => {
      await this.recover();
      const nodes = this.graph(),
        byId = validatePageTree(nodes),
        revision = Number(this.state.get('revision'));
      let parent = query.resourceId
        ? nodes.find(
            node =>
              node.resource.resourceId === query.resourceId &&
              query.resourceKind === node.resource.kind
          )
        : query.parentNodeId
          ? byId.get(query.parentNodeId)
          : null;
      if (!parent && query.resourceId) {
        const nodeId = this.ports.journal
          .getMap('conversions')
          .get(JSON.stringify([query.resourceKind, query.resourceId]));
        parent = nodes.find(node => node.nodeId === nodeId);
      }
      if ((query.parentNodeId || query.resourceId) && !parent)
        throw new Error('Page unavailable');
      const scope = JSON.stringify([
        revision,
        parent?.nodeId ?? null,
        query.trash ?? false,
      ]);
      const offset = query.after
        ? Number(query.after.slice(scope.length + 1))
        : 0;
      if (
        query.after &&
        (!query.after.startsWith(scope + ':') ||
          !Number.isSafeInteger(offset) ||
          offset < 0)
      )
        throw new Error('Local page tree cursor changed');
      const describe = (node: PageTreeNode): Page['items'][number] => ({
        nodeId: node.nodeId,
        kind: node.resource.kind,
        resourceId: node.resource.resourceId,
        primaryMode: node.resource.primaryMode ?? null,
        parentNodeId: node.parentNodeId,
        title:
          node.folder?.title ??
          String(
            this.pages()
              .toArray()
              .find(page => page.get('id') === node.resource.resourceId)
              ?.get('title') ?? ''
          ),
        documentType:
          node.resource.kind === 'folder'
            ? 'folder'
            : node.resource.primaryMode === 'edgeless'
              ? 'edgeless'
              : 'page',
        order: node.order,
        trashed: node.resource.trashed,
        canOrganize: true,
        isContainer: isPageTreeContainer(node.resource),
        canRename: node.resource.kind === 'folder' && !node.resource.trashed,
        canConvertToPage:
          node.resource.kind === 'folder' && !node.resource.trashed,
        folder: node.folder ?? null,
        defaultSortMode: node.defaultSortMode ?? null,
      });
      const items = nodes
        .filter(node =>
          query.trash && !parent
            ? node.resource.trashed && node.trashRootNodeId === node.nodeId
            : !node.resource.trashed &&
              node.parentNodeId === (parent?.nodeId ?? null)
        )
        .sort((a, b) =>
          a.order < b.order
            ? -1
            : a.order > b.order
              ? 1
              : a.nodeId.localeCompare(b.nodeId)
        );
      return {
        enabled: true,
        contractVersion: stateKey,
        canCreateFolder: true,
        canCreatePage: true,
        revision,
        authorizationRevision: localAuthority,
        snapshotRevision: null,
        parent: parent ? describe(parent) : null,
        ancestors: parent
          ? pageTreeAncestors(byId, parent.nodeId).map(describe)
          : [],
        items: items.slice(offset, offset + 100).map(describe),
        nextCursor:
          offset + 100 < items.length ? `${scope}:${offset + 100}` : null,
      };
    });
  }
  async conversionPreview(nodeId: string) {
    const tree = await this.list({ parentNodeId: nodeId });
    if (
      tree.parent?.kind !== 'folder' ||
      !tree.parent.folder ||
      tree.parent.trashed
    )
      throw new Error('Container conversion unavailable');
    return {
      nodeId,
      title: tree.parent.title,
      targetKind: 'doc',
      revision: tree.revision,
      authorizationRevision: tree.authorizationRevision,
      resourceVersion: tree.parent.folder.metadataVersion,
    };
  }
  async lifecyclePreview(
    nodeId: string,
    action: 'trash' | 'restore' | 'delete'
  ) {
    return this.ports.exclusive(async () => {
      await this.recover();
      const nodes = this.graph(),
        source = nodes.find(node => node.nodeId === nodeId);
      if (!source) throw new Error('Resource unavailable');
      const subtree = pageTreeSubtree(nodes, nodeId);
      const affected =
        action === 'trash'
          ? subtree.filter(node => !node.resource.trashed)
          : action === 'restore'
            ? subtree.filter(node => node.trashRootNodeId === nodeId)
            : subtree;
      if (
        !affected.length ||
        (action === 'trash'
          ? source.resource.trashed
          : !source.resource.trashed)
      )
        throw new Error('Resource lifecycle changed');
      if (
        action === 'delete' &&
        affected.some(
          node => !node.resource.trashed || node.trashRootNodeId !== nodeId
        )
      )
        throw new Error('Resolve descendant recovery dependencies first');
      return {
        revision: Number(this.state.get('revision')),
        authorizationRevision: localAuthority,
        parentNodeId: source.parentNodeId,
        total: affected.length,
        truncated: affected.length > 20,
        items: affected.slice(0, 20).map(node => ({
          nodeId: node.nodeId,
          title:
            node.folder?.title ??
            String(
              this.pages()
                .toArray()
                .find(page => page.get('id') === node.resource.resourceId)
                ?.get('title') ?? ''
            ),
          documentType:
            node.resource.kind === 'folder'
              ? 'folder'
              : node.resource.primaryMode === 'edgeless'
                ? 'edgeless'
                : 'page',
        })),
      };
    });
  }
  async execute(input: WorkspacePageTreeCommandInput): Promise<LocalReceipt> {
    return this.ports.exclusive(async () => {
      await this.recover();
      const key = input.requestKey,
        fingerprint = JSON.stringify(input);
      const replay = this.ports.journal.getMap('receipts').get(key) as
        | { fingerprint: string; receipt: LocalReceipt }
        | undefined;
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw new Error('Request key changed');
        return {
          ...replay.receipt,
          oldTargetSiblingOrder: replay.receipt.oldTargetSiblingOrder ?? null,
          oldSourceSiblingOrder: replay.receipt.oldSourceSiblingOrder ?? null,
        };
      }
      if (
        input.contractVersion !== stateKey ||
        input.expectedRevision !== this.state.get('revision') ||
        input.expectedAuthorizationRevision !== localAuthority
      )
        throw new Error('Page tree changed; reload');
      let nodes = this.graph();
      let nodeId = input.nodeId ?? '',
        oldParentNodeId: string | null = null,
        oldBeforeNodeId: string | null = null;
      let oldSiblingOrder: string[] | null = null;
      let oldTargetSiblingOrder: string[] | null = null;
      let oldSourceSiblingOrder: string[] | null = null;
      const create: Creation[] = [],
        retired: string[] = [];
      const target = input.parentNodeId ?? null;
      if (
        ['create-folder', 'create', 'move'].includes(input.action) ||
        (input.action === 'restore' && input.parentNodeId !== undefined)
      ) {
        const parent = target
          ? nodes.find(node => node.nodeId === target)
          : null;
        if (
          target &&
          (!parent ||
            !isPageTreeContainer(parent.resource) ||
            parent.resource.trashed)
        )
          throw new Error('Target must be an active page');
      }
      const nextOrder = () => {
        const siblings = nodes
          .filter(
            node => node.parentNodeId === target && node.nodeId !== nodeId
          )
          .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
        const index = input.beforeNodeId
          ? siblings.findIndex(node => node.nodeId === input.beforeNodeId)
          : siblings.length;
        if (index < 0) throw new Error('Reorder target unavailable');
        return generateFractionalIndexingKeyBetween(
          siblings[index - 1]?.order ?? null,
          siblings[index]?.order ?? null
        );
      };
      let conversion: Pending['conversion'];
      if (input.action === 'create-folder') {
        const title = input.title?.trim();
        if (!title || title.length > 512)
          throw new Error('Invalid folder title');
        const resource: PageTreeResource = {
          kind: 'folder',
          resourceId: nanoid(),
          trashed: false,
        };
        nodeId = pageTreeNodeId(resource);
        nodes.push({
          nodeId,
          resource,
          parentNodeId: target,
          order: nextOrder(),
          folder: {
            title,
            metadataVersion: 1,
            createdAt: null,
            createdBy: null,
            updatedAt: null,
            updatedBy: null,
          },
        });
      } else if (input.action === 'create') {
        const id = input.resourceId ?? nanoid();
        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
          id === this.ports.workspaceId ||
          [...this.ports.folders.share.keys()].some(
            key => this.ports.folders.getMap(key).get('data') === id
          )
        )
          throw new Error('Document identity already exists or is invalid');
        if (
          !input.title?.trim() ||
          input.title.length > 512 ||
          !['page', 'edgeless'].includes(input.primaryMode ?? '')
        )
          throw new Error('Invalid page');
        const primaryMode =
          input.primaryMode === 'edgeless' ? 'edgeless' : 'page';
        nodeId = pageTreeNodeId({ kind: 'doc', resourceId: id });
        create.push({ id, title: input.title, primaryMode, at: Date.now() });
        nodes.push({
          nodeId,
          resource: {
            kind: 'doc',
            resourceId: id,
            primaryMode,
            trashed: false,
          },
          parentNodeId: target,
          order: nextOrder(),
        });
      } else {
        const source = nodes.find(node => node.nodeId === nodeId);
        if (!source) throw new Error('Resource unavailable');
        if (
          input.expectedParentNodeId !== undefined &&
          input.expectedParentNodeId !== source.parentNodeId
        )
          throw new Error('Resource moved; review deletion again');
        oldParentNodeId = source.parentNodeId;
        const siblings = nodes
          .filter(
            node =>
              node.parentNodeId === source.parentNodeId &&
              (input.action !== 'move' || !node.resource.trashed)
          )
          .sort((a, b) =>
            a.order < b.order
              ? -1
              : a.order > b.order
                ? 1
                : a.nodeId.localeCompare(b.nodeId)
          );
        oldBeforeNodeId =
          siblings[siblings.findIndex(node => node.nodeId === nodeId) + 1]
            ?.nodeId ?? null;
        if (
          input.action === 'rename-folder' ||
          input.action === 'convert-folder'
        ) {
          if (
            source.resource.kind !== 'folder' ||
            !source.folder ||
            source.resource.trashed ||
            source.folder.metadataVersion !== input.expectedResourceVersion
          )
            throw new Error('Folder changed; reload');
          if (input.action === 'rename-folder') {
            const title = input.title?.trim();
            if (!title || title.length > 512)
              throw new Error('Invalid folder title');
            if (title !== source.folder.title)
              source.folder = {
                ...source.folder,
                title,
                metadataVersion: source.folder.metadataVersion + 1,
                updatedAt: null,
                updatedBy: null,
              };
          } else {
            const id = nanoid();
            create.push({
              id,
              title: source.folder.title,
              primaryMode: 'page',
              at: Date.now(),
            });
            conversion = {
              sourceKind: 'folder',
              sourceId: source.resource.resourceId,
              nodeId,
            };
            source.resource = {
              kind: 'doc',
              resourceId: id,
              primaryMode: 'page',
              trashed: false,
            };
            delete source.folder;
          }
        } else if (input.action === 'move') {
          const crossParent = source.parentNodeId !== target;
          if (
            (input.siblingOrder && crossParent) ||
            (!crossParent &&
              (input.targetSiblingOrder || input.sourceSiblingOrder)) ||
            (input.siblingOrder &&
              (input.targetSiblingOrder || input.sourceSiblingOrder))
          )
            throw new Error('Order must match the affected sibling level');
          if (input.siblingOrder) {
            if (source.parentNodeId !== target || source.resource.trashed)
              throw new Error('Manual order requires the active sibling level');
            oldSiblingOrder = pageTreeSiblingOrder(
              nodes,
              target,
              input.siblingOrder
            );
            nodes = reorderPageTreeLevel(
              nodes,
              target,
              input.siblingOrder,
              previous => generateFractionalIndexingKeyBetween(previous, null)
            );
          } else {
            const original = nodes;
            nodes = movePageTreeNode(
              nodes,
              nodeId,
              target,
              input.targetSiblingOrder
                ? generateFractionalIndexingKeyBetween(null, null)
                : nextOrder()
            );
            if (input.targetSiblingOrder) {
              oldTargetSiblingOrder = pageTreeSiblingOrder(original, target);
              nodes = reorderPageTreeLevel(
                nodes,
                target,
                input.targetSiblingOrder,
                previous => generateFractionalIndexingKeyBetween(previous, null)
              );
            }
            if (input.sourceSiblingOrder) {
              oldSourceSiblingOrder = pageTreeSiblingOrder(
                original,
                source.parentNodeId
              );
              nodes = reorderPageTreeLevel(
                nodes,
                source.parentNodeId,
                input.sourceSiblingOrder,
                previous => generateFractionalIndexingKeyBetween(previous, null)
              );
            }
          }
        } else {
          const subtree = pageTreeSubtree(nodes, nodeId);
          if (input.action === 'trash') {
            if (source.resource.trashed)
              throw new Error('Resource already trashed');
            for (const node of subtree)
              if (!node.resource.trashed) {
                node.resource = { ...node.resource, trashed: true };
                node.trashRootNodeId = nodeId;
              }
          } else if (input.action === 'restore') {
            if (!source.resource.trashed || source.trashRootNodeId !== nodeId)
              throw new Error('Restore the parent first');
            if (input.parentNodeId !== undefined) source.parentNodeId = target;
            for (const node of subtree)
              if (node.trashRootNodeId === nodeId) {
                node.resource = { ...node.resource, trashed: false };
                delete node.trashRootNodeId;
              }
          } else if (input.action === 'delete') {
            if (
              subtree.some(
                node =>
                  !node.resource.trashed || node.trashRootNodeId !== nodeId
              )
            )
              throw new Error('Resolve dependent trash before deletion');
            retired.push(...subtree.map(node => node.nodeId));
            nodes = nodes.filter(node => !retired.includes(node.nodeId));
          } else throw new Error('Unsupported page tree command');
        }
      }
      validatePageTree(nodes);
      const node =
        nodes.find(node => node.nodeId === nodeId) ??
        this.graph().find(node => node.nodeId === nodeId);
      if (!node) throw new Error('Resource unavailable');
      const revision = input.expectedRevision + 1;
      const receipt = {
        operationId: key,
        nodeId,
        resourceId: node.resource.resourceId,
        parentNodeId: node.parentNodeId,
        revision,
        oldParentNodeId,
        oldBeforeNodeId,
        oldSiblingOrder,
        oldTargetSiblingOrder,
        oldSourceSiblingOrder,
      };
      const pending: Pending = {
        key,
        fingerprint,
        nodes,
        create,
        retired,
        deletedResources: this.graph()
          .filter(
            node =>
              node.resource.kind === 'doc' && retired.includes(node.nodeId)
          )
          .map(node => node.resource.resourceId),
        revision,
        receipt,
        conversion,
      };
      if (input.insertAfterBlockId) {
        const parent = nodes.find(node => node.nodeId === target);
        if (
          !['create', 'move'].includes(input.action) ||
          !parent ||
          parent.resource.kind !== 'doc' ||
          parent.resource.primaryMode !== 'page' ||
          node.resource.primaryMode !== 'page'
        )
          throw new Error('A subpage entry requires a parent');
        if (!this.ports.validateInsert)
          throw new Error('Subpage adapter unavailable');
        await this.ports.validateInsert(
          parent.resource.resourceId,
          input.insertAfterBlockId
        );
        pending.insert = {
          parentId: parent.resource.resourceId,
          after: input.insertAfterBlockId,
          resourceId: node.resource.resourceId,
          blockId: nanoid(),
        };
      }
      this.state.set('pending', pending);
      await this.ports.persist();
      await this.apply(pending);
      return receipt;
    });
  }
}
