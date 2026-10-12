/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () => ({
    'com.affine.loading': () => '加载中',
    'com.affine.appUpdater.installUpdate': () => '安装更新',
    'com.affine.appUpdater.updateAvailable': () => '有可用更新',
  }),
}));
vi.mock('@toeverything/infra', () => ({ useService: () => ({}) }));
vi.mock('@affine/component', () => ({
  Tooltip: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@affine/core/modules/url', () => ({ UrlService: Symbol('url') }));
vi.mock('@affine/core/components/hooks/use-catch-event-hook', () => ({
  useCatchEventCallback: (fn: () => void) => fn,
}));
import { AppUpdaterButton } from './index';
afterEach(cleanup);

test('quitting to install an update displays the translated loading state', () => {
  const view = render(
    <AppUpdaterButton
      updateReady
      changelogUnread={false}
      autoDownload={false}
      downloadProgress={null}
      appQuitting={false}
      updateAvailable={{ version: '1.0.0', allowAutoUpdate: true }}
      onQuitAndInstall={vi.fn()}
      onDownloadUpdate={vi.fn()}
      onDismissChangelog={vi.fn()}
      onOpenChangelog={vi.fn()}
    />
  );
  expect(screen.getByText('安装更新')).toBeDefined();
  view.rerender(
    <AppUpdaterButton
      updateReady
      changelogUnread={false}
      autoDownload={false}
      downloadProgress={null}
      appQuitting
      updateAvailable={{ version: '1.0.0', allowAutoUpdate: true }}
      onQuitAndInstall={vi.fn()}
      onDownloadUpdate={vi.fn()}
      onDismissChangelog={vi.fn()}
      onOpenChangelog={vi.fn()}
    />
  );
  expect(screen.getByText('加载中')).toBeDefined();
  expect(screen.queryByText('安装更新')).toBeNull();
});
