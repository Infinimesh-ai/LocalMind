import {
  type GetDocRolePermissionsQuery,
  getDocRolePermissionsQuery,
  getReadableDocIdsQuery,
} from '@affine/graphql';
import { Store } from '@toeverything/infra';

import type { WorkspaceServerService } from '../../cloud';
import type { NbstoreService } from '../../storage';
import type { WorkspaceService } from '../../workspace';

export type WorkspacePermissionActions = string;

export type DocPermissionActions = keyof Omit<
  GetDocRolePermissionsQuery['workspace']['doc']['permissions'],
  '__typename'
>;

export class GuardStore extends Store {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly nbstoreService: NbstoreService
  ) {
    super();
  }

  async getWorkspacePermissions(): Promise<
    Record<WorkspacePermissionActions, boolean>
  > {
    const { access } = await this.nbstoreService.realtime.request(
      'workspace.access.get',
      { workspaceId: this.workspaceService.workspace.id },
      { timeoutMs: 10000 }
    );
    return access.permissions as Record<WorkspacePermissionActions, boolean>;
  }

  async getDocPermissions(
    docId: string
  ): Promise<Record<DocPermissionActions, boolean>> {
    if (!this.workspaceServerService.server) {
      throw new Error('No server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getDocRolePermissionsQuery,
      variables: {
        workspaceId: this.workspaceService.workspace.id,
        docId,
      },
    });
    return data.workspace.doc.permissions;
  }

  /**
   * Live `Doc.Read` check for up to 100 documents in one request. Returns only
   * the readable IDs; denied and unknown documents are indistinguishable.
   */
  async getReadableDocIds(
    docIds: string[],
    signal?: AbortSignal
  ): Promise<string[]> {
    if (!this.workspaceServerService.server) {
      throw new Error('No server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getReadableDocIdsQuery,
      variables: {
        workspaceId: this.workspaceService.workspace.id,
        docIds,
      },
      context: { signal },
    });
    return data.workspace.readableDocIds;
  }
}
