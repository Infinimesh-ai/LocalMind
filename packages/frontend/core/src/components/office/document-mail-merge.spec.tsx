/** @vitest-environment happy-dom */
import type * as Components from '@affine/component';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { DocumentMailMerge } from './document-mail-merge';

vi.mock('@affine/component', async importOriginal => ({
  ...(await importOriginal<typeof Components>()),
  Modal: ({ children }: PropsWithChildren) => (
    <div role="dialog">{children}</div>
  ),
}));
afterEach(cleanup);
const field = (argument: string, mailMergeSupported = true) => ({
  kind: 'MERGEFIELD',
  instruction: `MERGEFIELD "${argument}"`,
  argument,
  paragraphId: 'paragraph:1',
  mailMergeSupported,
});

test('deduplicates names and submits only edited values, including deliberate empty values', async () => {
  const onSubmit = vi.fn(async () => true);
  const onClose = vi.fn();
  render(
    <DocumentMailMerge
      fields={[
        field('Customer'),
        field('Customer'),
        field('Untouched'),
        field('constructor'),
      ]}
      readOnly={false}
      saving={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
  expect(screen.getAllByLabelText('Customer')).toHaveLength(1);
  expect((screen.getByLabelText('constructor') as HTMLInputElement).value).toBe(
    ''
  );
  const apply = screen.getByRole('button', { name: 'Apply field values' });
  expect(apply.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Customer'), {
    target: { value: '海棠' },
  });
  fireEvent.change(screen.getByLabelText('constructor'), {
    target: { value: 'Temporary' },
  });
  fireEvent.change(screen.getByLabelText('constructor'), {
    target: { value: '' },
  });
  fireEvent.click(apply);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSubmit).toHaveBeenCalledWith({ Customer: '海棠', constructor: '' });
});

test('retains input after failure and retries without closing or duplicating an in-flight write', async () => {
  let resolve: (value: boolean) => void = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<boolean>(done => {
        resolve = done;
      })
  );
  const onClose = vi.fn();
  render(
    <DocumentMailMerge
      fields={[field('Customer')]}
      readOnly={false}
      saving={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
  fireEvent.change(screen.getByLabelText('Customer'), {
    target: { value: '保留草稿' },
  });
  const apply = screen.getByRole('button', { name: 'Apply field values' });
  fireEvent.click(apply);
  fireEvent.click(apply);
  expect(onSubmit).toHaveBeenCalledOnce();
  resolve(false);
  await screen.findByRole('alert');
  expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Customer') as HTMLInputElement).value).toBe(
    '保留草稿'
  );
  onSubmit.mockResolvedValueOnce(true);
  fireEvent.click(apply);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSubmit).toHaveBeenCalledTimes(2);
});

test('read-only fields cannot submit and cancellation never writes', () => {
  const onSubmit = vi.fn(async () => true);
  const onClose = vi.fn();
  render(
    <DocumentMailMerge
      fields={[field('Customer')]}
      readOnly
      saving={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
  expect(screen.getByLabelText('Customer').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Apply field values' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});

test.each([
  { fields: [field('Complex', false)] },
  { fields: Array.from({ length: 101 }, (_, index) => field(String(index))) },
])(
  'does not offer a partial merge for unsupported or oversized field sets',
  ({ fields }) => {
    const onSubmit = vi.fn(async () => true);
    render(
      <DocumentMailMerge
        fields={fields}
        readOnly={false}
        saving={false}
        onSubmit={onSubmit}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole('status').textContent).toContain('preserved');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Apply field values' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  }
);
