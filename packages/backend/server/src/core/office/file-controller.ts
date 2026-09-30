import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentUser, type CurrentUser as User } from '../auth';
import { WorkspaceNativeResourceService } from './workspace-resource-service';

@Controller('/api/workspaces')
export class WorkspaceFileController {
  constructor(private readonly resources: WorkspaceNativeResourceService) {}

  @Get('/:workspaceId/files')
  list(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Query('cursor') cursor?: string,
    @Query('query') query?: string,
    @Query('trash') trash?: string
  ) {
    return this.resources.list({
      workspaceId,
      actorId: user.id,
      cursor,
      query,
      trash: trash === 'true',
    });
  }

  @Get('/:workspaceId/files/:fileId/download')
  async download(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('fileId') fileId: string,
    @Res() response: Response,
    @Query('sequence') sequence?: string
  ) {
    const resource = await this.resources.read({
      workspaceId,
      actorId: user.id,
      resourceId: fileId,
      kind: 'file',
      sequence:
        sequence === undefined
          ? undefined
          : z.coerce.number().int().positive().parse(sequence),
    });
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Resource-Content-Version', resource.contentVersion);
    response.setHeader('Content-Length', resource.bytes.length);
    response
      .attachment(resource.fileName)
      .type(resource.mimeType)
      .send(resource.bytes);
  }
}
