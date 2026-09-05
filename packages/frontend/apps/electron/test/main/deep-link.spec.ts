import type { App } from 'electron';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  addTabWithUrl: vi.fn(),
  loadUrlInActiveTab: vi.fn(),
  openUrlInHiddenWindow: vi.fn(),
  showMainWindow: vi.fn(),
}));

vi.mock('../../src/main/config', () => ({
  buildType: 'stable',
  isDev: false,
}));

vi.mock('../../src/main/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock('../../src/main/ui', () => ({
  uiSubjects: {
    // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the Subject API.
    authenticationRequest$: { next: vi.fn() },
  },
}));

vi.mock('../../src/main/windows-manager', () => ({
  addTabWithUrl: state.addTabWithUrl,
  loadUrlInActiveTab: state.loadUrlInActiveTab,
  openUrlInHiddenWindow: state.openUrlInHiddenWindow,
  showMainWindow: state.showMainWindow,
}));

import { setupDeepLink } from '../../src/main/deep-link';

describe('Electron deep-link startup', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    state.addTabWithUrl.mockReset();
    state.loadUrlInActiveTab.mockReset();
    state.openUrlInHiddenWindow.mockReset();
    state.showMainWindow.mockReset();
    process.argv = [
      'electron',
      'app.js',
      'localmind://app.local/tasks?filter=all&taskId=workspace-b-task',
    ];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  test('sends a cold-start global Tasks link through active-tab loading', async () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const app = {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
      setAsDefaultProtocolClient: vi.fn(),
    } as unknown as App;

    setupDeepLink(app);
    listeners.get('ready')?.();

    await vi.waitFor(() => {
      expect(state.showMainWindow).toHaveBeenCalled();
      expect(state.loadUrlInActiveTab).toHaveBeenCalledWith(
        'localmind://app.local/tasks?filter=all&taskId=workspace-b-task'
      );
    });
    expect(state.addTabWithUrl).not.toHaveBeenCalled();
    expect(state.openUrlInHiddenWindow).not.toHaveBeenCalled();
  });

  test('sends a cold-start Intelligence workbench link through active-tab loading', async () => {
    process.argv = [
      'electron',
      'app.js',
      'localmind://app.local/intelligence?project=project-1',
    ];
    const listeners = new Map<string, (...args: never[]) => void>();
    const app = {
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      }),
      setAsDefaultProtocolClient: vi.fn(),
    } as unknown as App;

    setupDeepLink(app);
    listeners.get('ready')?.();

    await vi.waitFor(() => {
      expect(state.showMainWindow).toHaveBeenCalled();
      expect(state.loadUrlInActiveTab).toHaveBeenCalledWith(
        'localmind://app.local/intelligence?project=project-1'
      );
    });
    expect(state.addTabWithUrl).not.toHaveBeenCalled();
    expect(state.openUrlInHiddenWindow).not.toHaveBeenCalled();
  });
});
