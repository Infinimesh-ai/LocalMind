import { getOrCreateI18n } from '@affine/i18n';

import { isToolError } from '../ai-tools/tool-result-utils';

export const PROJECT_REPORT_TOOL_NAMES = new Set([
  'project_report_list',
  'project_report_read',
  'project_report_rewrite',
  'project_report_refresh',
]);

export function isProjectReportToolName(name: string) {
  return PROJECT_REPORT_TOOL_NAMES.has(name);
}

export type ProjectReportToolResultView =
  | { status: 'error'; name: string }
  | {
      status: 'success';
      kind: 'read' | 'request';
      name: string;
      results: Array<{ title: string; content: string }>;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 512) {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, maximum)
    : null;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function projectReportToolResultView(
  toolName: string,
  result: unknown,
  isError = false
): ProjectReportToolResultView {
  const t = getOrCreateI18n().t;
  const read =
    toolName === 'project_report_list' || toolName === 'project_report_read';
  const failed = () => ({
    status: 'error' as const,
    name: read
      ? t('com.affine.localmind.report-tool.readFailed')
      : t('com.affine.localmind.report-tool.requestFailed'),
  });
  const value = record(result);
  if (isError || !value || isToolError(result)) return failed();

  if (toolName === 'project_report_list') {
    const reports = Array.isArray(value.reports) ? value.reports : null;
    if (!reports) return failed();
    return {
      status: 'success',
      kind: 'read',
      name: t('com.affine.localmind.report-tool.list', {
        count: reports.length,
      }),
      results: reports.flatMap(item => {
        const report = record(item);
        const title = text(report?.title);
        return title
          ? [{ title, content: text(report?.status, 64) ?? '' }]
          : [];
      }),
    };
  }

  if (toolName === 'project_report_read') {
    const title = text(value.title);
    const chapters = Array.isArray(value.chapters) ? value.chapters : null;
    if (!title || !chapters) return failed();
    return {
      status: 'success',
      kind: 'read',
      name: t('com.affine.localmind.report-tool.read', {
        title,
        count: chapters.length,
      }),
      results: chapters.flatMap(item => {
        const chapter = record(item);
        const chapterTitle = text(chapter?.title);
        return chapterTitle ? [{ title: chapterTitle, content: '' }] : [];
      }),
    };
  }

  if (value.status !== 'queued') return failed();
  const scope = record(value.scope);
  const scopeLabel =
    scope?.wholeReport === true
      ? t('com.affine.localmind.report-tool.wholeReport')
      : strings(scope?.chapterTitles).join('、') ||
        [...strings(scope?.chapterIds), ...strings(scope?.nodeIds)].join(', ');
  const runStatus = text(value.runStatus, 64);
  return {
    status: 'success',
    kind: 'request',
    name:
      toolName === 'project_report_refresh'
        ? t('com.affine.localmind.report-tool.refreshQueued')
        : t('com.affine.localmind.report-tool.rewriteQueued'),
    results: [
      {
        title: t('com.affine.localmind.report-tool.scope', {
          scope: scopeLabel,
        }),
        content: [
          t('com.affine.localmind.report-tool.review'),
          runStatus
            ? t('com.affine.localmind.report-tool.runStatus', {
                status: runStatus,
              })
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
    ],
  };
}
