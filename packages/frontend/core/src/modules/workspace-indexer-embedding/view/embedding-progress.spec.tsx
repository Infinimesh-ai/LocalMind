/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import EmbeddingProgress from './embedding-progress';
vi.mock('./styles-css', () => ({
  embeddingProgress: '',
  embeddingProgressTitle: '',
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_, key) => (values?: { count: number }) =>
          `${String(key)}${values ? ':' + values.count : ''}`,
      }
    ),
}));
vi.mock('@affine/component', () => ({
  Progress: ({ value }: { value: number }) => (
    <progress value={value} max={100} />
  ),
  Button: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{ onClick: () => void; disabled: boolean }>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
afterEach(cleanup);
test('terminal failures stay visible and retry is blocked while submitting', () => {
  const retry = vi.fn();
  const { rerender } = render(
    <EmbeddingProgress
      status={{ total: 2, embedded: 1, failed: 1, retryable: 1 }}
      onRetry={retry}
    />
  );
  expect(screen.getByTestId('embedding-progress-title').dataset.progress).toBe(
    'failed'
  );
  fireEvent.click(screen.getByRole('button'));
  expect(retry).toHaveBeenCalledOnce();
  rerender(
    <EmbeddingProgress
      status={{ total: 2, embedded: 1, failed: 1, retryable: 1 }}
      onRetry={retry}
      retrying
    />
  );
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  rerender(
    <EmbeddingProgress
      status={{ total: 2, embedded: 2, failed: 0, retryable: 0 }}
      onRetry={retry}
    />
  );
  expect(screen.getByTestId('embedding-progress-title').dataset.progress).toBe(
    'synced'
  );
  expect(screen.queryByRole('button')).toBeNull();
});
test('unavailable provider and missing old sources are not shown as still syncing', () => {
  const { rerender } = render(
    <EmbeddingProgress status={{ total: 0, embedded: 0, available: false }} />
  );
  expect(screen.getByTestId('embedding-progress-title').dataset.progress).toBe(
    'unavailable'
  );
  rerender(
    <EmbeddingProgress
      status={{ total: 1, embedded: 0, failed: 1, retryable: 0 }}
    />
  );
  expect(screen.getByRole('status').textContent).toContain(
    'com.affine.embedding.reupload'
  );
  expect(screen.queryByRole('button')).toBeNull();
});
