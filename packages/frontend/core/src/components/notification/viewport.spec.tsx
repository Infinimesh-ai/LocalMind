/** @vitest-environment happy-dom */
import type { Notification } from '@affine/core/modules/notification';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({ Scrollable: { Viewport: 'div' } }));

import { NotificationViewport } from './viewport';

afterEach(cleanup);

const notification = (id: string, read = false) =>
  ({ id, read }) as Notification;
function Inbox({
  rows,
  mode = 'all',
  busy = false,
}: {
  rows: Notification[];
  mode?: 'unread' | 'all';
  busy?: boolean;
}) {
  return (
    <div>
      <span tabIndex={-1} data-notification-heading>
        Notifications
      </span>
      <div>
        <NotificationViewport notifications={rows} mode={mode}>
          <ul>
            {rows.map(row => (
              <li key={row.id} data-notification-id={row.id} tabIndex={-1}>
                {!row.read && (
                  <button disabled={busy} data-notification-action="read">
                    Read {row.id}
                  </button>
                )}
                <button disabled={busy} data-notification-action="delete">
                  Delete {row.id}
                </button>
              </li>
            ))}
          </ul>
        </NotificationViewport>
      </div>
    </div>
  );
}

test('removing a focused notification transfers focus to the next row while controls are busy', () => {
  const { rerender, container } = render(
    <Inbox rows={[notification('a'), notification('b')]} />
  );
  screen.getByText('Delete a').focus();
  rerender(<Inbox rows={[notification('b')]} busy />);
  expect(document.activeElement).toBe(
    container.querySelector('[data-notification-id="b"]')
  );
});

test('removing the last row transfers focus to the inbox heading', () => {
  const { rerender } = render(<Inbox rows={[notification('a')]} />);
  screen.getByText('Delete a').focus();
  rerender(<Inbox rows={[]} />);
  expect(document.activeElement).toBe(screen.getByText('Notifications'));
});

test('marking read in all mode keeps focus on the remaining action in the same row', () => {
  const { rerender } = render(<Inbox rows={[notification('a')]} />);
  screen.getByText('Read a').focus();
  rerender(<Inbox rows={[notification('a', true)]} />);
  expect(document.activeElement).toBe(screen.getByText('Delete a'));
});

test('background insertions preserve the visible row offset and switching filters resets scroll', () => {
  const initial = [notification('a'), notification('b'), notification('c')];
  const { rerender, container } = render(<Inbox rows={initial} />);
  const viewport = container.querySelector('ul')!.parentElement!;
  viewport.scrollTop = 100;
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const index = this.dataset.notificationId
        ? [...viewport.querySelectorAll('[data-notification-id]')].indexOf(this)
        : -1;
      const top = index >= 0 ? index * 80 - viewport.scrollTop : 0;
      return {
        x: 0,
        y: top,
        top,
        bottom: top + 80,
        left: 0,
        right: 300,
        width: 300,
        height: 80,
        toJSON: () => ({}),
      };
    });
  rerender(<Inbox rows={[notification('new'), ...initial]} />);
  expect(viewport.scrollTop).toBe(180);
  rerender(<Inbox rows={initial} />);
  expect(viewport.scrollTop).toBe(100);
  rerender(<Inbox rows={initial} mode="unread" />);
  expect(viewport.scrollTop).toBe(0);
  geometry.mockRestore();
});
