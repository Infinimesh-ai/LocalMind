/** @vitest-environment happy-dom */
import { cleanup, renderHook } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  admin: false,
  revalidateRole: vi.fn(),
  account: { id: 'user-1', info: { features: [] as string[] } },
  model: {
    configuration: { value: 'missing' },
    refresh: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock('@affine/core/modules/ai-button/entities/project-model', () => ({
  ProjectAIModel: class {},
}));
vi.mock('@affine/core/modules/cloud', () => ({
  UserFeatureService: class UserFeatureService {},
  AuthService: class AuthService {},
}));
vi.mock('@affine/core/modules/doc-info/utils', () => ({
  useSignalValue: (signal: { value: string }) => signal.value,
}));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: vi.fn(),
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => {
  const { LiveData } = await importOriginal<typeof Infra>();
  const framework = { createEntity: () => state.model };
  return {
    useFramework: () => framework,
    useLiveData: (source: { value: unknown }) => source.value,
    useService: (token: { name: string }) =>
      token.name === 'AuthService'
        ? { session: { account$: new LiveData(state.account) } }
        : {
            userFeature: {
              isAdmin$: new LiveData(state.admin),
              revalidate: state.revalidateRole,
            },
          },
  };
});

import { useProjectAIAvailability } from './use-project-ai-availability';

beforeEach(() => {
  state.admin = false;
  state.model.configuration.value = 'missing';
  vi.clearAllMocks();
});
afterEach(cleanup);

test('refreshes roles when the full account profile arrives after mounting', () => {
  const { rerender } = renderHook(() => useProjectAIAvailability('project-1'));
  state.revalidateRole.mockClear();
  state.account = { id: 'user-1', info: { features: ['Admin'] } };
  rerender();
  expect(state.revalidateRole).toHaveBeenCalledOnce();
});

test('no project keeps the local draft available without a configuration notice', () => {
  const { result } = renderHook(() => useProjectAIAvailability(null));
  expect(result.current.notice).toBeUndefined();
  expect(result.current.sendBlocked).toBe(false);
  expect(state.revalidateRole).toHaveBeenCalledOnce();
});

test.each([false, true])(
  'missing configuration has the appropriate member/admin action (%s)',
  admin => {
    state.admin = admin;
    const { result } = renderHook(() => useProjectAIAvailability('project-1'));
    expect(result.current.sendBlocked).toBe(true);
    expect(result.current.notice?.description).toBe(
      `com.affine.localmind.project-byok.${admin ? 'adminSetupHelp' : 'memberSetupHelp'}`
    );
    expect(result.current.notice?.action).toEqual(
      admin
        ? {
            label: 'com.affine.localmind.project-byok.configure',
            href: '/admin/ai/config',
          }
        : undefined
    );
  }
);

test('loading and lookup failures block submission; retry and successful refresh recover', () => {
  state.model.configuration.value = 'loading';
  const { result, rerender } = renderHook(() =>
    useProjectAIAvailability('project-1')
  );
  expect(result.current.sendBlocked).toBe(true);
  expect(result.current.notice?.title).toBe(
    'com.affine.localmind.project-byok.checking'
  );
  state.model.configuration.value = 'error';
  rerender();
  const action = result.current.notice?.action;
  expect(action).toHaveProperty('label', 'Retry');
  if (action && 'onClick' in action) action.onClick();
  expect(state.model.refresh).toHaveBeenCalledOnce();
  state.model.configuration.value = 'configured';
  rerender();
  expect(result.current.notice).toBeUndefined();
  expect(result.current.sendBlocked).toBe(false);
});
