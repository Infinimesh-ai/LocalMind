/** @vitest-environment happy-dom */
import { ContextMenu, Menu } from '@affine/component/ui/menu';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', async () => ({
  ...(await import('@affine/component/ui/menu')),
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));

import { FolderSortMenu } from './sort-menu';

afterEach(cleanup);

test('child sorting opens from More, marks the current mode and selects a different mode', async () => {
  const change = vi.fn();
  render(
    <Menu
      items={
        <FolderSortMenu mode="manual" disabled={false} onChange={change} />
      }
    >
      <button>More</button>
    </Menu>
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
    key: 'ArrowDown',
  });
  const submenu = await screen.findByRole('menuitem', {
    name: 'com.affine.localmind.resource-display.childSort',
  });
  fireEvent.keyDown(submenu, { key: 'ArrowRight' });
  const manual = await screen.findByRole('menuitemradio', {
    name: 'com.affine.rootAppSidebar.organize.folder.sort.manual',
  });
  expect(manual.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(
    screen.getByRole('menuitemradio', {
      name: 'com.affine.rootAppSidebar.organize.folder.sort.name-asc',
    })
  );
  expect(change).toHaveBeenCalledWith('name-asc');
});

test.each(['dropdown', 'context'] as const)(
  'a disabled child sort menu cannot open or change sorting from a %s menu',
  async type => {
    const change = vi.fn();
    const Root = type === 'dropdown' ? Menu : ContextMenu;
    render(
      <Root items={<FolderSortMenu mode="manual" disabled onChange={change} />}>
        <button>More</button>
      </Root>
    );
    if (type === 'context') {
      fireEvent.contextMenu(screen.getByRole('button', { name: 'More' }));
    } else {
      fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
        key: 'ArrowDown',
      });
    }
    const submenu = await screen.findByRole('menuitem', {
      name: 'com.affine.localmind.resource-display.childSort',
    });
    expect(submenu.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(submenu, { key: 'ArrowRight' });
    fireEvent.click(submenu);
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  }
);
