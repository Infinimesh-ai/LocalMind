/**
 * @vitest-environment happy-dom
 */
import { IconButton } from '@blocksuite/affine/components/icon-button';
import { html } from 'lit';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ChatPanelAddPopover } from './add-popover';

vi.unstubAllGlobals();
if (!customElements.get('icon-button')) {
  customElements.define('icon-button', IconButton);
}
customElements.define('test-chat-add-popover', ChatPanelAddPopover);

afterEach(() => {
  document.body.replaceChildren();
});

async function createPopover(attachmentsOnly = false) {
  const actions = [vi.fn(), vi.fn()];
  const popover = document.createElement(
    'test-chat-add-popover'
  ) as ChatPanelAddPopover;
  popover.abortController = new AbortController();
  popover.attachmentsOnly = attachmentsOnly;
  popover.searchMenuConfig = {
    supportsCategories: false,
    getDocMenuGroup: () => ({
      name: 'Documents',
      items: actions.map((action, index) => ({
        key: `doc-${index}`,
        name: `Document ${index}`,
        icon: html``,
        action,
      })),
    }),
    getTagMenuGroup: () => ({ name: 'Tags', items: [] }),
    getCollectionMenuGroup: () => ({ name: 'Collections', items: [] }),
  };
  document.body.append(popover);
  await popover.updateComplete;
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const buttons = Array.from(popover.querySelectorAll('icon-button'));
  return { popover, actions, buttons };
}

function key(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('chat context picker keyboard activation', () => {
  test.each(['Enter', ' '])(
    '%s activates the focused document even after another item is hovered',
    async activationKey => {
      const { actions, buttons } = await createPopover();
      buttons[1].focus();
      buttons[0].dispatchEvent(new MouseEvent('mousemove'));

      expect(key(buttons[1], activationKey).defaultPrevented).toBe(true);
      expect(actions[0]).not.toHaveBeenCalled();
      expect(actions[1]).toHaveBeenCalledTimes(1);
    }
  );

  test('arrow navigation from a focused item moves focus and activates that item', async () => {
    const { actions, buttons } = await createPopover();
    buttons[0].focus();
    key(buttons[0], 'ArrowDown');

    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1], 'Enter');
    expect(actions[1]).toHaveBeenCalledTimes(1);
    key(buttons[1], 'ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
  });

  test('search input retains focus during arrows and Enter activates the highlighted result', async () => {
    const { popover, actions } = await createPopover();
    key(popover.searchInput, 'ArrowDown');
    expect(document.activeElement).toBe(popover.searchInput);
    key(popover.searchInput, 'Enter');
    expect(actions[0]).not.toHaveBeenCalled();
    expect(actions[1]).toHaveBeenCalledTimes(1);
    expect(key(popover.searchInput, ' ').defaultPrevented).toBe(false);
  });

  test('repeated activation does not attach twice', async () => {
    const { actions, buttons } = await createPopover();
    buttons[1].focus();
    key(buttons[1], 'Enter');
    expect(key(buttons[1], 'Enter', { repeat: true }).defaultPrevented).toBe(
      true
    );
    expect(key(buttons[1], ' ', { repeat: true }).defaultPrevented).toBe(true);
    expect(actions[1]).toHaveBeenCalledTimes(1);
  });

  test('IME and modified keys do not activate a document', async () => {
    const { actions, buttons } = await createPopover();
    buttons[1].focus();
    key(buttons[1], 'Enter', { isComposing: true });
    key(buttons[1], 'Enter', { keyCode: 229 });
    key(buttons[1], 'Enter', { ctrlKey: true });
    key(buttons[1], 'Enter', { metaKey: true });
    expect(actions.every(action => action.mock.calls.length === 0)).toBe(true);
  });

  test('outside keys are untouched and Escape only closes the focused picker', async () => {
    const { popover, actions } = await createPopover();
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    for (const value of ['Enter', 'ArrowDown', 'Escape']) {
      expect(key(outside, value).defaultPrevented).toBe(false);
    }
    expect(popover.abortController.signal.aborted).toBe(false);
    expect(actions.every(action => action.mock.calls.length === 0)).toBe(true);
    popover.searchInput.focus();
    key(popover.searchInput, 'Escape');
    expect(popover.abortController.signal.aborted).toBe(true);
  });

  test('attachment-only picker focuses its first upload button', async () => {
    const { buttons } = await createPopover(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
});
