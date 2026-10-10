/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
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
vi.mock('../input', () => ({
  default: ({
    onChange,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
  }) => <input {...props} onChange={e => onChange(e.target.value)} />,
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
