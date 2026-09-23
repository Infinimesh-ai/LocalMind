import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  applyAttachHeaders,
  BadRequest,
  readBufferWithLimit,
} from '../../base';
import { CurrentUser, type CurrentUser as User } from '../../core/auth';
import {
  WORK_ORDER_BLOB_MAX_BYTES,
  WorkOrderStorage,
} from './work-order-storage';

@Controller('/api/copilot/work-orders')
export class WorkOrderController {
  constructor(private readonly storage: WorkOrderStorage) {}

  @Post('/:workOrderId/files')
  async stage(
    @CurrentUser() user: User,
    @Param('workOrderId') workOrderId: string,
    @Query('fileName') fileName: string,
    @Query('requirementId') requirementId: string,
    @Query('requestKey') requestKey: string,
    @Req() request: Request
  ) {
    const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim();
    if (!mimeType) throw new BadRequest('A file MIME type is required');
    const bytes = await readBufferWithLimit(request, WORK_ORDER_BLOB_MAX_BYTES);
    return this.storage.stage({
      workOrderId,
      actorId: user.id,
      requirementId,
      requestKey,
      fileName,
      mimeType,
      bytes,
    });
  }

  @Get('/:workOrderId/files/:blobId')
  async download(
    @CurrentUser() user: User,
    @Param('workOrderId') workOrderId: string,
    @Param('blobId') blobId: string,
    @Res() response: Response
  ) {
    const { blob, bytes } = await this.storage.read({
      workOrderId,
      blobId,
      actorId: user.id,
    });
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; sandbox"
    );
    applyAttachHeaders(response, {
      contentType: blob.mimeType,
      filename: blob.fileName,
    });
    response.send(bytes);
  }
}
