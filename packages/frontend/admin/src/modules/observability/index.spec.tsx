/**
 * @vitest-environment happy-dom
 */
import { getOrCreateI18n } from '@affine/i18n';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ObservabilityLogsPage, ObservabilitySettingsPage } from './index';

vi.mock('../header', () => ({
  Header: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await getOrCreateI18n().changeLanguage('en');
});

test('logs switch language without remounting or refetching', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: { localmindLogEvents: [] } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  await getOrCreateI18n().changeLanguage('en');
  render(<ObservabilityLogsPage />);
  await screen.findByText('No logs found.');
  await act(() => getOrCreateI18n().changeLanguage('zh-Hans'));
  expect(screen.getByText('日志中心')).toBeTruthy();
  expect(screen.getByPlaceholderText('按请求 ID 筛选')).toBeTruthy();
  expect(screen.getByText('暂无符合条件的日志。')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(() => getOrCreateI18n().changeLanguage('en'));
  expect(screen.getByText('Log Center')).toBeTruthy();
});

test('log policy labels are translated', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          localmindLogPolicy: { runtimeRetentionDays: 30 },
          localmindLogIngestionStatus: { files: 2, bytes: 128 },
        },
      }),
    })
  );
  await getOrCreateI18n().changeLanguage('zh-Hans');
  render(<ObservabilitySettingsPage />);
  expect(await screen.findByText('日志缓冲：2 个文件 / 128 字节')).toBeTruthy();
  expect(screen.getByLabelText('运行日志保留天数')).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存策略' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '预览签名归档' })).toBeTruthy();
  expect(screen.getByText('签名归档批次')).toBeTruthy();
  expect(screen.getByText('暂无归档批次。')).toBeTruthy();
  expect(screen.getByText('会话删除任务')).toBeTruthy();
  expect(screen.getByText('暂无会话删除任务。')).toBeTruthy();
});
