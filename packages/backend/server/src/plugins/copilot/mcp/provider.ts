import { Injectable } from '@nestjs/common';
import { McpAccessMode, type McpCredential } from '@prisma/client';
import type { Request } from 'express';

import {
  MCP_DELEGATE_CAPABILITY,
  MCP_TASK_CONTROL_CAPABILITY,
  MCP_TASK_QUERY_CAPABILITY,
  type McpCapability,
  normalizeMcpCapabilities,
} from './capabilities';
import { McpAiDelegationService } from './delegation';
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
    private readonly taskQuery: McpAiTaskQueryService
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
      tools.push(this.delegation.createTool(credential, capabilities));
    }
    if (capabilities.includes(MCP_TASK_QUERY_CAPABILITY)) {
      tools.push(this.taskQuery.createTool(credential));
    }
    if (capabilities.includes(MCP_TASK_CONTROL_CAPABILITY)) {
      tools.push(this.taskControl.createTool(credential));
    }
    return {
      name: 'localmind-ai',
      version: '3.4.0',
      instructions: [
        'LOCALMIND-SCOPED TOOL ROUTING - apply the most specific matching rule first.',
        'Use these tools only for requests directed to LocalMind: the user explicitly asks LocalMind to answer or act, or the request requires LocalMind-managed documents, attachments, workspace resources, tasks, connected data, or other LocalMind-specific capabilities.',
        'Do not use this server as a global request router. It must not intercept, reroute, delay, or otherwise affect ordinary conversations or native workflows in host agents such as Codex, Claude, or other MCP clients.',
        'A request that merely mentions, discusses, configures, or troubleshoots LocalMind is not directed to LocalMind unless the user explicitly asks LocalMind to execute work.',
        'If the user only asks for the status, progress, or final result of an existing task and its taskId is known from delegate_to_localmind, use get_localmind_task directly. Do not call delegate_to_localmind first and never create or guess a taskId.',
        'If the user explicitly asks to stop or cancel an unfinished existing task and its taskId is known, use control_localmind_task directly. Do not call delegate_to_localmind first.',
        'For every other request directed to LocalMind that asks for an answer or action, including follow-ups that request additional work, revisions, continuations, and retries, submit the complete request through delegate_to_localmind.',
        'When a delegated request includes local files, include them directly in delegate_to_localmind.attachments so the request and its files are submitted in one tool call. Use attachmentIds only to reuse attachments returned by an earlier delegation in the same credential family.',
        'LocalMind work can include answering questions, reading or searching documents, creating or editing documents, web research, and multi-step workspace tasks.',
        'Do not call or search for internal AI tools such as doc_create or doc_read; they are not public MCP tools, and LocalMind selects them after delegation.',
        'After a queued or running result, poll get_localmind_task using pollAfterMs until terminal is true, unless a terminal callback is configured.',
        'LocalMind applies the credential capability ceiling and the delegated user real-time ACL.',
        'Permission failures are terminal and never request elevated access.',
        'Authorized side effects execute asynchronously; configured callbacks deliver terminal result notifications.',
      ].join(' '),
      tools,
    };
  }
}
