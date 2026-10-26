/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { LiveData } from '@toeverything/infra';
import type { PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { ViewRoot } from './view-root';

vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  FrameworkScope: ({ children }: PropsWithChildren) => children,
}));
afterEach(cleanup);

test('restores the view directly, without loading the default route or duplicating navigation', async () => {
  const location = {
    pathname: '/all',
    search: '?filter=saved',
    hash: '#section',
    state: { restored: true },
    key: 'saved',
  };
  const location$ = new LiveData(location);
  const rootLoader = vi.fn(() => null);
  const allLoader = vi.fn(() => null);
  function Content() {
    const current = useLocation();
    return <div>{current.pathname + current.search + current.hash}</div>;
  }
  const view = { history: { location }, location$ };
  render(
    <ViewRoot
      view={view as never}
      routes={[
        { path: '/', loader: rootLoader, Component: Content },
        { path: '/all', loader: allLoader, Component: Content },
        { path: '/doc', Component: Content },
      ]}
    />
  );
  expect(await screen.findByText('/all?filter=saved#section')).toBeTruthy();
  expect(rootLoader).not.toHaveBeenCalled();
  expect(allLoader).toHaveBeenCalledTimes(1);
  await act(async () => location$.next({ ...location, pathname: '/doc' }));
  expect(await screen.findByText('/doc?filter=saved#section')).toBeTruthy();
});
