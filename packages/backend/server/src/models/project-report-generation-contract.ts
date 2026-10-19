import {
  type ReportDocument,
  ReportSelectionSchema,
  ReportSourceSchema,
} from '@localmind/office/report';
import { z } from 'zod';

export const PROJECT_REPORT_WORKFLOW = 'agent_runtime_project_report_v1';
export const REPORT_PHASES = [
  'discover',
  'capture',
  'extract',
  'reconcile',
  'compose',
  'layout',
  'validate',
  'persist',
] as const;
export type ReportPhase = (typeof REPORT_PHASES)[number];
const identity = z.string().min(1).max(256);
export const ReportGenerationCommandSchema = z
  .object({
    version: z.literal(1),
    reportId: identity,
    baselineRevisionId: identity,
    expectedVersion: z.number().int().positive(),
    operation: z.enum(['create', 'refresh', 'rewrite']),
    selection: ReportSelectionSchema,
    instruction: z.string().max(10000),
    cutoffAt: z.string().datetime(),
    scope: z
      .object({
        chapterIds: z.array(identity).max(60).optional(),
        nodeIds: z.array(identity).max(2000).optional(),
      })
      .strict(),
  })
  .strict();
export type ReportGenerationCommand = z.infer<
  typeof ReportGenerationCommandSchema
>;
export const CapturedReportResourceSchema = z
  .object({
    source: ReportSourceSchema,
    sequence: z.number().int().positive().optional(),
    artifactId: identity.optional(),
    blobKey: identity.optional(),
    changedInPeriod: z.boolean(),
    historicalGap: z.boolean(),
  })
  .strict();
export const ReportCaptureSchema = z
  .object({
    resources: z.array(CapturedReportResourceSchema).max(10000),
    discovered: z.number().int().nonnegative(),
    enumerationComplete: z.boolean(),
    omittedReportExports: z.number().int().nonnegative(),
  })
  .strict();
export type ReportCapture = z.infer<typeof ReportCaptureSchema>;
export type CapturedReportResource = z.infer<
  typeof CapturedReportResourceSchema
>;
export const ReportTextSnapshotSchema = z
  .object({
    source: ReportSourceSchema,
    text: z.string().max(1000000),
    changedInPeriod: z.boolean(),
    historicalGap: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export type ReportTextSnapshot = z.infer<typeof ReportTextSnapshotSchema>;
export const ReportExtractedFactSchema = z
  .object({
    sourceId: identity,
    quote: z.string().min(1).max(2000),
    statement: z.string().min(1).max(3000),
    kind: z.enum([
      'progress',
      'achievement',
      'risk',
      'plan',
      'goal',
      'decision',
      'background',
    ]),
    state: z.enum([
      'planned',
      'in_progress',
      'completed',
      'blocked',
      'unknown',
    ]),
    owner: z
      .object({
        label: z.string().min(1).max(256),
        quote: z.string().min(1).max(1000),
      })
      .strict()
      .nullish(),
  })
  .strict();
export type ReportExtractedFact = z.infer<typeof ReportExtractedFactSchema>;
export const ReportExtractionSchema = z
  .object({ facts: z.array(ReportExtractedFactSchema).max(80) })
  .strict();
export const ReportCompositionSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            id: identity,
            items: z
              .array(
                z
                  .object({
                    factIds: z.array(identity).min(1).max(20),
                    text: z.string().min(1).max(4000),
                    suggestion: z.boolean(),
                  })
                  .strict()
              )
              .max(80),
            notes: z.string().max(8000),
          })
          .strict()
      )
      .max(60),
  })
  .strict();
export const ReportCheckpointSchema = z
  .object({
    blobKey: identity,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();

/** Participant-visible work-order metadata used as report business state. */
export type ReportWorkOrderEvidence = {
  id: string;
  title: string;
  role: 'sender' | 'recipient';
  status: string;
  version: number;
  requirementTitles: string[];
  delivery: {
    revision: number;
    submittedAt: string;
    itemCount: number;
  } | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: string;
  fingerprint: string;
};

const WORK_ORDER_STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  open: { zh: '进行中', en: 'in progress' },
  validating: { zh: '交付校验中', en: 'validating delivery' },
  waiting_sender: { zh: '等待发单人处理', en: 'waiting for the sender' },
  delivered: { zh: '已交付完成', en: 'delivered (completed)' },
  refused: { zh: '已拒绝（未完成）', en: 'refused (not completed)' },
  cancelled: { zh: '已取消（未完成）', en: 'cancelled (not completed)' },
};

/** Deterministic, metadata-only work-order text. Never include delivery bodies. */
export function workOrderEvidenceText(
  order: ReportWorkOrderEvidence,
  language: ReportDocument['language'] = 'zh-Hans'
) {
  const en = language === 'en';
  const label = WORK_ORDER_STATUS_LABELS[order.status];
  const status = label ? (en ? label.en : label.zh) : order.status;
  const title = order.title.replace(/\s+/g, ' ').trim();
  const requirements = order.requirementTitles
    .map(item => item.replace(/\s+/g, ' ').trim())
    .join(en ? '; ' : '；');
  const lines = en
    ? [
        `Work order "${title}" status: ${status}.`,
        `Work order version: ${order.version}.`,
        ...(requirements ? [`Required items: ${requirements}.`] : []),
        ...(order.delivery
          ? [
              `Latest delivery revision ${order.delivery.revision} submitted at ${order.delivery.submittedAt} with ${order.delivery.itemCount} delivered items.`,
            ]
          : []),
        ...(order.completedAt ? [`Completed at ${order.completedAt}.`] : []),
        `Last updated at ${order.updatedAt}.`,
      ]
    : [
        `工单「${title}」当前状态：${status}。`,
        `工单版本：${order.version}。`,
        ...(requirements ? [`必需要求：${requirements}。`] : []),
        ...(order.delivery
          ? [
              `最新交付为第 ${order.delivery.revision} 版，提交于 ${order.delivery.submittedAt}，交付项 ${order.delivery.itemCount} 个。`,
            ]
          : []),
        ...(order.completedAt ? [`完成时间：${order.completedAt}。`] : []),
        `最后更新：${order.updatedAt}。`,
      ];
  return lines.join('\n');
}
