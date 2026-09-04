import { z } from 'zod';

import { type OfficeCommand, OfficeCommandSchema } from './command';

export const OFFICE_COMMAND_BATCH_MAX_COMMANDS = 64;
export const OFFICE_COMMAND_BATCH_MAX_BYTES = 32 * 1024 * 1024;

const boundedString = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);

export const OfficeCommandBatchSchema = z
  .object({
    version: z.literal('localmind-office-command-batch/v1'),
    batchId: boundedString(256),
    idempotencyKey: boundedString(256),
    source: z.enum(['user', 'ai', 'system']),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    commands: z
      .array(OfficeCommandSchema)
      .min(1)
      .max(OFFICE_COMMAND_BATCH_MAX_COMMANDS),
  })
  .strict()
  .superRefine((batch, refinement) => {
    const commandIds = new Set<string>();
    const commandIdempotencyKeys = new Set<string>();
    batch.commands.forEach((command, index) => {
      if (command.artifactId !== batch.artifactId) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commands', index, 'artifactId'],
          message: 'Batch command artifact must match the batch artifact',
        });
      }
      if (command.expectedRevisionId !== batch.expectedRevisionId) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commands', index, 'expectedRevisionId'],
          message:
            'Batch command expected revision must match the batch revision',
        });
      }
      if (command.source !== batch.source) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commands', index, 'source'],
          message: 'Batch command source must match the batch source',
        });
      }
      if (commandIds.has(command.commandId)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commands', index, 'commandId'],
          message: 'Batch command ids must be unique',
        });
      }
      commandIds.add(command.commandId);
      if (commandIdempotencyKeys.has(command.idempotencyKey)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commands', index, 'idempotencyKey'],
          message: 'Batch command idempotency keys must be unique',
        });
      }
      commandIdempotencyKeys.add(command.idempotencyKey);
    });

    const byteSize = new TextEncoder().encode(JSON.stringify(batch)).byteLength;
    if (byteSize > OFFICE_COMMAND_BATCH_MAX_BYTES) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Office command batch must not exceed ${OFFICE_COMMAND_BATCH_MAX_BYTES} bytes`,
      });
    }
  });

export type OfficeCommandOperation = OfficeCommand;
export type OfficeCommandBatch = z.infer<typeof OfficeCommandBatchSchema>;

export function parseOfficeCommandBatch(input: unknown): OfficeCommandBatch {
  return OfficeCommandBatchSchema.parse(input);
}
