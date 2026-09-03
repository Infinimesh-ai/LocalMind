import { z } from 'zod';

import { toolError } from './error';
import { defineTool } from './tool';

const TASK_ATTACHMENT_CHUNK_LENGTH = 8_000;

export type TaskAttachmentContext = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  contentFingerprint: string;
  extractedText?: string;
  extractedTextTruncated?: boolean;
  suppliedToModel?: boolean;
};

export function createTaskAttachmentReadTool(
  attachments: readonly TaskAttachmentContext[]
) {
  const byId = new Map(
    attachments.map(attachment => [attachment.attachmentId, attachment])
  );

  return defineTool({
    description:
      'Read bounded extracted text from an attachment persisted on the current delegated task. Use attachment_id values from the task context; this tool cannot access other blobs or chat-session attachments.',
    inputSchema: z
      .object({
        attachment_id: z.string().trim().min(1).max(256),
        chunk: z.number().int().min(0).default(0),
      })
      .strict(),
    execute: ({ attachment_id, chunk }) => {
      const attachment = byId.get(attachment_id);
      if (!attachment) {
        return toolError(
          'Task Attachment Read Failed',
          `Attachment ${attachment_id} is not bound to the current task.`
        );
      }
      if (!attachment.extractedText) {
        return {
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          contentFingerprint: attachment.contentFingerprint,
          content: null,
          suppliedToModel: attachment.suppliedToModel === true,
          message: attachment.suppliedToModel
            ? 'This attachment was supplied directly to the model and has no extracted text.'
            : 'This attachment has no readable extracted text.',
        };
      }

      const start = chunk * TASK_ATTACHMENT_CHUNK_LENGTH;
      if (start >= attachment.extractedText.length) {
        return toolError(
          'Task Attachment Read Failed',
          `Attachment ${attachment_id} does not have chunk ${chunk}.`
        );
      }
      const content = attachment.extractedText.slice(
        start,
        start + TASK_ATTACHMENT_CHUNK_LENGTH
      );
      return {
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        contentFingerprint: attachment.contentFingerprint,
        chunk,
        content,
        hasMore: start + content.length < attachment.extractedText.length,
        extractedTextTruncated: attachment.extractedTextTruncated === true,
      };
    },
  });
}
