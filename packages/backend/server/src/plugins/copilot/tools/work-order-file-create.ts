import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { WorkOrderStorage } from '../work-order-storage';
import { NativeFileCreateToolSchema } from './file-create-input';
import { defineTool } from './tool';

export function createWorkOrderFileTool(
  storage: WorkOrderStorage,
  scope: { actorId: string; sessionId: string; workOrderId: string }
) {
  return {
    work_order_file_create: {
      ...defineTool({
        description:
          'Generate a real private DOCX, XLSX, PPTX, TXT, Markdown, CSV or JSON delivery draft for one frozen file requirement. The result is staged only in this personal work order. It is not delivered until the user explicitly submits the work-order form. Use structured content and never claim unsupported formatting, formulas, tables or images.',
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
