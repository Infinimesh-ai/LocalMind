/** @vitest-environment happy-dom */
import type * as Components from '@affine/component';
import { getOrCreateI18n } from '@affine/i18n';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';

import { boundedPdfRegion, PdfAnnotationRegionDialog } from './pdf-region';

vi.mock('@affine/component', async importOriginal => ({
  ...(await importOriginal<typeof Components>()),
  Modal: ({ children }: PropsWithChildren) => (
    <div role="dialog">{children}</div>
  ),
}));
beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});
afterEach(cleanup);
const page = { widthPt: 612, heightPt: 792 };
const initial = { xPt: 48, yPt: 640, widthPt: 220, heightPt: 24 };

test('regions stay inside small pages and reject nonfinite or negative dimensions', () => {
  expect(
    boundedPdfRegion({ xPt: 600, yPt: -1, widthPt: 1000, heightPt: 0 }, page)
  ).toEqual({
    xPt: 0,
    yPt: 0,
    widthPt: 612,
    heightPt: 1,
  });
  expect(
    boundedPdfRegion(
      { xPt: NaN, yPt: Infinity, widthPt: NaN, heightPt: -5 },
      page
    )
  ).toEqual({
    xPt: 0,
    yPt: 0,
    widthPt: 1,
    heightPt: 1,
  });
  expect(boundedPdfRegion(initial, { widthPt: 100, heightPt: 60 })).toEqual({
    xPt: 0,
    yPt: 36,
    widthPt: 100,
    heightPt: 24,
  });
});

test('region preview and cancellation never submit changes', () => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const onPreview = vi.fn();
  render(
    <PdfAnnotationRegionDialog
      initial={initial}
      page={page}
      disabled={false}
      onSubmit={onSubmit}
      onClose={onClose}
      onPreview={onPreview}
    />
  );
  fireEvent.change(screen.getByLabelText('Annotation region · X (pt)'), {
    target: { value: '70' },
  });
  expect(onPreview).toHaveBeenLastCalledWith({ ...initial, xPt: 70 });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('failed region save preserves the draft and prevents duplicate pending submissions', async () => {
  let finish!: (value: boolean) => void;
  const onSubmit = vi.fn(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      })
  );
  const onClose = vi.fn();
  render(
    <PdfAnnotationRegionDialog
      initial={initial}
      page={page}
      disabled={false}
      onSubmit={onSubmit}
      onClose={onClose}
      onPreview={vi.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText('Annotation region · Y (pt)'), {
    target: { value: '610' },
  });
  const apply = screen.getByRole('button', { name: 'Apply region' });
  fireEvent.click(apply);
  fireEvent.click(apply);
  expect(onSubmit).toHaveBeenCalledOnce();
  finish(false);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(
    (screen.getByLabelText('Annotation region · Y (pt)') as HTMLInputElement)
      .value
  ).toBe('610');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(apply);
  finish(true);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSubmit).toHaveBeenLastCalledWith({ ...initial, yPt: 610 });
});

test('read-only region cannot submit', () => {
  const onSubmit = vi.fn();
  render(
    <PdfAnnotationRegionDialog
      initial={initial}
      page={page}
      disabled
      onSubmit={onSubmit}
      onClose={vi.fn()}
      onPreview={vi.fn()}
    />
  );
  const apply = screen.getByRole('button', { name: 'Apply region' });
  expect(apply.hasAttribute('disabled')).toBe(true);
  fireEvent.click(apply);
  expect(onSubmit).not.toHaveBeenCalled();
});
