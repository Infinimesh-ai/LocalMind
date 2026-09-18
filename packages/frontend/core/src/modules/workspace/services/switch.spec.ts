import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceSwitchService } from './switch';

const createService = () => {
  const framework = new Framework();
  framework.service(WorkspaceSwitchService);
  return framework.provider().get(WorkspaceSwitchService);
};

describe('WorkspaceSwitchService', () => {
  test('reuses the switch id for duplicate target clicks', () => {
    const service = createService();
    const first = service.begin('workspace-b');
    const second = service.begin('workspace-b');

    expect(second).toBe(first);
    expect(service.isPending('workspace-b')).toBe(true);
  });

  test('uses latest-wins semantics for rapid switches', () => {
    const service = createService();
    const first = service.begin('workspace-b');
    const second = service.begin('workspace-c');

    expect(service.isCurrent(first)).toBe(false);
    expect(service.isCurrent(second)).toBe(true);
    expect(service.phase(first, 'local-ready')).toBe(false);
    expect(service.state$.value).toMatchObject({
      switchId: second,
      targetWorkspaceId: 'workspace-c',
      phase: 'preparing',
    });
  });

  test('keeps failures scoped to the current switch', () => {
    const service = createService();
    const oldSwitch = service.begin('workspace-b');
    const currentSwitch = service.begin('workspace-c');

    expect(service.fail(oldSwitch, 'open', new Error('stale'))).toBe(false);
    expect(service.fail(currentSwitch, 'open', new TypeError('failed'))).toBe(
      true
    );
    expect(service.phase(currentSwitch, 'ready')).toBe(false);
    expect(service.state$.value).toMatchObject({
      phase: 'failed',
      failurePhase: 'open',
      errorType: 'TypeError',
    });
  });

  test('emits the documented performance marks', () => {
    const mark = vi.spyOn(performance, 'mark');
    const service = createService();
    const switchId = service.begin('workspace-b');
    service.routeCommitted('workspace-b');
    service.phase(switchId, 'preparing');
    service.engineStarted(switchId);
    service.remoteConnected(switchId);
    service.phase(switchId, 'local-ready');
    service.phase(switchId, 'committed');
    service.phase(switchId, 'ready');

    expect(mark.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'workspace-switch-click',
        'workspace-switch-route-committed',
        'workspace-switch-open-start',
        'workspace-switch-engine-start',
        'workspace-switch-remote-connected',
        'workspace-switch-local-root-ready',
        'workspace-switch-ui-committed',
        'workspace-switch-sync-ready',
      ])
    );
    mark.mockRestore();
  });
});
