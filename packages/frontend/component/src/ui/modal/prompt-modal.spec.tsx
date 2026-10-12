/** @vitest-environment happy-dom */
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
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@radix-ui/react-dialog', () => ({
  DialogTrigger: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../button', () => ({
  Button: ({
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props} disabled={props.disabled || loading} />
  ),
}));
vi.mock('../input', async () => ({
  default: (await import('../input/row-input')).RowInput,
}));
vi.mock('./modal', () => ({
  Modal: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <section role="dialog">{children}</section> : null,
}));
import { PromptModalProvider, usePromptModal } from './prompt-modal';
afterEach(cleanup);
function Fixture({ confirm }: { confirm: (text: string) => Promise<void> }) {
  const { openPromptModal } = usePromptModal();
  return (
    <>
      <button
        onClick={() =>
          openPromptModal({
            defaultValue: 'Folder',
            confirmText: 'Save',
            onConfirm: confirm,
          })
        }
      >
        Open
      </button>
      <button
        onClick={() =>
          openPromptModal({ defaultValue: 'Another', confirmText: 'Save' })
        }
      >
        Replace
      </button>
    </>
  );
}
function mount(confirm: (text: string) => Promise<void>) {
  render(
    <PromptModalProvider>
      <Fixture confirm={confirm} />
    </PromptModalProvider>
  );
  fireEvent.click(screen.getByText('Open'));
}
test('rename starts with the current title and retains edited text after a failed save', async () => {
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(new Error('Private error'))
    .mockResolvedValueOnce(undefined);
  mount(confirm);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Folder'
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Edited folder' },
  });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByText('Private error')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Edited folder'
  );
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(confirm).toHaveBeenNthCalledWith(2, 'Edited folder');
});
test('duplicate saves and late results cannot dismiss a replacement prompt', async () => {
  let resolve!: () => void;
  const confirm = vi.fn(
    () =>
      new Promise<void>(done => {
        resolve = done;
      })
  );
  mount(confirm);
  fireEvent.click(screen.getByText('Save'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Replace'));
  resolve();
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Another'
    )
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
});

test('Enter submits the edited name and a failed submission retains it for retry', async () => {
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(new Error('Save failed'))
    .mockResolvedValueOnce(undefined);
  mount(confirm);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '新的子页面' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(confirm).toHaveBeenNthCalledWith(1, '新的子页面');
  expect((input as HTMLInputElement).value).toBe('新的子页面');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(confirm).toHaveBeenNthCalledWith(2, '新的子页面');
});

test('IME confirmation and whitespace-only names never submit a prompt', async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  mount(confirm);
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.compositionEnd(input);
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await Promise.resolve();
  expect(confirm).not.toHaveBeenCalled();
  expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
});

test('click and Enter while saving share the same pending operation', async () => {
  let resolve!: () => void;
  const confirm = vi.fn(
    () =>
      new Promise<void>(done => {
        resolve = done;
      })
  );
  mount(confirm);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(confirm).toHaveBeenCalledTimes(1);
  resolve();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
