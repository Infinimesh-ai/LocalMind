/**
 * @vitest-environment happy-dom
 */
import {
  ByokProvider,
  saveProjectByokConfigMutation,
  setProjectByokEnabledMutation,
  testProjectByokConfigMutation,
} from '@affine/graphql';
import { getOrCreateI18n } from '@affine/i18n';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { formatByokError } from './byok-feedback';

const state = vi.hoisted(() => ({
  configured: false,
  enabled: false,
  revision: 0,
  busy: false,
  error: undefined as Error | undefined,
  save: vi.fn(),
  test: vi.fn(),
  toggle: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@affine/admin/use-query', () => ({
  useQuery: () => ({
    data: {
      adminProjectByokSettings: {
        configured: state.configured,
        enabled: state.enabled,
        revision: state.revision,
        provider: ByokProvider.openai,
        endpoint: null,
        modelId: state.configured ? 'global-model' : null,
        allowedProviders: [ByokProvider.openai, ByokProvider.anthropic],
        customEndpointSupported: true,
        auditEvents: [],
        lastError: null,
      },
    },
    error: state.error,
    isValidating: false,
    mutate: state.reload,
  }),
}));

vi.mock('@affine/admin/use-mutation', () => ({
  useMutation: ({ mutation }: { mutation: unknown }) => ({
    isMutating: state.busy,
    trigger:
      mutation === saveProjectByokConfigMutation
        ? state.save
        : mutation === testProjectByokConfigMutation
          ? state.test
          : mutation === setProjectByokEnabledMutation
            ? state.toggle
            : undefined,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProjectByokAdmin } from './project-byok';

beforeEach(() => {
  state.configured = false;
  state.enabled = false;
  state.revision = 0;
  state.busy = false;
  state.error = undefined;
  state.save.mockReset().mockResolvedValue({});
  state.test
    .mockReset()
    .mockResolvedValue({ testProjectByokConfig: { ok: true, message: null } });
  state.toggle.mockReset().mockResolvedValue({});
  state.reload.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await getOrCreateI18n().changeLanguage('en');
});

test('saves one global configuration with no workspace or user assignment', async () => {
  render(<ProjectByokAdmin />);
  expect(screen.queryByText('Workspace')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'Verify and save',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Model ID' })).toBeNull();
  state.test.mockResolvedValue({
    testProjectByokConfig: {
      ok: true,
      models: ['project-model'],
      message: null,
    },
  });
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'new-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Available models',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Available models' }));
  fireEvent.click(await screen.findByRole('option', { name: 'project-model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      input: {
        expectedRevision: 0,
        provider: 'openai',
        apiStyle: 'responses',
        endpoint: null,
        modelId: 'project-model',
        apiKey: 'new-key',
      },
    })
  );
  await waitFor(() =>
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(
      ''
    )
  );
  expect(state.reload).toHaveBeenCalled();
});

test('editing retains saved credentials without returning a key to the browser', async () => {
  state.configured = true;
  state.enabled = true;
  state.revision = 4;
  render(<ProjectByokAdmin />);
  expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }));
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      input: {
        expectedRevision: 4,
        provider: 'openai',
        apiStyle: 'responses',
        endpoint: null,
        modelId: 'global-model',
        apiKey: undefined,
      },
    })
  );
});

test('failed probes give feedback and do not save or enable the global configuration', async () => {
  state.configured = true;
  state.test.mockResolvedValue({
    testProjectByokConfig: {
      ok: false,
      message: 'Provider rejected the BYOK key.',
    },
  });
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'The provider rejected the API key.'
    )
  );
  expect(state.save).not.toHaveBeenCalled();
  expect(state.toggle).not.toHaveBeenCalled();
});

test('disabled controls block repeated actions and loading errors offer reload', () => {
  state.configured = true;
  state.busy = true;
  const { rerender } = render(<ProjectByokAdmin />);
  expect(screen.queryByRole('button', { name: 'Verify and save' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Verifying...' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByLabelText('API key') as HTMLInputElement).closest('fieldset')
      ?.disabled
  ).toBe(true);
  state.busy = false;
  state.error = new Error('offline');
  rerender(<ProjectByokAdmin />);
  expect(screen.getByRole('alert').textContent).toContain(
    'Reload before saving'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload Project BYOK' }));
  expect(state.reload).toHaveBeenCalled();
});

test('disabling all project conversations requires confirmation', async () => {
  state.configured = true;
  state.enabled = true;
  state.revision = 3;
  const confirm = vi.fn().mockReturnValue(false);
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    writable: true,
    value: confirm,
  });
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('switch', { name: 'Project AI enabled' }));
  expect(confirm).toHaveBeenCalled();
  expect(state.toggle).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('switch', { name: 'Project AI enabled' }));
  await waitFor(() =>
    expect(state.toggle).toHaveBeenCalledWith({
      expectedRevision: 3,
      enabled: false,
    })
  );
});

test('explains why a new project configuration cannot be enabled before verification', () => {
  render(<ProjectByokAdmin />);
  expect(
    (
      screen.getByRole('switch', {
        name: 'Project AI enabled',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    screen.getByText(
      /Project AI is enabled automatically after successful verification/
    )
  ).not.toBeNull();
});

test('tests credentials before a model is entered and offers the API model list', async () => {
  state.test.mockResolvedValue({
    testProjectByokConfig: {
      ok: true,
      message: null,
      models: ['model-a', 'model-b'],
      modelListError: null,
    },
  });
  render(<ProjectByokAdmin />);
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'synthetic-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await waitFor(() =>
    expect(state.test).toHaveBeenCalledWith({
      input: expect.objectContaining({ modelId: '' }),
    })
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Available models',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Available models' }));
  fireEvent.click(await screen.findByRole('option', { name: 'model-b' }));
  expect(
    screen.getByRole('combobox', { name: 'Available models' }).textContent
  ).toContain('model-b');
  expect(screen.queryByRole('textbox', { name: 'Model ID' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Endpoint'), {
    target: { value: 'https://other.example/v1' },
  });
  expect(
    (
      screen.getByRole('combobox', {
        name: 'Available models',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'Verify and save',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

test('Simplified Chinese renders provider failures and catalog warnings in Chinese', async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
  expect(formatByokError('Provider rejected the BYOK key.')).toContain(
    '提供商拒绝'
  );
  expect(formatByokError('Provider returned malformed JSON.')).toContain(
    '返回内容'
  );
  expect(formatByokError('unknown upstream secret')).toContain('连接失败');
  expect(formatByokError('unknown upstream secret')).not.toContain('secret');
  state.configured = true;
  state.test.mockResolvedValue({
    testProjectByokConfig: {
      ok: true,
      message: null,
      models: [],
      modelListError: 'model_catalog_unavailable',
    },
  });
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await screen.findByText(/所选模型连接测试通过，但无法加载/);
  expect(screen.queryByText('model_catalog_unavailable')).toBeNull();
});
