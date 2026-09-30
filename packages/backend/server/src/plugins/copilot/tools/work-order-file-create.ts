import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Models } from '../../../models';
import type { WorkOrderStorage } from '../work-order-storage';
import { NativeFileCreateToolSchema } from './file-create-input';
import { defineTool } from './tool';

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
          const draft = await storage.deliveryPreview(
            scope.workOrderId,
            scope.actorId
          );
          return {
            ready: draft.ready,
            checks: draft.checks,
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
          'Generate a real private DOCX, XLSX, PPTX, TXT, Markdown, CSV or JSON file for one frozen file requirement. On successful staging it is linked to the private delivery draft, but is not delivered until the recipient confirms the in-conversation return card. Use structured content and never claim unsupported formatting, formulas, tables or images.',
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
