/**
 * @vitest-environment happy-dom
 */
import {
  adminAiProfilesQuery,
  adminWorkspaceByokSettingsQuery,
  ByokKeyStorage,
  ByokKeyTestStatus,
  ByokProvider,
  deleteAdminAiProfileMutation,
  upsertAdminAiProfileMutation,
} from '@affine/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mutateProfilesMock = vi.fn();
const revalidateAssignmentsMock = vi.fn();
const upsertProfileMock = vi.fn();
const deleteProfileMock = vi.fn();

vi.mock('@affine/admin/use-query', () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === adminAiProfilesQuery) {
      return {
        data: { adminAiProfiles: [] },
        error: undefined,
        isValidating: false,
        mutate: mutateProfilesMock,
      };
    }
    if (query === adminWorkspaceByokSettingsQuery) {
      return {
        data: {
          adminWorkspaceByokSettings: {
            keys: [
              {
                id: 'credential-1',
                provider: ByokProvider.openai,
                name: 'Engineering primary',
                description: null,
                storage: ByokKeyStorage.server,
                configured: true,
                enabled: true,
                endpoint: null,
                modelId: 'gpt-test',
                endpointEditable: false,
                sortOrder: 0,
                capabilities: ['Text'],
                testStatus: ByokKeyTestStatus.passed,
                disabledReason: null,
                lastTestedAt: null,
                lastTestError: null,
                lastUsedAt: null,
                lastErrorAt: null,
                lastError: null,
              },
            ],
          },
        },
      };
    }
    throw new Error('Unexpected query');
  },
}));

vi.mock('@affine/admin/use-mutation', () => ({
  useMutateQueryResource: () => revalidateAssignmentsMock,
  useMutation: ({ mutation }: { mutation: unknown }) => {
    if (mutation === upsertAdminAiProfileMutation) {
      return { trigger: upsertProfileMock, isMutating: false };
    }
    if (mutation === deleteAdminAiProfileMutation) {
      return { trigger: deleteProfileMock, isMutating: false };
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

import { WorkspaceAiProfilesEditor } from './workspace-ai-profiles';

describe('WorkspaceAiProfilesEditor', () => {
  beforeEach(() => {
    mutateProfilesMock.mockReset().mockResolvedValue(undefined);
    revalidateAssignmentsMock.mockReset().mockResolvedValue(undefined);
    upsertProfileMock.mockReset().mockResolvedValue({
      upsertAdminAiProfile: { id: 'profile-1' },
    });
    deleteProfileMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('creates a profile that references selected workspace credentials', async () => {
    render(
      <WorkspaceAiProfilesEditor
        scope={{ id: 'workspace-1', name: 'Engineering' }}
      />
    );

    fireEvent.change(screen.getByLabelText('Profile name'), {
      target: { value: 'Engineering default' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(upsertProfileMock).toHaveBeenCalledWith({
        input: {
          id: undefined,
          workspaceId: 'workspace-1',
          name: 'Engineering default',
          description: null,
          enabled: true,
          isDefault: false,
          credentialIds: ['credential-1'],
        },
      });
    });
    expect(revalidateAssignmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'adminUserAiProfileAssignmentQuery' })
    );
  });
});
