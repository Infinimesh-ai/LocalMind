import { z } from 'zod';

const boundedString = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);

export const PROJECT_REPORT_AI_CONTEXT_VERSION =
  'localmind-project-report-ai-context/v1' as const;

export const ProjectReportAiContextSchema = z
  .object({
    version: z.literal(PROJECT_REPORT_AI_CONTEXT_VERSION),
    projectId: boundedString(512),
    reportId: boundedString(512),
    revisionId: boundedString(512),
    reportVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    chapterIds: z.array(boundedString(512)).max(200).default([]),
    nodeIds: z.array(boundedString(512)).max(500).default([]),
  })
  .strict();

export type ProjectReportAiContext = z.infer<
  typeof ProjectReportAiContextSchema
>;
export type ProjectReportAiContextInput = z.input<
  typeof ProjectReportAiContextSchema
>;

export function parseProjectReportAiContext(
  input: unknown
): ProjectReportAiContext {
  return ProjectReportAiContextSchema.parse(input);
}
