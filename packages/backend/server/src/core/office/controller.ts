import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { applyAttachHeaders, CallMetric } from '../../base';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth';
import { OfficeArtifactService } from './artifact-service';

@Controller('/api/workspaces')
export class OfficeController {
  constructor(private readonly artifacts: OfficeArtifactService) {}

  @Get(
    '/:workspaceId/office/artifacts/:artifactId/revisions/:revisionId/package'
  )
  @CallMetric('controllers', 'office_revision_package_get')
  async package(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Res() response: Response
  ) {
    const asset = await this.artifacts.readRevisionAsset(
      workspaceId,
      user.id,
      artifactId,
      revisionId,
      'package'
    );
    response.setHeader('content-type', asset.revision.packageMimeType);
    response.setHeader('content-length', asset.bytes.byteLength);
    response.setHeader('last-modified', asset.revision.createdAt.toUTCString());
    response.setHeader('etag', `"${asset.revision.packageFingerprint}"`);
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    applyAttachHeaders(response, {
      contentType: asset.revision.packageMimeType,
      filename: asset.artifact.sourceFileName,
    });
    response.send(asset.bytes);
  }

  @Get('/:workspaceId/office/artifacts/:artifactId/revisions/:revisionId/state')
  @CallMetric('controllers', 'office_revision_state_get')
  async state(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Res() response: Response
  ) {
    const asset = await this.artifacts.readRevisionAsset(
      workspaceId,
      user.id,
      artifactId,
      revisionId,
      'state'
    );
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('content-length', asset.bytes.byteLength);
    response.setHeader('last-modified', asset.revision.createdAt.toUTCString());
    response.setHeader('etag', `"${asset.revision.stateFingerprint}"`);
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    response.send(asset.bytes);
  }

  @Get('/:workspaceId/office/artifacts/:artifactId/revisions/:revisionId/part')
  @CallMetric('controllers', 'office_revision_part_get')
  async part(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Query('path') partName: string,
    @Res() response: Response
  ) {
    const part = await this.artifacts.readRevisionPackagePart(
      workspaceId,
      user.id,
      artifactId,
      revisionId,
      partName
    );
    response.setHeader('content-type', part.mimeType);
    response.setHeader('content-length', part.bytes.byteLength);
    response.setHeader('last-modified', part.revision.createdAt.toUTCString());
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    response.setHeader('x-content-type-options', 'nosniff');
    response.send(part.bytes);
  }

  @Get(
    '/:workspaceId/office/artifacts/:artifactId/revisions/:revisionId/export/pdf'
  )
  @CallMetric('controllers', 'office_revision_pdf_export_get')
  async exportPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('artifactId') artifactId: string,
    @Param('revisionId') revisionId: string,
    @Res() response: Response
  ) {
    const asset = await this.artifacts.exportDocumentRevisionPdf(
      workspaceId,
      user.id,
      artifactId,
      revisionId
    );
    response.setHeader('content-type', asset.mimeType);
    response.setHeader('content-length', asset.bytes.byteLength);
    response.setHeader('last-modified', asset.revision.createdAt.toUTCString());
    response.setHeader('etag', `"${asset.fingerprint}"`);
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    applyAttachHeaders(response, {
      contentType: asset.mimeType,
      filename: `${asset.artifact.title || 'document'}.pdf`,
    });
    response.send(asset.bytes);
  }
}
