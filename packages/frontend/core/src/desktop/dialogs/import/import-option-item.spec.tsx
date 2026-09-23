/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { ImportOptionItem } from './import-option-item';

vi.mock('@affine/i18n', () => ({
  useI18n: () => ({ help: () => 'Format help' }),
}));
afterEach(cleanup);

test('import formats support Tab, Enter and Space', async () => {
  const user = userEvent.setup();
  const onImport = vi.fn();
  render(
    <ImportOptionItem
      label="Markdown"
      labelText="Markdown"
      prefixIcon={<svg />}
      onImport={onImport}
    />
  );
  const item = screen.getByRole('button', { name: 'Markdown' });
  await user.tab();
  expect(document.activeElement).toBe(item);
  await user.keyboard('{Enter}');
  expect(onImport).toHaveBeenCalledTimes(1);
  await user.keyboard(' ');
  expect(onImport).toHaveBeenCalledTimes(2);
});

test('disabled formats cannot start import by mouse or keyboard', async () => {
  const user = userEvent.setup();
  const onImport = vi.fn();
  render(
    <ImportOptionItem
      label="OneNote"
      labelText="OneNote"
      prefixIcon={<svg />}
      onImport={onImport}
      disabled
    />
  );
  const item = screen.getByRole('button', {
    name: 'OneNote',
  }) as HTMLButtonElement;
  expect(item.disabled).toBe(true);
  await user.click(item);
  await user.tab();
  await user.keyboard('{Enter} ');
  expect(onImport).not.toHaveBeenCalled();
});

test('help is independently accessible and never starts an import', async () => {
  const user = userEvent.setup();
  const onImport = vi.fn();
  render(
    <ImportOptionItem
      label="Markdown"
      labelText="Markdown"
      prefixIcon={<svg />}
      suffixIcon={<svg />}
      suffixTooltip="help"
      onImport={onImport}
    />
  );
  const item = screen.getByRole('button', { name: 'Markdown' });
  const help = screen.getByRole('button', { name: 'Format help' });
  expect(item.contains(help)).toBe(false);
  await user.click(help);
  await user.keyboard('{Enter} ');
  expect(onImport).not.toHaveBeenCalled();
});
