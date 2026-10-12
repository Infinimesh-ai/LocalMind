/** @vitest-environment happy-dom */
import { UserFriendlyError } from '@affine/error';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_, key) => () =>
          key === 'Cancel' ? '取消' : key === 'Confirm' ? '确认' : String(key),
      }
    ),
}));
vi.mock('@radix-ui/react-dialog', () => ({
  DialogTrigger: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../button', () => ({
  Button: ({
    loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    variant?: string;
  }) => <button {...props} disabled={props.disabled || loading} />,
}));
vi.mock('./modal', () => ({
  Modal: ({
    open,
    title,
    children,
    onOpenChange,
  }: {
    open?: boolean;
    title?: ReactNode;
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <section role="dialog">
        <h2>{title}</h2>
        {children}
        <button onClick={() => onOpenChange?.(false)}>Dismiss</button>
      </section>
    ) : null,
}));

import {
  ConfirmModal,
  ConfirmModalProvider,
  useConfirmModal,
} from './confirm-modal';
import { OverlayModal } from './overlay-modal';

afterEach(cleanup);
test('overlay confirmation defaults are translated and preserve explicit labels', () => {
  const view = render(<OverlayModal open />);
  expect(screen.getByRole('button', { name: '取消' })).toBeDefined();
  expect(screen.getByRole('button', { name: '确认' })).toBeDefined();
  view.rerender(<OverlayModal open cancelText="返回" confirmText="继续" />);
  expect(screen.getByRole('button', { name: '返回' })).toBeDefined();
  expect(screen.getByRole('button', { name: '继续' })).toBeDefined();
});
test('default confirmation labels use i18n and explicit labels remain supported', () => {
  const view = render(<ConfirmModal open />);
  expect(screen.getByTestId('confirm-modal-cancel').textContent).toBe('取消');
  expect(screen.getByTestId('confirm-modal-confirm').textContent).toBe('确认');
  view.rerender(<ConfirmModal open cancelText="返回" confirmText="确认删除" />);
  expect(screen.getByTestId('confirm-modal-cancel').textContent).toBe('返回');
  expect(screen.getByTestId('confirm-modal-confirm').textContent).toBe(
    '确认删除'
  );
});
function Fixture({
  confirm,
  autoClose = true,
}: {
  confirm: () => void | Promise<void>;
  autoClose?: boolean;
}) {
  const { openConfirmModal } = useConfirmModal();
  return (
    <>
      <button
        onClick={() =>
          openConfirmModal(
            {
              title: 'Trash document',
              confirmText: 'Confirm',
              onConfirm: confirm,
            },
            { autoClose }
          )
        }
      >
        Open
      </button>
      <button
        onClick={() =>
          openConfirmModal({
            title: 'Another operation',
            confirmText: 'Confirm',
          })
        }
      >
        Replace
      </button>
    </>
  );
}
function mount(confirm: () => void | Promise<void>, autoClose = true) {
  render(
    <ConfirmModalProvider>
      <Fixture confirm={confirm} autoClose={autoClose} />
    </ConfirmModalProvider>
  );
  fireEvent.click(screen.getByText('Open'));
}

test('failed confirmation stays open with a safe error and can retry successfully', async () => {
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(
      new UserFriendlyError({
        status: 499,
        code: 'REQUEST_ABORTED',
        type: 'REQUEST_ABORTED',
        name: 'REQUEST_ABORTED',
        message: 'private raw details',
      })
    )
    .mockResolvedValueOnce(undefined);
  mount(confirm);
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'com.affine.confirmModal.error.network'
    )
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('private raw details')).toBeNull();
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('synchronous failure also stops loading and preserves the dialog', async () => {
  mount(() => {
    throw new Error('synchronous failure');
  });
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect((screen.getByText('Confirm') as HTMLButtonElement).disabled).toBe(
    false
  );
});

test('duplicate confirmation is ignored and a late result cannot close a replacement dialog', async () => {
  let resolve!: () => void;
  const confirm = vi.fn(
    () =>
      new Promise<void>(done => {
        resolve = done;
      })
  );
  mount(confirm);
  fireEvent.click(screen.getByText('Confirm'));
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText('Replace'));
  resolve();
  await waitFor(() =>
    expect(screen.getByText('Another operation')).toBeTruthy()
  );
  expect((screen.getByText('Confirm') as HTMLButtonElement).disabled).toBe(
    false
  );
});

test('autoClose false remains supported after success', async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  mount(confirm, false);
  fireEvent.click(screen.getByText('Confirm'));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect((screen.getByText('Confirm') as HTMLButtonElement).disabled).toBe(
      false
    )
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
});
