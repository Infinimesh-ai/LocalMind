/** @vitest-environment happy-dom */
/* eslint-disable rxjs/finnish -- Mock state fields keep the service's public API names. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  quickSearch: {
    show$: { value: true },
    query$: { value: 'report' },
    isLoading$: { value: false },
    loadingProgress$: { value: null },
    error$: { value: null },
    options$: { value: { searchModes: true } },
    items$: {
      value: [
        {
          id: 'native:office:pdf',
          source: 'workspace-native',
          label: { title: 'report.pdf' },
          payload: { resourceId: 'pdf', kind: 'office' },
        },
        {
          id: 'command',
          source: 'commands',
          label: { title: 'Open settings' },
          payload: {},
        },
      ],
    },
    hide: vi.fn(),
    setQuery: vi.fn(),
    submit: vi.fn(),
  },
}));
vi.mock('@affine/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (data: { value: unknown }) => data.value,
  useServices: () => ({ quickSearchService: state }),
}));
vi.mock('../services/quick-search', () => ({ QuickSearchService: class {} }));
vi.mock('./modal', () => ({
  QuickSearchModal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('./cmdk', () => ({
  CMDK: ({
    groups,
  }: {
    groups: { items: { id: string; label: { title: string } }[] }[];
  }) => (
    <div>
      {groups.flatMap(group =>
        group.items.map(item => <span key={item.id}>{item.label.title}</span>)
      )}
    </div>
  ),
}));

import { QuickSearchContainer } from './container';
afterEach(cleanup);

test('resource mode includes native PDF results while commands remain isolated', () => {
  render(<QuickSearchContainer />);
  expect(screen.getByText('report.pdf')).toBeTruthy();
  expect(screen.queryByText('Open settings')).toBeNull();
  fireEvent.click(
    screen.getByRole('tab', { name: 'com.affine.quicksearch.mode.commands' })
  );
  expect(screen.queryByText('report.pdf')).toBeNull();
  expect(screen.getByText('Open settings')).toBeTruthy();
});
