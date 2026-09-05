import { describe, expect, test, vi } from 'vitest';

import { navigateUrlInActiveTab } from '../../src/main/windows-manager/tab-navigation';

describe('Electron active-tab navigation', () => {
  test('creates a tab with the complete global route on cold start', async () => {
    const addTabWithUrl = vi.fn();

    await navigateUrlInActiveTab({
      url: 'localmind://app.local/tasks?filter=all&taskId=task-b#timeline',
      mainWindowOrigin: 'localmind-internal://app.local',
      activeWorkbenchId: undefined,
      activeWorkbench: undefined,
      getActiveWorkbenchView: () => undefined,
      updateWorkbench: vi.fn(),
      showTab: vi.fn(),
      addTabWithUrl,
    });

    expect(addTabWithUrl).toHaveBeenCalledWith(
      'localmind://app.local/tasks?filter=all&taskId=task-b#timeline'
    );
  });

  test('loads an absent active view from updated top-level route metadata', async () => {
    const updateWorkbench = vi.fn();
    const showTab = vi.fn();
    const addTabWithUrl = vi.fn();

    await navigateUrlInActiveTab({
      url: 'localmind://app.local/tasks?taskId=task-b',
      mainWindowOrigin: 'localmind-internal://app.local',
      activeWorkbenchId: 'tab-1',
      activeWorkbench: {
        activeViewIndex: 0,
        views: [{ path: { pathname: '/intelligence' } }],
      },
      getActiveWorkbenchView: () => undefined,
      updateWorkbench,
      showTab,
      addTabWithUrl,
    });

    expect(updateWorkbench).toHaveBeenCalledWith('tab-1', {
      basename: '/',
      activeViewIndex: 0,
      views: [
        {
          path: {
            pathname: '/tasks',
            search: '?taskId=task-b',
            hash: '',
          },
        },
      ],
    });
    expect(showTab).toHaveBeenCalledWith('tab-1');
    expect(addTabWithUrl).not.toHaveBeenCalled();
  });

  test('loads the global route directly when the active view exists', async () => {
    const loadURL = vi.fn();

    await navigateUrlInActiveTab({
      url: 'localmind://app.local/tasks?filter=completed#timeline',
      mainWindowOrigin: 'localmind-internal://app.local',
      activeWorkbenchId: 'tab-1',
      activeWorkbench: {
        activeViewIndex: 0,
        views: [{ path: { pathname: '/intelligence' } }],
      },
      getActiveWorkbenchView: () => ({ webContents: { loadURL } }),
      updateWorkbench: vi.fn(),
      showTab: vi.fn(),
      addTabWithUrl: vi.fn(),
    });

    expect(loadURL).toHaveBeenCalledWith(
      'localmind-internal://app.local/tasks?filter=completed#timeline'
    );
  });
});
