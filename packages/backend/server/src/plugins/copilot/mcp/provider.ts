import { Injectable } from '@nestjs/common';
import { McpAccessMode, type McpCredential } from '@prisma/client';
import type { Request } from 'express';

import {
  MCP_DELEGATE_CAPABILITY,
  MCP_DELEGATION_CAPABILITIES,
  MCP_TASK_CONTROL_CAPABILITY,
  MCP_TASK_QUERY_CAPABILITY,
  type McpCapability,
  normalizeMcpCapabilities,
} from './capabilities';
import { McpAiDelegationService } from './delegation';
import { McpResourcesService } from './resources';
import { McpAiTaskControlService } from './task-control';
import { McpAiTaskQueryService } from './task-query';
import type { WorkspaceMcpServer } from './types';

export type {
  WorkspaceMcpResource,
  WorkspaceMcpResourceContents,
  WorkspaceMcpResourcePage,
  WorkspaceMcpResourceTemplate,
  WorkspaceMcpServer,
  WorkspaceMcpToolDefinition,
  WorkspaceMcpToolResult,
} from './types';

type McpDelegationCredential = Pick<
  McpCredential,
  | 'id'
  | 'familyId'
  | 'generation'
  | 'userId'
  | 'workspaceId'
  | 'accessMode'
  | 'capabilities'
>;

@Injectable()
export class WorkspaceMcpProvider {
  constructor(
    private readonly delegation: McpAiDelegationService,
    private readonly taskControl: McpAiTaskControlService,
    private readonly taskQuery: McpAiTaskQueryService,
    private readonly resources: McpResourcesService
  ) {}

  async for(
    userId: string,
    workspaceId: string,
    capabilitiesOrAccessMode:
      | readonly string[]
      | McpAccessMode = McpAccessMode.READ_ONLY,
    _request?: Request,
    authenticatedCredential?: McpDelegationCredential
  ): Promise<WorkspaceMcpServer> {
    const capabilities =
      typeof capabilitiesOrAccessMode === 'string'
        ? normalizeMcpCapabilities(undefined, capabilitiesOrAccessMode)
        : normalizeMcpCapabilities(
            capabilitiesOrAccessMode,
            McpAccessMode.READ_ONLY
          );
    const credential: McpDelegationCredential = authenticatedCredential ?? {
      id: 'direct-provider-call',
      familyId: 'direct-provider-call',
      generation: 0,
      userId,
      workspaceId,
      accessMode:
        typeof capabilitiesOrAccessMode === 'string'
          ? capabilitiesOrAccessMode
          : McpAccessMode.READ_ONLY,
      capabilities,
    };

    return this.server(credential, capabilities);
  }

  private server(
    credential: McpDelegationCredential,
    capabilities: readonly McpCapability[]
  ): WorkspaceMcpServer {
    const tools: WorkspaceMcpServer['tools'] = [];
    if (capabilities.includes(MCP_DELEGATE_CAPABILITY)) {
      tools.push(
        this.delegation.createTool(
          credential,
          capabilities.filter(capability =>
            (MCP_DELEGATION_CAPABILITIES as readonly string[]).includes(
              capability
            )
          )
        )
      );
    }
    if (capabilities.includes(MCP_TASK_QUERY_CAPABILITY)) {
      tools.push(this.taskQuery.createTool(credential));
    }
    if (capabilities.includes(MCP_TASK_CONTROL_CAPABILITY)) {
      tools.push(this.taskControl.createTool(credential));
    }
    tools.push(...this.resources.tools(credential, capabilities));
    return {
      name: 'localmind-ai',
      version: '3.5.0',
      instructions: [
        'LOCALMIND-SCOPED TOOL ROUTING - apply the most specific matching rule first.',
        'Use these tools only for requests directed to LocalMind: the user explicitly asks LocalMind to answer or act, or the request requires LocalMind-managed documents, attachments, workspace resources, tasks, connected data, or other LocalMind-specific capabilities.',
        'Do not use this server as a global request router. It must not intercept, reroute, delay, or otherwise affect ordinary conversations or native workflows in host agents such as Codex, Claude, or other MCP clients.',
        'A request that merely mentions, discusses, configures, or troubleshoots LocalMind is not directed to LocalMind unless the user explicitly asks LocalMind to execute work.',
        'If the user only asks for the status, progress, or final result of an existing task and its taskId is known from delegate_to_localmind, use get_localmind_task directly. Do not call delegate_to_localmind first and never create or guess a taskId.',
        'If the user explicitly asks to stop or cancel an unfinished existing task and its taskId is known, use control_localmind_task directly. Do not call delegate_to_localmind first.',
        'Use workspace_operation_get to reconcile a known direct operationId. For explicit resource operations and prepared content, use the granted workspace_* direct tools. They never invoke a model or create an AI task. When the caller explicitly delegates interpretation, generation or multi-step work to LocalMind AI, submit the complete request through delegate_to_localmind. Never change a direct failure into a delegation to bypass authorization, conflicts or unsupported content.',
        'When a delegated request includes local files, include them directly in delegate_to_localmind.attachments so the request and its files are submitted in one tool call. Use attachmentIds only to reuse attachments returned by an earlier delegation in the same credential family.',
        'LocalMind work can include answering questions, reading or searching documents, creating or editing documents, web research, and multi-step workspace tasks.',
        'Use only tools discovered for this credential. Direct resource capability and AI delegation capability are independent. operationId, taskId, documentId and folderId identify different objects; never substitute titles or paths for resource IDs. Reuse the original idempotencyKey and identical arguments after uncertain writes.',
        'After a queued or running result, poll get_localmind_task using pollAfterMs until terminal is true, unless a terminal callback is configured.',
        'LocalMind applies the credential capability ceiling and the delegated user real-time ACL.',
        'Permission failures are terminal and never request elevated access.',
        'Authorized side effects execute asynchronously; configured callbacks deliver terminal result notifications.',
      ].join(' '),
      tools,
      unavailableToolResult: name =>
        this.resources.unavailableToolResult(credential, name),
    };
  }
}
