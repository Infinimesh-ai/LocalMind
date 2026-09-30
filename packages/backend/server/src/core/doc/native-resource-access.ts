import { Injectable } from '@nestjs/common';

import { NotFound } from '../../base';
import { Models } from '../../models';
import type { WorkspaceNativeIdentity } from '../../models/workspace-native-resource';
import { PermissionAccess } from '../permission';
import { ResourceError } from './resource-types';
import { WorkspaceOrganizationService } from './workspace-organization';
import { WorkspaceResourceService } from './workspace-resource';

/** All native entry points share live Blob ACL, directory ACL and lifecycle checks. */
@Injectable()
export class WorkspaceNativeResourceAccess {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly organization: WorkspaceOrganizationService,
    private readonly resources: WorkspaceResourceService
  ) {}

  async assert(
    input: WorkspaceNativeIdentity & { actorId: string },
    options: {
      write?: boolean;
      organize?: boolean;
      trash?: boolean;
      deleted?: boolean;
    } = {}
  ) {
    const permission = this.ac.user(input.actorId).workspace(input.workspaceId);
    await permission.assert('Workspace.Blobs.Read');
    if (options.write) await permission.assert('Workspace.Blobs.Write');
    if (options.organize) await permission.assert('Workspace.Sync');
    const resource = await this.models.workspaceNativeResource.get(
      input,
      options
    );
    await this.organization.nativeResourceLocations({
      ...input,
      write: options.write,
      organize: options.organize,
    });
    return resource;
  }

  async assertBlobRead(input: {
    workspaceId: string;
    actorId: string;
    key: string;
  }) {
    const references = await this.models.workspaceNativeResource.blobResources(
      input.workspaceId,
      input.key
    );
    if (!references.length) return false;
    await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .assert('Workspace.Blobs.Read');
    for (const reference of references) {
      try {
        await this.assert({
          ...input,
          resourceId: reference.id,
          kind: reference.kind,
        });
        return true;
      } catch (error) {
        if (!(error instanceof NotFound) && !(error instanceof ResourceError))
          throw error;
      }
    }
    throw new NotFound('Native file content is unavailable');
  }

  async write<T>(
    input: WorkspaceNativeIdentity & { actorId: string },
    operation: () => Promise<T>,
    options: { trash?: boolean; organize?: boolean; deleted?: boolean } = {}
  ) {
    return this.resources.snapshot(input, async () => {
      await this.models.workspaceNativeResource.lock(input);
      await this.assert(input, { ...options, write: true });
      return operation();
    });
  }
}
