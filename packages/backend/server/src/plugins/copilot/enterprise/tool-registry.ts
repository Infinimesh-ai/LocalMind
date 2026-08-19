import { Injectable } from '@nestjs/common';

import type { CopilotToolSet } from '../tools';
import { EnterpriseConnectionService } from './service';

const MAX_ENTERPRISE_TOOLS_PER_SESSION = 32;

@Injectable()
export class EnterpriseToolRegistry {
  constructor(private readonly connections: EnterpriseConnectionService) {}

  async getTools(input: {
    workspaceId: string;
    userId: string;
  }): Promise<CopilotToolSet> {
    const tools: CopilotToolSet = {};
    const connections = await this.connections.activeConnections(
      input.workspaceId,
      input.userId
    );
    for (const connection of connections) {
      const enabled = new Set(connection.enabledToolNames);
      for (const tool of this.connections.catalog(connection)) {
        if (Object.keys(tools).length >= MAX_ENTERPRISE_TOOLS_PER_SESSION) {
          return tools;
        }
        if (!enabled.has(tool.name) || tool.risk !== 'read') continue;
        const registeredName = this.registeredName(tool.name, connection.id);
        tools[registeredName] = {
          description: `${tool.description ?? tool.command.join(' ')} (connection: ${connection.name})`,
          jsonSchema: tool.inputSchema,
          inputSchema: tool.inputSchema,
          execute: async (args, options) =>
            await this.connections.execute({
              connection,
              actorId: input.userId,
              toolName: tool.name,
              arguments: args,
              confirmed: false,
              signal: options.signal,
            }),
        };
      }
    }
    return tools;
  }

  private registeredName(toolName: string, connectionId: string) {
    const suffix = connectionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    return `${toolName.slice(0, 55)}_${suffix}`;
  }
}
