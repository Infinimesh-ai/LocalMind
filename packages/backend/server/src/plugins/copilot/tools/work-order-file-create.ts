import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Models } from '../../../models';
import type { WorkOrderStorage } from '../work-order-storage';
import { NativeFileCreateToolSchema } from './file-create-input';
import { defineTool } from './tool';

export const WORK_ORDER_DELIVERY_POLICY = [
  'This is a private personal work-order conversation. It has no Workspace or Project resource scope, Memory, resource tree, or Office editing context.',
  'Use the frozen requirements and explicit question/answer exchanges supplied as reference data. Do not ask the recipient to repeat requirements already present there.',
  'A statement such as "nothing to deliver" does not waive a frozen required item. Distinguish having no supplementary material from being unable to provide the requested deliverable; clarify an ambiguous reply before choosing either path. If the recipient confirms they cannot provide it, explain how to enter the reason and confirm Refuse work order in the existing UI so the sender receives a refusal. Chat alone does not refuse the order, and you must not claim it has been refused before confirmation. Never generate a placeholder or no-content statement to satisfy file counts.',
  'For a requested file, use work_order_file_create with the exact frozen requirement_id and a supportedGenerationFormats value. Markdown requires content.format="md" and meaningful Markdown text addressing the frozen topic; TXT or DOCX is not a substitute.',
  'A queued or running file task is not a staged file. Use work_order_delivery_check to inspect its actual generation status. Do not submit duplicate generation attempts or repeatedly poll in the same turn; if still running, tell the recipient it is processing. If failed, report the failure and correct the input before a new attempt.',
  'Before saving a final text answer the recipient intends to return, call work_order_delivery_check and pass its draftVersion as expected_draft_version to work_order_delivery_text_set with the exact requirement_id. Retry a version conflict only after checking the latest draft with the recipient.',
  'A ready draft proves only the listed server checks, not semantic quality. Ask the recipient to review the content against the frozen instructions before confirming the delivery card. Chat text, staged files and readiness do not send the order. Only recipient confirmation creates an immutable delivery revision.',
].join('\n');

export function createWorkOrderFileTool(
  models: Models,
  storage: WorkOrderStorage,
  scope: { actorId: string; sessionId: string; workOrderId: string }
) {
  return {
    work_order_delivery_text_set: {
      ...defineTool({
        description:
          'After work_order_delivery_check, save the recipient-approved answer for one frozen text requirement to this private work-order delivery draft. Pass its current draft version to prevent overwriting newer user edits. This does not send the delivery.',
        inputSchema: z
          .object({
            requirement_id: z.string().trim().min(1).max(256),
            expected_draft_version: z.number().int().nonnegative(),
            text: z.string().trim().min(1).max(200_000),
          })
          .strict(),
        execute: async (
          { requirement_id, expected_draft_version, text },
          options
        ) => {
          options.signal?.throwIfAborted();
          const draft = await models.copilotWorkOrder.setDeliveryDraftItem({
            workOrderId: scope.workOrderId,
            actorId: scope.actorId,
            requirementId: requirement_id,
            expectedDraftVersion: expected_draft_version,
            text,
          });
          return {
            status: 'draft_saved',
            requirementId: requirement_id,
            draftVersion: draft.version,
            ready: draft.ready,
            checks: draft.checks,
            deliveryRequired: true,
          };
        },
      }),
      sideEffectType: 'work_order_write' as const,
    },
    work_order_delivery_check: {
      ...defineTool({
        description:
          'Check the private delivery draft against all frozen work-order requirements. Report missing items; a ready result only invites recipient confirmation in the UI and never sends the work order.',
        inputSchema: z.object({}).strict(),
        execute: async (_args, options) => {
          options.signal?.throwIfAborted();
          const [draft, order] = await Promise.all([
            storage.deliveryPreview(scope.workOrderId, scope.actorId),
            models.copilotWorkOrder.getOwned(scope.workOrderId, scope.actorId),
          ]);
          return {
            ready: draft.ready,
            checks: draft.checks,
            requirements: order.requirements.map(requirement => ({
              id: requirement.id,
              kind: requirement.kind,
              title: requirement.title,
              instructions: requirement.instructions,
              required: requirement.required,
              acceptedMimeTypes: requirement.acceptedMimeTypes,
              minCount: requirement.minCount,
              maxCount: requirement.maxCount,
            })),
            draftVersion: draft.version,
            confirmationRequired: true,
          };
        },
      }),
      sideEffectType: 'read' as const,
    },
    work_order_file_create: {
      ...defineTool({
        description:
          'Queue generation of a real private file for one frozen file requirement. Match its MIME type and requested topic: Markdown requires content.format="md", not "txt". Do not create no-content placeholders for required deliverables. A queued/running result is not successful staging; inspect work_order_delivery_check for the real outcome before reporting success. Only the recipient can confirm delivery. Use structured content and never claim unsupported formatting, formulas, tables or images.',
        inputSchema: NativeFileCreateToolSchema.extend({
          requirement_id: z.string().trim().min(1).max(256),
        }).strict(),
        execute: async ({ requirement_id, ...file }, options) => {
          if (!options.toolCallId || options.toolCallId.length > 512)
            throw new Error(
              'Work-order file generation requires a stable tool call identity'
            );
          options.signal?.throwIfAborted();
          if (file.parent_id)
            throw new Error(
              'Personal work-order drafts do not have a Project folder'
            );
          const requestKey = `agent-file:${createHash('sha256')
            .update(`${scope.sessionId}:${options.toolCallId}`)
            .digest('hex')}`;
          const run = await storage.queuePrivateFileGeneration({
            workOrderId: scope.workOrderId,
            actorId: scope.actorId,
            sessionId: scope.sessionId,
            requirementId: requirement_id,
            requestKey,
            title: `Generate ${file.title}`,
            file,
          });
          return {
            status: run.status,
            workOrderId: scope.workOrderId,
            sessionId: scope.sessionId,
            requirementId: requirement_id,
            runId: run.id,
            fileName: file.title,
            format: file.content.format,
            deliveryRequired: true,
          };
        },
      }),
      sideEffectType: 'work_order_write' as const,
    },
  };
}
