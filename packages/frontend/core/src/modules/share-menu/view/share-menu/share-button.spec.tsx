/** @vitest-environment happy-dom */
import { Menu } from '@affine/component/ui/menu';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

const service = {
  shareInfo: { isShared$: new LiveData(false), revalidate: vi.fn() },
};
vi.mock('@affine/core/modules/share-doc', () => ({
  ShareInfoService: class ShareInfoService {},
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<object>()),
  useService: () => service,
  useLiveData: () => false,
}));

import { DefaultShareButton } from './share-button';

afterEach(cleanup);

test('the real menu receives a focusable Share button and returns focus there on Escape', async () => {
  render(
    <Menu items={<button>Menu action</button>}>
      <DefaultShareButton data-testid="share-trigger" />
    </Menu>
  );
  const trigger = screen.getByTestId('share-trigger');
  expect(trigger.tagName).toBe('BUTTON');
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  });
  const menu = await screen.findByRole('menu');
  await act(async () => {
    fireEvent.keyDown(menu, { key: 'Escape' });
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
