/** Shared ownership contract. Content references never participate in this graph. */
export const WORKSPACE_PAGE_TREE_V1_CONTRACT =
  'localmind-page-tree/v1' as const;
export const WORKSPACE_PAGE_TREE_CONTRACT = 'localmind-page-tree/v2' as const;
export const WORKSPACE_PAGE_TREE_MAX_DEPTH = 64;
export type PageTreeResourceKind = 'doc' | 'office' | 'file' | 'folder';
export type PageTreeResource = {
  kind: PageTreeResourceKind;
  resourceId: string;
  primaryMode?: 'page' | 'edgeless';
  trashed: boolean;
};
export type PageTreeFolderMetadata = {
  title: string;
  metadataVersion: number;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};
export function isPageTreeFolderMetadata(
  value: unknown
): value is PageTreeFolderMetadata {
  if (!value || typeof value !== 'object') return false;
  const v = value as PageTreeFolderMetadata;
  const event = (at: unknown, by: unknown) =>
    (at === null && by === null) ||
    (typeof at === 'string' &&
      Number.isFinite(Date.parse(at)) &&
      typeof by === 'string' &&
      by.length > 0);
  return (
    typeof v.title === 'string' &&
    v.title.trim().length > 0 &&
    v.title.length <= 512 &&
    Number.isSafeInteger(v.metadataVersion) &&
    v.metadataVersion >= 1 &&
    event(v.createdAt, v.createdBy) &&
    event(v.updatedAt, v.updatedBy)
  );
}
export type PageTreeNode = {
  nodeId: string;
  resource: PageTreeResource;
  folder?: PageTreeFolderMetadata;
  parentNodeId: string | null;
  order: string;
  defaultSortMode?: 'name-desc';
  trashRootNodeId?: string;
};
export type PageTreeErrorCode =
  | 'invalid_node'
  | 'duplicate_resource'
  | 'missing_resource'
  | 'invalid_parent'
  | 'parent_trashed'
  | 'cycle'
  | 'depth_exceeded'
  | 'version_conflict'
  | 'protocol_retired'
  | 'migration_conflict';
export class PageTreeError extends Error {
  constructor(readonly code: PageTreeErrorCode) {
    super(code);
    this.name = 'PageTreeError';
  }
}
export function pageTreeResourceKey(
  resource: Pick<PageTreeResource, 'kind' | 'resourceId'>
) {
  return JSON.stringify([resource.kind, resource.resourceId]);
}
export function pageTreeNodeId(
  resource: Pick<PageTreeResource, 'kind' | 'resourceId'>
) {
  return `tree:${resource.kind}:${resource.resourceId}`;
}
export function isPageTreeContainer(resource: PageTreeResource) {
  return (
    resource.kind === 'folder' ||
    (resource.kind === 'doc' && resource.primaryMode === 'page')
  );
}
export const comparePageTreeKeys = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;

/** Validate the complete graph, including recycled resources and their dependencies.
 * Callers must supply the authoritative inventory, never an ACL-filtered listing. */
export function validatePageTree(
  nodes: readonly PageTreeNode[],
  inventory?: readonly PageTreeResource[]
) {
  const byId = new Map<string, PageTreeNode>();
  const identities = new Map<string, PageTreeNode>();
  const resources =
    inventory &&
    new Map(
      inventory.map(resource => [pageTreeResourceKey(resource), resource])
    );
  if (resources && resources.size !== inventory?.length)
    throw new PageTreeError('duplicate_resource');
  for (const node of nodes) {
    if (
      !node.nodeId ||
      !node.order ||
      !node.resource.resourceId ||
      !['doc', 'office', 'file', 'folder'].includes(node.resource.kind) ||
      typeof node.resource.trashed !== 'boolean' ||
      (node.resource.kind === 'folder'
        ? !isPageTreeFolderMetadata(node.folder)
        : node.folder !== undefined) ||
      (node.resource.kind !== 'doc' &&
        node.resource.primaryMode !== undefined) ||
      (node.resource.kind === 'doc' &&
        !['page', 'edgeless'].includes(node.resource.primaryMode ?? '')) ||
      (node.parentNodeId !== null && typeof node.parentNodeId !== 'string') ||
      byId.has(node.nodeId)
    ) {
      throw new PageTreeError('invalid_node');
    }
    const identity = pageTreeResourceKey(node.resource);
    if (identities.has(identity)) throw new PageTreeError('duplicate_resource');
    if (resources) {
      const actual = resources.get(identity);
      if (!actual) throw new PageTreeError('missing_resource');
      if (
        actual.trashed !== node.resource.trashed ||
        actual.primaryMode !== node.resource.primaryMode
      )
        throw new PageTreeError('invalid_node');
    }
    byId.set(node.nodeId, node);
    identities.set(identity, node);
  }
  if (resources && resources.size !== identities.size)
    throw new PageTreeError('missing_resource');
  // Memoized path depth makes a wide/deep tree linear rather than quadratic.
  const depths = new Map<string, number>();
  for (const node of nodes) {
    const path: PageTreeNode[] = [];
    const visiting = new Set<string>();
    let current: PageTreeNode | undefined = node;
    while (current && !depths.has(current.nodeId)) {
      if (visiting.has(current.nodeId)) throw new PageTreeError('cycle');
      visiting.add(current.nodeId);
      path.push(current);
      if (path.length > WORKSPACE_PAGE_TREE_MAX_DEPTH)
        throw new PageTreeError('depth_exceeded');
      if (current.parentNodeId === null) {
        current = undefined;
        break;
      }
      const parent = byId.get(current.parentNodeId);
      if (!parent || !isPageTreeContainer(parent.resource))
        throw new PageTreeError('invalid_parent');
      if (!current.resource.trashed && parent.resource.trashed)
        throw new PageTreeError('parent_trashed');
      current = parent;
    }
    let depth = current ? (depths.get(current.nodeId) ?? 0) : 0;
    for (const entry of path.reverse()) {
      if (++depth > WORKSPACE_PAGE_TREE_MAX_DEPTH)
        throw new PageTreeError('depth_exceeded');
      depths.set(entry.nodeId, depth);
    }
  }
  return byId;
}

export function pageTreeAncestors(
  nodes: ReadonlyMap<string, PageTreeNode>,
  nodeId: string
) {
  const ancestors: PageTreeNode[] = [];
  const visited = new Set<string>([nodeId]);
  let current = nodes.get(nodeId);
  if (!current) throw new PageTreeError('invalid_node');
  while (current.parentNodeId !== null) {
    if (visited.has(current.parentNodeId)) throw new PageTreeError('cycle');
    visited.add(current.parentNodeId);
    current = nodes.get(current.parentNodeId);
    if (!current) throw new PageTreeError('invalid_parent');
    ancestors.push(current);
    if (ancestors.length >= WORKSPACE_PAGE_TREE_MAX_DEPTH)
      throw new PageTreeError('depth_exceeded');
  }
  return ancestors.reverse();
}

export function movePageTreeNode(
  nodes: readonly PageTreeNode[],
  nodeId: string,
  parentNodeId: string | null,
  order: string
) {
  const source = nodes.find(node => node.nodeId === nodeId);
  if (!source || source.resource.trashed)
    throw new PageTreeError('invalid_node');
  const next = nodes.map(node =>
    node.nodeId === nodeId ? { ...node, parentNodeId, order } : node
  );
  validatePageTree(next);
  return next;
}

export function pageTreeSubtree(
  nodes: readonly PageTreeNode[],
  nodeId: string
) {
  const byId = validatePageTree(nodes);
  const root = byId.get(nodeId);
  if (!root) throw new PageTreeError('invalid_node');
  const children = new Map<string, PageTreeNode[]>();
  for (const node of nodes)
    if (node.parentNodeId !== null) {
      const siblings = children.get(node.parentNodeId) ?? [];
      siblings.push(node);
      children.set(node.parentNodeId, siblings);
    }
  const result = [root];
  for (const node of result) result.push(...(children.get(node.nodeId) ?? []));
  return result;
}

/** A name-sorted view becomes a complete, versioned manual level in one write. */
export function pageTreeSiblingOrder(
  nodes: readonly PageTreeNode[],
  parentNodeId: string | null,
  next?: readonly string[]
) {
  const siblings = nodes
    .filter(
      node => node.parentNodeId === parentNodeId && !node.resource.trashed
    )
    .sort((a, b) =>
      a.order < b.order
        ? -1
        : a.order > b.order
          ? 1
          : a.nodeId.localeCompare(b.nodeId)
    );
  if (
    next &&
    (next.length !== siblings.length ||
      new Set(next).size !== next.length ||
      siblings.some(node => !next.includes(node.nodeId)))
  )
    throw new PageTreeError('version_conflict');
  return siblings.map(node => node.nodeId);
}
