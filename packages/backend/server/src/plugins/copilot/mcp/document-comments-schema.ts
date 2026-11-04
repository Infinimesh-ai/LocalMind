import { z } from 'zod';

import {
  documentId,
  documentTextRun,
  documentTextTarget,
} from '../../../core/doc/document-schema';
import {
  OfficeCommentContentSchema,
  OfficeCommentReplyContentSchema,
} from '../../../core/office/comment-service';

export const documentCommentAnchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document') }).strict(),
  z.object({ kind: z.literal('block'), blockId: documentId }).strict(),
  z
    .object({
      kind: z.literal('element'),
      surfaceId: documentId,
      elementId: documentId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('text'),
      target: documentTextTarget,
      offset: z.number().int().nonnegative(),
      length: z.number().int().positive(),
    })
    .strict(),
]);
export const documentCommentContent = z
  .object({
    version: z.literal('localmind-blocksuite-comment/v1'),
    paragraphs: z.array(z.array(documentTextRun).max(1000)).min(1).max(100),
  })
  .strict()
  .refine(
    value =>
      value.paragraphs.some(paragraph =>
        paragraph.some(run => run.insert.trim().length)
      ),
    'Comment text is empty'
  );
const content = z.union([documentCommentContent, OfficeCommentContentSchema]);
const replyContent = z.union([
  documentCommentContent,
  OfficeCommentReplyContentSchema,
]);
const op = { opId: documentId };
export const documentCommentCommands = z
  .array(
    z.discriminatedUnion('type', [
      z
        .object({
          ...op,
          type: z.literal('comment.create'),
          clientRef: documentId,
          content,
          anchor: documentCommentAnchor.optional(),
          mentions: z.array(documentId).max(100).default([]),
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('comment.update'),
          commentId: documentId,
          content,
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('comment.resolve'),
          commentId: documentId,
          resolved: z.boolean(),
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('comment.delete'),
          commentId: documentId,
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('comment.anchor.set'),
          commentId: documentId,
          anchor: documentCommentAnchor,
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('reply.create'),
          commentId: documentId,
          clientRef: documentId,
          content: replyContent,
          mentions: z.array(documentId).max(100).default([]),
        })
        .strict(),
      z
        .object({
          ...op,
          type: z.literal('reply.update'),
          replyId: documentId,
          content: replyContent,
        })
        .strict(),
      z
        .object({ ...op, type: z.literal('reply.delete'), replyId: documentId })
        .strict(),
    ])
  )
  .min(1)
  .max(100);
