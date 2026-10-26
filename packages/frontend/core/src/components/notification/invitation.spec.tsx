/** @vitest-environment happy-dom */
import type { Notification } from '@affine/core/modules/notification';
import { getOrCreateI18n } from '@affine/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acceptInvite: vi.fn(),
  readNotification: vi.fn(async () => {}),
  waitForRevalidation: vi.fn(async () => {}),
  jumpToPage: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('@affine/component', () => ({
  Avatar: () => null,
  Button: ({
    loading: _loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    variant?: string;
  }) => <button {...props} />,
  notify: { error: mocks.notifyError },
  observeIntersection: vi.fn(),
  RadioGroup: () => null,
  Scrollable: () => null,
  Skeleton: () => null,
}));
vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: class AuthService {},
  InvitationService: class InvitationService {},
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  GlobalDialogService: class GlobalDialogService {},
}));
vi.mock('@affine/core/modules/notification', () => ({
  NotificationListService: class NotificationListService {},
  NotificationType: {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspacesService: class WorkspacesService {},
}));
vi.mock('@affine/core/utils', () => ({ extractEmojiIcon: vi.fn() }));
vi.mock('@affine/track', () => ({
  default: {
    ['$']: { sidebar: { notifications: { clickNotification: vi.fn() } } },
  },
}));
vi.mock('../hooks/use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToPage: mocks.jumpToPage }),
}));
vi.mock('./access-request', () => ({
  AccessRequestNotificationItem: () => null,
}));
vi.mock('./cleanup-actions', () => ({
  NotificationCleanupActions: () => null,
  NotificationItemActions: () => null,
}));
vi.mock('./project-file-request', () => ({
  ProjectFileRequestNotificationItem: () => null,
}));
vi.mock('./project-invitation', () => ({
  ProjectInvitationNotificationItem: () => null,
}));
vi.mock('./project-report', () => ({
  ProjectReportNotificationItem: () => null,
}));
vi.mock('./viewport', () => ({ NotificationViewport: () => null }));
vi.mock('./work-order', () => ({ WorkOrderNotificationItem: () => null }));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: (service: { name: string }) =>
    service.name === 'WorkspacesService'
      ? {
          list: {
            ['workspaces$']: [],
            waitForRevalidation: mocks.waitForRevalidation,
          },
        }
      : mocks,
}));

import { InvitationNotificationItem } from './list';

const notification = {
  id: 'notice-1',
  type: 'Invitation',
  createdAt: new Date().toISOString(),
  body: {
    inviteId: 'invite-1',
    createdByUser: { name: 'Owner' },
    workspace: { id: 'workspace-1', name: 'QA Workspace' },
  },
} as unknown as Notification;
const failure = (name: string) => ({
  type: name,
  name,
  message: 'private raw error',
});
beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.acceptInvite.mockReset();
});
afterEach(cleanup);
function open() {
  render(<InvitationNotificationItem notification={notification} />);
}
function accept() {
  fireEvent.click(screen.getByRole('button', { name: '接受并加入' }));
}

test('revoked invitation shows an inline result and stops accepting without navigating', async () => {
  mocks.acceptInvite.mockRejectedValue(failure('NOT_FOUND'));
  open();
  accept();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('已过期或被撤销')
  );
  expect(
    (screen.getByRole('button', { name: '邀请已失效' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(mocks.jumpToPage).not.toHaveBeenCalled();
  expect(mocks.readNotification).not.toHaveBeenCalled();
  expect(mocks.notifyError).not.toHaveBeenCalled();
});

test('transient failure preserves retry and successful retry reads and opens the workspace', async () => {
  mocks.acceptInvite
    .mockRejectedValueOnce(failure('NETWORK_ERROR'))
    .mockResolvedValueOnce(true);
  open();
  accept();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('查看工作区列表')
  );
  expect(
    (screen.getByRole('button', { name: '接受并加入' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  accept();
  await waitFor(() =>
    expect(mocks.jumpToPage).toHaveBeenCalledWith('workspace-1', 'all')
  );
  expect(mocks.readNotification).toHaveBeenCalledWith('notice-1');
  expect(mocks.acceptInvite).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('false result is expired and never treated as acceptance', async () => {
  mocks.acceptInvite.mockResolvedValue(false);
  open();
  accept();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '邀请已失效' })).toBeTruthy()
  );
  expect(mocks.jumpToPage).not.toHaveBeenCalled();
});

test('duplicate clicks while accepting issue one request', async () => {
  let resolve: (value: boolean) => void = (_value: boolean) => undefined;
  mocks.acceptInvite.mockReturnValue(
    new Promise<boolean>(done => {
      resolve = done;
    })
  );
  open();
  act(() => {
    accept();
    accept();
  });
  expect(mocks.acceptInvite).toHaveBeenCalledTimes(1);
  await act(async () => resolve(true));
  await waitFor(() => expect(mocks.jumpToPage).toHaveBeenCalledTimes(1));
});

test('already joined result opens the existing workspace without another invitation', async () => {
  mocks.acceptInvite.mockRejectedValue(failure('ALREADY_IN_SPACE'));
  open();
  accept();
  await waitFor(() =>
    expect(mocks.jumpToPage).toHaveBeenCalledWith('workspace-1', 'all')
  );
  expect(mocks.waitForRevalidation).toHaveBeenCalledTimes(1);
  expect(mocks.acceptInvite).toHaveBeenCalledTimes(1);
});
