import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Prisma } from '@prisma/client';

import { AccessDenied, BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import type { ReportActor } from './project-report';

@Injectable()
export class ProjectReportShareModel extends BaseModel {
  @Transactional()
  async save(
    input: ReportActor & {
      requestKey: string;
      fingerprint: string;
      shareId?: string;
      expectedShareVersion?: number;
      shareRevisionId: string;
      reportRevisionId: string;
      projectionBlobKey: string;
      audience: Prisma.InputJsonValue;
      accessMode: 'accounts' | 'link';
      recipientIds: string[];
      tokenHash: string;
      tokenCiphertext: string;
      passwordHash?: string;
      allowDownload: boolean;
      expiresAt: Date;
    }
  ) {
    await this.models.projectReport.lock(input);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'share.create',
    });
    if (prior)
      return prior.result as { shareId: string; shareRevisionId: string };
    const revision = await this.models.projectReport.revision({
      ...input,
      revisionId: input.reportRevisionId,
    });
    if (revision.kind !== 'final')
      throw new BadRequest('Only a finalized revision may be shared');
    let share = input.shareId
      ? await this.db.projectReportShare.findFirst({
          where: {
            id: input.shareId,
            projectId: input.projectId,
            reportId: input.reportId,
          },
        })
      : null;
    if (input.shareId && !share) throw new AccessDenied();
    if (share && share.version !== input.expectedShareVersion)
      throw new ResourceConflict('Share authorization changed');
    if (share?.status === 'revoked')
      throw new BadRequest(
        'Create a new authorization instead of restoring a revoked link'
      );
    if (!share)
      share = await this.db.projectReportShare.create({
        data: {
          projectId: input.projectId,
          reportId: input.reportId,
          actorId: input.actorId,
        },
      });
    const authorization = await this.db.projectReportShareRevision.create({
      data: {
        id: input.shareRevisionId,
        projectId: input.projectId,
        reportId: input.reportId,
        shareId: share.id,
        reportRevisionId: revision.id,
        sequence: share.revisionCounter + 1,
        projectionBlobKey: input.projectionBlobKey,
        audience: input.audience,
        accessMode: input.accessMode,
        recipientIds: input.recipientIds,
        tokenHash: input.tokenHash,
        tokenCiphertext: input.tokenCiphertext,
        passwordHash: input.passwordHash,
        allowDownload: input.allowDownload,
        expiresAt: input.expiresAt,
        actorId: input.actorId,
      },
    });
    await this.db.projectReportShare.update({
      where: { id: share.id },
      data: {
        currentRevisionId: authorization.id,
        revisionCounter: authorization.sequence,
        actorId: input.actorId,
        version: { increment: 1 },
      },
    });
    const result = { shareId: share.id, shareRevisionId: authorization.id };
    await this.models.projectReport.record({
      ...input,
      operation: 'share.create',
      result,
    });
    return result;
  }

  @Transactional()
  async revoke(
    input: ReportActor & {
      shareId: string;
      expectedShareVersion: number;
      requestKey: string;
      fingerprint: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, false, true);
    await this.db
      .$queryRaw`SELECT id FROM project_report_shares WHERE id=${input.shareId} AND project_id=${input.projectId} AND report_id=${input.reportId} FOR UPDATE`;
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'share.revoke',
    });
    if (prior) return prior.result;
    const changed = await this.db.projectReportShare.updateMany({
      where: {
        id: input.shareId,
        projectId: input.projectId,
        reportId: input.reportId,
        version: input.expectedShareVersion,
      },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new ResourceConflict('Share changed or is unavailable');
    const result = { shareId: input.shareId, status: 'revoked' };
    await this.models.projectReport.record({
      ...input,
      operation: 'share.revoke',
      result,
    });
    return result;
  }

  @Transactional()
  async authorize(input: {
    shareId: string;
    authorizationId?: string;
    actorId?: string;
    tokenHash?: string;
  }) {
    const share = await this.db.projectReportShare.findUnique({
      where: { id: input.shareId },
      include: {
        current: true,
        report: {
          include: { deletion: true, project: { select: { status: true } } },
        },
      },
    });
    const authorization = share?.current;
    if (
      !share ||
      !authorization ||
      share.status !== 'active' ||
      share.report.deletion ||
      share.report.lifecycle === 'trashed' ||
      !['active', 'archived'].includes(share.report.project.status) ||
      authorization.expiresAt <= new Date() ||
      (input.authorizationId && input.authorizationId !== authorization.id) ||
      (input.tokenHash && input.tokenHash !== authorization.tokenHash)
    )
      throw new AccessDenied('Report share is unavailable');
    await this.models.projectResource.assertMember(
      { projectId: share.projectId, actorId: authorization.actorId },
      false,
      true
    );
    if (
      authorization.accessMode === 'accounts' &&
      (!input.actorId || !authorization.recipientIds.includes(input.actorId))
    )
      throw new AccessDenied('Report share is unavailable');
    return { share, authorization };
  }
}
