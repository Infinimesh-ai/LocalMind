import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { vi } from 'vitest';

export const notify = Object.assign(vi.fn(), {
  error: vi.fn(),
  success: vi.fn(),
});
export const openConfirmModal = vi.fn(
  (options: { onConfirm?: () => unknown }) => options.onConfirm?.()
);
export const Button = ({
  children,
  variant: _variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
  <button type="button" {...props}>
    {children}
  </button>
);
export const Loading = () => <span role="status">loading</span>;
export const Tooltip = ({ children }: PropsWithChildren) => children;
export const Modal = ({
  open,
  title,
  children,
}: PropsWithChildren<{ open: boolean; title?: ReactNode }>) =>
  open ? (
    <div
      role="dialog"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {children}
    </div>
  ) : null;
export const useConfirmModal = () => ({ openConfirmModal });
