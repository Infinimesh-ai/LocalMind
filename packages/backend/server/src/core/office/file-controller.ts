import { createHash } from 'node:crypto';

import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { readBufferWithLimit } from '../../base';
import { Models } from '../../models';
import { CurrentUser, type CurrentUser as User } from '../auth';
import { PermissionAccess } from '../permission';
import { WorkspaceBlobStorage } from '../storage';

@Controller('/api/workspaces')
export class WorkspaceFileController {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly blobs: WorkspaceBlobStorage
  ) {}

  @Get('/:workspaceId/files')
  async list(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Query('cursor') cursor?: string
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Blobs.Read');
    if (cursor && cursor.length > 1024) throw new Error('Invalid file cursor');
    const after = cursor
      ? z
          .object({
            file: z.string().max(128).nullable(),
            office: z.string().max(128).nullable(),
          })
          .strict()
          .parse(JSON.parse(cursor))
      : undefined;
    const [records, office] = await Promise.all([
      after?.file === null
        ? []
        : this.models.workspaceFile.list(workspaceId, after?.file),
      after?.office === null
        ? []
        : this.models.officeArtifact.listFilePage(workspaceId, after?.office),
    ]);
    const next = {
      file: records.length > 100 ? records[99].id : null,
      office: office.length > 100 ? office[99].id : null,
    };
    return {
      items: [
        ...office.slice(0, 100).map(file => ({
          id: file.id,
          fileName: file.sourceFileName,
          mimeType: file.sourceMimeType,
          byteSize: file.sourceByteSize,
          createdAt: file.createdAt,
          kind: 'office',
        })),
        ...records.slice(0, 100).map(file => ({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          createdAt: file.createdAt,
          kind: 'file',
        })),
      ],
      nextCursor: next.file || next.office ? JSON.stringify(next) : null,
    };
  }

  @Get('/:workspaceId/files/:fileId/download')
  async download(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('fileId') fileId: string,
    @Res() response: Response
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Blobs.Read');
    const file = await this.models.workspaceFile.get(workspaceId, fileId);
    const stored = await this.blobs.get(workspaceId, file.blobKey);
    if (!stored.body) throw new Error('File content is unavailable');
    const bytes = await readBufferWithLimit(stored.body, 4 * 1024 * 1024);
    if (
      bytes.length !== file.byteSize ||
      createHash('sha256').update(bytes).digest('hex') !== file.fingerprint
    )
      throw new Error('File content does not match its saved fingerprint');
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Blobs.Read');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.attachment(file.fileName).type(file.mimeType).send(bytes);
  }
}
