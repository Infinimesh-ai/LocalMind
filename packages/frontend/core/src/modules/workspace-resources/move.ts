import { UserFriendlyError } from '@affine/error';
import {
  moveWorkspaceDocumentMutation,
  type MoveWorkspaceDocumentMutationVariables,
  workspaceDirectoryQuery,
} from '@affine/graphql';
import { Service } from '@toeverything/infra';

import type { WorkspaceServerService } from '../cloud';
import type { WorkspacePageTreeService } from '../organize/services/page-tree';
import type { WorkspaceService } from '../workspace';
import type { WorkspaceResourcesService } from './service';

export type ResourceMoveTarget = {
  kind: 'doc' | 'file' | 'office';
  id: string;
};
export class NestedResourceMoveError extends Error {}
const identity = (item: ResourceMoveTarget) => `${item.kind}:${item.id}`;

/** A batch freezes its destination and account; each resource commits independently. */
export class WorkspaceResourceMoveService extends Service {
  private inactive = false;
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly serverService: WorkspaceServerService,
    private readonly resources: WorkspaceResourcesService,
    private readonly pageTree: WorkspacePageTreeService
  ) {
    super();
    this.disposables.push(() => {
      this.inactive = true;
    });
  }

  get accountGeneration() {
    return this.pageTree.accountGeneration;
  }

  async begin(
    targets: readonly ResourceMoveTarget[],
    parentId: string | null,
    generation = this.accountGeneration
  ) {
    if (!targets.length || targets.length > 100)
      throw new Error('Select 1–100 resources');
    const workspace = this.workspaceService.workspace;
    const assertScope = () => {
      if (this.inactive || generation !== this.pageTree.accountGeneration)
        throw new Error('Resource scope changed');
    };
    if (this.pageTree.enabled$.value === null) await this.pageTree.load(null);
    assertScope();
    const treeEnabled = this.pageTree.enabled$.value;
    if (treeEnabled === null) throw new Error('Directory unavailable');
    if (!treeEnabled && workspace.flavour === 'local')
      throw new Error('Online workspace required');
    const selected = new Map(targets.map(item => [identity(item), item]));
    const locations = new Map<
      string,
      Awaited<ReturnType<WorkspacePageTreeService['locate']>>
    >();
    if (treeEnabled) {
      for (const item of selected.values()) {
        // Resolve the whole selection before writes so an unreadable descendant
        // cannot be silently flattened after its selected parent has moved.
        const location = await this.pageTree.locate(item.kind, item.id);
        if (!location.parent) throw new Error('Resource unavailable');
        locations.set(identity(item), location);
        assertScope();
      }
      const nodes = new Set(
        [...locations.values()].flatMap(row =>
          row.parent ? [row.parent.nodeId] : []
        )
      );
      if (
        (parentId !== null && nodes.has(parentId)) ||
        [...locations.values()].some(row =>
          row.ancestors.some(ancestor => nodes.has(ancestor.nodeId))
        )
      )
        throw new NestedResourceMoveError(
          'Select only the top-level resources to move'
        );
    }
    const requests = new Map<string, MoveWorkspaceDocumentMutationVariables>();
    const pending = new Set<string>();
    const succeeded = new Set<string>();
    return {
      move: async (item: ResourceMoveTarget) => {
        assertScope();
        const key = identity(item);
        if (!selected.has(key))
          throw new Error('Resource is outside this batch');
        if (succeeded.has(key)) return;
        if (pending.has(key))
          throw new Error('Resource move is already pending');
        pending.add(key);
        try {
          if (treeEnabled) {
            const node = locations.get(key)?.parent;
            if (!node?.canOrganize || node.trashed)
              throw new Error('Resource unavailable');
            await this.pageTree.execute({
              action: 'move',
              nodeId: node.nodeId,
              parentNodeId: parentId,
              expectedParentNodeId: node.parentNodeId,
            });
          } else if (item.kind !== 'doc') {
            await this.resources.move(
              {
                workspaceId: workspace.id,
                resourceId: item.id,
                kind: item.kind,
              },
              parentId
            );
          } else {
            const server = this.serverService.server;
            if (!server?.account$.value)
              throw new Error('Sign in before moving resources');
            let request = requests.get(key);
            if (!request) {
              const directory = await server.gql({
                query: workspaceDirectoryQuery,
                variables: { workspaceId: workspace.id },
              });
              assertScope();
              request = {
                workspaceId: workspace.id,
                documentId: item.id,
                folderId: parentId,
                expectedRevision: directory.workspaceDirectory.revision,
              };
              requests.set(key, request);
            }
            await server.gql({
              query: moveWorkspaceDocumentMutation,
              variables: request,
            });
            assertScope();
            requests.delete(key);
            for (const id of [workspace.id, 'db$folders'])
              void workspace.engine.doc.requestPull(id).catch(() => {});
            this.resources.invalidate();
          }
          assertScope();
          succeeded.add(key);
        } catch (error) {
          // Unknown outcomes retain the original version. Definite rejection lets
          // an explicit retry read a fresh version without replaying successes.
          if (
            [400, 403, 404, 409].includes(
              UserFriendlyError.fromAny(error).status
            )
          )
            requests.delete(key);
          throw error;
        } finally {
          pending.delete(key);
        }
      },
    };
  }
}
