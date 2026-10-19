/** @vitest-environment happy-dom */
import type { DocRecord } from '@affine/core/modules/doc';
import type { CompatibleFavoriteItemsAdapter } from '@affine/core/modules/favorite';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { LiveData } from '@toeverything/infra';
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useLayoutEffect,
} from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const adapter = vi.hoisted(() => ({
  // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the production adapter method.
  isFavorite$: vi.fn<CompatibleFavoriteItemsAdapter['isFavorite$']>(),
  toggle: vi.fn(),
  committed: false,
}));
vi.mock('@affine/component', () => ({
  IconButton: ({
    icon,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) => (
    <button {...props}>{icon}</button>
  ),
  Checkbox: () => null,
  toast: vi.fn(),
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
}));
vi.mock('@affine/core/modules/favorite', () => ({
  CompatibleFavoriteItemsAdapter: class {},
}));
vi.mock('@affine/core/modules/permissions', () => ({ GuardService: class {} }));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => adapter,
}));
vi.mock('@affine/i18n', () => ({ useI18n: () => ({}) }));
vi.mock('@affine/track', () => ({
  default: { allDocs: { list: { docMenu: { toggleFavorite: vi.fn() } } } },
}));
vi.mock('../../hooks/affine/use-block-suite-meta-helper', () => ({
  useBlockSuiteMetaHelper: vi.fn(),
}));
vi.mock('../../pure/icons', () => ({ IsFavoriteIcon: () => null }));

import { createDocExplorerContext, DocExplorerContext } from '../context';
import { QuickFavorite } from './quick-actions';

beforeEach(() => {
  adapter.isFavorite$.mockReset();
  adapter.toggle.mockReset();
  adapter.committed = false;
});
afterEach(cleanup);

test('initializes the favorite watcher after commit and retains reactive toggle behavior', () => {
  const favorite$ = new LiveData(false);
  adapter.isFavorite$.mockImplementation(() => {
    // Opening the real userdata watcher can synchronously update workspace sync UI.
    expect(adapter.committed).toBe(true);
    return favorite$;
  });
  const onClick = vi.fn();
  const context = createDocExplorerContext();
  function View() {
    useLayoutEffect(() => {
      adapter.committed = true;
    });
    return (
      <DocExplorerContext.Provider value={context}>
        <QuickFavorite doc={{ id: 'first' } as DocRecord} onClick={onClick} />
      </DocExplorerContext.Provider>
    );
  }
  render(<View />);
  const button = screen.getByTestId('doc-list-operation-favorite');
  expect(adapter.isFavorite$).toHaveBeenCalledExactlyOnceWith('first', 'doc');
  expect(button.dataset.favorite).toBe('false');
  act(() => favorite$.next(true));
  expect(button.dataset.favorite).toBe('true');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  expect(adapter.toggle).toHaveBeenCalledExactlyOnceWith('first', 'doc');
});

test('hidden quick favorites do not open the userdata watcher', () => {
  const context = createDocExplorerContext();
  context.displayPreference$.next({
    ...context.displayPreference$.value,
    quickFavorite: false,
  });
  render(
    <DocExplorerContext.Provider value={context}>
      <QuickFavorite doc={{ id: 'first' } as DocRecord} />
    </DocExplorerContext.Provider>
  );
  expect(screen.queryByTestId('doc-list-operation-favorite')).toBeNull();
  expect(adapter.isFavorite$).not.toHaveBeenCalled();
});

test('changing documents removes the old favorite subscription', () => {
  const first$ = new LiveData(true);
  const second$ = new LiveData(false);
  adapter.isFavorite$.mockImplementation((id: string) =>
    id === 'first' ? first$ : second$
  );
  const context = createDocExplorerContext();
  const view = (id: string) => (
    <DocExplorerContext.Provider value={context}>
      <QuickFavorite doc={{ id } as DocRecord} />
    </DocExplorerContext.Provider>
  );
  const result = render(view('first'));
  expect(
    screen.getByTestId('doc-list-operation-favorite').dataset.favorite
  ).toBe('true');
  result.rerender(view('second'));
  act(() => first$.next(false));
  act(() => first$.next(true));
  const button = screen.getByTestId('doc-list-operation-favorite');
  expect(button.dataset.favorite).toBe('false');
  fireEvent.click(button);
  expect(adapter.toggle).toHaveBeenCalledExactlyOnceWith('second', 'doc');
  act(() => second$.next(true));
  expect(button.dataset.favorite).toBe('true');
});
