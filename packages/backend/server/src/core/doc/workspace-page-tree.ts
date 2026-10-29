import { createHash, randomUUID } from 'node:crypto';

import {
  isPageTreeContainer,
  isPageTreeFolderMetadata,
  movePageTreeNode,
  pageTreeAncestors,
  type PageTreeFolderMetadata,
  type PageTreeNode,
  pageTreeNodeId,
  type PageTreeResource,
  pageTreeResourceKey,
  pageTreeSiblingOrder,
  pageTreeSubtree,
  reorderPageTreeLevel,
  validatePageTree,
  WORKSPACE_PAGE_TREE_CONTRACT,
  WORKSPACE_PAGE_TREE_V1_CONTRACT,
  type WorkspaceDocumentType,
  workspaceDocumentType,
} from '@affine/graphql';
import { Injectable } from '@nestjs/common';
import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';

import { BadRequest, NotFound, ResourceConflict } from '../../base';
import { Models } from '../../models';
import { hasLegacyPageTreeToolContract } from '../../models/common/copilot-tool-contract';
import { directoryPolicySnapshot } from '../../models/workspace-directory-grant';
import { PermissionAccess } from '../permission';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';
import {
  pageTreeNativeCreatedContext,
  pageTreeWriteContext,
} from './page-tree-context';
import {
  type LegacyTreeRow,
  type PageTreePlan,
  planWorkspacePageTree,
} from './page-tree-plan';
import { migrateLegacyRootPages } from './root-doc-registration';
import { snapshotParser } from './snapshot-parser';
import { WorkspaceOrganizationService } from './workspace-organization';
import { DocWriter } from './writer';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Actor = { workspaceId: string; actorId: string };
export type FolderConversionBlocker =
  | 'not_folder'
  | 'trashed'
  | 'missing_rights'
  | 'public_workspace'
  | 'default_role_not_manager';
export type PageTreeCommand = {
  contractVersion: typeof WORKSPACE_PAGE_TREE_CONTRACT;
  expectedRevision: number;
  expectedAuthorizationRevision: string;
  requestKey: string;
} & (
  | { action: 'create-folder'; title: string; parentNodeId: string | null }
  | {
      action: 'rename-folder' | 'convert-folder';
      nodeId: string;
      expectedResourceVersion: number;
      title?: string;
    }
  | {
      action: 'create';
      title: string;
      parentNodeId: string | null;
      primaryMode: 'page' | 'edgeless';
      resourceId?: string;
      contentFingerprint?: string;
      insertAfterBlockId?: string;
    }
  | {
      action: 'move';
      nodeId: string;
      parentNodeId: string | null;
      beforeNodeId?: string;
      siblingOrder?: string[];
      targetSiblingOrder?: string[];
      sourceSiblingOrder?: string[];
      insertAfterBlockId?: string;
    }
  | {
      action: 'create-native';
      title: string;
      parentNodeId: string | null;
      nativeFingerprint: string;
    }
  | {
      action: 'trash' | 'delete';
      nodeId: string;
      expectedParentNodeId?: string | null;
    }
  | { action: 'restore'; nodeId: string; parentNodeId?: string | null }
);

@Injectable()
export class WorkspacePageTreeService {
  constructor(
    private readonly storage: PgWorkspaceDocStorageAdapter,
    private readonly organization: WorkspaceOrganizationService,
    private readonly writer: DocWriter,
    private readonly models: Models,
    private readonly ac: PermissionAccess
  ) {}

  /** A newly uploaded local Workspace has content but no online directory.
   * The server derives resource types/lifecycle itself and validates the complete
   * proposed graph before freezing and switching it through the normal runner. */
  async adoptLocalTree(
    input: Actor,
    positions: {
      kind: 'doc' | 'folder';
      trashed: boolean;
      folder?: PageTreeFolderMetadata;
      nodeId: string;
      resourceId: string;
      parentNodeId: string | null;
      order: string;
      defaultSortMode?: 'name-desc';
      trashRootNodeId?: string;
    }[]
  ) {
    const uploadFingerprint = digest(positions);
    const fingerprint = await this.models.workspacePageTree.lock(
      input.workspaceId,
      async () => {
        await this.models.workspaceDirectoryGrant.assertAdministrator(
          input.workspaceId,
          input.actorId
        );
        const state = await this.models.workspacePageTree.state(
          input.workspaceId
        );
        if (state?.planId) {
          const saved = await this.models.workspacePageTree.plan(
            state.planId,
            input.workspaceId
          );
          const existing = saved?.plan as PageTreePlan | undefined;
          if (existing?.localUploadFingerprint === uploadFingerprint)
            return existing.fingerprint;
          throw new ResourceConflict('Workspace already has a page tree plan');
        }
        const source = await this.source(input.workspaceId);
        await this.models.workspacePageTree.lockDocuments(
          input.workspaceId,
          source.resources.map(resource => resource.resourceId)
        );
        if (
          source.rows.length ||
          source.resources.some(resource => resource.kind !== 'doc')
        )
          throw new BadRequest(
            'Local upload requires a Workspace without existing directory or native resources'
          );
        if (
          (
            await this.models.workspacePageTree.activeToolRuns(
              input.workspaceId
            )
          ).some(hasLegacyPageTreeToolContract)
        )
          throw new BadRequest(
            'Legacy resource tasks must finish before upload'
          );
        const nodes: PageTreeNode[] = positions.map(position => {
          const resource: PageTreeResource | undefined =
            position.kind === 'folder'
              ? {
                  kind: 'folder',
                  resourceId: position.resourceId,
                  trashed: position.trashed,
                }
              : source.resources.find(
                  resource =>
                    resource.kind === 'doc' &&
                    resource.resourceId === position.resourceId
                );
          if (
            position.kind === 'folder' &&
            !isPageTreeFolderMetadata(position.folder)
          )
            throw new BadRequest('Invalid uploaded folder metadata');
          if (resource?.trashed !== position.trashed)
            throw new BadRequest('Local lifecycle changed');
          if (
            !resource ||
            !position.nodeId ||
            position.nodeId.length > 512 ||
            !position.order ||
            position.order.length > 512
          )
            throw new BadRequest('Invalid local resource identity');
          // Also validates fractional-index syntax before accepting future reorder anchors.
          generateKeyBetween(position.order, null);
          return {
            nodeId: position.nodeId,
            resource,
            ...(position.kind === 'folder' ? { folder: position.folder } : {}),
            parentNodeId: position.parentNodeId,
            order: position.order,
            defaultSortMode: position.defaultSortMode,
            trashRootNodeId: position.trashRootNodeId,
          };
        });
        const byId = validatePageTree(nodes, [
          ...source.resources,
          ...nodes
            .filter(node => node.resource.kind === 'folder')
            .map(node => node.resource),
        ]);
        for (const node of nodes) {
          const policyPath = pageTreeAncestors(byId, node.nodeId)
            .filter(node => isPageTreeContainer(node.resource))
            .map(node => node.nodeId);
          if (isPageTreeContainer(node.resource)) policyPath.push(node.nodeId);
          const principals = new Set(
            source.inventory.policies.map(policy => policy.principalId)
          );
          for (const principal of principals) {
            const policy = directoryPolicySnapshot(
              principal,
              source.inventory.policies
            );
            if (
              JSON.stringify(policy.rights([])) !==
              JSON.stringify(policy.rights(policyPath))
            )
              throw new BadRequest(
                'Local upload would change directory permissions'
              );
          }
          if (node.resource.trashed) {
            const claim = node.trashRootNodeId
              ? byId.get(node.trashRootNodeId)
              : undefined;
            if (
              !claim?.resource.trashed ||
              ![...pageTreeAncestors(byId, node.nodeId), node].some(
                item => item.nodeId === claim.nodeId
              )
            )
              throw new BadRequest('Invalid local trash dependency');
          } else if (node.trashRootNodeId)
            throw new BadRequest('Invalid local trash dependency');
        }
        const plan: PageTreePlan = {
          contract: WORKSPACE_PAGE_TREE_CONTRACT,
          sourceContract: null,
          typedMappings: nodes.map(node => ({
            sourceKind: node.resource.kind,
            sourceId: node.resource.resourceId,
            nodeId: node.nodeId,
            targetKind: node.resource.kind,
            targetId: node.resource.resourceId,
          })),
          workspaceId: input.workspaceId,
          sourceRevision: source.sourceRevision,
          localUploadFingerprint: uploadFingerprint,
          fingerprint: digest([source.sourceRevision, uploadFingerprint]),
          nodes,
          mappings: [],
          retiredPlacementIds: [],
          recycleEvidence: source.recycleClaims,
          conflicts: [],
        };
        const saved = await this.models.workspacePageTree.savePlan({
          ...input,
          sourceRevision: plan.sourceRevision,
          fingerprint: plan.fingerprint,
          plan,
        });
        await this.models.workspacePageTree.freeze({
          workspaceId: input.workspaceId,
          planId: saved.id,
        });
        return plan.fingerprint;
      }
    );
    return this.migrate(input, fingerprint);
  }

  private async source(workspaceId: string, excludeDocIds: string[] = []) {
    const inventory =
      await this.models.workspacePageTree.inventory(workspaceId);
    const load = async (id: string) => {
      const stored = await this.storage.getDocReadOnly(workspaceId, id);
      const doc = await snapshotParser.decode(
        `${workspaceId}:${id}`,
        stored?.bin ?? null
      );
      return {
        doc,
        revision: digest(
          stored ? Buffer.from(stored.bin).toString('base64') : null
        ),
      };
    };
    const root = await load(workspaceId);
    const tree = await load(`db$${workspaceId}$folders`);
    const properties = await load(`db$${workspaceId}$docProperties`);
    {
      const pages = root.doc.maps.meta?.pages;
      if (root.doc.pagesKind === 'invalid')
        throw new BadRequest('Invalid Workspace root');
      const rawPages = (root.doc.pagesKind === 'absent' ? [] : pages) as {
        id: string;
        title?: string;
        trash?: boolean;
        $localmindTrashClaims?: string[];
      }[];
      const nativeIds = new Set(inventory.office.map(item => item.id));
      const titles = new Map<string, string>();
      const resources: PageTreeResource[] = [];
      const recycleClaims: PageTreePlan['recycleEvidence'] = [];
      const documentTypes = new Map<string, WorkspaceDocumentType>();
      const legacy = root.doc.legacyPagePropertiesIsMap
        ? (root.doc.maps['affine:workspace-properties']
            ?.pageProperties as Record<string, unknown>)
        : undefined;
      for (const page of rawPages) {
        if (typeof page.id !== 'string' || !page.id)
          throw new BadRequest('Invalid Workspace resource');
        if (nativeIds.has(page.id)) continue;
        const current = properties.doc.maps[page.id] ?? {};
        const oldValue = legacy?.[page.id] as
          | { system?: { primaryMode?: { value?: string } } }
          | undefined;
        const mode =
          (current.$$DELETED === true ? undefined : current.primaryMode) ??
          oldValue?.system?.primaryMode?.value;
        const resource: PageTreeResource = {
          kind: 'doc',
          resourceId: page.id,
          primaryMode: mode === 'edgeless' ? 'edgeless' : 'page',
          trashed: page.trash === true,
        };
        resources.push(resource);
        if (resource.trashed)
          recycleClaims.push({
            identity: pageTreeResourceKey(resource),
            claims: page.$localmindTrashClaims ?? ['direct'],
          });
        titles.set(pageTreeResourceKey(resource), page.title ?? '');
        documentTypes.set(
          pageTreeResourceKey(resource),
          workspaceDocumentType(resource)
        );
      }
      for (const file of inventory.files) {
        if (!file.state)
          throw new BadRequest('Workspace file state requires repair');
        if (file.state.deletedAt) continue;
        const resource: PageTreeResource = {
          kind: 'file',
          resourceId: file.id,
          trashed: !!file.state.trashedAt,
        };
        resources.push(resource);
        if (resource.trashed)
          recycleClaims.push({
            identity: pageTreeResourceKey(resource),
            claims: file.state.trashSourceId
              ? [`folder:${file.state.trashSourceId}`]
              : ['direct'],
          });
        titles.set(pageTreeResourceKey(resource), file.state.title);
        documentTypes.set(
          pageTreeResourceKey(resource),
          workspaceDocumentType({
            kind: 'file',
            mimeType: file.state.revision.mimeType,
          })
        );
      }
      for (const office of inventory.office) {
        if (office.workspaceState?.deletedAt) continue;
        const resource: PageTreeResource = {
          kind: 'office',
          resourceId: office.id,
          trashed: !!office.workspaceState?.trashedAt,
        };
        resources.push(resource);
        if (resource.trashed)
          recycleClaims.push({
            identity: pageTreeResourceKey(resource),
            claims: office.workspaceState?.trashSourceId
              ? [`folder:${office.workspaceState.trashSourceId}`]
              : ['direct'],
          });
        titles.set(pageTreeResourceKey(resource), office.title);
        documentTypes.set(
          pageTreeResourceKey(resource),
          workspaceDocumentType({ kind: 'office', officeKind: office.kind })
        );
      }
      const rows: LegacyTreeRow[] = [];
      for (const [id, row] of Object.entries(tree.doc.maps)) {
        if (row.id === id && row.$$DELETED === true && row.type === undefined)
          continue;
        if (
          row.id !== id ||
          typeof row.type !== 'string' ||
          typeof row.data !== 'string' ||
          typeof row.index !== 'string'
        )
          throw new BadRequest('Invalid directory record');
        rows.push(row as LegacyTreeRow);
        if (
          row.type === 'folder' &&
          row.$pageTreeContract === WORKSPACE_PAGE_TREE_CONTRACT &&
          row.$pageTreeRetired !== true
        ) {
          if (!isPageTreeFolderMetadata(row.$pageTreeFolder))
            throw new BadRequest('Invalid folder metadata');
          const resource: PageTreeResource = {
            kind: 'folder',
            resourceId: row.data,
            trashed: row.$$DELETED === true,
          };
          resources.push(resource);
          titles.set(pageTreeResourceKey(resource), row.$pageTreeFolder.title);
          documentTypes.set(pageTreeResourceKey(resource), 'folder');
        }
      }
      const authorizationRevision = digest([
        inventory.policies,
        await this.models.workspacePageTree.authorizationVersion(
          workspaceId,
          excludeDocIds
        ),
      ]);
      const sourceRevision = digest([
        root.revision,
        tree.revision,
        properties.revision,
        inventory,
        authorizationRevision,
      ]);
      return {
        inventory,
        resources,
        rows,
        titles,
        documentTypes,
        recycleClaims,
        sourceRevision,
        authorizationRevision,
        legacyRootPages: root.doc.pagesKind === 'legacy-array',
      };
    }
  }

  async preflight(input: Actor) {
    await this.models.workspaceDirectoryGrant.assertAdministrator(
      input.workspaceId,
      input.actorId
    );
    const plan = await this.storage.observe(async () => {
      const source = await this.source(input.workspaceId);
      const state = await this.models.workspacePageTree.state(
        input.workspaceId
      );
      if (
        state?.contractVersion === WORKSPACE_PAGE_TREE_V1_CONTRACT ||
        state?.contractVersion === WORKSPACE_PAGE_TREE_CONTRACT
      ) {
        if (state.phase !== 'switched')
          throw new BadRequest(
            'Finish the historical migration before upgrading'
          );
        const graph = await this.graph(input.workspaceId);
        const body = {
          contract: WORKSPACE_PAGE_TREE_CONTRACT,
          sourceContract: state.contractVersion,
          workspaceId: input.workspaceId,
          sourceRevision: source.sourceRevision,
          nodes: graph.nodes,
          mappings: [],
          typedMappings: graph.nodes.map(node => ({
            sourceKind: node.resource.kind,
            sourceId: node.resource.resourceId,
            nodeId: node.nodeId,
            targetKind: node.resource.kind,
            targetId: node.resource.resourceId,
          })),
          retiredPlacementIds: [],
          recycleEvidence: [],
          conflicts: [],
        };
        return { ...body, fingerprint: digest(body) } satisfies PageTreePlan;
      }
      return planWorkspacePageTree({
        ...input,
        sourceRevision: source.sourceRevision,
        rows: source.rows,
        resources: source.resources,
        policies: source.inventory.policies,
        recycleClaims: source.recycleClaims,
      });
    });
    return plan;
  }

  private async graph(workspaceId: string) {
    const source = await this.source(workspaceId);
    const resources = new Map(
      source.resources.map(resource => [
        pageTreeResourceKey(resource),
        resource,
      ])
    );
    const nodes: PageTreeNode[] = source.rows
      .filter(
        row =>
          row.type === 'doc' ||
          row.type === 'office' ||
          row.type === 'file' ||
          row.type === 'folder'
      )
      .filter(
        row =>
          (row as LegacyTreeRow & { $pageTreeRetired?: boolean })
            .$pageTreeRetired !== true
      )
      .map(row => {
        const resource = resources.get(
          pageTreeResourceKey({
            kind: row.type as PageTreeResource['kind'],
            resourceId: row.data,
          })
        );
        if (!resource)
          throw new BadRequest('Page tree resource requires repair');
        return {
          nodeId: row.id,
          resource,
          ...(resource.kind === 'folder'
            ? { folder: row.$pageTreeFolder }
            : {}),
          parentNodeId: row.parentId ?? null,
          order: row.index,
          ...((row as LegacyTreeRow & { $pageTreeTrashRoot?: string })
            .$pageTreeTrashRoot
            ? {
                trashRootNodeId: (
                  row as LegacyTreeRow & { $pageTreeTrashRoot: string }
                ).$pageTreeTrashRoot,
              }
            : {}),
          ...(row.defaultSortMode
            ? { defaultSortMode: row.defaultSortMode }
            : {}),
        };
      });
    validatePageTree(nodes, source.resources);
    return { ...source, nodes };
  }

  private async readable(input: Actor, node: PageTreeNode) {
    const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
    if (node.resource.kind === 'folder')
      return acl.can('Workspace.Organize.Read');
    if (node.resource.kind === 'doc')
      return acl.doc(node.resource.resourceId).can('Doc.Read');
    if (!(await acl.can('Workspace.Blobs.Read'))) return false;
    try {
      await this.models.workspaceNativeResource.get(
        {
          ...input,
          kind: node.resource.kind,
          resourceId: node.resource.resourceId,
        },
        { trash: true }
      );
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  async list(
    input: Actor,
    parentNodeId: string | null,
    after?: string,
    limit = 100,
    options: {
      trash?: boolean;
      resource?: { kind: PageTreeResource['kind']; resourceId: string };
    } = {}
  ) {
    await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .assert('Workspace.Organize.Read');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new BadRequest('Invalid page size');
    return this.storage.observe(async () => {
      const state = await this.models.workspacePageTree.state(
        input.workspaceId
      );
      if (
        state &&
        !['preflight', 'needs_resolution', 'switched'].includes(state.phase)
      )
        throw new BadRequest('page_tree_migration_incomplete');
      if (state?.phase !== 'switched')
        return {
          enabled: false,
          contractVersion: state?.contractVersion ?? null,
          canCreateFolder: false,
          canCreatePage: false,
          revision: 0,
          authorizationRevision: '',
          snapshotRevision: null,
          items: [],
          nextCursor: null,
          parent: null,
          ancestors: [],
        };
      if (state.contractVersion !== WORKSPACE_PAGE_TREE_CONTRACT)
        throw new BadRequest('page_tree_upgrade_required');
      const graph = await this.graph(input.workspaceId);
      const { authorizationRevision } = graph;
      const selectedResource = options.resource;
      if (selectedResource) {
        let selected = graph.nodes.find(
          node =>
            pageTreeResourceKey(node.resource) ===
            pageTreeResourceKey(selectedResource)
        );
        if (!selected) {
          const converted =
            await this.models.workspacePageTree.convertedIdentity(
              input.workspaceId,
              selectedResource.kind,
              selectedResource.resourceId
            );
          if (converted)
            selected = graph.nodes.find(
              node => node.nodeId === converted.nodeId
            );
        }
        if (!selected) throw new NotFound('Resource unavailable');
        parentNodeId = selected.nodeId;
      }
      const scope = digest([
        input,
        parentNodeId,
        state.revision,
        state.contractVersion,
        authorizationRevision,
        limit,
        options.trash ?? false,
        graph.sourceRevision,
      ]);
      let offset = 0;
      if (after) {
        const parts = after.split(':');
        if (parts.length !== 2 || parts[0] !== scope || !/^\d+$/.test(parts[1]))
          throw new ResourceConflict('Page tree cursor changed; reload');
        offset = Number(parts[1]);
        if (!Number.isSafeInteger(offset))
          throw new BadRequest('Invalid cursor');
      }
      const byId = validatePageTree(graph.nodes);
      const policy = directoryPolicySnapshot(
        input.actorId,
        graph.inventory.policies
      );
      const canRead = async (node: PageTreeNode) => {
        const path = [...pageTreeAncestors(byId, node.nodeId), node];
        if (
          !policy.rights(
            path
              .filter(item => isPageTreeContainer(item.resource))
              .map(item => item.nodeId)
          ).canRead
        )
          return false;
        for (const entry of path)
          if (!(await this.readable(input, entry))) return false;
        return true;
      };
      if (parentNodeId !== null) {
        const parent = byId.get(parentNodeId);
        if (
          !parent ||
          (parent.resource.trashed && !options.trash) ||
          !(await canRead(parent))
        )
          throw new NotFound('Page unavailable');
      }
      const children = graph.nodes
        .filter(node =>
          options.trash
            ? node.resource.trashed && node.trashRootNodeId === node.nodeId
            : node.parentNodeId === parentNodeId && !node.resource.trashed
        )
        .sort((a, b) =>
          a.order < b.order
            ? -1
            : a.order > b.order
              ? 1
              : a.nodeId.localeCompare(b.nodeId, 'en')
        );
      let workspaceConversionBlocker:
        | FolderConversionBlocker
        | null
        | undefined;
      const conversionBlocker = async (
        node: PageTreeNode
      ): Promise<FolderConversionBlocker | null> => {
        if (node.resource.kind !== 'folder') return 'not_folder';
        if (node.resource.trashed) return 'trashed';
        const rights = policy.rights(
          [...pageTreeAncestors(byId, node.nodeId), node].map(
            item => item.nodeId
          )
        );
        if (!rights.canCreateFolder || !rights.canWrite || !rights.canOrganize)
          return 'missing_rights';
        workspaceConversionBlocker ??=
          await this.folderConversionBlocker(input);
        return workspaceConversionBlocker;
      };
      const describe = async (node: PageTreeNode) => {
        const blocker = await conversionBlocker(node);
        return {
          ...node,
          isContainer: isPageTreeContainer(node.resource),
          canConvertToPage: blocker === null,
          convertToPageUnavailableReason:
            blocker === 'not_folder' ? null : blocker,
          title: graph.titles.get(pageTreeResourceKey(node.resource)) ?? '',
          documentType:
            graph.documentTypes.get(pageTreeResourceKey(node.resource)) ??
            'other',
          rights: {
            ...policy.rights(
              [...pageTreeAncestors(byId, node.nodeId), node]
                .filter(item => isPageTreeContainer(item.resource))
                .map(item => item.nodeId)
            ),
            canOrganize:
              policy.rights(
                [...pageTreeAncestors(byId, node.nodeId), node]
                  .filter(item => isPageTreeContainer(item.resource))
                  .map(item => item.nodeId)
              ).canOrganize &&
              (await this.ac
                .user(input.actorId)
                .workspace(input.workspaceId)
                .can('Workspace.Sync')),
          },
        };
      };
      const visible = [];
      for (const node of children)
        if (await canRead(node)) visible.push(await describe(node));
      const parent = parentNodeId ? byId.get(parentNodeId) : null;
      const ancestors = parent ? pageTreeAncestors(byId, parent.nodeId) : [];
      const parentRights = policy.rights(
        ancestors.concat(parent ? [parent] : []).map(node => node.nodeId)
      );
      const writable =
        (!parent ||
          (isPageTreeContainer(parent.resource) && !parent.resource.trashed)) &&
        parentRights.canRead &&
        parentRights.canWrite &&
        parentRights.canOrganize &&
        (await this.ac
          .user(input.actorId)
          .workspace(input.workspaceId)
          .can('Workspace.Sync'));
      return {
        enabled: true,
        contractVersion: state.contractVersion,
        canCreateFolder: writable && parentRights.canCreateFolder,
        canCreatePage:
          writable &&
          (await this.ac
            .user(input.actorId)
            .workspace(input.workspaceId)
            .can('Workspace.CreateDoc')),
        revision: state.revision,
        authorizationRevision,
        // Covers nested titles, native metadata, tree structure and ACLs, not
        // just explicit tree commands. Clients may reuse layers only while the
        // complete authoritative read snapshot remains unchanged.
        snapshotRevision: digest([
          input,
          state.revision,
          state.contractVersion,
          graph.sourceRevision,
        ]),
        items: visible.slice(offset, offset + limit),
        parent: parent ? await describe(parent) : null,
        ancestors: await Promise.all(ancestors.map(describe)),
        nextCursor:
          offset + limit < visible.length ? `${scope}:${offset + limit}` : null,
      };
    });
  }

  private async authorizeLifecycle(
    input: Actor,
    graph: Awaited<ReturnType<WorkspacePageTreeService['graph']>>,
    affected: PageTreeNode[],
    action: 'trash' | 'restore' | 'delete'
  ) {
    const byId = validatePageTree(graph.nodes);
    const policies = directoryPolicySnapshot(
      input.actorId,
      graph.inventory.policies
    );
    const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
    await acl.assert('Workspace.Sync');
    for (const node of affected) {
      const path = [...pageTreeAncestors(byId, node.nodeId), node];
      for (const entry of path)
        if (!(await this.readable(input, entry)))
          throw new NotFound('Resource unavailable');
      const rights = policies.rights(
        path
          .filter(entry => isPageTreeContainer(entry.resource))
          .map(entry => entry.nodeId)
      );
      if (!rights.canRead || !rights.canWrite || !rights.canOrganize)
        throw new NotFound('Resource unavailable');
      const allowed =
        node.resource.kind === 'doc'
          ? await acl
              .doc(node.resource.resourceId)
              .can(
                action === 'trash'
                  ? 'Doc.Trash'
                  : action === 'restore'
                    ? 'Doc.Restore'
                    : 'Doc.Delete'
              )
          : node.resource.kind === 'folder'
            ? true
            : (await acl.can('Workspace.Blobs.Write')) &&
              (action !== 'delete' || (await acl.can('Workspace.Delete')));
      if (!allowed) throw new NotFound('Resource unavailable');
    }
  }

  async lifecyclePreview(
    input: Actor,
    nodeId: string,
    action: 'trash' | 'restore' | 'delete'
  ) {
    await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .assert('Workspace.Organize.Read');
    return this.storage.observe(async () => {
      const state = await this.models.workspacePageTree.state(
        input.workspaceId
      );
      if (state?.phase !== 'switched')
        throw new BadRequest('page_tree_migration_incomplete');
      const graph = await this.graph(input.workspaceId);
      const source = graph.nodes.find(node => node.nodeId === nodeId);
      if (!source) throw new NotFound('Resource unavailable');
      const subtree = pageTreeSubtree(graph.nodes, nodeId);
      const affected =
        action === 'trash'
          ? subtree.filter(node => !node.resource.trashed)
          : action === 'restore'
            ? subtree.filter(node => node.trashRootNodeId === nodeId)
            : subtree;
      // Check the entire affected set before disclosing even the count. The command
      // rechecks these same permissions, the tree revision and live resource state.
      await this.authorizeLifecycle(input, graph, affected, action);
      if (
        !affected.length ||
        (action === 'trash'
          ? source.resource.trashed
          : !source.resource.trashed)
      )
        throw new BadRequest('Resource lifecycle changed');
      if (
        action === 'delete' &&
        affected.some(
          node => !node.resource.trashed || node.trashRootNodeId !== nodeId
        )
      )
        throw new BadRequest('Resolve descendant recovery dependencies first');
      return {
        revision: state.revision,
        authorizationRevision: graph.authorizationRevision,
        parentNodeId: source.parentNodeId,
        total: affected.length,
        truncated: affected.length > 20,
        items: affected.slice(0, 20).map(node => ({
          nodeId: node.nodeId,
          title: graph.titles.get(pageTreeResourceKey(node.resource)) ?? '',
          documentType:
            graph.documentTypes.get(pageTreeResourceKey(node.resource)) ??
            'other',
        })),
      };
    });
  }

  async conversionPreview(input: Actor, nodeId: string) {
    const tree = await this.list(input, nodeId, undefined, 1);
    const node = tree.parent;
    if (
      !node ||
      node.resource.kind !== 'folder' ||
      !node.folder ||
      !node.canConvertToPage
    )
      throw new BadRequest(
        'Container conversion is unavailable; reverse conversion requires a history archive'
      );
    return {
      nodeId,
      title: node.title,
      revision: tree.revision,
      authorizationRevision: tree.authorizationRevision,
      resourceVersion: node.folder.metadataVersion,
      targetKind: 'doc',
    };
  }

  async destination(input: Actor, parentNodeId: string | null) {
    const page = await this.list(input, parentNodeId, undefined, 1);
    if (
      !page.enabled ||
      (page.parent && !isPageTreeContainer(page.parent.resource))
    )
      throw new BadRequest('An active page tree target is required');
    const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
    await acl.assert('Workspace.CreateDoc');
    await acl.assert('Workspace.Sync');
    const path = [...page.ancestors, ...(page.parent ? [page.parent] : [])].map(
      node => ({
        id: node.nodeId,
        name: node.title,
        parentId: node.parentNodeId,
      })
    );
    const rights = await this.models.workspaceDirectoryGrant.rights({
      ...input,
      directoryIds: path.map(node => node.id),
    });
    if (!rights.canRead || !rights.canWrite || !rights.canOrganize)
      throw new NotFound('Page does not allow publication');
    return {
      workspaceId: input.workspaceId,
      folderId: null,
      parentKind: page.parent?.resource.kind ?? 'root',
      path,
      fingerprint: digest({
        workspaceId: input.workspaceId,
        parentNodeId,
        parentKind: page.parent?.resource.kind ?? 'root',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        path,
      }),
      revision: page.revision,
      authorizationRevision: page.authorizationRevision,
    };
  }

  private async saveNodes(
    input: Actor,
    nodes: PageTreeNode[],
    retired: string[] = []
  ) {
    const id = `db$${input.workspaceId}$folders`;
    const stored = await this.storage.getDoc(input.workspaceId, id);
    const doc = new Y.Doc({ guid: id });
    try {
      if (stored) Y.applyUpdate(doc, stored.bin);
      const vector = Y.encodeStateVector(doc);
      doc.transact(() => {
        const active = new Set(nodes.map(node => node.nodeId));
        for (const old of retired)
          if (!active.has(old)) {
            doc.getMap(old).set('$$DELETED', true);
            doc.getMap(old).set('$pageTreeRetired', true);
          }
        for (const node of nodes) {
          const row = doc.getMap(node.nodeId);
          const values: Record<string, unknown> = {
            id: node.nodeId,
            type: node.resource.kind,
            data: node.resource.resourceId,
            parentId: node.parentNodeId,
            index: node.order,
            $$DELETED: node.resource.trashed,
            $pageTreeTrashRoot: node.trashRootNodeId,
            defaultSortMode: node.defaultSortMode,
            $pageTreeContract: WORKSPACE_PAGE_TREE_CONTRACT,
            $pageTreeFolder: node.folder,
          };
          for (const [key, value] of Object.entries(values)) {
            if (value === undefined) {
              if (row.has(key)) row.delete(key);
            } else if (JSON.stringify(row.get(key)) !== JSON.stringify(value))
              row.set(key, value);
          }
        }
      });
      const update = Y.encodeStateAsUpdate(doc, vector);
      if (stored || nodes.length || retired.length)
        await this.writer.pushDocUpdate(
          input.workspaceId,
          id,
          update,
          input.actorId
        );
    } finally {
      doc.destroy();
    }
  }

  /** Repair an already-switched legacy root inside the same locked command. */
  private async normalizeLegacyRoot(input: Actor) {
    const stored = await this.storage.getDoc(
      input.workspaceId,
      input.workspaceId
    );
    if (!stored) throw new NotFound('Workspace unavailable');
    const root = new Y.Doc();
    try {
      Y.applyUpdate(root, stored.bin);
      const vector = Y.encodeStateVector(root);
      if (migrateLegacyRootPages(root))
        await this.writer.pushDocUpdate(
          input.workspaceId,
          input.workspaceId,
          Y.encodeStateAsUpdate(root, vector),
          input.actorId
        );
    } finally {
      root.destroy();
    }
  }

  /** Prepare and freeze in a committed transaction before any batch can start.
   * Only the migration runner invokes this; it is deliberately not a user mutation. */
  async prepareMigration(input: Actor, expectedFingerprint: string) {
    return this.models.workspacePageTree.lock(input.workspaceId, async () => {
      await this.models.workspaceDirectoryGrant.assertAdministrator(
        input.workspaceId,
        input.actorId
      );
      const state = await this.models.workspacePageTree.state(
        input.workspaceId
      );
      if (
        state?.planId &&
        !(
          state.phase === 'switched' &&
          state.contractVersion === WORKSPACE_PAGE_TREE_V1_CONTRACT
        ) &&
        !['preflight', 'needs_resolution'].includes(state.phase)
      ) {
        const saved = await this.models.workspacePageTree.plan(
          state.planId,
          input.workspaceId
        );
        if (
          state.phase !== 'switched' &&
          (saved?.plan as { contract?: string } | undefined)?.contract ===
            WORKSPACE_PAGE_TREE_V1_CONTRACT
        )
          throw new BadRequest('page_tree_v1_migration_requires_resume');
        if (saved?.fingerprint !== expectedFingerprint)
          throw new ResourceConflict('Migration plan changed');
        return state;
      }
      const pending = await this.models.workspacePageTree.activeToolRuns(
        input.workspaceId
      );
      if (pending.some(hasLegacyPageTreeToolContract))
        throw new BadRequest(
          'Drain or retire frozen legacy resource tasks before page tree migration'
        );
      const plan = await this.preflight(input);
      if (plan.fingerprint !== expectedFingerprint)
        throw new ResourceConflict('Migration source changed');
      if (plan.conflicts.length)
        throw new BadRequest('Migration requires conflict resolution');
      const saved = await this.models.workspacePageTree.savePlan({
        ...input,
        sourceRevision: plan.sourceRevision,
        fingerprint: plan.fingerprint,
        plan,
      });
      await this.models.workspacePageTree.freeze({
        workspaceId: input.workspaceId,
        planId: saved.id,
        sourceContract: plan.sourceContract,
      });
      return this.models.workspacePageTree.state(input.workspaceId);
    });
  }

  /** One bounded, fenced transaction. Staged content has no root/tree membership.
   * A committed checkpoint therefore remains safe to resume after process death. */
  async migrationBatch(input: Actor, token: string, batchSize = 50) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw new BadRequest('Invalid migration batch size');
    return this.writer.withDeferredBroadcasts(() =>
      this.models.workspacePageTree.lock(input.workspaceId, () =>
        this.storage.withTransactionalWrites(async () => {
          await this.models.workspaceDirectoryGrant.assertAdministrator(
            input.workspaceId,
            input.actorId
          );
          const state = await this.models.workspacePageTree.state(
            input.workspaceId
          );
          if (
            !state?.planId ||
            state.leaseToken !== token ||
            !state.leaseExpiresAt ||
            state.leaseExpiresAt <= new Date() ||
            !['applying', 'validating'].includes(state.phase)
          )
            throw new ResourceConflict('Page tree migration lease expired');
          const saved = await this.models.workspacePageTree.plan(
            state.planId,
            input.workspaceId
          );
          if (!saved) throw new BadRequest('Migration plan unavailable');
          const plan = saved.plan as unknown as PageTreePlan;
          if (
            plan.workspaceId !== input.workspaceId ||
            plan.contract !== WORKSPACE_PAGE_TREE_CONTRACT ||
            plan.fingerprint !== saved.fingerprint
          )
            throw new BadRequest('Migration plan invalid');
          validatePageTree(plan.nodes);
          await this.models.workspacePageTree.lockDocuments(
            input.workspaceId,
            plan.nodes
              .filter(node => node.resource.kind === 'doc')
              .map(node => node.resource.resourceId)
          );
          const source = await this.source(
            input.workspaceId,
            plan.mappings.map(mapping => mapping.documentId)
          );
          if (source.sourceRevision !== plan.sourceRevision)
            throw new ResourceConflict('Frozen migration source changed');
          return pageTreeWriteContext.run(input.workspaceId, async () => {
            const batch = plan.typedMappings.slice(
              state.checkpoint,
              state.checkpoint + batchSize
            );
            if (batch.length) {
              await this.models.workspacePageTree.typedMappings(
                input.workspaceId,
                saved.id,
                batch
              );
              const next = state.checkpoint + batch.length;
              await this.models.workspacePageTree.checkpoint({
                workspaceId: input.workspaceId,
                planId: saved.id,
                token,
                expected: state.checkpoint,
                next,
                phase:
                  next === plan.typedMappings.length
                    ? 'validating'
                    : 'applying',
              });
              return { done: false, checkpoint: next };
            }
            const rootId = input.workspaceId,
              propertiesId = `db$${input.workspaceId}$docProperties`;
            const rootRecord = await this.storage.getDoc(rootId, rootId),
              propertiesRecord = await this.storage.getDoc(
                rootId,
                propertiesId
              );
            if (!rootRecord) throw new NotFound('Workspace unavailable');
            const root = new Y.Doc(),
              properties = new Y.Doc();
            try {
              Y.applyUpdate(root, rootRecord.bin);
              if (propertiesRecord)
                Y.applyUpdate(properties, propertiesRecord.bin);
              const rootVector = Y.encodeStateVector(root),
                propertiesVector = Y.encodeStateVector(properties);
              const migratedLegacyPages = migrateLegacyRootPages(root);
              const pages = root.getMap('meta').get('pages');
              if (!(pages instanceof Y.Array))
                throw new BadRequest('Invalid Workspace root');
              for (const mapping of plan.mappings) {
                const page = new Y.Map<unknown>();
                pages.push([page]);
                page.set('id', mapping.documentId);
                page.set('title', mapping.title);
                page.set('createDate', saved.createdAt.getTime());
                page.set('updatedDate', saved.createdAt.getTime());
                page.set(
                  'displayUpdateEvent',
                  JSON.stringify({
                    at: saved.createdAt.getTime(),
                    actor: 'user',
                    by: saved.actorId,
                  })
                );
                page.set('tags', new Y.Array());
                if (mapping.trashed) {
                  page.set('trash', true);
                  page.set('$localmindTrashClaims', ['direct']);
                }
                root
                  .getMap('spaces')
                  .set(
                    mapping.documentId,
                    new Y.Doc({ guid: mapping.documentId })
                  );
                const props = properties.getMap(mapping.documentId);
                props.set('id', mapping.documentId);
                props.set('createdBy', saved.actorId);
                props.set('updatedBy', saved.actorId);
              }
              // The immutable plan retains the original claims. The active root uses
              // one lifecycle marker; ownership groups remain solely in folders.
              for (let index = 0; index < pages.length; index++) {
                const page = pages.get(index);
                const id = page instanceof Y.Map ? page.get('id') : page.id;
                const node = plan.nodes.find(
                  node =>
                    node.resource.kind === 'doc' &&
                    node.resource.resourceId === id
                );
                if (!node?.resource.trashed) continue;
                if (page instanceof Y.Map)
                  page.set('$localmindTrashClaims', ['direct']);
                else {
                  pages.delete(index, 1);
                  pages.insert(index, [
                    { ...page, $localmindTrashClaims: ['direct'] },
                  ]);
                }
              }
              if (
                migratedLegacyPages ||
                plan.mappings.length ||
                plan.recycleEvidence.length
              ) {
                await this.writer.pushDocUpdate(
                  rootId,
                  rootId,
                  Y.encodeStateAsUpdate(root, rootVector),
                  saved.actorId
                );
              }
              if (plan.mappings.length) {
                await this.writer.pushDocUpdate(
                  rootId,
                  propertiesId,
                  Y.encodeStateAsUpdate(properties, propertiesVector),
                  saved.actorId
                );
              }
            } finally {
              root.destroy();
              properties.destroy();
            }
            await this.saveNodes(input, plan.nodes, plan.retiredPlacementIds);
            await this.models.workspacePageTree.checkpoint({
              workspaceId: input.workspaceId,
              planId: saved.id,
              token,
              expected: state.checkpoint,
              next: state.checkpoint,
              phase: 'validating',
            });
            await this.graph(input.workspaceId);
            await this.models.workspacePageTree.switchContract(
              input.workspaceId,
              saved.id,
              token,
              WORKSPACE_PAGE_TREE_CONTRACT
            );
            return { done: true, checkpoint: state.checkpoint };
          });
        })
      )
    );
  }

  async migrate(input: Actor, expectedFingerprint: string) {
    const state = await this.prepareMigration(input, expectedFingerprint);
    if (state?.phase === 'switched') return state;
    if (!state?.planId) throw new BadRequest('Migration plan unavailable');
    const token = await this.models.workspacePageTree.claim(
      input.workspaceId,
      state.planId
    );
    try {
      while (!(await this.migrationBatch(input, token)).done) {
        /* Each batch commits its checkpoint. */
      }
      return await this.models.workspacePageTree.state(input.workspaceId);
    } catch (error) {
      await this.models.workspacePageTree.fail(
        input.workspaceId,
        state.planId,
        token,
        error instanceof ResourceConflict
          ? 'source_or_lease_changed'
          : 'batch_failed'
      );
      throw error;
    }
  }

  async cancelMigration(input: Actor) {
    return this.models.workspacePageTree.lock(input.workspaceId, async () => {
      await this.models.workspaceDirectoryGrant.assertAdministrator(
        input.workspaceId,
        input.actorId
      );
      return this.models.workspacePageTree.cancel(input.workspaceId);
    });
  }

  private async folderConversionBlocker(
    input: Actor
  ): Promise<FolderConversionBlocker | null> {
    const workspace = this.ac.user(input.actorId).workspace(input.workspaceId);
    if (
      !(await workspace.can('Workspace.CreateDoc')) ||
      !(await workspace.can('Workspace.Sync'))
    )
      return 'missing_rights';
    return await this.models.workspacePageTree.conversionAudienceBlocker(
      input.workspaceId
    );
  }
  private async assertFolderConversionAudience(input: Actor) {
    if (
      !(await this.models.workspacePageTree.conversionAudience(
        input.workspaceId
      ))
    )
      throw new BadRequest(
        'Container conversion requires equivalent document permissions'
      );
  }

  async execute(
    input: Actor,
    command: PageTreeCommand,
    createNative?: () => Promise<unknown>,
    createDocument?: (documentId: string) => Promise<void>
  ) {
    if (
      command.contractVersion !== WORKSPACE_PAGE_TREE_CONTRACT ||
      !command.requestKey ||
      command.requestKey.length > 256
    )
      throw new BadRequest('Page tree protocol required');
    return this.writer.withDeferredBroadcasts(() =>
      this.models.workspacePageTree.lock(input.workspaceId, () =>
        this.storage.withTransactionalWrites(async () => {
          const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
          await acl.assert('Workspace.Sync');
          await acl.assert('Workspace.Organize.Read');
          const state = await this.models.workspacePageTree.state(
            input.workspaceId
          );
          if (
            state?.phase !== 'switched' ||
            state.contractVersion !== WORKSPACE_PAGE_TREE_CONTRACT
          )
            throw new BadRequest('Page tree migration is incomplete');
          await this.models.workspacePageTree.lockDocuments(
            input.workspaceId,
            (await this.source(input.workspaceId)).resources
              .filter(resource => resource.kind === 'doc')
              .map(resource => resource.resourceId)
          );
          const graph = await this.graph(input.workspaceId);
          const hash = digest(command);
          const replay = await this.models.workspacePageTree.operation(
            input.workspaceId,
            input.actorId,
            command.requestKey
          );
          if (replay) {
            if (replay.fingerprint !== hash)
              throw new ResourceConflict('Request key was already used');
            const evidence = replay.result as {
              nodeId?: string;
              parentNodeId?: string | null;
              oldParentNodeId?: string | null;
              affectedNodeIds?: string[];
            };
            const byId = validatePageTree(graph.nodes);
            const policy = directoryPolicySnapshot(
              input.actorId,
              graph.inventory.policies
            );
            const resultNode = evidence.nodeId
              ? byId.get(evidence.nodeId)
              : undefined;
            // Deleted identities remain readable only to a current administrator.
            if (!resultNode)
              await this.models.workspaceDirectoryGrant.assertAdministrator(
                input.workspaceId,
                input.actorId
              );
            for (const id of [
              evidence.nodeId,
              evidence.parentNodeId,
              evidence.oldParentNodeId,
              ...(evidence.affectedNodeIds ?? []),
            ]) {
              const node = id ? byId.get(id) : undefined;
              if (!node) continue;
              const path = [...pageTreeAncestors(byId, node.nodeId), node];
              if (
                !policy.rights(
                  path
                    .filter(item => isPageTreeContainer(item.resource))
                    .map(item => item.nodeId)
                ).canRead
              )
                throw new NotFound('Resource unavailable');
              for (const entry of path)
                if (!(await this.readable(input, entry)))
                  throw new NotFound('Resource unavailable');
            }
            return replay;
          }
          if (state.revision !== command.expectedRevision)
            throw new ResourceConflict('Page tree changed; reload');
          if (
            graph.authorizationRevision !==
            command.expectedAuthorizationRevision
          )
            throw new ResourceConflict('Page permissions changed; reload');
          const byId = validatePageTree(graph.nodes);
          const policies = directoryPolicySnapshot(
            input.actorId,
            graph.inventory.policies
          );
          const assertLocation = async (nodeId: string | null) => {
            const parent = nodeId === null ? null : byId.get(nodeId);
            if (
              nodeId !== null &&
              (!parent ||
                parent.resource.trashed ||
                !isPageTreeContainer(parent.resource))
            )
              throw new BadRequest('Target must be an active folder or page');
            const path = parent
              ? [...pageTreeAncestors(byId, parent.nodeId), parent]
              : [];
            for (const entry of path)
              if (!(await this.readable(input, entry)))
                throw new NotFound('Page unavailable');
            const rights = policies.rights(path.map(node => node.nodeId));
            if (!rights.canRead || !rights.canWrite || !rights.canOrganize)
              throw new NotFound('Page organization unavailable');
            return rights;
          };
          return pageTreeWriteContext.run(input.workspaceId, async () => {
            if (graph.legacyRootPages) await this.normalizeLegacyRoot(input);
            let nodes = graph.nodes;
            const retired: string[] = [];
            const affectedNodeIds: string[] = [];
            let nodeId: string;
            let oldParentNodeId: string | null = null;
            let oldBeforeNodeId: string | null = null;
            let oldSiblingOrder: string[] | null = null;
            let oldTargetSiblingOrder: string[] | null = null;
            let oldSourceSiblingOrder: string[] | null = null;
            if (command.action === 'create-native') {
              if (!createNative)
                throw new BadRequest('Native creation adapter required');
              await acl.assert('Workspace.CreateDoc');
              await acl.assert('Workspace.Blobs.Write');
              await assertLocation(command.parentNodeId);
              let registered: string | undefined;
              await pageTreeNativeCreatedContext.run(async identity => {
                if (registered)
                  throw new BadRequest('Native resource was registered twice');
                const resource: PageTreeResource = {
                  ...identity,
                  trashed: false,
                };
                const created = pageTreeNodeId(resource);
                const last =
                  nodes
                    .filter(node => node.parentNodeId === command.parentNodeId)
                    .map(node => node.order)
                    .sort()
                    .at(-1) ?? null;
                nodes = [
                  ...nodes,
                  {
                    nodeId: created,
                    resource,
                    parentNodeId: command.parentNodeId,
                    order: generateKeyBetween(last, null),
                  },
                ];
                validatePageTree(nodes);
                await this.saveNodes(input, nodes);
                registered = created;
              }, createNative);
              if (!registered)
                throw new BadRequest(
                  'Native resource placement was not completed'
                );
              nodeId = registered;
            } else if (command.action === 'create-folder') {
              const title = command.title.trim();
              if (!title || title.length > 512)
                throw new BadRequest('Invalid folder title');
              const rights = await assertLocation(command.parentNodeId);
              if (!rights.canCreateFolder)
                throw new NotFound('Folder creation unavailable');
              const resource: PageTreeResource = {
                kind: 'folder',
                resourceId: randomUUID(),
                trashed: false,
              };
              nodeId = pageTreeNodeId(resource);
              const last =
                nodes
                  .filter(node => node.parentNodeId === command.parentNodeId)
                  .map(node => node.order)
                  .sort()
                  .at(-1) ?? null;
              const at = new Date().toISOString();
              nodes = [
                ...nodes,
                {
                  nodeId,
                  resource,
                  parentNodeId: command.parentNodeId,
                  order: generateKeyBetween(last, null),
                  folder: {
                    title,
                    metadataVersion: 1,
                    createdAt: at,
                    createdBy: input.actorId,
                    updatedAt: at,
                    updatedBy: input.actorId,
                  },
                },
              ];
            } else if (command.action === 'create') {
              if (!command.title.trim() || command.title.length > 512)
                throw new BadRequest('Invalid page title');
              await acl.assert('Workspace.CreateDoc');
              await assertLocation(command.parentNodeId);
              const documentId = command.resourceId ?? randomUUID();
              if (
                !/^[A-Za-z0-9_-]{1,128}$/.test(documentId) ||
                documentId === input.workspaceId
              )
                throw new BadRequest('Invalid new document identity');
              if (
                nodes.some(node => node.resource.resourceId === documentId) ||
                (await this.models.doc.exists(input.workspaceId, documentId)) ||
                (await this.models.workspacePageTree.recordedResource(
                  input.workspaceId,
                  documentId
                ))
              )
                throw new ResourceConflict('Document identity already exists');
              const resource: PageTreeResource = {
                kind: 'doc',
                resourceId: documentId,
                primaryMode: command.primaryMode,
                trashed: false,
              };
              nodeId = pageTreeNodeId(resource);
              const last =
                nodes
                  .filter(node => node.parentNodeId === command.parentNodeId)
                  .map(node => node.order)
                  .sort()
                  .at(-1) ?? null;
              if (createDocument) await createDocument(documentId);
              else
                await this.writer.createDoc(
                  input.workspaceId,
                  command.title,
                  '',
                  input.actorId,
                  documentId
                );
              await this.models.doc.upsertMeta(input.workspaceId, documentId, {
                title: command.title,
              });
              await this.models.docUser.setOwner(
                input.workspaceId,
                documentId,
                input.actorId
              );
              if (command.primaryMode === 'edgeless')
                await this.organization.applyDataOperations(
                  input.workspaceId,
                  input.actorId,
                  input.actorId,
                  'document_properties',
                  [
                    {
                      op: 'upsert',
                      key: documentId,
                      values: { primaryMode: 'edgeless' },
                    },
                  ]
                );
              nodes = [
                ...nodes,
                {
                  nodeId,
                  resource,
                  parentNodeId: command.parentNodeId,
                  order: generateKeyBetween(last, null),
                },
              ];
            } else {
              nodeId = command.nodeId;
              const source = byId.get(nodeId);
              if (!source || !(await this.readable(input, source)))
                throw new NotFound('Resource unavailable');
              if (
                'expectedParentNodeId' in command &&
                command.expectedParentNodeId !== source.parentNodeId
              )
                throw new ResourceConflict(
                  'Resource moved; review deletion again'
                );
              oldParentNodeId = source.parentNodeId;
              const oldSiblings = nodes
                .filter(
                  node =>
                    node.parentNodeId === source.parentNodeId &&
                    (command.action !== 'move' || !node.resource.trashed)
                )
                .sort((a, b) =>
                  a.order < b.order
                    ? -1
                    : a.order > b.order
                      ? 1
                      : a.nodeId.localeCompare(b.nodeId)
                );
              oldBeforeNodeId =
                oldSiblings[
                  oldSiblings.findIndex(node => node.nodeId === nodeId) + 1
                ]?.nodeId ?? null;
              if (
                ['trash', 'restore', 'delete'].includes(command.action) &&
                source.resource.trashed !== (command.action !== 'trash')
              )
                throw new BadRequest('Resource lifecycle changed');
              if (
                command.action !== 'restore' ||
                command.parentNodeId === undefined
              )
                await assertLocation(source.parentNodeId);
              if (
                command.action === 'rename-folder' ||
                command.action === 'convert-folder'
              ) {
                if (
                  source.resource.kind !== 'folder' ||
                  !source.folder ||
                  source.resource.trashed
                )
                  throw new BadRequest('Folder type changed; reload');
                const folder = source.folder;
                const rights = await assertLocation(source.nodeId);
                if (
                  source.folder.metadataVersion !==
                  command.expectedResourceVersion
                )
                  throw new ResourceConflict('Folder metadata changed; reload');
                if (command.action === 'convert-folder') {
                  // Reverse conversion remains unavailable until its history archive is implemented.
                  // A new document must not expand or restrict the effective audience.
                  await acl.assert('Workspace.CreateDoc');
                  if (!rights.canCreateFolder)
                    throw new NotFound('Container conversion unavailable');
                  await this.assertFolderConversionAudience(input);
                  const documentId = randomUUID();
                  await this.writer.createDoc(
                    input.workspaceId,
                    source.folder.title,
                    '',
                    input.actorId,
                    documentId
                  );
                  await this.models.doc.upsertMeta(
                    input.workspaceId,
                    documentId,
                    { title: source.folder.title }
                  );
                  await this.models.docUser.setOwner(
                    input.workspaceId,
                    documentId,
                    input.actorId
                  );
                  nodes = nodes.map(node =>
                    node.nodeId === nodeId
                      ? {
                          ...node,
                          folder: undefined,
                          resource: {
                            kind: 'doc',
                            resourceId: documentId,
                            primaryMode: 'page',
                            trashed: false,
                          },
                        }
                      : node
                  );
                } else {
                  const title = command.title?.trim();
                  if (!title || title.length > 512)
                    throw new BadRequest('Invalid folder title');
                  if (title !== source.folder.title)
                    nodes = nodes.map(node =>
                      node.nodeId === nodeId
                        ? {
                            ...node,
                            folder: {
                              ...folder,
                              title,
                              metadataVersion: folder.metadataVersion + 1,
                              updatedAt: new Date().toISOString(),
                              updatedBy: input.actorId,
                            },
                          }
                        : node
                    );
                }
              } else if (command.action === 'move') {
                await assertLocation(command.parentNodeId);
                const crossParent =
                  source.parentNodeId !== command.parentNodeId;
                if (
                  (command.siblingOrder && crossParent) ||
                  (!crossParent &&
                    (command.targetSiblingOrder ||
                      command.sourceSiblingOrder)) ||
                  (command.siblingOrder &&
                    (command.targetSiblingOrder || command.sourceSiblingOrder))
                )
                  throw new BadRequest(
                    'Order must match the affected sibling level'
                  );
                const siblings = nodes
                  .filter(
                    node =>
                      node.nodeId !== nodeId &&
                      node.parentNodeId === command.parentNodeId &&
                      !node.resource.trashed
                  )
                  .sort((a, b) =>
                    a.order < b.order
                      ? -1
                      : a.order > b.order
                        ? 1
                        : a.nodeId.localeCompare(b.nodeId)
                  );
                const targetOrder =
                  command.siblingOrder ?? command.targetSiblingOrder;
                const offset =
                  !targetOrder && command.beforeNodeId
                    ? siblings.findIndex(
                        node => node.nodeId === command.beforeNodeId
                      )
                    : siblings.length;
                if (offset < 0)
                  throw new BadRequest('Reorder target unavailable');
                nodes = movePageTreeNode(
                  nodes,
                  nodeId,
                  command.parentNodeId,
                  generateKeyBetween(
                    siblings[offset - 1]?.order ?? null,
                    siblings[offset]?.order ?? null
                  )
                );
                const reorder = async (
                  parentId: string | null,
                  order: string[]
                ) => {
                  if (order.length > 10000)
                    throw new BadRequest('Sibling order is too large');
                  pageTreeSiblingOrder(nodes, parentId, order);
                  const current = validatePageTree(nodes);
                  for (const siblingId of order) {
                    const sibling = current.get(siblingId);
                    if (!sibling) throw new BadRequest('Resource unavailable');
                    if (!(await this.readable(input, sibling)))
                      throw new NotFound('Resource unavailable');
                    const path = [
                      ...pageTreeAncestors(current, siblingId),
                      sibling,
                    ]
                      .filter(node => isPageTreeContainer(node.resource))
                      .map(node => node.nodeId);
                    const rights = policies.rights(path);
                    if (
                      !rights.canRead ||
                      !rights.canWrite ||
                      !rights.canOrganize
                    )
                      throw new NotFound('Resource unavailable');
                    if (sibling.resource.kind === 'doc')
                      await acl
                        .doc(sibling.resource.resourceId)
                        .assert('Doc.Update');
                    else if (sibling.resource.kind !== 'folder')
                      await acl.assert('Workspace.Blobs.Write');
                    affectedNodeIds.push(siblingId);
                  }
                  nodes = reorderPageTreeLevel(
                    nodes,
                    parentId,
                    order,
                    previous => generateKeyBetween(previous, null)
                  );
                };
                if (command.siblingOrder) {
                  oldSiblingOrder = pageTreeSiblingOrder(
                    graph.nodes,
                    source.parentNodeId,
                    command.siblingOrder
                  );
                  await reorder(command.parentNodeId, command.siblingOrder);
                }
                if (command.targetSiblingOrder) {
                  oldTargetSiblingOrder = pageTreeSiblingOrder(
                    graph.nodes,
                    command.parentNodeId
                  );
                  await reorder(
                    command.parentNodeId,
                    command.targetSiblingOrder
                  );
                }
                if (command.sourceSiblingOrder) {
                  oldSourceSiblingOrder = pageTreeSiblingOrder(
                    graph.nodes,
                    source.parentNodeId
                  );
                  await reorder(
                    source.parentNodeId,
                    command.sourceSiblingOrder
                  );
                }
                const nextGraph = validatePageTree(nodes);
                const principals = [
                  ...new Set([
                    '*',
                    input.actorId,
                    ...graph.inventory.policies.map(
                      policy => policy.principalId
                    ),
                  ]),
                ];
                for (const affected of pageTreeSubtree(graph.nodes, nodeId)) {
                  if (!(await this.readable(input, affected)))
                    throw new NotFound('Resource unavailable');
                  const beforePath = [
                    ...pageTreeAncestors(byId, affected.nodeId),
                    affected,
                  ]
                    .filter(node => isPageTreeContainer(node.resource))
                    .map(node => node.nodeId);
                  const actorRights = policies.rights(beforePath);
                  if (
                    !actorRights.canRead ||
                    !actorRights.canWrite ||
                    !actorRights.canOrganize
                  )
                    throw new NotFound('Resource unavailable');
                  if (affected.resource.kind === 'doc')
                    await acl
                      .doc(affected.resource.resourceId)
                      .assert('Doc.Update');
                  else if (affected.resource.kind !== 'folder')
                    await acl.assert('Workspace.Blobs.Write');
                  const next = nextGraph.get(affected.nodeId);
                  if (!next) throw new BadRequest('Invalid subtree');
                  const afterPath = [
                    ...pageTreeAncestors(nextGraph, affected.nodeId),
                    next,
                  ]
                    .filter(node => isPageTreeContainer(node.resource))
                    .map(node => node.nodeId);
                  for (const principal of principals) {
                    const snapshot = directoryPolicySnapshot(
                      principal,
                      graph.inventory.policies
                    );
                    if (
                      JSON.stringify(snapshot.rights(beforePath)) !==
                      JSON.stringify(snapshot.rights(afterPath))
                    )
                      throw new BadRequest(
                        'Move requires explicit permission changes'
                      );
                  }
                }
              } else {
                if (
                  command.action === 'restore' &&
                  command.parentNodeId !== undefined &&
                  command.parentNodeId !== source.parentNodeId
                ) {
                  await assertLocation(command.parentNodeId);
                  const relocated = nodes.map(node =>
                    node.nodeId === nodeId
                      ? { ...node, parentNodeId: command.parentNodeId ?? null }
                      : node
                  );
                  const nextGraph = validatePageTree(relocated);
                  for (const affected of pageTreeSubtree(nodes, nodeId)) {
                    const beforePath = [
                      ...pageTreeAncestors(byId, affected.nodeId),
                      affected,
                    ]
                      .filter(node => isPageTreeContainer(node.resource))
                      .map(node => node.nodeId);
                    const afterPath = [
                      ...pageTreeAncestors(nextGraph, affected.nodeId),
                      nextGraph.get(affected.nodeId) ?? affected,
                    ]
                      .filter(node => isPageTreeContainer(node.resource))
                      .map(node => node.nodeId);
                    for (const principal of new Set([
                      '*',
                      input.actorId,
                      ...graph.inventory.policies.map(
                        policy => policy.principalId
                      ),
                    ])) {
                      const snapshot = directoryPolicySnapshot(
                        principal,
                        graph.inventory.policies
                      );
                      if (
                        JSON.stringify(snapshot.rights(beforePath)) !==
                        JSON.stringify(snapshot.rights(afterPath))
                      )
                        throw new BadRequest(
                          'Restore requires explicit permission changes'
                        );
                    }
                  }
                  nodes = relocated;
                }
                const subtree = pageTreeSubtree(nodes, nodeId);
                const affected =
                  command.action === 'restore'
                    ? subtree.filter(node => node.trashRootNodeId === nodeId)
                    : command.action === 'trash'
                      ? subtree.filter(node => !node.resource.trashed)
                      : subtree;
                if (!affected.length)
                  throw new BadRequest('No matching subtree lifecycle claim');
                if (
                  command.action === 'delete' &&
                  affected.some(
                    node =>
                      !node.resource.trashed || node.trashRootNodeId !== nodeId
                  )
                )
                  throw new BadRequest(
                    'Resolve descendant recovery dependencies first'
                  );
                // Authorize the entire batch before the first side effect. Errors do
                // not include a hidden child's name, path or the number of children.
                await this.authorizeLifecycle(
                  input,
                  graph,
                  affected,
                  command.action
                );
                for (const node of [...affected].reverse()) {
                  affectedNodeIds.push(node.nodeId);
                  if (node.resource.kind === 'doc') {
                    const operation = {
                      ...input,
                      editorId: input.actorId,
                      userId: input.actorId,
                      documentId: node.resource.resourceId,
                      expectedTitle:
                        graph.titles.get(pageTreeResourceKey(node.resource)) ??
                        '',
                    };
                    if (command.action === 'delete')
                      await this.organization.deleteDocumentPermanently(
                        operation
                      );
                    else {
                      const changed =
                        await this.organization.setDocumentTrashed({
                          ...operation,
                          trashed: command.action === 'trash',
                        });
                      if (changed.trashed !== (command.action === 'trash'))
                        throw new BadRequest(
                          'Resource has another recovery dependency'
                        );
                    }
                  } else if (node.resource.kind !== 'folder') {
                    const identity = {
                      ...input,
                      kind: node.resource.kind,
                      resourceId: node.resource.resourceId,
                    };
                    const current =
                      await this.models.workspaceNativeResource.get(identity, {
                        trash: true,
                      });
                    await this.models.workspaceNativeResource.change({
                      ...identity,
                      expectedVersion: current.metadataVersion,
                      ...(command.action === 'delete'
                        ? { permanentlyDelete: true }
                        : {
                            trash: command.action === 'trash',
                            trashSourceId:
                              command.action === 'trash' ? nodeId : null,
                            restoreLocations:
                              command.action === 'trash'
                                ? [
                                    {
                                      folderId: node.parentNodeId,
                                      path: pageTreeAncestors(byId, node.nodeId)
                                        .map(entry => entry.nodeId)
                                        .reverse(),
                                    },
                                  ]
                                : [],
                          }),
                    });
                  }
                }
                const affectedSet = new Set(affectedNodeIds);
                if (command.action === 'delete') {
                  retired.push(...affectedNodeIds);
                  nodes = nodes.filter(node => !affectedSet.has(node.nodeId));
                } else
                  nodes = nodes.map(node =>
                    affectedSet.has(node.nodeId)
                      ? {
                          ...node,
                          resource: {
                            ...node.resource,
                            trashed: command.action === 'trash',
                          },
                          trashRootNodeId:
                            command.action === 'trash' ? nodeId : undefined,
                        }
                      : node
                  );
              }
            }
            validatePageTree(nodes);
            if (
              (command.action === 'create' || command.action === 'move') &&
              command.insertAfterBlockId
            ) {
              const parent = command.parentNodeId
                ? byId.get(command.parentNodeId)
                : undefined;
              if (
                !parent ||
                parent.resource.kind !== 'doc' ||
                nodes.find(node => node.nodeId === nodeId)?.resource
                  .primaryMode !== 'page'
              )
                throw new BadRequest('A subpage entry requires a page parent');
              await acl.doc(parent.resource.resourceId).assert('Doc.Update');
              const record = await this.storage.getDoc(
                input.workspaceId,
                parent.resource.resourceId
              );
              if (!record) throw new NotFound('Page unavailable');
              const document = new Y.Doc();
              try {
                Y.applyUpdate(document, record.bin);
                const blocks = document.getMap<Y.Map<unknown>>('blocks');
                const containing = [...blocks.values()].find(block => {
                  const children = block.get('sys:children');
                  return (
                    children instanceof Y.Array &&
                    children.toArray().includes(command.insertAfterBlockId)
                  );
                });
                if (!containing)
                  throw new ResourceConflict(
                    'Insertion position changed; reload the page'
                  );
                const children = containing.get('sys:children');
                if (!(children instanceof Y.Array))
                  throw new BadRequest('Invalid page structure');
                const vector = Y.encodeStateVector(document),
                  blockId = randomUUID();
                const entry = new Y.Map<unknown>();
                entry.set('sys:id', blockId);
                entry.set('sys:flavour', 'localmind:subpage');
                entry.set('sys:version', 1);
                entry.set('sys:children', new Y.Array<string>());
                const created = nodes.find(node => node.nodeId === nodeId);
                if (!created) throw new BadRequest('Created page unavailable');
                entry.set('prop:resourceId', created.resource.resourceId);
                entry.set('prop:kind', 'doc');
                document.transact(() => {
                  blocks.set(blockId, entry);
                  children.insert(
                    children.toArray().indexOf(command.insertAfterBlockId) + 1,
                    [blockId]
                  );
                });
                await this.writer.pushDocUpdate(
                  input.workspaceId,
                  parent.resource.resourceId,
                  Y.encodeStateAsUpdate(document, vector),
                  input.actorId
                );
              } finally {
                document.destroy();
              }
            }
            await this.saveNodes(input, nodes, retired);
            const revision = await this.models.workspacePageTree.advance(
              input.workspaceId,
              state.revision
            );
            const node =
              nodes.find(node => node.nodeId === nodeId) ?? byId.get(nodeId);
            if (!node) throw new BadRequest('Resource unavailable');
            const receipt = await this.models.workspacePageTree.receipt({
              workspaceId: input.workspaceId,
              actorId: input.actorId,
              requestKey: command.requestKey,
              fingerprint: hash,
              contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
              beforeRevision: state.revision,
              afterRevision: revision,
              result: {
                nodeId,
                resource: node.resource,
                oldParentNodeId,
                oldBeforeNodeId,
                oldSiblingOrder,
                oldTargetSiblingOrder,
                oldSourceSiblingOrder,
                action: command.action,
                parentNodeId: node.parentNodeId,
                revision,
                affectedNodeIds,
              },
            });
            if (command.action === 'convert-folder') {
              const before = byId.get(nodeId);
              if (!before?.folder)
                throw new BadRequest('Conversion source unavailable');
              await this.models.workspacePageTree.conversion({
                workspaceId: input.workspaceId,
                operationId: receipt.id,
                nodeId,
                sourceKind: 'folder',
                sourceId: before.resource.resourceId,
                targetKind: 'doc',
                targetId: node.resource.resourceId,
                sourceVersion: before.folder.metadataVersion,
                authorizationRevision: graph.authorizationRevision,
                evidence: {
                  folder: before.folder,
                  beforeRevision: state.revision,
                  afterRevision: revision,
                },
              });
            }
            return receipt;
          });
        })
      )
    );
  }
}
