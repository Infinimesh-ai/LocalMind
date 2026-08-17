import { Framework, Store } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import type { ExternalMcpStore } from '../stores/external-mcp';
import { ExternalMcpService } from './external-mcp';

class TestExternalMcpStore extends Store {
  get = vi.fn();
  connect = vi.fn();
}

function createService() {
  const framework = new Framework();
  framework.store(TestExternalMcpStore);
  framework.service(
    ExternalMcpService,
    provider =>
      new ExternalMcpService(
        provider.get(TestExternalMcpStore) as unknown as ExternalMcpStore
      )
  );
  const provider = framework.provider();
  return {
    service: provider.get(ExternalMcpService),
    store: provider.get(TestExternalMcpStore),
  };
}

describe('ExternalMcpService', () => {
  test('clears another workspace connection while the next workspace loads', async () => {
    let resolveNext: ((value: any) => void) | undefined;
    const { service, store } = createService();
    store.get
      .mockResolvedValueOnce({
        externalMcpSettings: {
          endpoint: 'http://192.168.20.252:18791/mcp',
          protocolVersion: '2025-06-18',
          connection: { id: 'connection-a', workspaceId: 'workspace-a' },
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveNext = resolve;
          })
      );
    await service.revalidate('workspace-a');
    expect(service.settings$.value?.connection?.id).toBe('connection-a');

    const loading = service.revalidate('workspace-b');
    expect(service.settings$.value).toBeNull();
    expect(service.loading$.value).toBe(true);

    resolveNext?.({
      externalMcpSettings: {
        endpoint: 'http://192.168.20.252:18791/mcp',
        protocolVersion: '2025-06-18',
        connection: { id: 'connection-b', workspaceId: 'workspace-b' },
      },
    });
    await loading;

    expect(service.settings$.value?.connection?.id).toBe('connection-b');
    expect(service.loading$.value).toBe(false);
  });

  test('does not restore an old workspace after its mutation finishes', async () => {
    let resolveConnect: ((value: any) => void) | undefined;
    const { service, store } = createService();
    store.get
      .mockResolvedValueOnce({
        externalMcpSettings: {
          endpoint: 'http://192.168.20.252:18791/mcp',
          protocolVersion: '2025-06-18',
          connection: { id: 'connection-a', workspaceId: 'workspace-a' },
        },
      })
      .mockResolvedValueOnce({
        externalMcpSettings: {
          endpoint: 'http://192.168.20.252:18791/mcp',
          protocolVersion: '2025-06-18',
          connection: { id: 'connection-b', workspaceId: 'workspace-b' },
        },
      });
    store.connect.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveConnect = resolve;
        })
    );

    await service.revalidate('workspace-a');
    const connecting = service.connect({
      workspaceId: 'workspace-a',
      name: 'SparkClaw MCP',
      accessTicket: 'ticket-once',
    });
    await service.revalidate('workspace-b');

    resolveConnect?.({ id: 'connection-a', status: 'ACTIVE' });
    await connecting;

    expect(service.settings$.value?.connection?.id).toBe('connection-b');
    expect(store.get).toHaveBeenCalledTimes(2);
  });
});
