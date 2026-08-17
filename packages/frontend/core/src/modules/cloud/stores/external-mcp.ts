import type { ConnectExternalMcpMutationVariables } from '@affine/graphql';
import {
  connectExternalMcpMutation,
  deleteExternalMcpMutation,
  disableExternalMcpMutation,
  externalMcpSettingsQuery,
  refreshExternalMcpToolsMutation,
  testExternalMcpConversationMutation,
  updateExternalMcpToolAllowlistMutation,
} from '@affine/graphql';
import { Store } from '@toeverything/infra';

import type { GraphQLService } from '../services/graphql';

export class ExternalMcpStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async get(workspaceId: string, signal?: AbortSignal) {
    return await this.gqlService.gql({
      query: externalMcpSettingsQuery,
      variables: { workspaceId },
      context: { signal },
    });
  }

  async connect(input: ConnectExternalMcpMutationVariables['input']) {
    const data = await this.gqlService.gql({
      query: connectExternalMcpMutation,
      variables: {
        input: {
          workspaceId: input.workspaceId,
          name: input.name,
          accessTicket: input.accessTicket,
        },
      },
    });
    return data.connectExternalMcp;
  }

  async refreshTools(workspaceId: string) {
    const data = await this.gqlService.gql({
      query: refreshExternalMcpToolsMutation,
      variables: { workspaceId },
    });
    return data.refreshExternalMcpTools;
  }

  async updateToolAllowlist(workspaceId: string, enabledToolNames: string[]) {
    const data = await this.gqlService.gql({
      query: updateExternalMcpToolAllowlistMutation,
      variables: { workspaceId, enabledToolNames },
    });
    return data.updateExternalMcpToolAllowlist;
  }

  async testConversation(workspaceId: string, query: string) {
    const data = await this.gqlService.gql({
      query: testExternalMcpConversationMutation,
      variables: { workspaceId, query },
    });
    return data.testExternalMcpConversation;
  }

  async disable(workspaceId: string) {
    const data = await this.gqlService.gql({
      query: disableExternalMcpMutation,
      variables: { workspaceId },
    });
    return data.disableExternalMcp;
  }

  async delete(workspaceId: string) {
    const data = await this.gqlService.gql({
      query: deleteExternalMcpMutation,
      variables: { workspaceId },
    });
    return data.deleteExternalMcp;
  }
}
