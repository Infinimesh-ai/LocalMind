/** @vitest-environment happy-dom */
import { NotificationType } from '@affine/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  service: {
    // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the NotificationListService API.
    isMutating$: { value: false },
    readNotification: vi.fn(),
    dismissNotification: vi.fn(),
    readAllNotifications: vi.fn(),
    dismissReadNotifications: vi.fn(),
    dismissAllNotifications: vi.fn(),
  },
  error: vi.fn(),
  t: new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/core/modules/notification', () => ({
  NotificationListService: class {},
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => state.service,
  useLiveData: (data: { value: boolean }) => data.value,
}));
vi.mock('@affine/i18n', () => ({ useI18n: () => state.t }));
vi.mock('@affine/track', () => ({
  default: {
    // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the tracking API.
    $: { sidebar: { notifications: { clickNotification: vi.fn() } } },
  },
}));
vi.mock('@affine/component', () => {
  const Button = ({
    icon,
    tooltip: _tooltip,
    size: _size,
    variant: _variant,
    loading: _loading,
    suffix: _suffix,
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    tooltip?: string;
    size?: number;
    variant?: string;
    loading?: boolean;
    suffix?: ReactNode;
  }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  );
  return {
    Avatar: () => <span />,
    Button,
    IconButton: Button,
    MenuItem: ({
      prefixIcon: _prefix,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      prefixIcon?: ReactNode;
    }) => <button {...props} />,
    Menu: ({ items, children }: { items: ReactNode; children: ReactNode }) => (
      <div>
        {children}
        {items}
      </div>
    ),
    Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    notify: { error: state.error },
  };
});

import type { Notification } from '../../modules/notification';
import {
  NotificationCleanupActions,
  NotificationItemActions,
} from './cleanup-actions';
import { WorkOrderNotificationItem } from './work-order';

const key = (name: string) => `com.affine.notification.${name}`;
beforeEach(() => {
  vi.clearAllMocks();
  state.service.isMutating$.value = false;
  for (const method of [
    'readNotification',
    'dismissNotification',
    'readAllNotifications',
    'dismissReadNotifications',
    'dismissAllNotifications',
  ] as const) {
    state.service[method].mockReset().mockResolvedValue(undefined);
  }
});
afterEach(cleanup);

test.each([
  NotificationType.AccessRequest,
  NotificationType.AccessRequestResolved,
  NotificationType.ProjectFileRequest,
  NotificationType.Mention,
])('%s exposes independent read and delete actions', async type => {
  const parentClick = vi.fn();
  render(
    <div onClick={parentClick}>
      <NotificationItemActions
        notification={{ id: 'one', type, read: false } as Notification}
      />
    </div>
  );
  fireEvent.click(screen.getByRole('button', { name: key('mark-read') }));
  expect(state.service.readNotification).toHaveBeenCalledWith('one');
  fireEvent.click(screen.getByRole('button', { name: key('delete') }));
  expect(state.service.dismissNotification).toHaveBeenCalledWith('one');
  expect(parentClick).not.toHaveBeenCalled();
});

test('read notifications retain delete and pending cleanup disables actions', () => {
  state.service.isMutating$.value = true;
  render(
    <NotificationItemActions
      notification={{ id: 'one', read: true } as Notification}
    />
  );
  expect(screen.queryByRole('button', { name: key('mark-read') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: key('delete') }));
  expect(state.service.dismissNotification).not.toHaveBeenCalled();
});

test('bulk clearing requires confirmation and cancel leaves the inbox untouched', async () => {
  render(<NotificationCleanupActions />);
  fireEvent.click(screen.getByRole('button', { name: key('mark-all-read') }));
  expect(state.service.readAllNotifications).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: key('delete-read') }));
  expect(state.service.dismissReadNotifications).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: key('clear-all') }));
  expect(state.service.dismissAllNotifications).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: key('clear-all') }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: key('clear-all'),
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.service.dismissAllNotifications).toHaveBeenCalledOnce();
});

test('failed clearing reports an error and keeps confirmation available for retry', async () => {
  state.service.dismissAllNotifications.mockRejectedValueOnce(
    new Error('offline')
  );
  render(<NotificationCleanupActions />);
  fireEvent.click(screen.getByRole('button', { name: key('clear-all') }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: key('clear-all'),
    })
  );
  await waitFor(() => expect(state.error).toHaveBeenCalledOnce());
  expect(screen.getByRole('dialog')).toBeTruthy();
});

function Location() {
  return <output>{useLocation().pathname}</output>;
}

test('work order renders localized status and navigation does not run when deleting a notice', async () => {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <Location />
      <WorkOrderNotificationItem
        notification={
          {
            id: 'work-order-notice',
            read: false,
            type: NotificationType.WorkOrder,
            body: {
              workOrderId: 'order',
              title: 'Review the proposal',
              status: 'open',
              viewerRole: 'recipient',
            },
          } as Notification
        }
      />
    </MemoryRouter>
  );
  expect(
    screen.getByText('com.affine.localmind.workbench.v9.workOrderStatusOpen')
  ).toBeTruthy();
  expect(screen.queryByText('open')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: key('delete') }));
  expect(screen.getByText('/inbox')).toBeTruthy();
  expect(state.service.dismissNotification).toHaveBeenCalledWith(
    'work-order-notice'
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.v9.openWorkOrder',
    })
  );
  expect(screen.getByText('/project/work-orders/order')).toBeTruthy();
  expect(state.service.readNotification).toHaveBeenCalledWith(
    'work-order-notice'
  );
});

test('unavailable work orders keep cleanup available but cannot be opened', () => {
  render(
    <MemoryRouter>
      <WorkOrderNotificationItem
        notification={
          {
            id: 'gone',
            read: false,
            type: NotificationType.WorkOrder,
            body: {
              workOrderId: 'order',
              title: 'No longer available',
              status: 'unavailable',
            },
          } as Notification
        }
      />
    </MemoryRouter>
  );
  expect(
    screen.getByText('com.affine.localmind.accessNotification.unavailable')
  ).toBeTruthy();
  expect(
    screen
      .getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.openWorkOrder',
      })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: key('delete') }).hasAttribute('disabled')
  ).toBe(false);
});
