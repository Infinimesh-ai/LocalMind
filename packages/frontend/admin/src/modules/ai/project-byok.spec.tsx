/**
 * @vitest-environment happy-dom
 */
import { GraphQLError } from '@affine/error';
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
  const nativeConfirm = vi.fn();
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    writable: true,
    value: nativeConfirm,
  });
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('switch', { name: 'Project AI enabled' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('New requests will stop');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: 'Project AI enabled' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
  expect(nativeConfirm).not.toHaveBeenCalled();
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
  expect(screen.getByRole('status').textContent).toContain('Model list loaded');
  expect(
    screen.queryByText(/selected model returned a valid response/i)
  ).toBeNull();
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

test('save and test share specific diagnostics, preserve the draft key and never expose arbitrary errors', async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
  state.configured = true;
  const message = 'DeepSeek OpenAI endpoint requires the OpenAI provider.';
  // Match the GraphQL error envelope consumed by gqlFetcher.
  state.save.mockRejectedValue(
    new GraphQLError(message, {
      extensions: {
        status: 400,
        code: 'BAD_REQUEST',
        type: 'BAD_REQUEST',
        name: 'BAD_REQUEST',
        message,
      },
    })
  );
  state.test.mockResolvedValue({
    testProjectByokConfig: { ok: true, models: ['deepseek-flash'] },
  });
  render(<ProjectByokAdmin />);
  fireEvent.change(screen.getByLabelText('API 密钥'), {
    target: { value: 'synthetic-draft-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await screen.findByText(/已获取模型列表/);
  fireEvent.click(screen.getByRole('combobox', { name: '可选模型' }));
  fireEvent.click(
    await screen.findByRole('option', { name: 'deepseek-flash' })
  );
  fireEvent.click(screen.getByRole('button', { name: '验证并保存' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      '配置未保存。此 DeepSeek 地址使用 OpenAI 接口'
    )
  );
  expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe(
    'synthetic-draft-key'
  );
  expect(state.reload).not.toHaveBeenCalled();
  state.test.mockResolvedValue({
    testProjectByokConfig: { ok: false, message },
  });
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(formatByokError(message))
  );
  state.save.mockRejectedValue(new Error('upstream secret-key body'));
  fireEvent.click(screen.getByRole('button', { name: '验证并保存' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('保存失败')
  );
  expect(screen.getByRole('alert').textContent).not.toContain('secret-key');
});

test('a successful selected-model test reports actual model validation without claiming persistence', async () => {
  state.configured = true;
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  await screen.findByText(/selected model returned a valid response/);
  expect(screen.getByRole('status').textContent).toContain(
    'does not save configuration'
  );
  expect(state.save).not.toHaveBeenCalled();
});

test('successful saves are not reported as failed when reloading settings fails', async () => {
  state.configured = true;
  state.reload.mockRejectedValue(new Error('offline'));
  render(<ProjectByokAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }));
  await screen.findByText(
    /Configuration was saved, but the settings could not be refreshed/
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(state.save).toHaveBeenCalledTimes(1);
});

test('Chinese diagnostics distinguish model, quota, rate limit, timeout and ambiguous 404', async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
  expect(
    formatByokError('Provider model was not found or is not accessible.')
  ).toContain('模型不存在');
  expect(formatByokError('Provider account has insufficient quota.')).toContain(
    '额度不足'
  );
  expect(
    formatByokError('Provider rate limit exceeded while testing the key.')
  ).toContain('频率限制');
  expect(formatByokError('Provider request timed out.')).toContain('超时');
  expect(formatByokError('Provider probe endpoint was not found.')).toContain(
    '未说明'
  );
  expect(formatByokError('Provider service is unavailable.')).toContain(
    '服务暂时不可用'
  );
});
