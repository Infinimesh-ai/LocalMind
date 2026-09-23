import { createHash } from 'node:crypto';

import { type NativeFileCreateService } from '../../../core/office/create-service';
import { NativeFileCreateToolSchema } from './file-create-input';
import { defineTool } from './tool';
import type { CopilotChatOptions } from './types';

export function createWorkspaceFileTool(
  service: NativeFileCreateService,
  options: NonNullable<CopilotChatOptions>
) {
  return defineTool({
    description:
      'Create a real native DOCX, XLSX, PPTX, TXT, Markdown, CSV or JSON file at the current workspace root. Use structured content: DOCX paragraphs with optional heading levels, XLSX sheets containing typed rows (strings are literal text, not formulas), PPTX slides with a title and paragraphs. Use text for TXT/Markdown/JSON (valid JSON) and rows for CSV. Return the saved file receipt. To edit it afterwards, read it with workspace_office_read first. Never claim unsupported formatting, tables, formulas or images were generated. Do not use this tool for a different workspace or a named destination folder.',
    inputSchema: NativeFileCreateToolSchema,
    execute: async (file, execute) => {
      if (
        !options.user ||
        !options.workspace ||
        !options.session ||
        options.delegatedExecution ||
        options.taskId
      )
        throw new Error(
          'File creation requires a direct workspace conversation'
        );
      if (!execute.toolCallId || execute.toolCallId.length > 512)
        throw new Error('File creation requires a stable tool call identity');
      execute.signal?.throwIfAborted();
      return service.create({
        workspaceId: options.workspace,
        actorId: options.user,
        sessionId: options.session,
        requestKey: createHash('sha256')
          .update(
            JSON.stringify([options.billingUnitId ?? null, execute.toolCallId])
          )
          .digest('hex'),
        file,
      });
    },
  });
}
