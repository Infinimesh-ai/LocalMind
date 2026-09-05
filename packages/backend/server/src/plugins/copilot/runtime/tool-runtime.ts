import { randomUUID } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { Config } from '../../../base';
import {
  DocReader,
  DocWriter,
  WorkspaceOrganizationService,
} from '../../../core/doc';
import { PermissionAccess, PermissionService } from '../../../core/permission';
import { Models } from '../../../models';
import { mcpDelegationFingerprint } from '../../../models/copilot-mcp-delegation';
import { IndexerService } from '../../indexer';
import type { NodeTextMiddleware } from '../config';
import { CopilotContextService } from '../context/service';
import {
  type EnterpriseToolCapabilitySnapshot,
  EnterpriseToolRegistry,
} from '../enterprise';
import { ExternalMcpToolRegistry } from '../external-mcp';
import { McpAttachmentService } from '../mcp/attachments';
import { OfficeAgentCommandService } from '../office-agent-command';
import {
  type CopilotChatOptions,
  type CopilotChatTools,
  type PromptMessage,
} from '../providers/types';
import {
  buildBlobContentGetter,
  buildDocContentGetter,
  buildDocCreateHandler,
  buildDocKeywordSearchGetter,
  buildDocSearchGetter,
  buildDocUpdateHandler,
  buildDocUpdateMetaHandler,
  buildOfficeCommandBatchRequestHandler,
  buildOfficeCommandRequestHandler,
  buildOfficeReadHandler,
  buildProjectDocContentGetter,
  buildProjectDocKeywordSearchGetter,
  buildProjectDocSearchGetter,
  type CopilotTool,
  type CopilotToolSet,
  createBlobReadTool,
  createBlockerSuggestionTool,
  createCodeArtifactTool,
  createConversationSummaryTool,
  createDocComposeTool,
  createDocCreateTool,
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
  createProjectDocKeywordSearchTool,
  createProjectDocReadTool,
  createProjectDocSemanticSearchTool,
  createProjectDocUpdateRequestTool,
  createSectionEditTool,
  createTaskAttachmentReadTool,
  createWorkspaceOrganizationTools,
  defineTool,
} from '../tools';
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
  'blob_read',
  'task_attachment_read',
  'code_artifact',
  'conversation_summary',
  'doc_semantic_search',
  'doc_keyword_search',
  'project_doc_read',
  'web_search_exa',
  'web_crawl_exa',
  'doc_compose',
  'section_edit',
  'conditional_noop_complete',
  'blocker_suggest',
]);

const PROJECT_SESSION_APPROVAL_GATED_TOOLS = new Set([
  'project_doc_update_request',
]);

export function canRunDirectlyInProjectSession(toolName: string) {
  return (
    PROJECT_SESSION_DIRECT_READ_TOOLS.has(toolName) &&
    toolSideEffectType(toolName) === 'read'
  );
}

export function canExposeInProjectSession(toolName: string) {
  return (
    canRunDirectlyInProjectSession(toolName) ||
    PROJECT_SESSION_APPROVAL_GATED_TOOLS.has(toolName)
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
    @Optional() private readonly mcpAttachments?: McpAttachmentService
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
          workspaceId: string;
          docId: string | null;
          selectedContextProjectId: string | null;
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
    for (const tool of options.tools) {
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
          const docContext = options.session
            ? await this.context.getBySessionId(options.session)
            : null;
          if (!docContext) break;
          const getBlobContent = buildBlobContentGetter(this.ac, docContext);
          tools.blob_read = createBlobReadTool(
            getBlobContent.bind(null, options)
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
          if (selectedProjectId) {
            const searchDocs = buildProjectDocSearchGetter(
              this.ac,
              this.context,
              this.models
            );
            tools.doc_semantic_search = createProjectDocSemanticSearchTool(
              searchDocs.bind(null, options)
            );
            break;
          }
          const searchDocs = buildDocSearchGetter(
            this.ac,
            this.context,
            options.session,
            this.models
          );
          tools.doc_semantic_search = createDocSemanticSearchTool(
            searchDocs.bind(null, options)
          );
          break;
        }
        case 'docKeywordSearch': {
          if (selectedProjectId) {
            const searchDocs = buildProjectDocKeywordSearchGetter(
              this.ac,
              this.indexerService,
              this.models,
              this.docReader
            );
            tools.doc_keyword_search = createProjectDocKeywordSearchTool(
              searchDocs.bind(null, options)
            );
            break;
          }
          const searchDocs = buildDocKeywordSearchGetter(
            this.ac,
            this.permission,
            this.indexerService,
            this.models,
            this.docReader
          );
          tools.doc_keyword_search = createDocKeywordSearchTool(
            searchDocs.bind(null, options)
          );
          break;
        }
        case 'docRead': {
          if (selectedProjectId) {
            const getProjectDoc = buildProjectDocContentGetter(
              this.ac,
              this.docReader,
              this.models
            );
            tools.project_doc_read = createProjectDocReadTool(
              getProjectDoc.bind(null, options)
            );
            break;
          }
          const getDoc = buildDocContentGetter(
            this.ac,
            this.docReader,
            this.models
          );
          tools.doc_read = createDocReadTool(getDoc.bind(null, options));
          break;
        }
        case 'docCreate': {
          const createDoc = buildDocCreateHandler(this.ac, this.docWriter);
          tools.doc_create = createDocCreateTool(createDoc.bind(null, options));
          break;
        }
        case 'docUpdate': {
          if (selectedProjectId) {
            tools.project_doc_update_request =
              createProjectDocUpdateRequestTool({
                ac: this.ac,
                models: this.models,
                options,
              });
            break;
          }
          const updateDoc = buildDocUpdateHandler(this.ac, this.docWriter);
          tools.doc_update = createDocUpdateTool(updateDoc.bind(null, options));
          break;
        }
        case 'docUpdateMeta': {
          const updateDocMeta = buildDocUpdateMetaHandler(
            this.ac,
            this.docWriter
          );
          tools.doc_update_meta = createDocUpdateMetaTool(
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
          tools.office_read = createOfficeReadTool(selector =>
            readOffice(options, undefined, undefined, selector)
          );
          tools.office_command_request = createOfficeCommandRequestTool(
            requestOfficeCommand.bind(null, options)
          );
          tools.office_command_batch_request =
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
            workbenchSession.workspaceId !== options.workspace ||
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

    const guarded = this.applyExecutionGuards(tools, options);
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
      Object.keys(guarded).some(name => !canExposeInProjectSession(name))
        ? await resolveSelectedProjectId()
        : (selectedProjectId ?? null);
    return Object.fromEntries(
      Object.entries(guarded).filter(([name, tool]) => {
        if (activeProjectId && !canExposeInProjectSession(name)) {
          return false;
        }
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
    options: NonNullable<CopilotChatOptions>
  ) {
    if (!options.maxToolExecutions && !options.conditionalDocumentUpdate) {
      return tools;
    }

    const readFingerprints = new Map<string, string>();
    const guarded: CopilotToolSet = { ...tools };
    if (options.conditionalDocumentUpdate) {
      guarded.conditional_noop_complete = defineTool({
        description:
          'Complete a conditional document update without writing only after doc_read proved the requested condition is already satisfied. Pass the exact readFingerprint returned by doc_read.',
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
            name === 'doc_update' &&
            requestedDocumentId === conditionalDocumentId &&
            !readFingerprints.has(conditionalDocumentId)
          ) {
            throw new Error('conditional_document_update_requires_read');
          }

          const result = await execute(args, executeOptions);
          const resultObject =
            result && typeof result === 'object' && !Array.isArray(result)
              ? (result as Record<string, unknown>)
              : null;
          const failed =
            resultObject?.type === 'error' || resultObject?.success === false;
          if (
            !failed &&
            name === 'doc_read' &&
            requestedDocumentId &&
            requestedDocumentId === conditionalDocumentId
          ) {
            const readFingerprint = mcpDelegationFingerprint({
              version: 'localmind-conditional-document-read/v1',
              documentId: requestedDocumentId,
              result,
            });
            readFingerprints.set(requestedDocumentId, readFingerprint);
            return resultObject
              ? { ...resultObject, readFingerprint }
              : { result, readFingerprint };
          }
          return result;
        },
      };
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
