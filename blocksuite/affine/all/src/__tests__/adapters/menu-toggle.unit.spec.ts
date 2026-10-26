/** @vitest-environment happy-dom */
import { signal } from '@preact/signals-core';
import { render } from 'lit';
import { afterEach, expect, test, vi } from 'vitest';

import {
  MenuButton,
  menuButtonItems as menu,
} from '../../../../components/src/context-menu/button';
import type { Menu } from '../../../../components/src/context-menu/menu';
import { ToggleSwitch } from '../../../../components/src/toggle-switch';

if (!customElements.get('affine-menu-button'))
  customElements.define('affine-menu-button', MenuButton);
if (!customElements.get('toggle-switch'))
  customElements.define('toggle-switch', ToggleSwitch);

afterEach(() => document.body.replaceChildren());

async function setup() {
  const onChange = vi.fn();
  const context = {
    search: () => true,
    currentFocused$: signal(undefined),
    closeSubMenu: vi.fn(),
  } as unknown as Menu;
  const host = document.createElement('div');
  document.body.append(host);
  render(
    menu.toggleSwitch({ name: 'Read pages', on: false, onChange })(context),
    host
  );
  const row = host.querySelector<MenuButton>('affine-menu-button')!;
  await row.updateComplete;
  const control = row.querySelector('toggle-switch')!;
  await control.updateComplete;
  return { row, control, onChange };
}

test('clicking the label toggles both ways without closing or using a stale value', async () => {
  const { row, control, onChange } = await setup();
  const label = row.querySelector<HTMLElement>('.affine-menu-action-text')!;
  label.click();
  await control.updateComplete;
  expect(control.on).toBe(true);
  label.click();
  await control.updateComplete;
  expect(control.on).toBe(false);
  expect(onChange.mock.calls).toEqual([[true], [false]]);
});

test('keyboard selection toggles the same control', async () => {
  const { row, control, onChange } = await setup();
  row.onPressEnter();
  await control.updateComplete;
  expect(control.on).toBe(true);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
});

test('the native switch click does not also activate the menu row', async () => {
  const { control, onChange } = await setup();
  control.shadowRoot!.querySelector('input')!.click();
  await control.updateComplete;
  expect(control.on).toBe(true);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
});
