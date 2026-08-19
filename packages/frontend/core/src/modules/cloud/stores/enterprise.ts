import type { CreateEnterpriseConnectionMutationVariables } from '@affine/graphql';
import {
  beginEnterpriseAuthorizationMutation,
  cancelEnterpriseAuthorizationMutation,
  createEnterpriseConnectionMutation,
  deleteEnterpriseConnectionMutation,
  disableEnterpriseConnectionMutation,
  enterpriseAuthorizationSessionQuery,
  enterpriseConnectionsQuery,
  latestEnterpriseAuthorizationSessionQuery,
  refreshEnterpriseConnectionMutation,
  updateEnterpriseToolAllowlistMutation,
} from '@affine/graphql';
import { Store } from '@toeverything/infra';

import type { GraphQLService } from '../services/graphql';

export class EnterpriseStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async getConnections(workspaceId: string, signal?: AbortSignal) {
    return await this.gqlService.gql({
      query: enterpriseConnectionsQuery,
      variables: { workspaceId },
      context: { signal },
    });
  }

  async createConnection(
    input: CreateEnterpriseConnectionMutationVariables['input']
  ) {
    const data = await this.gqlService.gql({
      query: createEnterpriseConnectionMutation,
      variables: { input },
    });
    return data.createEnterpriseConnection;
  }

  async beginAuthorization(workspaceId: string, connectionId: string) {
    const data = await this.gqlService.gql({
      query: beginEnterpriseAuthorizationMutation,
      variables: { workspaceId, connectionId },
    });
    return data.beginEnterpriseAuthorization;
  }

  async getAuthorization(
    workspaceId: string,
    sessionId: string,
    signal?: AbortSignal
  ) {
    const data = await this.gqlService.gql({
      query: enterpriseAuthorizationSessionQuery,
      variables: { workspaceId, sessionId },
      context: { signal },
    });
    return data.enterpriseAuthorizationSession;
  }

  async getLatestAuthorization(
    workspaceId: string,
    connectionId: string,
    signal?: AbortSignal
  ) {
    const data = await this.gqlService.gql({
      query: latestEnterpriseAuthorizationSessionQuery,
      variables: { workspaceId, connectionId },
      context: { signal },
    });
    return data.latestEnterpriseAuthorizationSession;
  }

  async cancelAuthorization(workspaceId: string, sessionId: string) {
    const data = await this.gqlService.gql({
      query: cancelEnterpriseAuthorizationMutation,
      variables: { workspaceId, sessionId },
    });
    return data.cancelEnterpriseAuthorization;
  }

  async refreshConnection(workspaceId: string, connectionId: string) {
    const data = await this.gqlService.gql({
      query: refreshEnterpriseConnectionMutation,
      variables: { workspaceId, connectionId },
    });
    return data.refreshEnterpriseConnection;
  }

  async updateToolAllowlist(
    workspaceId: string,
    connectionId: string,
    enabledToolNames: string[]
  ) {
    const data = await this.gqlService.gql({
      query: updateEnterpriseToolAllowlistMutation,
      variables: { workspaceId, connectionId, enabledToolNames },
    });
    return data.updateEnterpriseToolAllowlist;
  }

  async disableConnection(workspaceId: string, connectionId: string) {
    const data = await this.gqlService.gql({
      query: disableEnterpriseConnectionMutation,
      variables: { workspaceId, connectionId },
    });
    return data.disableEnterpriseConnection;
  }

  async deleteConnection(workspaceId: string, connectionId: string) {
    const data = await this.gqlService.gql({
      query: deleteEnterpriseConnectionMutation,
      variables: { workspaceId, connectionId },
    });
    return data.deleteEnterpriseConnection;
  }
}
