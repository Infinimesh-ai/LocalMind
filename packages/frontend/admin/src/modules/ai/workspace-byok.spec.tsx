/**
 * @vitest-environment happy-dom
 */
import {
  adminWorkspaceByokScopesQuery,
  adminWorkspaceByokSettingsQuery,
  ByokKeyStorage,
  ByokKeyTestStatus,
  ByokProvider,
  deleteWorkspaceByokConfigMutation,
  reorderWorkspaceByokConfigsMutation,
  testWorkspaceByokConfigMutation,
  upsertWorkspaceByokConfigMutation,
} from '@affine/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mutateSettingsMock = vi.fn();
const testConfigMock = vi.fn();
const upsertConfigMock = vi.fn();
const deleteConfigMock = vi.fn();
const reorderConfigsMock = vi.fn();

vi.mock('./workspace-ai-profiles', () => ({
  WorkspaceAiProfilesEditor: () => null,
}));

const scope = {
  id: 'workspace-1',
  name: 'Engineering',
  enableAi: true,
  memberCount: 12,
};

const settings = {
  workspaceId: scope.id,
  entitled: true,
  serverEntitled: true,
  allowedProviders: [ByokProvider.openai, ByokProvider.gemini],
  customEndpointSupported: true,
  privateEndpointSupported: false,
  keys: [],
  warnings: [],
};

vi.mock('@affine/admin/use-query', () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === adminWorkspaceByokScopesQuery) {
      return {
        data: { adminWorkspaceByokScopes: [scope] },
        error: undefined,
        isValidating: false,
      };
    }
    if (query === adminWorkspaceByokSettingsQuery) {
      return {
        data: { adminWorkspaceByokSettings: settings },
        error: undefined,
        isValidating: false,
        mutate: mutateSettingsMock,
      };
    }
    throw new Error('Unexpected query');
  },
}));

vi.mock('@affine/admin/use-mutation', () => ({
  useMutation: ({ mutation }: { mutation: unknown }) => {
    if (mutation === testWorkspaceByokConfigMutation) {
      return { trigger: testConfigMock, isMutating: false };
    }
    if (mutation === upsertWorkspaceByokConfigMutation) {
      return { trigger: upsertConfigMock, isMutating: false };
    }
    if (mutation === deleteWorkspaceByokConfigMutation) {
      return { trigger: deleteConfigMock, isMutating: false };
    }
    if (mutation === reorderWorkspaceByokConfigsMutation) {
      return { trigger: reorderConfigsMock, isMutating: false };
    }
    throw new Error('Unexpected mutation');
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { WorkspaceByokAdmin } from './workspace-byok';

describe('WorkspaceByokAdmin', () => {
  beforeEach(() => {
    mutateSettingsMock.mockReset().mockResolvedValue(undefined);
    testConfigMock.mockReset().mockResolvedValue({
      testWorkspaceByokConfig: {
        ok: true,
        status: ByokKeyTestStatus.passed,
        message: null,
      },
    });
    upsertConfigMock.mockReset().mockResolvedValue({
      upsertWorkspaceByokConfig: { id: 'key-1' },
    });
    deleteConfigMock.mockReset();
    reorderConfigsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('requires a successful provider test before saving a new credential', async () => {
    render(<WorkspaceByokAdmin />);

    expect(screen.getByText('Engineering')).not.toBeNull();
    expect(
      screen.getByText('No Workspace AI credentials configured.')
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Credential name'), {
      target: { value: 'Primary' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.change(screen.getByLabelText('Model ID'), {
      target: { value: 'gpt-test' },
    });

    const save = screen.getByRole('button', { name: 'Save credential' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(testConfigMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          apiKey: 'sk-test',
          modelId: 'gpt-test',
          provider: ByokProvider.openai,
          storage: ByokKeyStorage.server,
          workspaceId: scope.id,
        }),
      });
      expect(save.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(save);

    await waitFor(() => {
      expect(upsertConfigMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          apiKey: 'sk-test',
          name: 'Primary',
          modelId: 'gpt-test',
          storage: ByokKeyStorage.server,
          workspaceId: scope.id,
        }),
      });
    });
  });
});
