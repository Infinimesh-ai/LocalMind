import {
  Controller,
  Header,
  HttpException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { CallMetric, Throttle } from '../../base';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth';
import { PermissionAccess } from '../permission';
import { DocumentOcrError } from './error';
import { DocumentOcrService } from './service';

function contentTypeOf(req: Request) {
  return (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

async function readBoundedBody(req: Request, limit: number) {
  const contentLength = req.header('content-length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new DocumentOcrError(
        'OCR_INVALID_IMAGE',
        'The OCR page image has an invalid content length.',
        400
      );
    }
    if (parsed > limit) {
      throw new DocumentOcrError(
        'OCR_IMAGE_TOO_LARGE',
        'The OCR page image exceeds the configured upload limit.',
        413
      );
    }
  }

  const parsedBody =
    (req as Request & { rawBody?: Buffer }).rawBody ?? req.body;
  if (Buffer.isBuffer(parsedBody)) {
    if (parsedBody.length > limit) {
      throw new DocumentOcrError(
        'OCR_IMAGE_TOO_LARGE',
        'The OCR page image exceeds the configured upload limit.',
        413
      );
    }
    return parsedBody;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new DocumentOcrError(
        'OCR_IMAGE_TOO_LARGE',
        'The OCR page image exceeds the configured upload limit.',
        413
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

@Controller('/api/workspaces')
export class DocumentOcrController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly service: DocumentOcrService
  ) {}

  @Post('/:workspaceId/document-ocr')
  @Header('Cache-Control', 'no-store')
  @Throttle('default', { limit: 120, ttl: 60_000 })
  @CallMetric('controllers', 'workspace_document_ocr')
  async parsePage(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.CreateDoc');

    try {
      const content = await readBoundedBody(req, this.service.maxUploadBytes);
      return await this.service.parsePage({
        content,
        contentType: contentTypeOf(req),
      });
    } catch (error) {
      if (!(error instanceof DocumentOcrError)) throw error;
      throw new HttpException(
        {
          statusCode: error.status,
          code: error.code,
          type: error.code,
          name: error.code,
          message: error.message,
        },
        error.status
      );
    }
  }
}
