import { Framework, Store } from '@toeverything/infra';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseStore } from '../stores/enterprise';
import { EnterpriseService } from './enterprise';

class TestEnterpriseStore extends Store {
  getConnections = vi.fn();
  createConnection = vi.fn();
  beginAuthorization = vi.fn();
  getAuthorization = vi.fn();
  getLatestAuthorization = vi.fn();
  cancelAuthorization = vi.fn();
  refreshConnection = vi.fn();
  updateToolAllowlist = vi.fn();
  disableConnection = vi.fn();
  deleteConnection = vi.fn();
}

function createService() {
  const framework = new Framework();
  framework.store(TestEnterpriseStore);
  framework.service(
    EnterpriseService,
    provider =>
      new EnterpriseService(
        provider.get(TestEnterpriseStore) as unknown as EnterpriseStore
      )
  );
  const provider = framework.provider();
  return {
    service: provider.get(EnterpriseService),
    store: provider.get(TestEnterpriseStore),
  };
}

const authorization = (status: string) => ({
  id: 'authorization-1',
  connectionId: 'connection-1',
  workspaceId: 'workspace-1',
  provider: 'WECOM',
  status,
  authorizationUrl:
    status === 'WAITING'
      ? 'https://work.weixin.qq.com/wework_admin/frame'
      : null,
  userCode: null,
  qrCodeUrl: null,
  expiresAt: '2026-08-18T12:00:00.000Z',
  startedAt: null,
  completedAt: status === 'AUTHORIZED' ? '2026-08-18T11:00:00.000Z' : null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
});

describe('EnterpriseService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('polls cloud authorization to a terminal state and refreshes tools', async () => {
    const { service, store } = createService();
    store.getConnections.mockResolvedValue({ enterpriseConnections: [] });
    store.beginAuthorization.mockResolvedValue(authorization('PENDING'));
    store.getAuthorization
      .mockResolvedValueOnce(authorization('WAITING'))
      .mockResolvedValueOnce(authorization('AUTHORIZED'));

    await service.revalidate('workspace-1');
    await service.beginAuthorization('workspace-1', 'connection-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(service.authorization$.value?.status).toBe('WAITING');
    expect(store.getAuthorization).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(service.authorization$.value?.status).toBe('AUTHORIZED');
    expect(store.getConnections).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(store.getAuthorization).toHaveBeenCalledTimes(2);
  });

  test('stops local polling without cancelling the cloud session', async () => {
    const { service, store } = createService();
    store.beginAuthorization.mockResolvedValue(authorization('PENDING'));
    store.getAuthorization.mockResolvedValue(authorization('WAITING'));

    await service.beginAuthorization('workspace-1', 'connection-1');
    await vi.advanceTimersByTimeAsync(0);
    service.clearAuthorization();
    await vi.advanceTimersByTimeAsync(6_000);

    expect(service.authorization$.value).toBeNull();
    expect(store.getAuthorization).toHaveBeenCalledTimes(1);
    expect(store.cancelAuthorization).not.toHaveBeenCalled();
  });

  test('sends read and write tools to the enterprise allowlist', async () => {
    const { service, store } = createService();
    const connection = {
      id: 'connection-1',
      enabledToolNames: [],
      tools: [
        { name: 'wecom_doc_search', risk: 'read' },
        { name: 'wecom_doc_delete', risk: 'high' },
      ],
    };
    store.getConnections.mockResolvedValue({
      enterpriseConnections: [connection],
    });
    store.updateToolAllowlist.mockResolvedValue({
      id: connection.id,
      enabledToolNames: ['wecom_doc_search', 'wecom_doc_delete'],
    });
    await service.revalidate('workspace-1');

    await service.updateToolAllowlist('workspace-1', connection.id, [
      'wecom_doc_search',
      'wecom_doc_delete',
    ]);

    expect(store.updateToolAllowlist).toHaveBeenCalledWith(
      'workspace-1',
      connection.id,
      ['wecom_doc_search', 'wecom_doc_delete']
    );
  });
});
