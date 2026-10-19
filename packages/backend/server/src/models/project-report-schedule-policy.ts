import type { ReportScheduleConfig } from './project-report-schedule-contract';

/** Delivery authority can only shrink from the configuration frozen with the occurrence. */
export function reportDeliveryIntersection(
  frozen: ReportScheduleConfig,
  current: ReportScheduleConfig
): ReportScheduleConfig['delivery'] | null {
  const before = frozen.delivery,
    after = current.delivery;
  if (!before.enabled || !after.enabled || before.channel !== after.channel)
    return null;
  const recipients = before.recipients.filter(recipient =>
    after.recipients.includes(recipient)
  );
  const chapters = before.audience.chapterIds.filter(id =>
    after.audience.chapterIds.includes(id)
  );
  if (!recipients.length || !chapters.length) return null;
  return {
    ...before,
    recipients,
    expiresDays: Math.min(before.expiresDays, after.expiresDays),
    includeAttachment: before.includeAttachment && after.includeAttachment,
    audience: {
      kind: 'external',
      chapterIds: chapters,
      includeNotes: false,
      includeSources:
        before.audience.includeSources && after.audience.includeSources,
    },
  };
}
