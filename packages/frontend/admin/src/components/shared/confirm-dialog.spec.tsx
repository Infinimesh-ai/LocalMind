/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_, key) => () =>
          key === 'Confirm'
            ? '确认'
            : key === 'Cancel'
              ? '取消'
              : key === 'com.affine.admin.ui.discard'
                ? '放弃'
                : String(key),
      }
    ),
}));
vi.mock('@affine/admin/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));
vi.mock('@affine/admin/components/ui/dialog', () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
      open ? <section role="dialog">{children}</section> : null,
    DialogContent: Box,
    DialogDescription: Box,
    DialogFooter: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});
import { ConfirmDialog } from './confirm-dialog';
import { DiscardChanges } from './discard-changes';
import { TypeConfirmDialog } from './type-confirm-dialog';
afterEach(cleanup);

test('admin confirmation and discard buttons use Chinese defaults', () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <ConfirmDialog {...props} title="确认操作" description="说明" />
  );
  expect(screen.getByRole('button', { name: '取消' })).toBeDefined();
  expect(screen.getByRole('button', { name: '确认' })).toBeDefined();
  view.rerender(<DiscardChanges {...props} />);
  expect(screen.getByRole('button', { name: '放弃' })).toBeDefined();
});

test('typed destructive confirmation stays gated behind the exact text and explicit click', () => {
  const confirm = vi.fn();
  render(
    <TypeConfirmDialog
      open
      onOpenChange={vi.fn()}
      title="确认删除"
      description="说明"
      targetText="REMOVE"
      onConfirm={confirm}
    />
  );
  const input = screen.getByRole('textbox');
  const button = screen.getByRole('button', {
    name: '确认',
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: 'REMOVE ' } });
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: 'REMOVE' } });
  expect(button.disabled).toBe(false);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledOnce();
});
