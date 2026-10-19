import { expect, test, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ dark: 0, light: 0 }));
vi.mock('shiki/themes/dark-plus.mjs', () => {
  loaded.dark++;
  return { default: { name: 'dark-plus' } };
});
vi.mock('shiki/themes/light-plus.mjs', () => {
  loaded.light++;
  return { default: { name: 'light-plus' } };
});

import {
  CODE_BLOCK_DEFAULT_DARK_THEME,
  CODE_BLOCK_DEFAULT_LIGHT_THEME,
} from '../../../blocks/code/src/highlight/const';

test('importing editor extensions does not fetch themes until highlighting is requested', async () => {
  expect(loaded).toEqual({ dark: 0, light: 0 });
  expect((await CODE_BLOCK_DEFAULT_DARK_THEME()).default.name).toBe(
    'dark-plus'
  );
  expect((await CODE_BLOCK_DEFAULT_LIGHT_THEME()).default.name).toBe(
    'light-plus'
  );
  expect(loaded).toEqual({ dark: 1, light: 1 });
});
