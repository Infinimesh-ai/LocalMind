/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { SettingSidebarItem } from './setting-sidebar-item';

vi.mock('@affine/i18n', () => ({ useI18n: () => ({}) }));
afterEach(cleanup);

test('settings navigation is reachable by Tab and activates once with Enter or Space', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <SettingSidebarItem
      key="appearance"
      title="Appearance"
      icon={<svg />}
      isActive
      onClick={onClick}
    />
  );
  const item = screen.getByRole('button', { name: 'Appearance' });
  await user.tab();
  expect(document.activeElement).toBe(item);
  expect(item.getAttribute('aria-current')).toBe('page');
  await user.keyboard('{Enter}');
  expect(onClick).toHaveBeenCalledTimes(1);
  await user.keyboard(' ');
  expect(onClick).toHaveBeenCalledTimes(2);
});
