/**
 * @vitest-environment happy-dom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  desktopApi: {
    handler: {
      ui: {
        pingAppLayoutReady: vi.fn(),
      },
    },
  },
}));

vi.mock('@toeverything/infra', () => ({
  useServiceOptional: () => state.desktopApi,
}));

vi.mock('../service/desktop-api', () => ({
  DesktopApiService: class DesktopApiService {},
}));

import { useAppLayoutReady } from './use-app-layout-ready';

const originalBuildConfig = globalThis.BUILD_CONFIG;

describe('useAppLayoutReady', () => {
  beforeEach(() => {
    state.desktopApi.handler.ui.pingAppLayoutReady.mockReset();
    state.desktopApi.handler.ui.pingAppLayoutReady.mockResolvedValue(undefined);
    globalThis.BUILD_CONFIG = {
      ...originalBuildConfig,
      isElectron: true,
    };
  });

  afterAll(() => {
    globalThis.BUILD_CONFIG = originalBuildConfig;
  });

  test('notifies the Electron shell after the app layout commits', async () => {
    renderHook(() => useAppLayoutReady());

    await waitFor(() => {
      expect(
        state.desktopApi.handler.ui.pingAppLayoutReady
      ).toHaveBeenCalledTimes(1);
    });
  });

  test('does not notify for a disabled layout', () => {
    renderHook(() => useAppLayoutReady(false));

    expect(
      state.desktopApi.handler.ui.pingAppLayoutReady
    ).not.toHaveBeenCalled();
  });

  test('does not change browser layout behavior', () => {
    globalThis.BUILD_CONFIG = {
      ...originalBuildConfig,
      isElectron: false,
    };

    renderHook(() => useAppLayoutReady());

    expect(
      state.desktopApi.handler.ui.pingAppLayoutReady
    ).not.toHaveBeenCalled();
  });
});
