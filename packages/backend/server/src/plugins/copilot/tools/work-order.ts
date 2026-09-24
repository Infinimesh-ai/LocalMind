import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { Models } from '../../../models';
import { defineTool } from './tool';

const requirementSchema = z
  .object({
    kind: z.enum(['text', 'file']),
    title: z.string().trim().min(1).max(256),
    instructions: z.string().trim().min(1).max(20_000),
    required: z.boolean().default(true),
    accepted_mime_types: z
      .array(z.string().trim().min(1).max(256))
      .max(32)
      .default([]),
    min_count: z.number().int().min(0).max(32).default(1),
    max_count: z.number().int().min(1).max(32).default(1),
  })
  .superRefine((value, context) => {
    if (value.max_count < value.min_count) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_count must be at least min_count',
      });
    }
    if (value.kind === 'file' && !value.accepted_mime_types.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File requirements need exact supported MIME types',
      });
    }
  });

const recipientDraftSchema = z.object({
  recipient_exact: z.string().trim().min(1).max(320),
  title: z.string().trim().min(1).max(256),
  purpose: z.string().trim().min(1).max(20_000),
  relation_kind: z
    .enum(['original', 'supplement', 'replacement'])
    .default('original'),
  related_work_order_id: z.string().trim().min(1).max(256).optional(),
  requirements: z.array(requirementSchema).min(1).max(32),
});

export const WORK_ORDER_DRAFT_POLICY = [
  'For a personal work order, first call work_order_recipient_resolve with an exact LocalMind account ID or email. Never enumerate or guess accounts.',
  'Then call work_order_draft once with every recipient and concrete, verifiable text/file requirement for this proposal. Do not repeat an identical draft call. Use exact supported MIME types; use PPTX rather than legacy PPT. A draft is only a proposal for the sender to review and explicitly confirm in the UI.',
  'Summarize a successful proposal once. Do not list internal draft IDs or describe duplicate tool executions to the user.',
  'Never claim that a work order, notification, or recipient session exists after drafting. The draft tool has no recipient-visible effect. Do not use project_file_request_create as a substitute for a personal work order.',
].join('\n');

function draftIdForTurn(turnId: string | null | undefined, content: unknown) {
  if (!turnId) return randomUUID();
  const bytes = createHash('sha256')
    .update(JSON.stringify({ turnId, content }))
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createWorkOrderDraftTools(
  models: Models,
  scope: { actorId: string; sourceSessionId: string; turnId?: string | null }
) {
  return {
    work_order_recipient_resolve: {
      ...defineTool({
        description:
          'Resolve one exact active LocalMind account by full email or account ID for a personal work-order draft. This does not search or enumerate users and has no recipient-visible effect.',
        inputSchema: z
          .object({ exact: z.string().trim().min(1).max(320) })
          .strict(),
        execute: async ({ exact }) =>
          models.copilotWorkOrder.resolveRecipient({
            actorId: scope.actorId,
            exact,
          }),
      }),
      sideEffectType: 'read' as const,
    },
    work_order_draft: {
      ...defineTool({
        description:
          'Produce a structured personal work-order draft for sender review. Every recipient must have been resolved by exact ID or email. This does not send, notify, create a recipient session, or confirm anything.',
        inputSchema: z
          .object({ recipients: z.array(recipientDraftSchema).min(1).max(20) })
          .strict(),
        execute: async ({ recipients }) => {
          const resolved = await Promise.all(
            recipients.map(async draft => ({
              recipient: await models.copilotWorkOrder.resolveRecipient({
                actorId: scope.actorId,
                exact: draft.recipient_exact,
              }),
              title: draft.title,
              purpose: draft.purpose,
              relationKind: draft.relation_kind,
              relatedWorkOrderId: draft.related_work_order_id ?? null,
              requirements: draft.requirements.map(item => ({
                kind: item.kind,
                title: item.title,
                instructions: item.instructions,
                required: item.required,
                acceptedMimeTypes: item.accepted_mime_types,
                minCount: item.min_count,
                maxCount: item.max_count,
              })),
            }))
          );
          return {
            kind: 'work_order_draft',
            draftId: draftIdForTurn(scope.turnId, {
              actorId: scope.actorId,
              sourceSessionId: scope.sourceSessionId,
              recipients: resolved,
            }),
            sourceSessionId: scope.sourceSessionId,
            origin: 'ai_generated',
            confirmationRequired: true,
            recipients: resolved,
          };
        },
      }),
      sideEffectType: 'read' as const,
    },
  };
}
