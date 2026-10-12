/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      { get: (_, key) => () => (key === 'Done' ? '完成' : String(key)) }
    ),
}));
vi.mock('@affine/component', async () => ({
  RowInput: (await import('@affine/component/ui/input')).RowInput,
  Button: ({
    variant: _variant,
    size: _size,
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
    loading?: boolean;
  }) => <button {...props} disabled={props.disabled || loading} />,
}));
import { RenameContent } from './content';
afterEach(cleanup);

test('mobile rename uses a translated label and submits the current value with Enter', () => {
  const confirm = vi.fn();
  render(<RenameContent initialName="旧名称" onConfirm={confirm} />);
  expect(screen.getByRole('button', { name: '完成' })).toBeDefined();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '新的中文名称' },
  });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(confirm).toHaveBeenCalledExactlyOnceWith('新的中文名称');
});

test('IME confirmation and blank names do not rename', () => {
  const confirm = vi.fn();
  render(
    <RenameContent
      initialName="候选名称"
      onConfirm={confirm}
      confirmButtonProps={{ disabled: false }}
    />
  );
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

test('disabled or pending rename cannot be submitted from the keyboard', () => {
  const confirm = vi.fn();
  render(
    <RenameContent
      initialName="完整名称"
      onConfirm={confirm}
      confirmButtonProps={{ loading: true }}
    />
  );
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(confirm).not.toHaveBeenCalled();
});
