/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signIn: vi.fn(),
  notify: vi.fn(),
  workspaces: {},
  loginStatus: 'authenticated',
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', async () => ({
  ...(await import('@affine/component/ui/input')),
  notify: { error: mocks.notify },
  ConfirmModal: ({
    children,
    customConfirmButton: Confirm,
  }: PropsWithChildren<{
    customConfirmButton: () => React.ReactNode;
  }>) => (
    <section role="dialog">
      {children}
      <Confirm />
    </section>
  ),
  Button: ({
    loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    variant?: string;
  }) => <button {...props} disabled={props.disabled || loading} />,
}));
vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: Symbol('auth'),
  ServersService: Symbol('servers'),
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  GlobalDialogService: Symbol('dialogs'),
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspacesService: Symbol('workspaces'),
}));
vi.mock('@affine/core/utils/first-app-data', () => ({
  buildShowcaseWorkspace: mocks.create,
}));
vi.mock('@affine/track', () => ({
  // eslint-disable-next-line rxjs/finnish -- Mock keys mirror the tracking API.
  default: { $: { $: { $: { createWorkspace: vi.fn() } } } },
}));
vi.mock('@toeverything/infra', () => ({
  FrameworkScope: ({ children }: PropsWithChildren) => children,
  useLiveData: (value: unknown) => value,
  useService: (service: symbol) => {
    switch (service.description) {
      case 'servers':
        return {
          // eslint-disable-next-line rxjs/finnish -- Static mock mirrors ServersService.server$.
          server$: (id: string) =>
            id === 'local'
              ? null
              : { id, baseUrl: 'http://localhost', scope: {} },
        };
      case 'auth':
        // eslint-disable-next-line rxjs/finnish -- Static mock mirrors the session status field.
        return { session: { status$: mocks.loginStatus } };
      case 'dialogs':
        return { open: mocks.signIn };
      case 'workspaces':
        return mocks.workspaces;
      default:
        throw new Error('Unexpected service');
    }
  },
}));
vi.mock('./server-selector', () => ({
  ServerSelector: () => <span>工作区类型</span>,
}));
import { CreateWorkspaceDialog } from './index';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginStatus = 'authenticated';
  mocks.create.mockResolvedValue({
    meta: { id: 'test-workspace' },
    defaultDocId: 'test-doc',
  });
});
afterEach(cleanup);

test('the name and create button submit the same form exactly once', async () => {
  const close = vi.fn();
  render(<CreateWorkspaceDialog serverId="local" close={close} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const button = screen.getByTestId(
    'create-workspace-create-button'
  ) as HTMLButtonElement;
  expect(input.form).toBeTruthy();
  expect(button.form).toBe(input.form);
  fireEvent.change(input, { target: { value: '完整中文工作区' } });
  fireEvent.submit(input.form!);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    mocks.workspaces,
    'local',
    '完整中文工作区'
  );
});

test('blank names, IME confirmation, repeat and pending submissions never create another workspace', async () => {
  let finish!: (value: { meta: { id: string }; defaultDocId: string }) => void;
  mocks.create.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    })
  );
  const close = vi.fn();
  render(<CreateWorkspaceDialog serverId="local" close={close} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.submit(input.form!);
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '候选中文名称' } });
  for (const event of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ])
    expect(fireEvent.keyDown(input, { key: 'Enter', ...event })).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('create-workspace-create-button'));
  fireEvent.submit(input.form!);
  expect(mocks.create).toHaveBeenCalledOnce();
  finish({ meta: { id: 'test-workspace' }, defaultDocId: 'test-doc' });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

test('cloud creation still requires authentication', () => {
  mocks.loginStatus = 'unauthenticated';
  render(<CreateWorkspaceDialog serverId="cloud-server" close={vi.fn()} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '受权限约束的工作区' } });
  fireEvent.submit(input.form!);
  expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith('sign-in', {
    server: 'http://localhost',
  });
  expect(mocks.create).not.toHaveBeenCalled();
});

test('a failed creation keeps the dialog open and allows retry', async () => {
  mocks.create.mockRejectedValueOnce(new Error('creation unavailable'));
  const close = vi.fn();
  render(<CreateWorkspaceDialog serverId="local" close={close} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '重试工作区' } });
  fireEvent.submit(input.form!);
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  fireEvent.submit(input.form!);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
