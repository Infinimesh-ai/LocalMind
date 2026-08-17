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
      version: '3.2.0',
      instructions: [
        'Delegate the complete natural-language task through delegate_to_localmind.',
        'Use get_localmind_task to reconcile persisted task state after an asynchronous return or callback.',
        'Use control_localmind_task only to cancel unfinished work.',
        'LocalMind applies the credential capability ceiling and the delegated user real-time ACL.',
        'Permission failures are terminal and never request elevated access.',
        'Authorized side effects execute asynchronously; configured callbacks deliver terminal result notifications.',
      ].join(' '),
      tools,
    };
  }
}
