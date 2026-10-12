/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { RowInput } from './row-input';

afterEach(cleanup);

test('Enter handled by the input cancels implicit form submission', () => {
  const confirm = vi.fn();
  render(
    <form>
      <RowInput defaultValue="子页面" onEnter={confirm} />
      <button type="submit">Save</button>
    </form>
  );
  expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })).toBe(
    false
  );
  expect(confirm).toHaveBeenCalledExactlyOnceWith('子页面');
});

test('an input without an Enter handler retains native form behavior', () => {
  render(
    <form>
      <RowInput />
      <button type="submit">Save</button>
    </form>
  );
  expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })).toBe(
    true
  );
});

test('IME confirmation, key repeat and cancelled events never confirm', () => {
  const confirm = vi.fn();
  render(
    <RowInput
      onEnter={confirm}
      onKeyDown={e => {
        if (e.ctrlKey) e.preventDefault();
      }}
    />
  );
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', repeat: true });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.compositionEnd(input);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '完整中文名称' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(confirm).toHaveBeenCalledExactlyOnceWith('完整中文名称');
});
