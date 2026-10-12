/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', async () => ({
  isComposingKeyboardEvent: (await import('@affine/component/ui/input'))
    .isComposingKeyboardEvent,
  PropertyValue: ({
    children,
    onClick,
  }: PropsWithChildren<{ onClick: () => void }>) => (
    <button onClick={onClick} aria-label="编辑链接">
      {children}
    </button>
  ),
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/core/components/affine/reference-link', () => ({
  AffinePageReference: () => null,
}));
vi.mock('@affine/core/components/mobile', () => ({ ConfigModal: () => null }));
vi.mock('@affine/core/modules/navigation', () => ({
  resolveLinkToDoc: () => null,
}));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (data: { value: unknown }) => data.value,
}));
import { LinkCell } from './link';
afterEach(cleanup);

test('link editing ignores IME confirmation and repeated Enter, then commits the complete value', () => {
  const cellValueChange = vi.fn();
  const onChange = vi.fn();
  const cellValue = {
    value: '',
    map: (fn: (value: string) => boolean) => ({ value: fn('') }),
  };
  render(
    <LinkCell
      cell={
        {
          id: 'property-1',
          // eslint-disable-next-line rxjs/finnish -- Static mock mirrors the cell's reactive field.
          value$: cellValue,
          // eslint-disable-next-line rxjs/finnish -- Static mock mirrors the property name field.
          property: { name$: { value: '链接' } },
        } as never
      }
      dataSource={{ cellValueChange } as never}
      rowId="doc-1"
      onChange={onChange}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑链接' }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, {
    target: { value: 'https://example.com/完整中文' },
  });
  for (const event of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ])
    fireEvent.keyDown(input, { key: 'Enter', ...event });
  expect(cellValueChange).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  expect(cellValueChange).toHaveBeenCalledExactlyOnceWith(
    'doc-1',
    'property-1',
    'https://example.com/完整中文'
  );
  expect(onChange).toHaveBeenCalledExactlyOnceWith(
    'https://example.com/完整中文'
  );
});
