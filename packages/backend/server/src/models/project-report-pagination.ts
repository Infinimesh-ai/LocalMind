import { z } from 'zod';

import { BadRequest } from '../base';
import type { ReportActor } from './project-report';

export type ReportPageKind =
  | 'comments'
  | 'reviews'
  | 'exports'
  | 'shares'
  | 'templates'
  | 'schedules'
  | 'schedule_occurrences'
  | 'schedule_revisions';
export type ReportPageInput = ReportActor & { cursor?: string; limit?: number };
const cursorSchema = z
  .object({
    projectId: z.string(),
    reportId: z.string(),
    kind: z.enum([
      'comments',
      'reviews',
      'exports',
      'shares',
      'templates',
      'schedules',
      'schedule_occurrences',
      'schedule_revisions',
    ]),
    createdAt: z.string().datetime(),
    id: z.string(),
  })
  .strict();
export function reportPage(input: ReportPageInput, kind: ReportPageKind) {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 30);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (input.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString())
      );
    } catch {
      throw new BadRequest('Invalid report history cursor');
    }
    if (
      cursor.projectId !== input.projectId ||
      cursor.reportId !== input.reportId ||
      cursor.kind !== kind
    )
      throw new BadRequest('Report cursor belongs to another history');
  }
  const direction = kind === 'comments' ? ('asc' as const) : ('desc' as const);
  const compare = direction === 'asc' ? 'gt' : 'lt';
  return {
    limit,
    where: {
      projectId: input.projectId,
      reportId: input.reportId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { [compare]: new Date(cursor.createdAt) } },
              {
                createdAt: new Date(cursor.createdAt),
                id: { [compare]: cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: direction }, { id: direction }],
    finish<T extends { id: string; createdAt: Date }>(rows: T[]) {
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  projectId: input.projectId,
                  reportId: input.reportId,
                  kind,
                  createdAt: last.createdAt.toISOString(),
                  id: last.id,
                })
              ).toString('base64url')
            : null,
      };
    },
  };
}
