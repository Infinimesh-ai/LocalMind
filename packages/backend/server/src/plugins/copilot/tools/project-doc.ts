import { createHash, randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { BadRequest } from '../../../base';
import { type NativeFileCreateService } from '../../../core/office/create-service';
import { ProjectResourceService } from '../../../core/project';
import { Models } from '../../../models';
import { assertCurrentProjectToolContract } from '../../../models/common/copilot-tool-contract';
import {
  PROJECT_AGENT_WORKFLOW,
  type ProjectAgentRun,
} from '../../../models/copilot-project-agent-runtime';
import { parseYDocToMarkdown } from '../../../native';
import {
  type CopilotChatOptions,
  CopilotChatOptionsSchema,
} from '../providers/types';
import { NativeFileCreateToolSchema } from './file-create-input';
import {
  type CopilotToolExecuteOptions,
  type CopilotToolSet,
  defineTool,
} from './tool';

export const PROJECT_NATIVE_TOOL_NAMES = new Set([
  'project_file_request_recipients',
  'project_file_request_create',
  'project_file_create',
  'project_doc_create',
  'project_doc_read',
  'project_doc_update',
  'project_resource_update_meta',
  'project_resource_list',
  'project_folder_create',
  'project_doc_keyword_search',
  'project_doc_semantic_search',
  'project_office_read',
  'project_office_command_request',
  'project_office_command_batch_request',
  'project_publication_prepare',
]);

const PROJECT_READ_TOOLS = new Set([
  'project_doc_read',
  'project_resource_list',
  'project_doc_keyword_search',
  'project_doc_semantic_search',
]);

export function createProjectResourceTools(
  models: Models,
  resources: ProjectResourceService,
  options: NonNullable<CopilotChatOptions>,
  projectId: string,
  executingRun?: ProjectAgentRun,
  files?: NativeFileCreateService
): CopilotToolSet {
  if (
    !options.user ||
    !options.session ||
    options.workspace ||
    options.taskId ||
    options.delegatedExecution
  ) {
    throw new BadRequest(
      'Native Project tools require an owned Project conversation.'
    );
  }
  const scope = {
    projectId,
    actorId: options.user,
    sourceSessionId: options.session,
    origin: 'ai' as const,
  };
  const editLease = async (resourceId: string) => {
    if (!executingRun?.workerLeaseId)
      throw new BadRequest('Project AI writes require their worker edit lease');
    return models.projectResourceEditLease.proofForTask({
      ...scope,
      resourceId,
      runId: executingRun.id,
      workerLeaseId: executingRun.workerLeaseId,
    });
  };
  const proof = new Map<string, number>();
  if (executingRun) {
    assertCurrentProjectToolContract(
      executingRun.steps.find(step => step.stepKey === 'execute')?.input
    );
    const command = ProjectResourceCommandSchema.parse(
      executingRun.steps.find(step => step.stepKey === 'execute')?.input
    );
    if (
      executingRun.projectId !== projectId ||
      executingRun.actorId !== scope.actorId ||
      executingRun.sessionId !== scope.sourceSessionId ||
      executingRun.workflow !== PROJECT_AGENT_WORKFLOW
    )
      throw new BadRequest('Project execution owner changed');
    if (command.readProof)
      proof.set(command.readProof.resourceId, command.readProof.contentVersion);
  }
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
      throw new BadRequest('Project writes require a stable tool call ID.');
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
  const receipt = async (resourceId: string) => {
    const resource = await models.projectResource.get({ ...scope, resourceId });
    const path = await models.projectResource.path({ ...scope, resourceId });
    return {
      status: 'saved',
      owner: { kind: 'project', projectId },
      resourceId,
      docId: resourceId,
      title: resource.title,
      kind: resource.kind,
      version: resource.version,
      contentVersion: resource.contentVersion,
      path: path.map(node => ({ id: node.id, title: node.title })),
      url: `/project/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
    };
  };
  const id = z.string().min(1).max(256);
  const search = defineTool({
    description:
      'Search indexed titles and document text in the current Project. Retrieval uses bounded keyword search and returns exact resource IDs, immutable versions and paths. Read a result before editing it. Workspace sources and other Projects are never searched.',
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(128),
        cursor: z.string().max(4096).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    execute: async ({ query, cursor, limit }) => {
      await authorize();
      const result = await models.projectResource.search({
        ...scope,
        query,
        cursor,
        limit,
      });
      await models.copilotContext.recordInputSources({
        ...scope,
        sessionId: scope.sourceSessionId,
        sources: result.items.map(item => ({
          workspaceId: null,
          kind: 'project_resource',
          sourceId: `${item.id}@${item.contentVersion}`,
        })),
      });
      return { ...result, retrievalMode: 'keyword' };
    },
  });
  const tools: CopilotToolSet = {
    ...(files
      ? {
          project_file_create: defineTool({
            description:
              'Create and save a real DOCX, XLSX, PPTX, TXT, Markdown, CSV or JSON file inside this Project, optionally in parent_id. Use structured paragraphs, sheets/rows or slides; use text for TXT/Markdown/JSON (valid JSON), rows for CSV. Strings in XLSX are literal text, not formulas. Native Office files can be read and edited with project_office tools afterwards. This never publishes to a Workspace.',
            inputSchema: NativeFileCreateToolSchema,
            execute: async (file, execute) => {
              await authorize();
              return files.create({
                projectId,
                actorId: scope.actorId,
                sessionId: scope.sourceSessionId,
                requestKey: requestKey(execute),
                file,
              });
            },
          }),
        }
      : {}),
    project_publication_prepare: defineTool({
      description:
        'Prepare a separate explicit Workspace publication or update request for a document already saved in this Project. Use only when the user explicitly asks to publish to or update a Workspace. Return the durable request ID and waiting status. The user chooses the exact destination and confirms the preview in the publication task; never imply publication has completed. Cancellation preserves the internal document.',
      inputSchema: z
        .object({ resource_id: id, kind: z.enum(['publish', 'update']) })
        .strict(),
      execute: async ({ resource_id, kind }, execute) => {
        await authorize();
        const publication = await models.projectPublication.prepare({
          ...scope,
          sessionId: scope.sourceSessionId,
          resourceId: resource_id,
          kind,
          requestKey: requestKey(execute),
        });
        return {
          publicationId: publication.id,
          resourceId: publication.resourceId,
          projectId,
          status: publication.status,
          sourceSequence: publication.sourceSequence,
          expiresAt: publication.expiresAt.toISOString(),
          internalStatus: 'saved',
          url: `/project/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resource_id)}?publication=${encodeURIComponent(publication.id)}`,
        };
      },
    }),
    project_doc_keyword_search: search,
    project_doc_semantic_search: search,
    project_resource_list: defineTool({
      description:
        'List the direct children of the current Project root or a Project folder. Follow nextCursor for pagination. These are internal Project resources; never infer an external Workspace target from a title.',
      inputSchema: z
        .object({
          parent_id: id.nullable().optional(),
          cursor: z.string().max(4096).optional(),
          search: z.string().max(128).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          trash: z.boolean().default(false),
        })
        .strict(),
      execute: async ({ parent_id, cursor, search, limit, trash }) => {
        await authorize();
        return models.projectResource.list({
          ...scope,
          parentId: parent_id,
          cursor,
          search,
          limit,
          trash,
        });
      },
    }),
    project_folder_create: defineTool({
      description:
        'Create a real folder inside the current Project. Use parent_id from project_resource_list, or null for the Project root. This does not create or change any Workspace folder.',
      inputSchema: z
        .object({
          title: z.string().trim().min(1).max(512),
          parent_id: id.nullable().optional(),
        })
        .strict(),
      execute: async ({ title, parent_id }, execute) => {
        await authorize();
        const resource = await resources.createFolder({
          ...scope,
          title,
          parentId: parent_id,
          requestKey: requestKey(execute),
        });
        return { ...(await receipt(resource.id)), folderCreated: true };
      },
    }),
    project_doc_create: defineTool({
      description:
        'Create and save a real document or canvas inside the current Project, then return its persisted ID and path. Default to the Project root. External publication is a separate explicit operation; it is never a prerequisite for this internal save.',
      inputSchema: z
        .object({
          title: z.string().trim().min(1).max(512),
          content: z.string().max(1024 * 1024),
          parent_id: id.nullable().optional(),
          kind: z.enum(['page', 'edgeless']).default('page'),
        })
        .strict(),
      execute: async ({ title, content, parent_id, kind }, execute) => {
        await authorize();
        const resource = await resources.createDocument({
          ...scope,
          title,
          markdown: content,
          parentId: parent_id,
          kind,
          requestKey: requestKey(execute),
        });
        return {
          ...(await receipt(resource.id)),
          documentCreated: true,
          createdContentVersion: 1,
        };
      },
    }),
    project_doc_read: defineTool({
      description:
        'Read a bounded character range from a Project document and return immutable version and coverage evidence. Use content_version from selected context to reread the same frozen source, and continue with start=nextStart until complete when exact later content is needed. Call this before project_doc_update. Source Workspace documents are independent copies and are not read by this tool.',
      inputSchema: z
        .object({
          doc_id: id,
          content_version: z.number().int().positive().optional(),
          start: z.number().int().nonnegative().default(0),
          max_characters: z.number().int().min(1).max(120_000).default(40_000),
        })
        .strict(),
      execute: async ({ doc_id, content_version, start, max_characters }) => {
        await authorize();
        const rangeStart = start ?? 0;
        const rangeLength = max_characters ?? 40_000;
        const current = await resources.readDocument({
          ...scope,
          resourceId: doc_id,
          sequence: content_version,
        });
        const markdown = parseYDocToMarkdown(current.bytes, doc_id, true);
        if (rangeStart > markdown.markdown.length) {
          throw new BadRequest('Project document read range is out of bounds');
        }
        const end = Math.min(
          markdown.markdown.length,
          rangeStart + rangeLength
        );
        await models.copilotContext.recordInputSources({
          projectId,
          actorId: scope.actorId,
          sessionId: scope.sourceSessionId,
          sources: [
            {
              workspaceId: null,
              kind: 'project_resource',
              sourceId: `${doc_id}@${current.revision.sequence}`,
            },
          ],
        });
        proof.set(doc_id, current.revision.sequence);
        return {
          ...(await receipt(doc_id)),
          contentVersion: current.revision.sequence,
          markdown: markdown.markdown.slice(rangeStart, end),
          coverage: {
            start: rangeStart,
            end,
            totalCharacters: markdown.markdown.length,
            complete: rangeStart === 0 && end === markdown.markdown.length,
          },
          truncated: end < markdown.markdown.length,
          nextStart: end < markdown.markdown.length ? end : null,
        };
      },
    }),
    project_doc_update: defineTool({
      description:
        'Save new Markdown to the exact Project document read by project_doc_read in this tool loop. The expected version must match that read. Conflicts require another read and comparison. This never updates Workspace copies.',
      inputSchema: z
        .object({
          doc_id: id,
          expected_content_version: z.number().int().positive(),
          content: z.string().max(1024 * 1024),
        })
        .strict(),
      execute: async (
        { doc_id, expected_content_version, content },
        execute
      ) => {
        await authorize();
        const revision = await resources.updateMarkdown({
          ...scope,
          editLease: await editLease(doc_id),
          resourceId: doc_id,
          expectedContentVersion: expected_content_version,
          readContentVersion: proof.get(doc_id),
          markdown: content,
          requestKey: requestKey(execute),
        });
        return {
          ...(await receipt(doc_id)),
          appliedContentVersion: revision.sequence,
        };
      },
    }),
    project_resource_update_meta: defineTool({
      description:
        'Rename, move, reorder, trash or restore a Project resource using its current metadata version. All IDs must belong to this Project. For root moves use parent_id null; trash is reversible and never deletes external copies.',
      inputSchema: z
        .object({
          resource_id: id,
          expected_version: z.number().int().positive(),
          title: z.string().trim().min(1).max(512).optional(),
          parent_id: id.nullable().optional(),
          before_id: id.nullable().optional(),
          trash: z.boolean().optional(),
        })
        .strict(),
      execute: async (
        { resource_id, expected_version, title, parent_id, before_id, trash },
        execute
      ) => {
        await authorize();
        const resource = await resources.change({
          ...scope,
          editLease: await editLease(resource_id),
          resourceId: resource_id,
          expectedVersion: expected_version,
          ...(title !== undefined ? { title } : {}),
          ...(parent_id !== undefined ? { parentId: parent_id } : {}),
          ...(before_id !== undefined ? { beforeId: before_id } : {}),
          ...(trash !== undefined ? { trash } : {}),
          requestKey: requestKey(execute),
        });
        return {
          status: resource.trashedAt ? 'trashed' : 'saved',
          owner: { kind: 'project', projectId },
          resourceId: resource.id,
          version: resource.version,
        };
      },
    }),
  };
  const enabled = new Set(options.tools ?? []);
  return Object.fromEntries(
    Object.entries(tools)
      .filter(([name]) => {
        if (name === 'project_publication_prepare')
          return enabled.has('docCreate') || enabled.has('docUpdate');
        if (name === 'project_doc_create' || name === 'project_file_create')
          return enabled.has('docCreate');
        if (name === 'project_doc_read') return enabled.has('docRead');
        if (name === 'project_doc_update') return enabled.has('docUpdate');
        if (name === 'project_doc_keyword_search')
          return (
            enabled.has('docKeywordSearch') || enabled.has('docSemanticSearch')
          );
        if (name === 'project_doc_semantic_search')
          return enabled.has('docSemanticSearch');
        if (name === 'project_resource_update_meta')
          return (
            enabled.has('docUpdateMeta') || enabled.has('workspaceOrganization')
          );
        return enabled.has('workspaceOrganization');
      })
      .map(([name, tool]) => [
        name,
        {
          ...tool,
          sideEffectType: PROJECT_READ_TOOLS.has(name)
            ? 'read'
            : 'project_write',
          execute:
            PROJECT_READ_TOOLS.has(name) ||
            name === 'project_publication_prepare' ||
            executingRun
              ? tool.execute
              : async (args, execute) => {
                  await authorize();
                  execute.signal?.throwIfAborted();
                  const command = {
                    version: 2,
                    toolName: name,
                    arguments: args,
                    toolCallId: execute.toolCallId,
                    options: {
                      user: options.user,
                      session: options.session,
                      tools: options.tools,
                      billingUnitId: options.billingUnitId,
                    },
                    ...(name === 'project_doc_update' &&
                    typeof args.doc_id === 'string' &&
                    proof.has(args.doc_id)
                      ? {
                          readProof: {
                            resourceId: args.doc_id,
                            contentVersion: proof.get(args.doc_id),
                          },
                        }
                      : {}),
                  };
                  const parsed = ProjectResourceCommandSchema.parse(command);
                  const targetId =
                    typeof args.doc_id === 'string'
                      ? args.doc_id
                      : typeof args.resource_id === 'string'
                        ? args.resource_id
                        : null;
                  const title =
                    typeof args.title === 'string'
                      ? args.title
                      : targetId
                        ? (
                            await models.projectResource.get({
                              ...scope,
                              resourceId: targetId,
                              includeTrash:
                                name === 'project_resource_update_meta',
                            })
                          ).title
                        : null;
                  if (!title)
                    throw new BadRequest(
                      'Project task requires a resource title'
                    );
                  const run = await models.copilotProjectAgentRuntime.prepare({
                    ...scope,
                    sessionId: scope.sourceSessionId,
                    requestKey: requestKey(execute),
                    workflow: PROJECT_AGENT_WORKFLOW,
                    sourceType: 'project_resource',
                    title,
                    command: JSON.parse(
                      JSON.stringify(parsed)
                    ) as Prisma.InputJsonObject,
                  });
                  const result = run.projectExecutionResults.find(
                    result => result.resultStatus === 'completed'
                  );
                  if (result) {
                    const payload = result.resultPayload as Prisma.JsonObject;
                    return {
                      ...(payload.sideEffectSummary as Prisma.JsonObject),
                      runId: run.id,
                    };
                  }
                  if (run.status === 'failed' || run.status === 'cancelled')
                    throw new BadRequest(
                      `Project task ${run.status}; use a new explicit request to retry`
                    );
                  const workerLeaseId = `project-tool-${randomUUID()}`;
                  const leased =
                    await models.copilotProjectAgentRuntime.acquire({
                      projectId,
                      runId: run.id,
                      workerLeaseId,
                    });
                  if (!leased)
                    return {
                      status: 'queued',
                      runId: run.id,
                      owner: { kind: 'project', projectId },
                    };
                  const lease = {
                    ...scope,
                    runId: run.id,
                    workerLeaseId,
                    workerAttempt: leased.workerAttempt,
                  };
                  try {
                    const resourceId =
                      name === 'project_doc_update'
                        ? parsed.arguments.doc_id
                        : name === 'project_resource_update_meta'
                          ? parsed.arguments.resource_id
                          : undefined;
                    if (typeof resourceId === 'string') {
                      const editing =
                        await models.projectResourceEditLease.acquire({
                          ...lease,
                          resourceId,
                          kind: 'ai_task',
                          taskId: run.id,
                          tabId: workerLeaseId,
                        });
                      if (!editing.acquired) {
                        if (!editing.lease)
                          throw new BadRequest('Project edit lease changed');
                        await models.copilotProjectAgentRuntime.waitForEditLease(
                          {
                            ...lease,
                            resourceId,
                            leaseId: editing.lease.leaseId,
                          }
                        );
                        return { status: 'waiting_lease', runId: run.id };
                      }
                    }
                    const saved =
                      await models.copilotProjectAgentRuntime.execute(
                        lease,
                        async current => {
                          execute.signal?.throwIfAborted();
                          const output = await executeProjectResourceRun(
                            models,
                            resources,
                            current,
                            files
                          );
                          execute.signal?.throwIfAborted();
                          return output;
                        }
                      );
                    return saved
                      ? { ...saved, runId: run.id }
                      : { status: 'cancelled', runId: run.id };
                  } catch (error) {
                    await models.copilotProjectAgentRuntime.fail(
                      lease,
                      'project_operation_failed',
                      'Project operation failed; read the current resource before retrying'
                    );
                    throw error;
                  } finally {
                    await models.projectResourceEditLease.releaseTask(lease);
                  }
                },
        },
      ])
  );
}

export const ProjectResourceCommandSchema = z
  .object({
    version: z.literal(2),
    toolName: z.enum([
      'project_file_create',
      'project_doc_create',
      'project_doc_update',
      'project_resource_update_meta',
      'project_folder_create',
    ]),
    arguments: z.record(z.unknown()),
    toolCallId: z.string().min(1).max(512),
    options: CopilotChatOptionsSchema,
    readProof: z
      .object({
        resourceId: z.string().min(1).max(256),
        contentVersion: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function executeProjectResourceRun(
  models: Models,
  resources: ProjectResourceService,
  run: ProjectAgentRun,
  files?: NativeFileCreateService
) {
  if (
    !run.projectId ||
    run.workspaceId ||
    !run.sessionId ||
    run.workflow !== PROJECT_AGENT_WORKFLOW
  )
    throw new BadRequest('This worker requires a native Project resource task');
  if (!(env.dev || env.selfhosted || env.namespaces.canary))
    throw new BadRequest('Document write tools are disabled');
  assertCurrentProjectToolContract(
    run.steps.find(step => step.stepKey === 'execute')?.input
  );
  const command = ProjectResourceCommandSchema.parse(
    run.steps.find(step => step.stepKey === 'execute')?.input
  );
  if (!command.options)
    throw new BadRequest('Project task capability snapshot is missing');
  const tools = createProjectResourceTools(
    models,
    resources,
    command.options,
    run.projectId,
    run,
    files
  );
  const tool = tools[command.toolName];
  if (!tool?.execute || !(tool.inputSchema instanceof z.ZodType))
    throw new BadRequest('Project task tool is unavailable');
  const args = tool.inputSchema.parse(command.arguments) as Record<
    string,
    unknown
  >;
  return (await tool.execute(args, {
    toolCallId: command.toolCallId,
  })) as Prisma.InputJsonObject;
}
