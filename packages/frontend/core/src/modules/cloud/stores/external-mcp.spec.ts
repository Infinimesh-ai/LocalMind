import { connectExternalMcpMutation } from '@affine/graphql';
import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { GraphQLService } from '../services/graphql';
import { ExternalMcpStore } from './external-mcp';

function createStore(gql: ReturnType<typeof vi.fn>) {
  const framework = new Framework();
  framework.service(GraphQLService, { gql } as any);
  framework.store(ExternalMcpStore, [GraphQLService]);
  return framework.provider().get(ExternalMcpStore);
}

describe('ExternalMcpStore', () => {
  test('sends the one-time ticket without accepting a client endpoint', async () => {
    const connected = { id: 'connection-1', status: 'ACTIVE' };
    const gql = vi.fn().mockResolvedValue({ connectExternalMcp: connected });
    const store = createStore(gql);

    await expect(
      store.connect({
        workspaceId: 'workspace-1',
        name: 'SparkClaw MCP',
        accessTicket: 'ticket-once',
      })
    ).resolves.toBe(connected);
    expect(gql).toHaveBeenCalledWith({
      query: connectExternalMcpMutation,
      variables: {
        input: {
          workspaceId: 'workspace-1',
          name: 'SparkClaw MCP',
          accessTicket: 'ticket-once',
        },
      },
    });
    expect(JSON.stringify(gql.mock.calls)).not.toContain('endpoint');
  });
});
