import {
  reportAudienceAssetBindings,
  ReportAudienceSchema,
} from '@localmind/office/report';
import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AccessDenied, applyAttachHeaders, Throttle } from '../../base';
import { CurrentUser, type CurrentUser as User, Public } from '../auth';
import { ProjectBlobStorage } from '../project';
import { ProjectReportContentService } from './content';
import { ProjectReportExportService } from './export';
import { ProjectReportShareService } from './share';

function headers(response: Response) {
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'none'; sandbox");
}
const cookieName = (id: string) =>
  `lm_report_${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64)}`;
@Controller('/api/projects/:projectId/reports/:reportId')
export class ProjectReportController {
  constructor(
    private readonly exports: ProjectReportExportService,
    private readonly content: ProjectReportContentService,
    private readonly blobs: ProjectBlobStorage
  ) {}
  @Get('/exports/:exportId')
  async download(
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
    @Param('reportId') reportId: string,
    @Param('exportId') exportId: string,
    @Res() response: Response
  ) {
    const result = await this.exports.download({
      projectId,
      reportId,
      actorId: user.id,
      exportId,
    });
    headers(response);
    applyAttachHeaders(response, {
      contentType: result.blob.mimeType,
      filename: `Report.${result.format === 'offline' ? 'zip' : result.format}`,
    });
    response.send(result.bytes);
  }
  @Get('/revisions/:revisionId/assets/:assetId')
  async asset(
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
    @Param('reportId') reportId: string,
    @Param('revisionId') revisionId: string,
    @Param('assetId') assetId: string,
    @Res() response: Response
  ) {
    const input = { projectId, reportId, revisionId, actorId: user.id };
    const { document } = await this.content.read(input);
    const audience = {
      kind: 'external' as const,
      chapterIds: document.chapters
        .filter(chapter => !chapter.hidden)
        .map(chapter => chapter.id),
      includeSources: false,
      includeNotes: false,
    };
    const binding = reportAudienceAssetBindings(document, audience).find(
      item => item.publicId === assetId
    );
    // The editor uses source asset IDs; audience windows use remapped IDs.
    const asset =
      binding?.asset ?? document.assets.find(item => item.id === assetId);
    if (!asset) throw new AccessDenied('Report image is unavailable');
    const stored = await this.blobs.read({
      ...input,
      key: asset.blobKey,
      allowArchivedRead: true,
    });
    headers(response);
    response.setHeader('content-type', stored.blob.mimeType);
    response.send(stored.bytes);
  }
}

@Controller('/api/report-shares/:shareId')
export class ProjectReportShareController {
  constructor(
    private readonly shares: ProjectReportShareService,
    private readonly exports: ProjectReportExportService
  ) {}
  private context(shareId: string, user: User | undefined, request: Request) {
    return {
      shareId,
      actorId: user?.id,
      cookie: request.cookies?.[cookieName(shareId)] as string | undefined,
    };
  }
  @Public()
  @Post()
  @Throttle('strict')
  async open(
    @CurrentUser() user: User | undefined,
    @Param('shareId') shareId: string,
    @Body() raw: unknown,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const body = z
      .object({
        token: z.string().min(1).max(2048),
        password: z.string().max(256).optional(),
      })
      .strict()
      .parse(raw);
    const session = await this.shares.open({
      shareId,
      actorId: user?.id,
      ...body,
    });
    response.cookie(cookieName(shareId), session.cookie, {
      httpOnly: true,
      secure: request.secure,
      sameSite: 'strict',
      path: `/api/report-shares/${encodeURIComponent(shareId)}`,
      expires: new Date(session.expiresAt),
    });
    headers(response);
    response.json(
      await this.shares.read({
        shareId,
        actorId: user?.id,
        cookie: session.cookie,
      })
    );
  }
  @Public()
  @Get()
  @Throttle('default', { bucket: 'report-share-read' })
  async read(
    @CurrentUser() user: User | undefined,
    @Param('shareId') shareId: string,
    @Req() request: Request,
    @Res() response: Response
  ) {
    headers(response);
    response.json(await this.shares.read(this.context(shareId, user, request)));
  }
  @Public()
  @Get('/assets/:assetId')
  @Throttle('default', {
    bucket: 'report-share-assets',
    limit: 600,
    ttl: 60000,
  })
  async asset(
    @CurrentUser() user: User | undefined,
    @Param('shareId') shareId: string,
    @Param('assetId') assetId: string,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const result = await this.shares.asset({
      ...this.context(shareId, user, request),
      assetId,
    });
    headers(response);
    response.setHeader('content-type', result.blob.mimeType);
    response.send(result.bytes);
  }
  @Public()
  @Get('/downloads/:format')
  @Throttle('strict')
  async download(
    @CurrentUser() user: User | undefined,
    @Param('shareId') shareId: string,
    @Param('format') rawFormat: string,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const input = this.context(shareId, user, request);
    const { share, authorization } = await this.shares.authorized(input);
    if (!authorization.allowDownload)
      throw new AccessDenied('Download is unavailable');
    const format = z.enum(['pdf', 'pptx', 'offline']).parse(rawFormat);
    const rendered = await this.exports.render({
      projectId: share.projectId,
      reportId: share.reportId,
      actorId: authorization.actorId,
      revisionId: authorization.reportRevisionId,
      audience: ReportAudienceSchema.parse(authorization.audience),
      format,
    });
    await this.shares.authorized(input);
    headers(response);
    applyAttachHeaders(response, {
      contentType: rendered.mimeType,
      filename: `Report.${rendered.extension}`,
    });
    response.send(Buffer.from(rendered.bytes));
  }
}
