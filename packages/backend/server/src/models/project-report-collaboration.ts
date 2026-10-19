import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import type { ReportActor } from './project-report';
import { reportPage, type ReportPageInput } from './project-report-pagination';

type Mutation = ReportActor & { requestKey: string; fingerprint: string };
const text = z.string().trim().min(1).max(20000);
const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class ProjectReportCollaborationModel extends BaseModel {
  @Transactional()
  async state(input: ReportActor) {
    await this.models.projectReport.get(input);
    const [comments, reviews, lease] = await Promise.all([
      this.comments(input),
      this.reviews(input),
      this.db.projectReportEditLease.findUnique({
        where: { reportId: input.reportId },
      }),
    ]);
    return {
      comments: comments.items,
      reviews: reviews.items,
      nextCursors: {
        comments: comments.nextCursor,
        reviews: reviews.nextCursor,
      },
      lease: lease
        ? {
            holderId: lease.holderId,
            tabId: lease.tabId,
            kind: lease.kind,
            taskId: lease.taskId,
            expiresAt: lease.expiresAt,
          }
        : null,
    };
  }
  @Transactional()
  async comments(input: ReportPageInput) {
    await this.models.projectReport.get(input);
    const page = reportPage(input, 'comments');
    return page.finish(
      await this.db.projectReportComment.findMany({
        where: page.where,
        orderBy: page.orderBy,
        take: page.limit + 1,
      })
    );
  }
  @Transactional()
  async reviews(input: ReportPageInput) {
    await this.models.projectReport.get(input);
    const page = reportPage(input, 'reviews');
    return page.finish(
      await this.db.projectReportReview.findMany({
        where: page.where,
        orderBy: page.orderBy,
        take: page.limit + 1,
      })
    );
  }

  @Transactional()
  async addComment(
    input: Mutation & {
      revisionId: string;
      chapterId?: string;
      nodeId?: string;
      anchorText: string;
      parentId?: string;
      content: string;
    }
  ) {
    await this.models.projectReport.lock(input);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'comment.add',
    });
    if (prior) return prior.result;
    await this.models.projectReport.revision(input);
    if (
      input.parentId &&
      !(await this.db.projectReportComment.findFirst({
        where: {
          id: input.parentId,
          reportId: input.reportId,
          projectId: input.projectId,
          revisionId: input.revisionId,
        },
      }))
    )
      throw new BadRequest('Comment parent is unavailable');
    const row = await this.db.projectReportComment.create({
      data: {
        projectId: input.projectId,
        reportId: input.reportId,
        revisionId: input.revisionId,
        chapterId: input.chapterId,
        nodeId: input.nodeId,
        anchorText: z.string().max(2000).parse(input.anchorText),
        parentId: input.parentId,
        actorId: input.actorId,
        content: text.parse(input.content),
      },
    });
    await this.models.projectReport.record({
      ...input,
      operation: 'comment.add',
      result: asJson(row),
    });
    return row;
  }

  @Transactional()
  async resolveComment(
    input: Mutation & {
      commentId: string;
      expectedVersion: number;
      resolved: boolean;
    }
  ) {
    await this.models.projectReport.lock(input);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'comment.resolve',
    });
    if (prior) return prior.result;
    const changed = await this.db.projectReportComment.updateMany({
      where: {
        id: input.commentId,
        reportId: input.reportId,
        projectId: input.projectId,
        version: input.expectedVersion,
      },
      data: {
        resolvedAt: input.resolved ? new Date() : null,
        resolvedBy: input.resolved ? input.actorId : null,
        version: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new ResourceConflict('Comment changed or is unavailable');
    const result = {
      commentId: input.commentId,
      resolved: input.resolved,
      version: input.expectedVersion + 1,
    };
    await this.models.projectReport.record({
      ...input,
      operation: 'comment.resolve',
      result,
    });
    return result;
  }

  @Transactional()
  async requestReview(
    input: Mutation & { revisionId: string; reviewerIds: string[] }
  ) {
    await this.models.projectReport.lock(input);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'review.request',
    });
    if (prior) return prior.result;
    await this.models.projectReport.revision(input);
    const ids = [
      ...new Set(
        z.array(z.string().min(1)).min(1).max(50).parse(input.reviewerIds)
      ),
    ];
    for (const actorId of ids)
      await this.models.projectResource.assertMember({ ...input, actorId });
    const reviews = [];
    for (const reviewerId of ids)
      reviews.push(
        await this.db.projectReportReview.create({
          data: {
            projectId: input.projectId,
            reportId: input.reportId,
            revisionId: input.revisionId,
            requestedBy: input.actorId,
            reviewerId,
          },
        })
      );
    for (const review of reviews)
      await this.models.notification.reportChanged({
        id: `report-review:${review.id}`,
        userId: review.reviewerId,
        actorId: input.actorId,
        projectId: input.projectId,
        reportId: input.reportId,
        revisionId: input.revisionId,
        status: 'review_requested',
        title: 'Report review requested',
        url: `/projects/${input.projectId}/reports/${input.reportId}?revisionId=${input.revisionId}`,
      });
    await this.models.projectReport.record({
      ...input,
      operation: 'review.request',
      result: asJson({ reviews }),
    });
    return { reviews };
  }

  @Transactional()
  async respondReview(
    input: Mutation & {
      reviewId: string;
      expectedVersion: number;
      status: 'approved' | 'changes_requested';
      note: string;
    }
  ) {
    await this.models.projectReport.lock(input);
    const prior = await this.models.projectReport.findRequest({
      ...input,
      operation: 'review.respond',
    });
    if (prior) return prior.result;
    const row = await this.db.projectReportReview.findFirst({
      where: {
        id: input.reviewId,
        projectId: input.projectId,
        reportId: input.reportId,
      },
    });
    if (!row || row.reviewerId !== input.actorId)
      throw new AccessDenied('Only the assigned reviewer can respond');
    const changed = await this.db.projectReportReview.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: 'pending' },
      data: {
        status: input.status,
        note: z.string().max(20000).parse(input.note),
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (!changed.count) throw new ResourceConflict('Review changed');
    const result = {
      reviewId: row.id,
      status: input.status,
      version: input.expectedVersion + 1,
    };
    await this.models.projectReport.record({
      ...input,
      operation: 'review.respond',
      result,
    });
    return result;
  }
}
