/**
 * @vitest-environment happy-dom
 */
import { FeatureType } from '@affine/graphql';
import { getOrCreateI18n } from '@affine/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { FeatureFilterPopover } from './feature-filter-popover';

afterEach(async () => {
  cleanup();
  await getOrCreateI18n().changeLanguage('en');
});

test('translates feature labels immediately without changing permission values', async () => {
  const onChange = vi.fn();
  await getOrCreateI18n().changeLanguage('en');
  render(
    <FeatureFilterPopover
      availableFeatures={[FeatureType.Admin]}
      selectedFeatures={[]}
      onChange={onChange}
    />
  );
  expect(screen.getByRole('button', { name: 'Features' })).toBeTruthy();
  await act(() => getOrCreateI18n().changeLanguage('zh-Hans'));
  fireEvent.click(screen.getByRole('button', { name: '功能权限' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '管理员' }));
  expect(onChange).toHaveBeenCalledWith([FeatureType.Admin]);
});
