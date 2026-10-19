import {
  ReportAudienceSchema,
  ReportSelectionSchema,
} from '@localmind/office/report';
import { z } from 'zod';

const id = z.string().trim().min(1).max(512);
export const ReportScheduleConfigSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    templateRevisionId: id,
    selection: ReportSelectionSchema,
    timeZone: z
      .string()
      .min(1)
      .max(128)
      .refine(value => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid time zone'),
    frequency: z.enum(['weekly', 'monthly']),
    day: z.number().int().min(1).max(31),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    period: z.enum(['previous_week', 'previous_month']),
    autoFinalize: z.boolean(),
    delivery: z
      .object({
        enabled: z.boolean(),
        channel: z.enum(['notification', 'email']),
        recipients: z.array(id).max(100),
        includeAttachment: z.boolean(),
        expiresDays: z.number().int().min(1).max(90),
        audience: ReportAudienceSchema,
      })
      .strict(),
  })
  .strict()
  .refine(
    v => v.frequency !== 'weekly' || v.day <= 7,
    'Weekly day must be between 1 and 7'
  )
  .refine(
    v => !v.delivery.enabled || v.autoFinalize,
    'Delivery requires automatic finalization'
  )
  .refine(
    v => !v.delivery.enabled || v.delivery.recipients.length > 0,
    'Delivery requires recipients'
  );
export type ReportScheduleConfig = z.infer<typeof ReportScheduleConfigSchema>;
export const ReportOccurrenceSnapshotSchema = z
  .object({
    config: ReportScheduleConfigSchema,
    authorization: z
      .object({
        actorId: id,
        memberIds: z.array(id).max(100),
        emailRecipients: z.array(z.string().email()).max(100),
      })
      .strict(),
    period: z
      .object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        timeZone: z.string(),
      })
      .strict(),
  })
  .strict();
export type ReportOccurrenceSnapshot = z.infer<
  typeof ReportOccurrenceSnapshotSchema
>;
export const REPORT_MAIL_AUTHORIZER = Symbol.for(
  'localmind.report-mail-authorizer'
);
export interface ReportMailAuthorizer {
  authorizeMailDelivery(
    deliveryId: string,
    recipient: string
  ): Promise<{
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>;
  }>;
}
