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
  type QueryResponse,
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
  keys: [] as QueryResponse<
    typeof adminWorkspaceByokSettingsQuery
  >['adminWorkspaceByokSettings']['keys'],
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
    settings.keys = [];
    mutateSettingsMock.mockReset().mockResolvedValue(undefined);
    testConfigMock.mockReset().mockResolvedValue({
      testWorkspaceByokConfig: {
        ok: true,
        status: ByokKeyTestStatus.passed,
        message: null,
        models: ['gpt-test'],
      },
    });
    upsertConfigMock.mockReset().mockResolvedValue({
      upsertWorkspaceByokConfig: { id: 'key-1', configRevision: 7 },
    });
    deleteConfigMock.mockReset();
    reorderConfigsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('loads the catalog once and verifies the selected model when saving', async () => {
    render(<WorkspaceByokAdmin />);

    expect(screen.getByText('Engineering')).not.toBeNull();
    expect(
      screen.getByText('No Workspace AI credentials configured.')
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    expect(screen.queryByRole('textbox', { name: 'Model ID' })).toBeNull();

    const save = screen.getByRole('button', { name: 'Save credential' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(testConfigMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          apiKey: 'sk-test',
          modelId: null,
          provider: ByokProvider.openai,
          storage: ByokKeyStorage.server,
          workspaceId: scope.id,
        }),
      });
      expect(save.hasAttribute('disabled')).toBe(true);
      expect(screen.getByLabelText('Available models')).not.toBeNull();
      expect(screen.getByRole('status').textContent).toContain(
        'Select a model, then save'
      );
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Available models' }));
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(testConfigMock).toHaveBeenCalledTimes(1);

    fireEvent.click(save);

    await waitFor(() => {
      expect(testConfigMock).toHaveBeenNthCalledWith(2, {
        input: expect.objectContaining({ modelId: 'gpt-test' }),
      });
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
    await waitFor(() => expect(testConfigMock).toHaveBeenCalledTimes(3));
    expect(testConfigMock).toHaveBeenLastCalledWith({
      input: {
        configId: 'key-1',
        expectedRevision: 7,
        provider: ByokProvider.openai,
        storage: ByokKeyStorage.server,
        workspaceId: scope.id,
      },
    });
    expect(upsertConfigMock).toHaveBeenCalledTimes(1);
  });

  test.each(['API key', 'Endpoint'])(
    'requires a new catalog after changing %s',
    async label => {
      render(<WorkspaceByokAdmin />);
      fireEvent.change(screen.getByLabelText('API key'), {
        target: { value: 'sk-test' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      const models = screen.getByRole('combobox', { name: 'Available models' });
      await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
      fireEvent.click(models);
      fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
      fireEvent.change(screen.getByLabelText(label), {
        target: {
          value: label === 'API key' ? 'sk-other' : 'https://other.example/v1',
        },
      });
      expect(models.hasAttribute('disabled')).toBe(true);
      expect(
        screen
          .getByRole('button', { name: 'Save credential' })
          .hasAttribute('disabled')
      ).toBe(true);
      expect(upsertConfigMock).not.toHaveBeenCalled();
    }
  );

  test('reports a saved credential with failed persisted verification without a success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(toast.success).mockClear();
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const models = screen.getByRole('combobox', { name: 'Available models' });
    await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
    fireEvent.click(models);
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    testConfigMock
      .mockResolvedValueOnce({ testWorkspaceByokConfig: { ok: true } })
      .mockResolvedValueOnce({
        testWorkspaceByokConfig: {
          ok: false,
          message: 'Provider service is unavailable.',
        },
      });
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('saved');
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(mutateSettingsMock).toHaveBeenCalled();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(
      ''
    );
  });

  test('does not re-enable a deliberately disabled credential by probing the saved record', async () => {
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const models = screen.getByRole('combobox', { name: 'Available models' });
    await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
    fireEvent.click(models);
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Use this credential in routing' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    await waitFor(() => expect(mutateSettingsMock).toHaveBeenCalled());
    expect(upsertConfigMock).toHaveBeenCalledWith({
      input: expect.objectContaining({ enabled: false }),
    });
    expect(testConfigMock).toHaveBeenCalledTimes(2);
  });

  test('shows an actionable error when the catalog contains no models', async () => {
    testConfigMock.mockResolvedValue({
      testWorkspaceByokConfig: { ok: true, models: [] },
    });
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The provider returned no models'
    );
    expect(
      screen
        .getByRole('button', { name: 'Save credential' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(upsertConfigMock).not.toHaveBeenCalled();
  });

  test('keeps the draft and skips saving when automatic model verification fails', async () => {
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const models = screen.getByRole('combobox', { name: 'Available models' });
    await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
    fireEvent.click(models);
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    testConfigMock.mockResolvedValueOnce({
      testWorkspaceByokConfig: {
        ok: false,
        message: 'Provider service is unavailable.',
        models: [],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    await screen.findByRole('alert');
    expect(upsertConfigMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(
      'sk-test'
    );
    expect(models.textContent).toContain('gpt-test');
    const save = screen.getByRole('button', { name: 'Save credential' });
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(upsertConfigMock).toHaveBeenCalledTimes(1));
  });

  test('locks the form and prevents repeated submissions while verifying the model', async () => {
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const models = screen.getByRole('combobox', { name: 'Available models' });
    await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
    fireEvent.click(models);
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    let finishProbe!: (value: unknown) => void;
    testConfigMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishProbe = resolve;
        })
    );
    const save = screen.getByRole('button', { name: 'Save credential' });
    const form = save.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(testConfigMock).toHaveBeenCalledTimes(2);
    expect(upsertConfigMock).not.toHaveBeenCalled();
    expect(
      (
        screen
          .getByLabelText('API key')
          .closest('fieldset') as HTMLFieldSetElement
      ).disabled
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Test' }).hasAttribute('disabled')
    ).toBe(true);
    finishProbe({
      testWorkspaceByokConfig: { ok: true, models: ['gpt-test'] },
    });
    await waitFor(() => expect(upsertConfigMock).toHaveBeenCalledTimes(1));
  });
  test('clears the model catalog and selection when the endpoint changes', async () => {
    render(<WorkspaceByokAdmin />);
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const models = screen.getByRole('combobox', { name: 'Available models' });
    await waitFor(() => expect(models.hasAttribute('disabled')).toBe(false));
    fireEvent.click(models);
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-test' }));
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'https://other.example/v1' },
    });
    expect(models.hasAttribute('disabled')).toBe(true);
    expect(models.textContent).not.toContain('gpt-test');
    expect(
      screen
        .getByRole('button', { name: 'Save credential' })
        .hasAttribute('disabled')
    ).toBe(true);
  });
  test('keeps the saved model selected when editing a credential', async () => {
    settings.keys = [
      {
        id: 'key-1',
        name: 'Saved key',
        provider: ByokProvider.openai,
        modelId: 'saved-model',
        apiStyle: 'responses',
        configRevision: 1,
        enabled: true,
        configured: true,
        endpoint: null,
        endpointEditable: true,
        storage: ByokKeyStorage.server,
        sortOrder: 0,
        description: null,
        capabilities: [],
        testStatus: ByokKeyTestStatus.passed,
        disabledReason: null,
        lastTestedAt: null,
        lastTestError: null,
        lastUsedAt: null,
        lastErrorAt: null,
        lastError: null,
      },
    ];
    render(<WorkspaceByokAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Saved key' }));
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Available models' }).textContent
      ).toContain('saved-model')
    );
  });

  test('deletes a credential only after the in-app confirmation', async () => {
    const nativeConfirm = vi.fn();
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: nativeConfirm,
    });
    deleteConfigMock.mockResolvedValue({ deleteWorkspaceByokConfig: true });
    settings.keys = [
      {
        id: 'key-1',
        name: 'Saved key',
        provider: ByokProvider.openai,
        modelId: 'saved-model',
        apiStyle: 'responses',
        configRevision: 1,
        enabled: true,
        configured: true,
        endpoint: null,
        endpointEditable: true,
        storage: ByokKeyStorage.server,
        sortOrder: 0,
        description: null,
        capabilities: [],
        testStatus: ByokKeyTestStatus.passed,
        disabledReason: null,
        lastTestedAt: null,
        lastTestError: null,
        lastUsedAt: null,
        lastErrorAt: null,
        lastError: null,
      },
    ];
    render(<WorkspaceByokAdmin />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Saved key' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete Saved key?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteConfigMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Saved key' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete credential' }));
    await waitFor(() =>
      expect(deleteConfigMock).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        id: 'key-1',
      })
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
