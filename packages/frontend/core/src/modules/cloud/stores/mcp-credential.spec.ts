import { createMcpCredentialMutation, McpAccessMode } from '@affine/graphql';
import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { GraphQLService } from '../services/graphql';
import { McpCredentialStore } from './mcp-credential';

function createStore(gql: ReturnType<typeof vi.fn>) {
  const framework = new Framework();
  framework.service(GraphQLService, { gql } as any);
  framework.store(McpCredentialStore, [GraphQLService]);
  return framework.provider().get(McpCredentialStore);
}

describe('McpCredentialStore', () => {
  test('forwards requested capability scopes when creating a credential', async () => {
    const created = {
      credential: { id: 'credential-1' },
      token: 'token',
    };
    const gql = vi.fn().mockResolvedValue({ createMcpCredential: created });
    const store = createStore(gql);
    const capabilities = [
      'delegate_to_localmind',
      'get_localmind_task',
      'control_localmind_task',
    ];

    await expect(
      store.create({
        workspaceId: 'workspace-1',
        name: 'Codex',
        accessMode: McpAccessMode.READ_WRITE,
        capabilities,
        expirationDays: 90,
        callbackUrl: 'https://sparkclaw.example/approvals',
      })
    ).resolves.toBe(created);
    expect(gql).toHaveBeenCalledWith({
      query: createMcpCredentialMutation,
      variables: {
        input: {
          workspaceId: 'workspace-1',
          name: 'Codex',
          accessMode: McpAccessMode.READ_WRITE,
          capabilities,
          expirationDays: 90,
          callbackUrl: 'https://sparkclaw.example/approvals',
        },
      },
    });
  });
});
