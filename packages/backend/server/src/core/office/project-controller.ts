import { officeDownloadFileName } from '@localmind/office';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { BadRequest } from '../../base';
import { CurrentUser, type CurrentUser as User } from '../auth';
import { OfficeArtifactService } from './artifact-service';

@Controller(
  '/api/projects/:projectId/office/artifacts/:artifactId/revisions/:revisionId'
)
export class ProjectOfficeController {
  constructor(private readonly artifacts: OfficeArtifactService) {}

  @Get('/:asset')
  async asset(
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Param('asset') kind: string,
    @Query('path') partName: string,
    @Res() response: Response
  ) {
    if (kind !== 'package' && kind !== 'state' && kind !== 'part')
      throw new BadRequest('Unknown Office asset');
    const asset =
      kind === 'part'
        ? await this.artifacts.readRevisionPackagePart(
            { projectId },
            user.id,
            artifactId,
            revisionId,
            partName
          )
        : await this.artifacts.readRevisionAsset(
            { projectId },
            user.id,
            artifactId,
            revisionId,
            kind
          );
    response.setHeader(
      'content-type',
      kind === 'state'
        ? 'application/json; charset=utf-8'
        : (asset.mimeType ?? 'application/octet-stream')
    );
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; sandbox"
    );
    if (kind === 'package')
      response
        .attachment(
          officeDownloadFileName(asset.artifact.title, asset.artifact.kind)
        )
        .type(asset.revision.packageMimeType);
    response.send(asset.bytes);
  }

  @Get('/export/pdf')
  async exportPdf(
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Res() response: Response
  ) {
    const asset = await this.artifacts.exportDocumentRevisionPdf(
      { projectId },
      user.id,
      artifactId,
      revisionId
    );
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response
      .attachment(officeDownloadFileName(asset.artifact.title, 'pdf'))
      .type(asset.mimeType);
    response.send(asset.bytes);
  }
}
