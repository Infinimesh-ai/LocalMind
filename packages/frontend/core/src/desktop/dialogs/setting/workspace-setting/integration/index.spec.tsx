/**
 * @vitest-environment happy-dom
 */

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const workspaceInfoState = vi.hoisted(() => ({
  info: {
    isOwner: false,
    isAdmin: false,
    isTeam: false,
  },
}));
const workspaceState = vi.hoisted(() => ({
  id: 'workspace-1',
  flavour: 'affine',
}));

const WorkspaceServiceToken = vi.hoisted(() => class WorkspaceService {});

vi.mock('@affine/component/setting-components', () => ({
  SettingHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('@affine/core/components/hooks/use-workspace-info', () => ({
  useWorkspaceInfo: () => workspaceInfoState.info,
}));

vi.mock('@affine/core/modules/integration', () => ({
  IntegrationTypeIcon: () => null,
}));

vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: WorkspaceServiceToken,
}));

vi.mock('@affine/i18n', () => {
  const messages: Record<string, string> = {
    'com.affine.integration.integrations': 'Integrations',
    'com.affine.integration.setting.description': 'Integration settings',
    'com.affine.integration.external-mcp.name': 'SparkClaw MCP',
    'com.affine.integration.external-mcp.desc':
      'Connect LocalMind to SparkClaw.',
  };
  const translate = (key: string) => messages[key] ?? key;
  return {
    useI18n: () =>
      new Proxy(
        {
          t: translate,
        },
        {
          get: (target, key: string) => {
            if (key in target) {
              return target[key as keyof typeof target];
            }
            return () => translate(key);
          },
        }
      ),
  };
});

vi.mock('@blocksuite/icons/rc', () => ({
  CollaborationIcon: () => null,
  TodayIcon: () => null,
}));

vi.mock('@toeverything/infra', () => ({
  Service: class Service {},
  useService: (token: unknown) => {
    if (token === WorkspaceServiceToken) {
      return {
        workspace: workspaceState,
      };
    }
    return {};
  },
}));

vi.mock('../../sub-page', () => ({
  SubPageProvider: ({ children }: { children: ReactNode }) => children,
  useSubPageIsland: () => null,
}));

vi.mock('./calendar/setting-panel', () => ({
  CalendarSettingPanel: () => null,
}));

vi.mock('./mcp-server/setting-panel', () => ({
  McpServerSettingPanel: () => null,
}));

vi.mock('./external-mcp/setting-panel', () => ({
  ExternalMcpSettingPanel: () => null,
}));

vi.mock('./readwise/setting-panel', () => ({
  ReadwiseSettingPanel: () => null,
}));

import { IntegrationSetting } from '.';

describe('IntegrationSetting', () => {
  beforeEach(() => {
    workspaceInfoState.info = {
      isOwner: false,
      isAdmin: false,
      isTeam: false,
    };
    workspaceState.flavour = 'affine';
  });

  afterEach(() => {
    cleanup();
  });

  test('does not expose BYOK configuration to workspace owners or admins', () => {
    workspaceInfoState.info = {
      isOwner: true,
      isAdmin: true,
      isTeam: true,
    };
    render(<IntegrationSetting />);

    expect(screen.queryByText('AI BYOK')).toBeNull();
  });

  test('shows SparkClaw MCP only to workspace owners and admins', () => {
    render(<IntegrationSetting />);
    expect(screen.queryByText('SparkClaw MCP')).toBeNull();

    cleanup();
    workspaceInfoState.info = {
      isOwner: false,
      isAdmin: true,
      isTeam: true,
    };
    render(<IntegrationSetting />);
    expect(screen.getByText('SparkClaw MCP')).not.toBeNull();
  });
});
