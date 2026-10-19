import type { ReportScheduleConfig } from './project-report-schedule-contract';

type LocalTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};
const stamp = (v: LocalTime) =>
  Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute);
const formatters = new Map<string, Intl.DateTimeFormat>();
export function reportLocalTime(date: Date, timeZone: string): LocalTime {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(p => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
/** Ambiguous wall times run once at their earlier instant; gaps advance by the DST gap. */
export function reportLocalInstant(local: LocalTime, timeZone: string): Date {
  const nominal = stamp(local);
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map(hours => {
      const instant = nominal + hours * 3600000;
      return stamp(reportLocalTime(new Date(instant), timeZone)) - instant;
    })
  );
  const candidates = [...offsets]
    .map(offset => new Date(nominal - offset))
    .sort((a, b) => +a - +b);
  const exact = candidates.find(
    date => stamp(reportLocalTime(date, timeZone)) === nominal
  );
  if (exact) return exact;
  const after = candidates
    .filter(date => stamp(reportLocalTime(date, timeZone)) > nominal)
    .sort(
      (a, b) =>
        stamp(reportLocalTime(a, timeZone)) -
        stamp(reportLocalTime(b, timeZone))
    );
  if (!after[0]) throw new Error('REPORT_INVALID_LOCAL_TIME');
  return after[0];
}
export function reportScheduleNext(config: ReportScheduleConfig, after: Date) {
  const current = reportLocalTime(after, config.timeZone);
  const [hour, minute] = config.time.split(':').map(Number);
  for (let offset = 0; offset < 400; offset++) {
    const day = new Date(
      Date.UTC(current.year, current.month - 1, current.day + offset)
    );
    const year = day.getUTCFullYear(),
      month = day.getUTCMonth() + 1,
      date = day.getUTCDate();
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      config.frequency === 'weekly'
        ? (day.getUTCDay() || 7) !== config.day
        : date !== Math.min(config.day, last)
    )
      continue;
    const local = { year, month, day: date, hour, minute };
    const instant = reportLocalInstant(local, config.timeZone);
    if (instant > after)
      return {
        instant,
        nominal: `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}T${config.time}`,
      };
  }
  throw new Error('REPORT_SCHEDULE_DATE_UNAVAILABLE');
}
export function reportSchedulePeriod(
  config: ReportScheduleConfig,
  scheduledAt: Date
) {
  const local = reportLocalTime(scheduledAt, config.timeZone);
  let end = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let start: Date;
  if (config.period === 'previous_month') {
    end = new Date(Date.UTC(local.year, local.month - 1, 1));
    start = new Date(Date.UTC(local.year, local.month - 2, 1));
  } else {
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
    start = new Date(+end - 7 * 86400000);
  }
  const convert = (date: Date) =>
    reportLocalInstant(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      config.timeZone
    ).toISOString();
  return {
    start: convert(start),
    end: convert(end),
    timeZone: config.timeZone,
  };
}
