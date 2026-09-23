import { randomUUID } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { Config } from '../../../base';
import {
  DocReader,
  DocWriter,
  WorkspaceOrganizationService,
} from '../../../core/doc';
import { NativeFileCreateService } from '../../../core/office/create-service';
import { PermissionAccess, PermissionService } from '../../../core/permission';
import { ProjectResourceService } from '../../../core/project';
import { Models } from '../../../models';
import { isRetiredResourceTool } from '../../../models/common/copilot-tool-contract';
import { mcpDelegationFingerprint } from '../../../models/copilot-mcp-delegation';
import { IndexerService } from '../../indexer';
import type { NodeTextMiddleware } from '../config';
import { CopilotContextService } from '../context/service';
import { CopilotDocumentCopyService } from '../document-copy-service';
import { CopilotDocumentOperationService } from '../document-operation-service';
import {
  type EnterpriseToolCapabilitySnapshot,
  EnterpriseToolRegistry,
} from '../enterprise';
import { ExternalMcpToolRegistry } from '../external-mcp';
import { McpAttachmentService } from '../mcp/attachments';
import { OfficeAgentCommandService } from '../office-agent-command';
import { ProjectOfficeAgentCommandService } from '../project-office-agent-command';
import {
  type CopilotChatOptions,
  type CopilotChatTools,
  type PromptMessage,
} from '../providers/types';
import {
  buildBlobContentGetter,
  buildDocContentGetter,
  buildDocKeywordSearchGetter,
  buildDocSearchGetter,
  buildDocUpdateHandler,
  buildDocUpdateMetaHandler,
  buildOfficeCommandBatchRequestHandler,
  buildOfficeCommandRequestHandler,
  buildOfficeReadHandler,
  type CopilotTool,
  type CopilotToolSet,
  createBlobReadTool,
  createBlockerSuggestionTool,
  createCodeArtifactTool,
  createConversationSummaryTool,
  createDocComposeTool,
  createDocCreateRequestTool,
  createDocCreationStatusTool,
  createDocKeywordSearchTool,
  createDocReadTool,
  createDocSemanticSearchTool,
  createDocUpdateMetaTool,
  createDocUpdateTool,
  createExaCrawlTool,
  createExaSearchTool,
  createOfficeCommandBatchRequestTool,
  createOfficeCommandRequestTool,
  createOfficeReadTool,
  createProjectOfficeTools,
  createSectionEditTool,
  createTaskAttachmentReadTool,
  createWorkspaceOrganizationTools,
  defineTool,
} from '../tools';
import { createDocCopyRequestTool } from '../tools/doc-write';
import { createWorkspaceFileTool } from '../tools/file-create';
import {
  createProjectResourceTools,
  PROJECT_NATIVE_TOOL_NAMES,
} from '../tools/project-doc';
import { createProjectFileRequestTools } from '../tools/project-file-request';
import { createWorkOrderDraftTools } from '../tools/work-order';
import { createWorkOrderFileTool } from '../tools/work-order-file-create';
import { WorkOrderStorage } from '../work-order-storage';
import { PromptRuntime } from './prompt-runtime';
import type { ToolLoopBackend } from './tool/bridge';
import { createNativeToolLoopAdapter } from './tool/native-adapter';
import {
  matchesToolCapability,
  type ToolCapabilitySnapshot,
  toolSideEffectType,
} from './tool-capability-snapshot';

export type ProviderSpecificToolResolver = (
  toolName: CopilotChatTools,
  model: string
) => [string, CopilotTool?] | undefined;

export function canExposeDocumentWriteTools(environment: {
  dev: boolean;
  selfhosted: boolean;
  canary: boolean;
}) {
  return environment.dev || environment.selfhosted || environment.canary;
}

const PROJECT_SESSION_DIRECT_READ_TOOLS = new Set([
  'code_artifact',
  'conversation_summary',
  'web_search_exa',
  'web_crawl_exa',
  'doc_compose',
  'section_edit',
  'blocker_suggest',
  'work_order_recipient_resolve',
  'work_order_draft',
]);

const PROJECT_DERIVED_RESULT_TOOLS = new Set([
  ...PROJECT_SESSION_DIRECT_READ_TOOLS,
  ...PROJECT_NATIVE_TOOL_NAMES,
]);

export function canRunDirectlyInProjectSession(toolName: string) {
  return (
    PROJECT_SESSION_DIRECT_READ_TOOLS.has(toolName) &&
    toolSideEffectType(toolName) === 'read'
  );
}

export function canExposeInProjectSession(toolName: string, native = false) {
  return (
    !toolName.startsWith('workspace_') &&
    ((native && PROJECT_NATIVE_TOOL_NAMES.has(toolName)) ||
      canRunDirectlyInProjectSession(toolName))
  );
}

@Injectable()
export class ToolRuntime {
  constructor(
    private readonly config: Config,
    private readonly ac: PermissionAccess,
    private readonly permission: PermissionService,
    private readonly context: CopilotContextService,
    private readonly docReader: DocReader,
    private readonly docWriter: DocWriter,
    private readonly workspaceOrganization: WorkspaceOrganizationService,
    private readonly models: Models,
    private readonly office: OfficeAgentCommandService,
    private readonly promptRuntime: PromptRuntime,
    private readonly indexerService: IndexerService,
    @Optional() private readonly enterpriseTools?: EnterpriseToolRegistry,
    @Optional() private readonly externalMcpTools?: ExternalMcpToolRegistry,
    @Optional() private readonly mcpAttachments?: McpAttachmentService,
    @Optional() private readonly documentCopies?: CopilotDocumentCopyService,
    @Optional()
    private readonly documentOperations?: CopilotDocumentOperationService,
    @Optional() private readonly projectResources?: ProjectResourceService,
    @Optional()
    private readonly projectOffice?: ProjectOfficeAgentCommandService,
    @Optional() private readonly nativeFiles?: NativeFileCreateService,
    @Optional() private readonly workOrderStorage?: WorkOrderStorage
  ) {}

  async getTools(
    options: CopilotChatOptions,
    model: string,
    resolveProviderSpecificTool?: ProviderSpecificToolResolver
  ): Promise<CopilotToolSet> {
    const tools: CopilotToolSet = {};
    if (!options?.tools?.length) {
      return tools;
    }
    const runPromptText = (
      promptName: string,
      params: Record<string, unknown>,
      promptOptions?: { appendMessages?: PromptMessage[] }
    ) =>
      this.promptRuntime.runText(promptName, params, {
        ...promptOptions,
        providerOptions: {
          user: options.user,
          session: options.session,
          workspace: options.workspace,
          byokLeaseId: options.byokLeaseId,
          billingUnitId: options.billingUnitId,
          quotaBackedRoutesAllowed: options.quotaBackedRoutesAllowed,
          featureKind: options.featureKind,
        },
      });
    const documentWriteToolsEnabled = canExposeDocumentWriteTools({
      dev: env.dev,
      selfhosted: env.selfhosted,
      canary: env.namespaces.canary,
    });
    let sessionMeta:
      | {
          userId: string;
          workspaceId: string | null;
          docId: string | null;
          selectedContextProjectId: string | null;
          scopeType: string;
          workOrderBinding: { workOrderId: string } | null;
        }
      | null
      | undefined;
    const resolveSessionMeta = async () => {
      if (sessionMeta !== undefined) return sessionMeta;
      sessionMeta = options.session
        ? await this.models.copilotSession.getMeta(options.session)
        : null;
      return sessionMeta;
    };
    let selectedProjectId: string | null | undefined;
    const resolveSelectedProjectId = async () => {
      if (selectedProjectId !== undefined) return selectedProjectId;
      selectedProjectId =
        (await resolveSessionMeta())?.selectedContextProjectId ?? null;
      return selectedProjectId;
    };
    if (options.session) {
      await resolveSelectedProjectId();
    }
    if (sessionMeta?.scopeType === 'work_order') {
      if (
        sessionMeta.userId !== options.user ||
        sessionMeta.workspaceId !== null ||
        sessionMeta.selectedContextProjectId !== null ||
        !sessionMeta.workOrderBinding
      ) {
        throw new Error('Work-order conversation authorization is invalid.');
      }
      if (
        !options.session ||
        !options.user ||
        !this.nativeFiles ||
        !this.workOrderStorage ||
        !options.tools.includes('workOrder')
      ) {
        return tools;
      }
      return this.applyExecutionGuards(
        createWorkOrderFileTool(this.workOrderStorage, {
          actorId: options.user,
          sessionId: options.session,
          workOrderId: sessionMeta.workOrderBinding.workOrderId,
        }),
        options,
        null
      );
    }
    const nativeProjectId =
      sessionMeta?.scopeType === 'project' ? selectedProjectId : null;
    if (selectedProjectId && !nativeProjectId) {
      throw new Error(
        'Start a native Project conversation to use Project tools.'
      );
    }
    if (nativeProjectId) {
      if (!this.projectResources)
        throw new Error('Project resource service is unavailable.');
      const nativeTools = createProjectResourceTools(
        this.models,
        this.projectResources,
        options,
        nativeProjectId,
        undefined,
        this.nativeFiles
      );
      Object.assign(
        tools,
        Object.fromEntries(
          Object.entries(nativeTools).filter(
            ([, tool]) =>
              documentWriteToolsEnabled || tool.sideEffectType === 'read'
          )
        )
      );
    }
    for (const tool of options.tools) {
      if (
        nativeProjectId &&
        [
          'docCreate',
          'docRead',
          'docUpdate',
          'docUpdateMeta',
          'docSemanticSearch',
          'docKeywordSearch',
          'workspaceOrganization',
        ].includes(tool)
      )
        continue;
      const toolDef =
        selectedProjectId || tool === 'blocker'
          ? undefined
          : resolveProviderSpecificTool?.(tool, model);
      if (toolDef) {
        if (toolDef[1]) {
          tools[toolDef[0]] = toolDef[1];
        }
        continue;
      }

      if (
        !documentWriteToolsEnabled &&
        ['docCreate', 'docUpdate', 'docUpdateMeta'].includes(tool) &&
        !(tool === 'docUpdate' && selectedProjectId)
      ) {
        continue;
      }

      switch (tool) {
        case 'blobRead': {
          if (!options.session || !options.user || !options.workspace) break;
          const actorId = options.user;
          const sessionId = options.session;
          const workspaceId = options.workspace;
          const docContext = await this.context.getOwnedBySessionId(
            actorId,
            sessionId,
            workspaceId
          );
          if (!docContext) break;
          tools.workspace_blob_read = createBlobReadTool(
            async (blobId, chunk) => {
              const current = await this.context.getOwnedContext(
                actorId,
                docContext.id,
                { sessionId, workspaceId }
              );
              return buildBlobContentGetter(this.ac, current)(
                options,
                blobId,
                chunk
              );
            }
          );
          break;
        }
        case 'taskAttachmentRead': {
          if (options.taskAttachments?.length) {
            const mcpAttachments = this.mcpAttachments;
            tools.task_attachment_read = createTaskAttachmentReadTool(
              options.taskAttachments,
              mcpAttachments &&
                options.taskId &&
                options.workspace &&
                options.user
                ? input =>
                    mcpAttachments.readTaskAttachmentChunk({
                      taskId: options.taskId as string,
                      workspaceId: options.workspace as string,
                      actorId: options.user as string,
                      attachmentId: input.attachmentId,
                      chunk: input.chunk,
                    })
                : undefined
            );
          }
          break;
        }
        case 'codeArtifact': {
          tools.code_artifact = createCodeArtifactTool(runPromptText);
          break;
        }
        case 'conversationSummary': {
          tools.conversation_summary = createConversationSummaryTool(
            options.session,
            runPromptText
          );
          break;
        }
        case 'docSemanticSearch': {
          const searchDocs = buildDocSearchGetter(
            this.ac,
            this.context,
            options.session,
            this.models
          );
          tools.workspace_doc_semantic_search = createDocSemanticSearchTool(
            searchDocs.bind(null, options)
          );
          break;
        }
        case 'docKeywordSearch': {
          const searchDocs = buildDocKeywordSearchGetter(
            this.ac,
            this.permission,
            this.indexerService,
            this.models,
            this.docReader
          );
          tools.workspace_doc_keyword_search = createDocKeywordSearchTool(
            searchDocs.bind(null, options)
          );
          break;
        }
        case 'docRead': {
          const getDoc = buildDocContentGetter(
            this.ac,
            this.docReader,
            this.models
          );
          tools.workspace_doc_read = createDocReadTool(
            getDoc.bind(null, options)
          );
          break;
        }
        case 'docCreate': {
          if (
            this.nativeFiles &&
            !options.taskId &&
            !options.delegatedExecution
          )
            tools.workspace_file_create = createWorkspaceFileTool(
              this.nativeFiles,
              options
            );
          if (options.session && this.documentCopies)
            tools.workspace_doc_copy = createDocCopyRequestTool(
              this.documentCopies,
              options
            );
          tools.workspace_doc_create = createDocCreateRequestTool(
            this.ac,
            this.models,
            options,
            this.documentOperations
          );
          tools.workspace_doc_creation_status = createDocCreationStatusTool(
            this.models,
            options
          );
          break;
        }
        case 'docUpdate': {
          const updateDoc = buildDocUpdateHandler(
            this.ac,
            this.docWriter,
            this.models
          );
          tools.workspace_doc_update = createDocUpdateTool(
            updateDoc.bind(null, options)
          );
          break;
        }
        case 'docUpdateMeta': {
          const updateDocMeta = buildDocUpdateMetaHandler(
            this.ac,
            this.docWriter,
            this.models
          );
          tools.workspace_doc_update_meta = createDocUpdateMetaTool(
            updateDocMeta.bind(null, options)
          );
          break;
        }
        case 'webSearch': {
          tools.web_search_exa = createExaSearchTool(this.config);
          tools.web_crawl_exa = createExaCrawlTool(this.config);
          break;
        }
        case 'docCompose': {
          tools.doc_compose = createDocComposeTool(runPromptText);
          break;
        }
        case 'sectionEdit': {
          tools.section_edit = createSectionEditTool(runPromptText);
          break;
        }
        case 'workspaceOrganization': {
          Object.assign(
            tools,
            createWorkspaceOrganizationTools(
              this.ac,
              this.permission,
              this.workspaceOrganization,
              options
            )
          );
          break;
        }
        case 'office': {
          if (nativeProjectId) {
            if (!this.projectOffice)
              throw new Error('Project Office service is unavailable');
            Object.assign(
              tools,
              createProjectOfficeTools(
                this.projectOffice,
                options,
                nativeProjectId,
                documentWriteToolsEnabled
              )
            );
            break;
          }
          let readProof: { artifactId: string; revisionId: string } | null =
            null;
          const readOffice = buildOfficeReadHandler(this.office, proof => {
            readProof = proof;
          });
          const requestOfficeCommand = buildOfficeCommandRequestHandler(
            this.office,
            () => readProof
          );
          const requestOfficeCommandBatch =
            buildOfficeCommandBatchRequestHandler(this.office, () => readProof);
          tools.workspace_office_read = createOfficeReadTool(selector =>
            readOffice(options, undefined, undefined, selector)
          );
          tools.workspace_office_command_request =
            createOfficeCommandRequestTool(
              requestOfficeCommand.bind(null, options)
            );
          tools.workspace_office_command_batch_request =
            createOfficeCommandBatchRequestTool(
              requestOfficeCommandBatch.bind(null, options)
            );
          break;
        }
        case 'blocker': {
          const workbenchSession = await resolveSessionMeta();
          if (
            options.chatSurface !== 'intelligence_workbench' ||
            !workbenchSession ||
            workbenchSession.userId !== options.user ||
            workbenchSession.workspaceId !== (options.workspace ?? null) ||
            workbenchSession.docId !== null ||
            !selectedProjectId ||
            !options.user
          ) {
            break;
          }
          const projectId = selectedProjectId;
          if (
            !(await this.models.intelligenceWorkbenchBlocker.canAccess({
              projectId,
              userId: options.user,
            }))
          ) {
            break;
          }
          tools.blocker_suggest = createBlockerSuggestionTool(
            async suggestion => ({
              projectId,
              ...(await this.models.intelligenceWorkbenchBlocker.suggestForMember(
                {
                  projectId,
                  actorUserId: options.user as string,
                  ...suggestion,
                }
              )),
            })
          );
          if (
            nativeProjectId &&
            !options.taskId &&
            !options.delegatedExecution &&
            options.session
          ) {
            Object.assign(
              tools,
              createProjectFileRequestTools(this.models, {
                projectId: nativeProjectId,
                actorId: options.user,
                sessionId: options.session,
                turnId: options.billingUnitId,
              })
            );
            Object.assign(
              tools,
              createWorkOrderDraftTools(this.models, {
                actorId: options.user,
                sourceSessionId: options.session,
              })
            );
          }
          break;
        }
        case 'enterprise': {
          if (
            this.config.copilot.enterpriseCli.enabled &&
            this.enterpriseTools &&
            options.workspace &&
            options.user
          ) {
            Object.assign(
              tools,
              await this.enterpriseTools.getTools({
                workspaceId: options.workspace,
                userId: options.user,
                allowedTools: options.enterpriseToolCapabilities as
                  | EnterpriseToolCapabilitySnapshot[]
                  | undefined,
              })
            );
          }
          break;
        }
        case 'sparkClaw': {
          if (this.externalMcpTools && options.workspace && options.user) {
            Object.assign(
              tools,
              await this.externalMcpTools.getTools({
                workspaceId: options.workspace,
                userId: options.user,
                invocationId:
                  options.taskId ?? options.actionId ?? randomUUID(),
                ...(options.sparkClawToolNames
                  ? { allowedToolNames: options.sparkClawToolNames }
                  : {}),
                ...(options.sparkClawToolCapabilities
                  ? { allowedTools: options.sparkClawToolCapabilities }
                  : {}),
              })
            );
          }
          break;
        }
      }
    }

    const guarded = this.applyExecutionGuards(
      tools,
      options,
      selectedProjectId ?? null
    );
    const allowedNames = options.allowedToolNames
      ? new Set(options.allowedToolNames)
      : null;
    const allowedCapabilities = options.toolCapabilities
      ? new Map(
          options.toolCapabilities.map(capability => [
            capability.name,
            capability as ToolCapabilitySnapshot,
          ])
        )
      : null;
    const activeProjectId =
      options.session &&
      Object.keys(guarded).some(
        name => !canExposeInProjectSession(name, !!nativeProjectId)
      )
        ? await resolveSelectedProjectId()
        : (selectedProjectId ?? null);
    return Object.fromEntries(
      Object.entries(guarded).filter(([name, tool]) => {
        if (
          activeProjectId &&
          !canExposeInProjectSession(name, !!nativeProjectId)
        ) {
          return false;
        }
        if (
          isRetiredResourceTool(name) ||
          (!activeProjectId && name.startsWith('project_'))
        )
          return false;
        if (allowedNames && !allowedNames.has(name)) return false;
        if (!allowedCapabilities) return true;
        const expected = allowedCapabilities.get(name);
        return !!expected && matchesToolCapability(name, tool, expected);
      })
    );
  }

  async getEnterpriseToolCapabilitySnapshot(input: {
    workspaceId: string;
    userId: string;
  }) {
    return (await this.enterpriseTools?.getCapabilitySnapshot(input)) ?? [];
  }

  async getSparkClawToolCapabilitySnapshot(input: {
    workspaceId: string;
    userId: string;
  }) {
    return (await this.externalMcpTools?.getCapabilitySnapshot(input)) ?? [];
  }

  private applyExecutionGuards(
    tools: CopilotToolSet,
    options: NonNullable<CopilotChatOptions>,
    expectedProjectId: string | null
  ) {
    const readFingerprints = new Map<string, string>();
    const guarded: CopilotToolSet = { ...tools };
    if (options.conditionalDocumentUpdate) {
      guarded.workspace_conditional_noop_complete = defineTool({
        description:
          'Complete a conditional document update without writing only after workspace_doc_read proved the requested condition is already satisfied. Pass the exact readFingerprint returned by workspace_doc_read.',
        inputSchema: z
          .object({
            document_id: z.string().trim().min(1).max(256),
            read_fingerprint: z.string().length(64),
          })
          .strict(),
        execute: ({ document_id, read_fingerprint }) => {
          if (document_id !== options.conditionalDocumentUpdate?.documentId) {
            throw new Error('conditional_noop_document_mismatch');
          }
          if (readFingerprints.get(document_id) !== read_fingerprint) {
            throw new Error('conditional_noop_read_evidence_mismatch');
          }
          return {
            success: true,
            conditionalNoop: {
              documentId: document_id,
              readFingerprint: read_fingerprint,
            },
          };
        },
      });
    }

    let executions = 0;
    for (const [name, tool] of Object.entries(guarded)) {
      if (!tool.execute) continue;
      const execute = tool.execute;
      guarded[name] = {
        ...tool,
        execute: async (args, executeOptions) => {
          const workOrderTool = name === 'work_order_file_create';
          executeOptions.signal?.throwIfAborted();
          if (
            isRetiredResourceTool(name) ||
            (expectedProjectId
              ? !canExposeInProjectSession(name, true)
              : name.startsWith('project_'))
          )
            throw new Error('tool_scope_mismatch');
          if (options.workspace && options.user)
            await this.ac
              .user(options.user)
              .workspace(options.workspace)
              .assert('Workspace.Copilot');
          if (options.session) {
            const session = await this.models.copilotSession.getMeta(
              options.session
            );
            if (
              !session ||
              session.userId !== options.user ||
              session.workspaceId !== (options.workspace ?? null) ||
              session.selectedContextProjectId !== expectedProjectId
            ) {
              throw new Error(
                'Conversation authorization changed. Reload this conversation.'
              );
            }
            if (workOrderTool) {
              if (
                session.scopeType !== 'work_order' ||
                !session.workOrderBinding ||
                session.docId
              ) {
                throw new Error(
                  "This tool requires the recipient's personal work-order conversation."
                );
              }
              const order = await this.models.copilotWorkOrder.getOwned(
                session.workOrderBinding.workOrderId,
                options.user as string
              );
              if (
                order.viewerRole !== 'recipient' ||
                order.sessionBinding?.sessionId !== session.id
              ) {
                throw new Error(
                  'Work-order ownership changed. Reload this conversation.'
                );
              }
            } else if (
              options.chatSurface === 'intelligence_workbench' &&
              (!expectedProjectId || session.docId)
            ) {
              throw new Error(
                'Select an active project before using Intelligence.'
              );
            }
            if (expectedProjectId) {
              const project =
                await this.models.copilotContextMemory.getProject(
                  expectedProjectId
                );
              if (
                !project ||
                project.status !== 'active' ||
                !project.members.some(member => member.userId === options.user)
              ) {
                throw new Error('Project membership is no longer active.');
              }
              if (
                !canExposeInProjectSession(name, session.workspaceId === null)
              ) {
                throw new Error(
                  'This tool is not permitted in a project conversation.'
                );
              }
            }
          }
          if (
            options.maxToolExecutions !== undefined &&
            executions >= options.maxToolExecutions
          ) {
            throw new Error('tool_execution_limit_exceeded');
          }
          executions++;

          const conditionalDocumentId =
            options.conditionalDocumentUpdate?.documentId;
          const requestedDocumentId =
            typeof args.doc_id === 'string' ? args.doc_id : null;
          if (
            conditionalDocumentId &&
            name === 'workspace_doc_update' &&
            requestedDocumentId === conditionalDocumentId &&
            !readFingerprints.has(conditionalDocumentId)
          ) {
            throw new Error('conditional_document_update_requires_read');
          }

          const checkpoint =
            options.taskId && options.session && options.delegatedExecution
              ? {
                  requestId: options.taskId,
                  sessionId: options.session,
                  ...options.delegatedExecution,
                  callId: executeOptions.toolCallId ?? '',
                }
              : null;
          if (options.taskId && options.session && !checkpoint)
            throw new Error('Delegated tool execution requires a worker lease');
          let replayedResult: { value: unknown } | null = null;
          if (checkpoint) {
            const call = await this.models.copilotMcpDelegation.beginToolCall({
              ...checkpoint,
              toolName: name,
              args,
            });
            if (call.completedAt)
              replayedResult = call.result as { value: unknown };
          }
          executeOptions.signal?.throwIfAborted();
          const result = replayedResult
            ? replayedResult.value
            : await execute(args, executeOptions);
          const resultObject =
            result && typeof result === 'object' && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : null;
          const failed =
            resultObject?.type === 'error' || resultObject?.success === false;
          const readFingerprint =
            !failed &&
            name === 'workspace_doc_read' &&
            requestedDocumentId &&
            requestedDocumentId === conditionalDocumentId
              ? replayedResult &&
                typeof resultObject?.readFingerprint === 'string'
                ? resultObject.readFingerprint
                : mcpDelegationFingerprint({
                    version: 'localmind-conditional-document-read/v1',
                    documentId: requestedDocumentId,
                    result,
                  })
              : null;
          const checkpointResult = readFingerprint
            ? resultObject
              ? { ...resultObject, readFingerprint }
              : { result, readFingerprint }
            : result;
          // Save the executor receipt before provenance/bookkeeping can fail.
          if (checkpoint && !replayedResult)
            await this.models.copilotMcpDelegation.completeToolCall({
              ...checkpoint,
              result: checkpointResult,
            });
          if (
            !failed &&
            options.session &&
            options.user &&
            options.workspace &&
            [
              'workspace_doc_read',
              'project_doc_read',
              'workspace_doc_keyword_search',
              'workspace_doc_semantic_search',
            ].includes(name)
          ) {
            const sources = z
              .array(
                z.object({
                  sourceWorkspaceId: z
                    .string()
                    .min(1)
                    .max(256)
                    .default(options.workspace),
                  docId: z.string().min(1).max(256),
                })
              )
              .max(4096)
              .parse(
                ['project_doc_read', 'workspace_doc_read'].includes(name)
                  ? [result]
                  : result
              );
            await this.models.copilotContext.recordDocumentSources({
              actorId: options.user,
              sessionId: options.session,
              projectId: expectedProjectId,
              documents: sources.map(source => ({
                workspaceId: source.sourceWorkspaceId,
                docId: source.docId,
              })),
            });
          }
          if (
            options.session &&
            options.user &&
            (options.workspace || expectedProjectId)
          ) {
            const identity = {
              actorId: options.user,
              sessionId: options.session,
              projectId: expectedProjectId,
            };
            if (!failed && name === 'project_doc_add') {
              const source = z
                .object({
                  sourceWorkspaceId: z.string().min(1).max(256),
                  docId: z.string().min(1).max(256),
                })
                .parse(result);
              await this.models.copilotContext.recordDocumentSources({
                ...identity,
                documents: [
                  {
                    workspaceId: source.sourceWorkspaceId,
                    docId: source.docId,
                  },
                ],
              });
            }
            const derived =
              (!options.workspace && PROJECT_NATIVE_TOOL_NAMES.has(name)) ||
              (!failed && PROJECT_DERIVED_RESULT_TOOLS.has(name));
            const privateAttachment =
              name === 'workspace_blob_read' || name === 'task_attachment_read';
            await this.models.copilotContext.recordInputSources({
              ...identity,
              sources: [
                {
                  workspaceId: options.workspace ?? null,
                  kind: derived
                    ? 'workspace'
                    : privateAttachment
                      ? 'private_attachment'
                      : 'unknown',
                  sourceId: `${derived ? 'derived-tool' : 'unverified-tool'}:${name}:${mcpDelegationFingerprint({ name, args, result })}`,
                },
              ],
            });
          }
          if (readFingerprint && requestedDocumentId) {
            readFingerprints.set(requestedDocumentId, readFingerprint);
          }
          return checkpointResult;
        },
      };
      const guardedExecute = guarded[name].execute;
      if (options.onToolExecution && guardedExecute) {
        const onToolExecution = options.onToolExecution;
        guarded[name].execute = async (args, executeOptions) => {
          executeOptions.signal?.throwIfAborted();
          const callId = executeOptions.toolCallId ?? '';
          await onToolExecution('started', name, callId);
          try {
            return await guardedExecute(args, executeOptions);
          } finally {
            await onToolExecution('completed', name, callId);
          }
        };
      }
    }
    return guarded;
  }

  createNativeAdapter(
    backend: ToolLoopBackend,
    tools: CopilotToolSet,
    options: {
      maxSteps?: number;
      nodeTextMiddleware?: NodeTextMiddleware[];
    } = {}
  ) {
    return createNativeToolLoopAdapter(backend, tools, options);
  }
}
