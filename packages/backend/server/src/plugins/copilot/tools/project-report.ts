import { createHash } from 'node:crypto';

import type { ProjectReportAiContext } from '@localmind/office';
import { type ReportDocument, reportNodeText } from '@localmind/office/report';
import { z } from 'zod';

import { BadRequest } from '../../../base';
import type { Models } from '../../../models';
import type { CopilotChatOptions } from '../providers/types';
import {
  type CopilotToolExecuteOptions,
  type CopilotToolSet,
  defineTool,
} from './tool';

export const PROJECT_REPORT_READ_TOOL_NAMES = [
  'project_report_list',
  'project_report_read',
] as const;
export const PROJECT_REPORT_WRITE_TOOL_NAMES = [
  'project_report_rewrite',
  'project_report_refresh',
] as const;
export const PROJECT_REPORT_TOOL_NAMES = [
  ...PROJECT_REPORT_READ_TOOL_NAMES,
  ...PROJECT_REPORT_WRITE_TOOL_NAMES,
] as const;

const REPORT_LIST_LIMIT = 20;
const NODE_SUMMARY_CHARACTERS = 160;
const MAX_OUTLINE_NODES = 400;

type ReportActor = { projectId: string; actorId: string; reportId: string };

type ReportListItem = {
  id: string;
  title: string;
  lifecycle: string;
  version: number;
  updatedAt: Date | string;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  draftRevisionId?: string | null;
  latestFinalRevisionId?: string | null;
};

type ReportRead = {
  report: {
    id: string;
    title: string;
    lifecycle: string;
    version: number;
    updatedAt?: Date | string;
  };
  revision: { id: string; sequence: number; kind: string };
  document: ReportDocument;
};

type ReportTask = {
  runId: string;
  status: string;
  failureCode?: string | null;
  candidateRevisionId?: string;
  phases?: { key: string; status: string }[];
};

/**
 * Narrow facade over the Project report domain. All calls must enforce
 * Project membership and the report feature flag themselves; the tool layer
 * only adds conversation binding and bounded AI-facing projections.
 */
export type ProjectReportToolBackend = {
  enabled: () => boolean;
  list: (input: {
    projectId: string;
    actorId: string;
    limit: number;
    search?: string;
  }) => Promise<{ items: ReportListItem[] }>;
  read: (input: ReportActor) => Promise<ReportRead>;
  task: (input: ReportActor) => Promise<ReportTask | null>;
  generate: (input: {
    projectId: string;
    actorId: string;
    reportId: string;
    requestKey: string;
    expectedVersion: number;
    command: {
      operation: 'generate';
      mode: 'refresh' | 'rewrite';
      revisionId: string;
      instructions: string;
      chapterIds?: string[];
      nodeIds?: string[];
    };
  }) => Promise<unknown>;
};

const iso = (value: Date | string | undefined) =>
  value instanceof Date ? value.toISOString() : value;

const truncate = (value: string, max: number) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
};

export function summarizeProjectReport(
  read: ReportRead,
  task: ReportTask | null
) {
  let remaining = MAX_OUTLINE_NODES;
  const chapters = read.document.chapters.map(chapter => {
    const nodes = chapter.nodes.slice(0, Math.max(0, remaining));
    remaining -= nodes.length;
    return {
      id: chapter.id,
      title: chapter.title,
      hidden: chapter.hidden,
      locked: chapter.locked,
      nodeCount: chapter.nodes.length,
      nodes: nodes.map(node => ({
        id: node.id,
        type: node.type,
        text: truncate(reportNodeText(node), NODE_SUMMARY_CHARACTERS),
      })),
      nodesTruncated: nodes.length < chapter.nodes.length,
    };
  });
  const countBy = <T extends string>(values: T[]) =>
    values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
  return {
    reportId: read.report.id,
    title: read.report.title,
    lifecycle: read.report.lifecycle,
    reportVersion: read.report.version,
    revision: {
      id: read.revision.id,
      sequence: read.revision.sequence,
      kind: read.revision.kind,
    },
    period: read.document.period,
    audience: read.document.audience,
    language: read.document.language,
    chapterCount: chapters.length,
    chapters,
    sources: {
      count: read.document.sources.length,
      kinds: countBy(read.document.sources.map(source => source.kind)),
      statuses: countBy(read.document.sources.map(source => source.status)),
      cutoffAt: read.document.cutoffAt,
    },
    openIssues: read.document.issues.length,
    generation: task
      ? {
          runId: task.runId,
          status: task.status,
          failureCode: task.failureCode ?? null,
          runningPhase:
            task.phases?.find(phase => phase.status === 'running')?.key ?? null,
          candidateReady:
            task.status === 'completed' && !!task.candidateRevisionId,
        }
      : null,
  };
}

const id = z.string().trim().min(1).max(256);

export function createProjectReportTools(
  models: Models,
  backend: ProjectReportToolBackend,
  options: NonNullable<CopilotChatOptions>,
  projectId: string,
  reportContext?: ProjectReportAiContext
): CopilotToolSet {
  if (
    !options.user ||
    !options.session ||
    options.workspace ||
    options.taskId ||
    options.delegatedExecution
  ) {
    throw new BadRequest(
      'Project report tools require an owned Project conversation.'
    );
  }
  if (reportContext && reportContext.projectId !== projectId) {
    throw new BadRequest('Report context belongs to another Project.');
  }
  const scope = {
    projectId,
    actorId: options.user,
    sourceSessionId: options.session,
    origin: 'ai' as const,
  };
  const actor = (reportId: string) => ({
    projectId,
    actorId: scope.actorId,
    reportId,
  });
  const authorize = async () => {
    const session = await models.copilotSession.getMeta(scope.sourceSessionId);
    if (
      !session ||
      session.userId !== scope.actorId ||
      session.workspaceId ||
      session.docId ||
      session.selectedContextProjectId !== projectId
    ) {
      throw new BadRequest('Project conversation authorization changed.');
    }
    await models.projectResource.assertMember(scope);
  };
  const requestKey = (execute: CopilotToolExecuteOptions) => {
    execute.signal?.throwIfAborted();
    if (!execute.toolCallId || execute.toolCallId.length > 512) {
      throw new BadRequest('Report requests require a stable tool call ID.');
    }
    return createHash('sha256')
      .update(
        JSON.stringify([
          scope.sourceSessionId,
          options.billingUnitId ?? null,
          execute.toolCallId,
        ])
      )
      .digest('hex');
  };
  const resolveReportId = (requested?: string) => {
    const reportId = requested ?? reportContext?.reportId;
    if (!reportId)
      throw new BadRequest(
        'Choose a report: call project_report_list and pass report_id.'
      );
    return reportId;
  };
  const resolveWritableReportId = (requested?: string) => {
    const reportId = resolveReportId(requested);
    if (!reportContext || reportId !== reportContext.reportId)
      throw new BadRequest(
        'AI report changes are limited to the report open in the editor.'
      );
    return reportId;
  };
  const queue = async (
    execute: CopilotToolExecuteOptions,
    input: {
      reportId: string;
      mode: 'refresh' | 'rewrite';
      instruction: string;
      chapterIds?: string[];
      nodeIds?: string[];
    }
  ) => {
    if (!backend.enabled())
      throw new BadRequest('Project report operations are disabled.');
    const key = requestKey(execute);
    const current = await backend.read(actor(input.reportId));
    if (current.report.lifecycle !== 'active')
      throw new BadRequest('Only active reports can be regenerated.');
    const chapterById = new Map(
      current.document.chapters.map(chapter => [chapter.id, chapter])
    );
    const chapterByNodeId = new Map(
      current.document.chapters.flatMap(chapter =>
        chapter.nodes.map(node => [node.id, chapter] as const)
      )
    );
    const touched = new Map<string, ReportDocument['chapters'][number]>();
    for (const chapterId of input.chapterIds ?? []) {
      const chapter = chapterById.get(chapterId);
      if (!chapter)
        throw new BadRequest(`Report chapter ${chapterId} is unavailable.`);
      touched.set(chapter.id, chapter);
    }
    for (const nodeId of input.nodeIds ?? []) {
      const chapter = chapterByNodeId.get(nodeId);
      if (!chapter)
        throw new BadRequest(`Report node ${nodeId} is unavailable.`);
      touched.set(chapter.id, chapter);
    }
    const locked = [...touched.values()].filter(chapter => chapter.locked);
    if (locked.length)
      throw new BadRequest(
        `Locked chapters cannot be rewritten: ${locked.map(chapter => chapter.title).join(', ')}.`
      );
    const result = (await backend.generate({
      ...actor(input.reportId),
      requestKey: key,
      expectedVersion: current.report.version,
      command: {
        operation: 'generate',
        mode: input.mode,
        revisionId: current.revision.id,
        instructions: input.instruction,
        ...(input.mode === 'rewrite'
          ? { chapterIds: input.chapterIds, nodeIds: input.nodeIds }
          : {}),
      },
    })) as { runId?: string; status?: string } | undefined;
    return {
      status: 'queued' as const,
      applied: false,
      reportId: current.report.id,
      title: current.report.title,
      mode: input.mode,
      baseRevisionId: current.revision.id,
      runId: result?.runId ?? null,
      runStatus: result?.status ?? null,
      scope:
        input.mode === 'rewrite'
          ? {
              chapterIds: input.chapterIds ?? [],
              nodeIds: input.nodeIds ?? [],
              chapterTitles: [...touched.values()].map(
                chapter => chapter.title
              ),
            }
          : { wholeReport: true },
      review:
        'A candidate revision is being generated. The user must review and apply it in the report canvas; nothing has been changed yet.',
    };
  };

  const tools: CopilotToolSet = {
    project_report_list: defineTool({
      sideEffectType: 'read',
      description:
        'List project reports in the current Project (newest first, at most 20). Returns report IDs, titles, lifecycle, version and update time. Use project_report_read for content.',
      inputSchema: z
        .object({
          search: z.string().trim().max(128).optional(),
          limit: z.number().int().min(1).max(REPORT_LIST_LIMIT).optional(),
        })
        .strict(),
      execute: async ({ search, limit }) => {
        await authorize();
        const result = await backend.list({
          projectId,
          actorId: scope.actorId,
          limit: limit ?? REPORT_LIST_LIMIT,
          ...(search ? { search } : {}),
        });
        return {
          projectId,
          reports: result.items.slice(0, REPORT_LIST_LIMIT).map(item => ({
            reportId: item.id,
            title: item.title,
            status: item.lifecycle,
            version: item.version,
            updatedAt: iso(item.updatedAt),
            periodStart: iso(item.periodStart),
            periodEnd: iso(item.periodEnd),
            hasFinalRevision: !!item.latestFinalRevisionId,
            open: item.id === reportContext?.reportId,
          })),
        };
      },
    }),
    project_report_read: defineTool({
      sideEffectType: 'read',
      description:
        'Read the outline of a project report: chapters (id, title, hidden, locked), nodes (id, type, truncated text), source summary, current revision/version and the latest generation run. report_id defaults to the report open in the editor. Read before proposing changes.',
      inputSchema: z.object({ report_id: id.optional() }).strict(),
      execute: async ({ report_id }) => {
        await authorize();
        const reportId = resolveReportId(report_id);
        const read = await backend.read(actor(reportId));
        const task = await backend.task(actor(reportId)).catch(() => null);
        return {
          ...summarizeProjectReport(read, task),
          selection:
            reportContext && reportContext.reportId === reportId
              ? {
                  chapterIds: reportContext.chapterIds,
                  nodeIds: reportContext.nodeIds,
                  staleRevision: reportContext.revisionId !== read.revision.id,
                }
              : null,
        };
      },
    }),
  };
  if (!reportContext) return tools;
  return {
    ...tools,
    project_report_rewrite: defineTool({
      sideEffectType: 'project_write',
      description:
        'Queue an AI rewrite of selected chapters/nodes of the report open in the editor. chapter_ids/node_ids default to the user selection. Produces a candidate revision for the user to review in the report canvas; it does not change the report. Facts must come from Project sources.',
      inputSchema: z
        .object({
          report_id: id.optional(),
          chapter_ids: z.array(id).max(60).optional(),
          node_ids: z.array(id).max(2000).optional(),
          instruction: z.string().trim().min(1).max(10000),
        })
        .strict(),
      execute: async (
        { report_id, chapter_ids, node_ids, instruction },
        execute
      ) => {
        await authorize();
        const reportId = resolveWritableReportId(report_id);
        const explicit = !!chapter_ids?.length || !!node_ids?.length;
        const chapterIds = explicit
          ? (chapter_ids ?? [])
          : reportContext.chapterIds;
        const nodeIds = explicit ? (node_ids ?? []) : reportContext.nodeIds;
        if (!chapterIds.length && !nodeIds.length)
          throw new BadRequest(
            'Select report chapters or nodes to rewrite, or use project_report_refresh for the whole report.'
          );
        return queue(execute, {
          reportId,
          mode: 'rewrite',
          instruction,
          chapterIds,
          nodeIds,
        });
      },
    }),
    project_report_refresh: defineTool({
      sideEffectType: 'project_write',
      description:
        'Queue a whole-report refresh of the report open in the editor from current Project sources. Use only when the user asks to refresh/regenerate the whole report. Produces a candidate revision for user review in the canvas.',
      inputSchema: z
        .object({
          report_id: id.optional(),
          instruction: z.string().trim().max(10000).default(''),
        })
        .strict(),
      execute: async ({ report_id, instruction }, execute) => {
        await authorize();
        return queue(execute, {
          reportId: resolveWritableReportId(report_id),
          mode: 'refresh',
          instruction,
        });
      },
    }),
  };
}

export function projectReportPolicy(input: {
  context: ProjectReportAiContext;
  title: string;
  revisionSequence: number;
}) {
  const selection =
    input.context.chapterIds.length || input.context.nodeIds.length
      ? `Selected chapters: ${JSON.stringify(input.context.chapterIds)}; selected nodes: ${JSON.stringify(input.context.nodeIds)}.`
      : 'No chapter or node is selected.';
  return [
    `You are assisting on the open Project report "${input.title}" (reportId ${input.context.reportId}, revision ${input.revisionSequence}, version ${input.context.reportVersion}).`,
    `你正在协助编辑当前打开的项目汇报《${input.title}》。`,
    selection,
    'Call project_report_read first to obtain the current outline and stable IDs. 修改前先调用 project_report_read。',
    'For changes call project_report_rewrite scoped to the selected chapters/nodes; use project_report_refresh only when the user explicitly asks to refresh or regenerate the whole report. 修改默认限定在所选章节/节点；只有用户明确要求整份刷新时才调用 project_report_refresh。',
    'These tools only queue a candidate revision. Never claim the report was changed: the user reviews and applies candidates in the report canvas. 工具只生成候选稿，不得声称已修改；用户会在右侧画布审核并应用。',
    'Facts must come from Project documents, work orders and shared memory. Do not invent numbers, names or dates. 事实只能来自项目文档、工单与共享记忆，不得编造数字。',
  ].join('\n');
}
