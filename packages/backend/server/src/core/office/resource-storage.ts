import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';

import {
  BlobQuotaExceeded,
  type PutObjectMetadata,
  StorageQuotaExceeded,
} from '../../base';
import { Models } from '../../models';
import type { OfficeOwner } from '../../models/office-owner';
import { PermissionAccess } from '../permission';
import { ProjectBlobStorage } from '../project';
import { QuotaService } from '../quota';
import { WorkspaceBlobStorage } from '../storage';

@Injectable()
export class OfficeResourceStorage {
  constructor(
    private readonly workspaces: WorkspaceBlobStorage,
    private readonly projects: ProjectBlobStorage,
    private readonly ac: PermissionAccess,
    private readonly quota: QuotaService,
    private readonly models: Models
  ) {}

  async putGenerated(
    owner: OfficeOwner,
    actorId: string,
    bytes: Buffer,
    mimeType: string,
    authorize: () => Promise<void>
  ) {
    if (typeof owner !== 'string') {
      const blob = await this.projects.put({
        projectId: owner.projectId,
        actorId,
        bytes,
        mimeType,
        mimeIdentity: true,
      });
      return blob.key;
    }
    const key = `ai-file-${createHash('sha256').update(mimeType).digest('hex').slice(0, 16)}-${createHash('sha256').update(bytes).digest('base64url')}`;
    const existing = await this.models.blob.get(owner, key);
    if (!existing) {
      const check = await this.quota.getWorkspaceQuotaCalculator(owner);
      const exceeded = check(bytes.length);
      if (exceeded?.blobQuotaExceeded) throw new BlobQuotaExceeded();
      if (exceeded?.storageQuotaExceeded) throw new StorageQuotaExceeded();
    }
    await this.workspaces.putCopyAttachment(
      owner,
      key,
      bytes,
      { uploadId: key, contentType: mimeType, deferQuotaInvalidation: true },
      authorize
    );
    return key;
  }

  async get(owner: OfficeOwner, actorId: string, key: string) {
    if (typeof owner === 'string') return this.workspaces.get(owner, key);
    const { bytes, blob } = await this.projects.read({
      projectId: owner.projectId,
      actorId,
      key,
    });
    return {
      body: Readable.from(bytes),
      metadata: {
        contentType: blob.mimeType,
        contentLength: blob.byteSize,
        lastModified: blob.createdAt,
      },
    };
  }

  async put(
    owner: OfficeOwner,
    actorId: string,
    _key: string,
    bytes: Buffer,
    metadata: PutObjectMetadata
  ) {
    if (typeof owner === 'string') {
      return this.putGenerated(
        owner,
        actorId,
        bytes,
        metadata.contentType ?? 'application/octet-stream',
        async () => {
          await this.ac
            .user(actorId)
            .workspace(owner)
            .assert('Workspace.Blobs.Write');
        }
      );
    }
    const blob = await this.projects.put({
      projectId: owner.projectId,
      actorId,
      bytes,
      mimeType: metadata.contentType ?? 'application/octet-stream',
    });
    return blob.key;
  }
}
