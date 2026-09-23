/**
 * @vitest-environment happy-dom
 */
import { getOrCreateI18n, useI18n } from '@affine/i18n';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { translateAdminText } from './localized-text';
import {
  ALL_CONFIG_DESCRIPTORS,
  ALL_SETTING_GROUPS,
} from './modules/settings/config';

function Labels() {
  useI18n();
  return (
    <div>
      {translateAdminText('Server')} / {translateAdminText('No jobs found')}
    </div>
  );
}

afterEach(async () => {
  cleanup();
  await getOrCreateI18n().changeLanguage('en');
});

test('inherited labels update immediately in both language directions', async () => {
  await getOrCreateI18n().changeLanguage('en');
  render(<Labels />);
  expect(screen.getByText('Server / No jobs found')).toBeTruthy();
  await act(() => getOrCreateI18n().changeLanguage('zh-Hans'));
  expect(screen.getByText('服务器 / 暂无任务')).toBeTruthy();
  await act(() => getOrCreateI18n().changeLanguage('en'));
  expect(screen.getByText('Server / No jobs found')).toBeTruthy();
});

test('every self-hosted settings group and displayed descriptor has a Chinese translation', async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
  for (const group of ALL_SETTING_GROUPS) {
    if (['payment', 'captcha', 'telemetry', 'metrics'].includes(group.module))
      continue;
    expect(translateAdminText(group.name), group.name).not.toBe(group.name);
    for (const field of group.fields) {
      const description =
        typeof field === 'string'
          ? ALL_CONFIG_DESCRIPTORS[group.module][field].desc
          : (field.desc ??
            ALL_CONFIG_DESCRIPTORS[group.module][field.key].desc);
      expect(
        translateAdminText(description),
        `${group.module}: ${description}`
      ).not.toBe(description);
    }
  }
  expect(translateAdminText('customer_queue_123')).toBe('customer_queue_123');
});
