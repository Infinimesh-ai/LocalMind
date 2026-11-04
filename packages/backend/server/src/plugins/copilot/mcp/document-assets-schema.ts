import { z } from 'zod';

const id = z.string().min(1).max(256);
export const documentUploadCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('begin'),
      mimeType: z
        .string()
        .max(256)
        .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
      totalBytes: z
        .number()
        .int()
        .min(0)
        .max(32 * 1024 * 1024),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('part'),
      uploadId: id,
      number: z.number().int().min(0).max(63),
      base64: z
        .string()
        .min(4)
        .max(699052)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
        ),
    })
    .strict(),
  z.object({ action: z.literal('commit'), uploadId: id }).strict(),
  z.object({ action: z.literal('status'), uploadId: id }).strict(),
  z.object({ action: z.literal('abort'), uploadId: id }).strict(),
]);
export const documentUploadResult = z
  .object({
    uploadId: id,
    status: z.enum(['pending', 'completed', 'aborted']),
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    mimeType: z.string(),
    fingerprint: z.string(),
    partBytes: z.literal(524288),
    receivedParts: z.array(z.number().int().nonnegative()).max(64),
    blobId: id.optional(),
  })
  .strict();
