import { createHash } from 'node:crypto';

import {
  comparePageTreeKeys,
  type PageTreeFolderMetadata,
  type PageTreeNode,
  pageTreeNodeId,
  type PageTreeResource,
  pageTreeResourceKey,
  validatePageTree,
  WORKSPACE_PAGE_TREE_CONTRACT,
} from '@affine/graphql';
import { generateKeyBetween } from 'fractional-indexing';

import {
  directoryPolicySnapshot,
  type DirectoryRights,
} from '../../models/workspace-directory-grant';
import { folderTrashFingerprint } from './folder-trash-manifest';

export type LegacyTreeRow = {
  id: string;
  parentId?: string | null;
  type: string;
  data: string;
  index: string;
  defaultSortMode?: 'name-desc';
  $$DELETED?: boolean;
  $pageTreeContract?: string;
  $pageTreeRetired?: boolean;
  $pageTreeFolder?: PageTreeFolderMetadata;
  $localmindTrashOperationId?: string;
  $localmindTrashRoot?: boolean;
  $localmindTrashDocumentIds?: string[];
  $localmindTrashNewDocumentIds?: string[];
  $localmindTrashPreviousDocumentIds?: string[];
  $localmindTrashFingerprint?: string;
};
export type PageTreeMapping = {
  oldFolderId: string;
  nodeId: string;
  documentId: string;
  title: string;
  trashed: boolean;
};
export type PageTreePlan = {
  contract: typeof WORKSPACE_PAGE_TREE_CONTRACT;
  sourceContract: string | null;
  typedMappings: {
    sourceKind: string;
    sourceId: string;
    nodeId: string;
    targetKind: string;
    targetId: string;
  }[];
  workspaceId: string;
  sourceRevision: string;
  fingerprint: string;
  localUploadFingerprint?: string;
  nodes: PageTreeNode[];
  mappings: PageTreeMapping[];
  retiredPlacementIds: string[];
  recycleEvidence: { identity: string; claims: string[] }[];
  conflicts: { code: string; identity: string }[];
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Pure, deterministic preflight. It never writes or decides from a user's filtered view. */
export function planWorkspacePageTree(input: {
  workspaceId: string;
  sourceRevision: string;
  rows: LegacyTreeRow[];
  resources: PageTreeResource[];
  policies: (DirectoryRights & { directoryId: string; principalId: string })[];
  recycleClaims?: { identity: string; claims: string[] }[];
}): PageTreePlan {
  const conflicts: PageTreePlan['conflicts'] = [];
  const rows = [...input.rows].sort((a, b) => comparePageTreeKeys(a.id, b.id));
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length)
    conflicts.push({ code: 'duplicate_legacy_id', identity: '' });
  const resources = new Map(
    input.resources.map(resource => [pageTreeResourceKey(resource), resource])
  );
  if (resources.size !== input.resources.length)
    conflicts.push({ code: 'duplicate_resource', identity: '' });
  const mappings = rows
    .filter(row => row.type === 'folder')
    .map(row => {
      const documentId = row.id;
      // Preserve container node IDs so policies and private sort keys remain scoped
      // to the same identity. The new content document has a distinct stable ID.
      return {
        oldFolderId: row.id,
        nodeId: row.id,
        documentId,
        title: row.data,
        trashed: row.$$DELETED === true,
      };
    });
  const mappingById = new Map(
    mappings.map(mapping => [mapping.oldFolderId, mapping])
  );
  function path(row: LegacyTreeRow) {
    const result: LegacyTreeRow[] = [row];
    const visited = new Set([row.id]);
    let current = row;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (
        !parent ||
        parent.type !== 'folder' ||
        visited.has(parent.id) ||
        result.length >= 64
      ) {
        conflicts.push({ code: 'invalid_legacy_path', identity: row.id });
        break;
      }
      visited.add(parent.id);
      result.unshift(parent);
      current = parent;
    }
    return result;
  }
  const paths = new Map(rows.map(row => [row.id, path(row)]));
  const principals = [
    ...new Set(input.policies.map(policy => policy.principalId)),
  ].sort(comparePageTreeKeys);
  // Include the all-members/default case even if only per-user overrides exist.
  principals.push('$page-tree-default-principal');
  const policySnapshots = principals.map(principal =>
    directoryPolicySnapshot(principal, input.policies)
  );
  const rightsFor = (row: LegacyTreeRow) =>
    JSON.stringify(
      policySnapshots.map(snapshot =>
        snapshot.rights(
          (paths.get(row.id) ?? [])
            .filter(item => item.type === 'folder')
            .map(item => item.id)
        )
      )
    );
  const comparePaths = (a: LegacyTreeRow, b: LegacyTreeRow) => {
    const left = paths.get(a.id) ?? [],
      right = paths.get(b.id) ?? [];
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const result =
        comparePageTreeKeys(left[i].index, right[i].index) ||
        comparePageTreeKeys(left[i].id, right[i].id);
      if (result) return result;
    }
    return left.length - right.length || comparePageTreeKeys(a.id, b.id);
  };
  const placements = new Map<string, LegacyTreeRow[]>();
  const retired = new Set<string>();
  for (const row of rows) {
    if (row.type === 'folder') continue;
    // Ordinary removed placements are tombstones, not recycled resources.
    if (row.$$DELETED && !row.$localmindTrashOperationId) {
      retired.add(row.id);
      continue;
    }
    let kind = row.type;
    if (
      kind === 'doc' &&
      resources.has(
        pageTreeResourceKey({ kind: 'office', resourceId: row.data })
      )
    )
      kind = 'office';
    if (kind !== 'doc' && kind !== 'office' && kind !== 'file') {
      retired.add(row.id);
      continue;
    }
    const identity = pageTreeResourceKey({ kind, resourceId: row.data });
    if (!resources.has(identity)) {
      retired.add(row.id);
      continue;
    }
    const group = placements.get(identity) ?? [];
    group.push(row);
    placements.set(identity, group);
  }
  const nodes: PageTreeNode[] = [];
  const trashRoots = new Map<string, string>();
  for (const root of rows.filter(
    row => row.$localmindTrashRoot && row.$$DELETED
  )) {
    const operationId = root.$localmindTrashOperationId;
    if (!operationId || trashRoots.has(operationId)) {
      conflicts.push({ code: 'invalid_recycle_operation', identity: root.id });
      continue;
    }
    trashRoots.set(operationId, root.id);
    const fingerprint = folderTrashFingerprint({
      rootFolderId: root.id,
      nodes: rows.filter(
        row => row.$$DELETED && row.$localmindTrashOperationId === operationId
      ),
      documentIds: root.$localmindTrashDocumentIds ?? [],
      newlyTrashedDocumentIds: root.$localmindTrashNewDocumentIds ?? [],
      previouslyTrashedDocumentIds:
        root.$localmindTrashPreviousDocumentIds ?? [],
    });
    if (fingerprint !== root.$localmindTrashFingerprint)
      conflicts.push({ code: 'invalid_recycle_manifest', identity: root.id });
  }
  for (const mapping of mappings) {
    const row = byId.get(mapping.oldFolderId);
    if (!row) throw new Error('Invalid folder mapping');
    if (
      resources.has(
        pageTreeResourceKey({ kind: 'folder', resourceId: mapping.oldFolderId })
      )
    )
      conflicts.push({
        code: 'mapping_identity_collision',
        identity: mapping.oldFolderId,
      });
    nodes.push({
      nodeId: mapping.nodeId,
      resource: {
        kind: 'folder',
        resourceId: mapping.oldFolderId,
        trashed: mapping.trashed,
      },
      folder: {
        title: mapping.title.trim() || 'Untitled folder',
        metadataVersion: 1,
        createdAt: null,
        createdBy: null,
        updatedAt: null,
        updatedBy: null,
      },
      parentNodeId: row.parentId ?? null,
      order: row.index,
      ...(mapping.trashed
        ? {
            trashRootNodeId:
              trashRoots.get(row.$localmindTrashOperationId ?? '') ?? row.id,
          }
        : {}),
      ...(row.defaultSortMode ? { defaultSortMode: row.defaultSortMode } : {}),
    });
  }
  let rootOrder =
    rows
      .filter(row => !row.parentId)
      .map(row => row.index)
      .sort(comparePageTreeKeys)
      .at(-1) ?? null;
  for (const [identity, resource] of [...resources].sort(([a], [b]) =>
    comparePageTreeKeys(a, b)
  )) {
    const group = [...(placements.get(identity) ?? [])].sort(comparePaths);
    const location = group[0];
    if (group.some(row => rightsFor(row) !== rightsFor(location)))
      conflicts.push({ code: 'non_equivalent_permissions', identity });
    if (
      group.some(
        row =>
          row.$localmindTrashOperationId !== location.$localmindTrashOperationId
      )
    )
      conflicts.push({ code: 'overlapping_recycle_claims', identity });
    if (location?.parentId && !mappingById.has(location.parentId))
      conflicts.push({ code: 'missing_parent_mapping', identity });
    if (location?.$$DELETED && !resource.trashed)
      conflicts.push({ code: 'recycle_state_mismatch', identity });
    let order = location?.index;
    if (!order) {
      try {
        rootOrder = generateKeyBetween(rootOrder, null);
        order = rootOrder;
      } catch {
        conflicts.push({ code: 'invalid_order', identity });
        order = 'a0';
      }
    }
    nodes.push({
      nodeId: pageTreeNodeId(resource),
      resource,
      parentNodeId: location?.parentId ?? null,
      order,
      ...(resource.trashed
        ? { trashRootNodeId: pageTreeNodeId(resource) }
        : {}),
    });
    for (const row of group) retired.add(row.id);
  }
  const recycleEvidence = input.recycleClaims ?? [];
  const byResource = new Map(
    nodes.map(node => [pageTreeResourceKey(node.resource), node])
  );
  for (const { identity, claims } of recycleEvidence) {
    const node = byResource.get(identity);
    if (!node?.resource.trashed) {
      if (claims.length)
        conflicts.push({ code: 'recycle_state_mismatch', identity });
      continue;
    }
    // A prior direct deletion stays independent of a later parent deletion.
    // Independent old folder claims cannot be collapsed into one restore group.
    const folderClaims = claims.filter(claim => claim.startsWith('folder:'));
    if (folderClaims.some(claim => !trashRoots.has(claim.slice(7))))
      conflicts.push({ code: 'missing_recycle_manifest', identity });
    if (folderClaims.length > 1)
      conflicts.push({ code: 'overlapping_recycle_claims', identity });
    if (!claims.includes('direct') && folderClaims.length === 1)
      node.trashRootNodeId = trashRoots.get(folderClaims[0].slice(7));
    if (node.trashRootNodeId && node.trashRootNodeId !== node.nodeId) {
      let parent = node.parentNodeId;
      const seen = new Set<string>();
      while (parent && parent !== node.trashRootNodeId && !seen.has(parent)) {
        seen.add(parent);
        parent =
          nodes.find(entry => entry.nodeId === parent)?.parentNodeId ?? null;
      }
      if (parent !== node.trashRootNodeId)
        conflicts.push({ code: 'recycle_owner_outside_path', identity });
    }
  }
  try {
    validatePageTree(nodes, [
      ...input.resources,
      ...nodes
        .filter(node => mappingById.has(node.nodeId))
        .map(node => node.resource),
    ]);
  } catch (error) {
    conflicts.push({
      code: error instanceof Error ? error.message : 'invalid_graph',
      identity: '',
    });
  }
  const body = {
    contract: WORKSPACE_PAGE_TREE_CONTRACT,
    workspaceId: input.workspaceId,
    sourceRevision: input.sourceRevision,
    nodes,
    sourceContract: null,
    mappings: [],
    typedMappings: mappings.map(mapping => ({
      sourceKind: 'folder',
      sourceId: mapping.oldFolderId,
      nodeId: mapping.nodeId,
      targetKind: 'folder',
      targetId: mapping.oldFolderId,
    })),
    retiredPlacementIds: [...retired].sort(comparePageTreeKeys),
    recycleEvidence,
    conflicts,
  };
  return { ...body, fingerprint: hash(body) };
}
