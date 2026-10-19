import {
  ReportAudienceSchema,
  ReportDocumentSchema,
  ReportResponsibilitySchema,
  ReportSelectionSchema,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { z } from 'zod';

import { ReportScheduleConfigSchema } from '../../models/project-report-schedule-contract';

const id = z.string().trim().min(1).max(512);
const version = z.number().int().positive();
export const ReportLeaseSchema = z
  .object({ tabId: id, leaseId: id, kind: z.literal('user').optional() })
  .strict();
export {
  type ReportScheduleConfig,
  ReportScheduleConfigSchema,
} from '../../models/project-report-schedule-contract';
export const ReportCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      title: z.string().trim().min(1).max(512),
      period: ReportDocumentSchema.innerType().shape.period,
      templateRevisionId: id,
      selection: ReportSelectionSchema,
      responsibility: ReportResponsibilitySchema.optional(),
      audience: z.enum(['management', 'customer', 'team']).optional(),
      language: z.enum(['zh-Hans', 'zh-Hant', 'en']).optional(),
      durationMinutes: z.number().min(1).max(180).optional(),
      instructions: z.string().max(10000).optional(),
      generate: z.boolean(),
      previousReportId: id.optional(),
      previousRevisionId: id.optional(),
      duplicateRevisionId: id.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('save'),
      document: ReportDocumentSchema,
      reason: z.string().max(512).optional(),
      kind: z.enum(['draft', 'preview']).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('finalize'),
      document: ReportDocumentSchema,
    })
    .strict(),
  z.object({ operation: z.literal('restore'), revisionId: id }).strict(),
  z
    .object({
      operation: z.literal('lifecycle'),
      lifecycle: z.enum(['active', 'archived', 'trashed']),
    })
    .strict(),
  z.object({ operation: z.literal('permanentlyDelete') }).strict(),
  z.object({ operation: z.literal('lease.acquire'), tabId: id }).strict(),
  z
    .object({ operation: z.literal('lease.renew'), tabId: id, leaseId: id })
    .strict(),
  z
    .object({ operation: z.literal('lease.release'), tabId: id, leaseId: id })
    .strict(),
  z
    .object({
      operation: z.literal('template.save'),
      templateId: id.optional(),
      expectedVersion: version.optional(),
      content: ReportTemplateSchema,
      status: z.enum(['active', 'archived']).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('comment.add'),
      revisionId: id,
      body: z.string().trim().min(1).max(20000),
      chapterId: id.optional(),
      nodeId: id.optional(),
      parentId: id.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('comment.resolve'),
      commentId: id,
      resolved: z.boolean(),
      expectedCommentVersion: version,
    })
    .strict(),
  z
    .object({
      operation: z.literal('review.request'),
      revisionId: id,
      reviewerIds: z.array(id).min(1).max(50),
    })
    .strict(),
  z
    .object({
      operation: z.literal('review.respond'),
      reviewId: id,
      status: z.enum(['approved', 'changes_requested']),
      note: z.string().max(20000),
      expectedReviewVersion: version,
    })
    .strict(),
  z
    .object({
      operation: z.literal('generate'),
      mode: z.enum(['create', 'refresh', 'rewrite']),
      selection: ReportSelectionSchema.optional(),
      revisionId: id,
      instructions: z.string().max(10000),
      chapterIds: z.array(id).max(60).optional(),
      nodeIds: z.array(id).max(2000).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('generation.cancel'), runId: id }).strict(),
  z.object({ operation: z.literal('generation.retry'), runId: id }).strict(),
  z
    .object({
      operation: z.literal('candidate.apply'),
      candidateId: id,
      choices: z.record(z.enum(['current', 'candidate'])),
    })
    .strict(),
  z
    .object({
      operation: z.literal('export'),
      revisionId: id,
      format: z.enum(['pdf', 'pptx', 'offline']),
      audience: ReportAudienceSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('export.save'),
      exportId: id,
      parentId: id.optional(),
      resourceId: id.optional(),
      expectedResourceVersion: version.optional(),
      expectedParentRevisionId: id.optional(),
      resourceEditLease: z
        .object({ tabId: id, leaseId: id, kind: z.literal('user').optional() })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('share.create'),
      revisionId: id,
      audience: ReportAudienceSchema,
      mode: z.enum(['accounts', 'link']),
      accountIds: z.array(id).max(100),
      accountEmails: z.array(z.string().email().max(254)).max(100).optional(),
      password: z.string().min(8).max(256).optional(),
      expiresAt: z.string().datetime().optional(),
      allowDownload: z.boolean(),
      shareId: id.optional(),
      expectedShareVersion: version.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('share.revoke'),
      shareId: id,
      expectedShareVersion: version,
    })
    .strict(),
  z
    .object({
      operation: z.literal('schedule.save'),
      scheduleId: id.optional(),
      expectedScheduleVersion: version.optional(),
      config: ReportScheduleConfigSchema,
      rebind: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('schedule.pause'),
      scheduleId: id,
      paused: z.boolean(),
      expectedScheduleVersion: version,
    })
    .strict(),
  z
    .object({
      operation: z.literal('schedule.remove'),
      scheduleId: id,
      expectedScheduleVersion: version,
    })
    .strict(),
  z
    .object({
      operation: z.literal('schedule.delivery.resolve'),
      deliveryId: id,
      expectedDeliveryVersion: version,
      result: z.enum(['sent', 'not_sent']),
      note: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('schedule.run'),
      scheduleId: id,
      expectedScheduleVersion: version,
      periodStart: z.string().datetime().optional(),
      periodEnd: z.string().datetime().optional(),
    })
    .strict(),
]);
export const ReportCommandInputSchema = z
  .object({
    projectId: id,
    reportId: id.optional(),
    requestKey: z.string().trim().min(1).max(256),
    expectedVersion: version.optional(),
    editLease: ReportLeaseSchema.optional(),
    command: ReportCommandSchema,
  })
  .strict();
export type ReportCommand = z.infer<typeof ReportCommandSchema>;
export type ReportCommandInput = z.infer<typeof ReportCommandInputSchema>;
export const ReportQuerySchema = z
  .object({
    projectId: id,
    reportId: id.optional(),
    scheduleId: id.optional(),
    revisionId: id.optional(),
    view: z
      .enum([
        'list',
        'list_results',
        'list_options',
        'detail',
        'templates',
        'schedules',
        'schedule_occurrences',
        'schedule_revisions',
        'history',
        'comments',
        'reviews',
        'exports',
        'shares',
        'presentation',
      ])
      .optional(),
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    search: z.string().max(128).optional(),
    lifecycle: z.enum(['active', 'archived', 'trashed']).optional(),
  })
  .strict();
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
