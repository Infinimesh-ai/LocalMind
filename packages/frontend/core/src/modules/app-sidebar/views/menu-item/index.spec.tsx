/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { CategoryDivider } from '../category-divider';
import { MenuItem, MenuLinkItem } from './index';

vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchLink: ({ to, children }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
}));

afterEach(cleanup);

test('overflow actions support Enter and Space, while disabled actions stay inactive', () => {
  const onClick = vi.fn();
  const view = render(<MenuItem onClick={onClick}>Settings</MenuItem>);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), {
    key: ' ',
  });
  expect(onClick).toHaveBeenCalledTimes(2);
  view.rerender(
    <MenuItem onClick={onClick} disabled>
      Settings
    </MenuItem>
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), {
    key: 'Enter',
  });
  expect(onClick).toHaveBeenCalledTimes(2);
});

test('navigation links have one keyboard stop', () => {
  render(<MenuLinkItem to="/all">Documents</MenuLinkItem>);
  const link = screen.getByRole('link', { name: 'Documents' });
  expect(link.querySelector('[tabindex="0"]')).toBeNull();
});

test('file section toggles with the keyboard without intercepting child actions', () => {
  const setCollapsed = vi.fn();
  render(
    <CategoryDivider
      label="Files"
      collapsed={false}
      setCollapsed={setCollapsed}
    >
      <button>Add folder</button>
    </CategoryDivider>
  );
  const header = screen.getByRole('button', { name: 'Files' });
  expect(header.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(header, { key: ' ' });
  expect(setCollapsed).toHaveBeenCalledExactlyOnceWith(true);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add folder' }), {
    key: 'Enter',
  });
  expect(setCollapsed).toHaveBeenCalledTimes(1);
});
