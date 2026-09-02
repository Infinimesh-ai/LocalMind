/**
 * @vitest-environment happy-dom
 */

import { cleanup, render, screen } from '@testing-library/react';
import type { ChangeEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const EnterpriseProvider = vi.hoisted(() => ({
  WECOM: 'WECOM',
  LARK: 'LARK',
  DINGTALK: 'DINGTALK',
}));
const EnterpriseServiceToken = vi.hoisted(() => class EnterpriseService {});
const WorkspaceServiceToken = vi.hoisted(() => class WorkspaceService {});
const openConfirmModal = vi.hoisted(() => vi.fn());
/* eslint-disable rxjs/finnish -- mock keys mirror the EnterpriseService API */
const serviceState = vi.hoisted(() => ({
  connections$: { value: null as unknown[] | null },
  policy$: {
    value: null as {
      enabled: boolean;
      allowedProviders: string[];
    } | null,
  },
  authorization$: { value: null },
  loading$: { value: false },
  error$: { value: null },
  revalidate: vi.fn(async () => undefined),
  resumeLatestAuthorization: vi.fn(async () => undefined),
  createAndAuthorize: vi.fn(async () => undefined),
  beginAuthorization: vi.fn(async () => undefined),
  cancelAuthorization: vi.fn(async () => undefined),
  refreshConnection: vi.fn(async () => undefined),
  disableConnection: vi.fn(async () => undefined),
  deleteConnection: vi.fn(async () => undefined),
  clearAuthorization: vi.fn(),
}));
/* eslint-enable rxjs/finnish */

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ErrorMessage: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  IconButton: ({ title, onClick }: { title: string; onClick?: () => void }) => (
    <button onClick={onClick}>{title}</button>
  ),
  Input: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <input
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange?.(event.target.value)
      }
    />
  ),
  Skeleton: () => <div>Loading</div>,
  notify: {
    error: vi.fn(),
    success: vi.fn(),
  },
  useConfirmModal: () => ({ openConfirmModal }),
}));

vi.mock('@affine/core/components/hooks/affine-async-hooks', () => ({
  useAsyncCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
    callback,
}));

vi.mock('@affine/core/modules/cloud/services/enterprise', () => ({
  EnterpriseService: EnterpriseServiceToken,
}));

vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: WorkspaceServiceToken,
}));

vi.mock('@affine/error', () => ({
  UserFriendlyError: {
    fromAny: (error: unknown) => error,
  },
}));

vi.mock('@affine/graphql', () => ({ EnterpriseProvider }));

vi.mock('@affine/i18n', () => {
  const messages: Record<string, string> = {
    'com.affine.integration.enterprise.name': 'Enterprise connections',
    'com.affine.integration.enterprise.desc': 'Enterprise connection settings',
    'com.affine.integration.enterprise.connect.title': 'Connect account',
    'com.affine.integration.enterprise.connect.description':
      'Authorize your own account.',
    'com.affine.integration.enterprise.provider.wecom': 'WeCom',
    'com.affine.integration.enterprise.provider.lark': 'Lark',
    'com.affine.integration.enterprise.provider.dingtalk': 'DingTalk',
    'com.affine.integration.enterprise.field.name': 'Connection name',
    'com.affine.integration.enterprise.action.connect': 'Connect',
    'com.affine.integration.enterprise.action.authorize': 'Authorize',
    'com.affine.integration.enterprise.action.refresh': 'Refresh',
    'com.affine.integration.enterprise.action.disable': 'Disable',
    'com.affine.integration.enterprise.policy.disabled':
      'Enterprise connections are disabled by your LocalMind administrator.',
    'com.affine.integration.enterprise.policy.no-providers':
      'No enterprise providers are available.',
    'com.affine.integration.enterprise.policy.provider-blocked':
      'This provider is no longer allowed by the LocalMind administrator.',
    'com.affine.integration.enterprise.empty': 'No connections',
    'com.affine.integration.enterprise.meta.identity': 'Identity',
    'com.affine.integration.enterprise.meta.last-checked': 'Last checked',
    'com.affine.integration.enterprise.status.active': 'Active',
    'com.affine.integration.enterprise.tool.risk.read': 'Read',
    'com.affine.integration.enterprise.tool.admin-managed':
      'Allowed by administrator',
    'com.affine.integration.enterprise.tool.refresh-required':
      'Refresh required',
    Delete: 'Delete',
    Cancel: 'Cancel',
    Retry: 'Retry',
  };

  return {
    useI18n: () =>
      new Proxy(
        {},
        {
          get: (_, key: string) => () => messages[key] ?? key,
        }
      ),
  };
});

vi.mock('@blocksuite/icons/rc', () => ({
  CollaborationIcon: () => null,
  CopyIcon: () => null,
  OpenInNewIcon: () => null,
}));

vi.mock('@toeverything/infra', () => ({
  useLiveData: (source: { value: unknown }) => source.value,
  useService: (token: unknown) => {
    if (token === WorkspaceServiceToken) {
      return { workspace: { id: 'workspace-1' } };
    }
    if (token === EnterpriseServiceToken) {
      return serviceState;
    }
    return {};
  },
}));

vi.mock('../setting', () => ({
  IntegrationSettingHeader: ({ name }: { name: string }) => <h1>{name}</h1>,
}));

import { EnterpriseSettingPanel } from './setting-panel';

describe('EnterpriseSettingPanel', () => {
  beforeEach(() => {
    serviceState.connections$.value = [];
    serviceState.policy$.value = {
      enabled: true,
      allowedProviders: [EnterpriseProvider.WECOM],
    };
    serviceState.authorization$.value = null;
    serviceState.loading$.value = false;
    serviceState.error$.value = null;
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  test('shows only providers allowed by the instance administrator', () => {
    serviceState.policy$.value = {
      enabled: true,
      allowedProviders: [EnterpriseProvider.LARK],
    };

    render(<EnterpriseSettingPanel />);

    expect(screen.getByRole('button', { name: 'Lark' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'WeCom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'DingTalk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeNull();
  });

  test('shows the administrator policy when enterprise connections are disabled', () => {
    serviceState.policy$.value = {
      enabled: false,
      allowedProviders: [],
    };

    render(<EnterpriseSettingPanel />);

    expect(
      screen.getByText(
        'Enterprise connections are disabled by your LocalMind administrator.'
      )
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  test('keeps user lifecycle actions but makes administrator tool policy read-only', () => {
    serviceState.policy$.value = {
      enabled: true,
      allowedProviders: [EnterpriseProvider.LARK],
    };
    serviceState.connections$.value = [
      {
        id: 'connection-1',
        name: 'Corporate WeCom',
        provider: EnterpriseProvider.WECOM,
        status: 'ACTIVE',
        externalUserId: 'user-1',
        identityType: 'user',
        lastCheckedAt: '2026-09-01T12:00:00.000Z',
        lastErrorMessage: null,
        tools: [
          {
            name: 'doc_search',
            risk: 'read',
            description: 'Search company documents',
            enabled: true,
          },
        ],
      },
    ];

    render(<EnterpriseSettingPanel />);

    expect(
      screen.getByText(
        'This provider is no longer allowed by the LocalMind administrator.'
      )
    ).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Authorize' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(screen.getByText('Allowed by administrator')).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
