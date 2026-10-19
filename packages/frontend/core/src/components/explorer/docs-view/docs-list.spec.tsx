/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { type ComponentType, type ReactNode, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
  Masonry: ({
    items,
  }: {
    items: {
      id: string;
      items: {
        id: string;
        height?: number;
        Component: ComponentType<{ itemId: string; groupId: string }>;
      }[];
    }[];
  }) =>
    items.map(group =>
      group.items.map(item => (
        <div key={item.id} data-testid={item.id} data-height={item.height}>
          <item.Component itemId={item.id} groupId={group.id} />
        </div>
      ))
    ),
}));
vi.mock('@affine/core/modules/doc', () => ({ DocsService: class {} }));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
const deck = vi.hoisted(() => ({ available: false, open: vi.fn() }));
vi.mock('../../report-deck-entry', () => ({
  useReportDeckEntryAvailable: () => deck.available,
  useOpenReportDeck: () => deck.open,
}));
vi.mock('@affine/core/modules/workspace-property', () => ({
  WorkspacePropertyService: class {},
}));
vi.mock('@toeverything/infra', async importOriginal => {
  const infra = await importOriginal<typeof Infra>();
  return {
    ...infra,
    useService: () => ({
      list: {
        // eslint-disable-next-line rxjs/finnish -- Mirrors the DocsService API.
        doc$: (id: string) =>
          new infra.LiveData({ title$: new infra.LiveData(`Title ${id}`) }),
      },
    }),
    useServiceOptional: () => ({ workspace: { id: 'workspace-1' } }),
  };
});
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
  Trans: () => null,
}));
vi.mock('../../affine/empty', () => ({ EmptyDocs: () => null }));
vi.mock('../../page-list/components/list-floating-toolbar', () => ({
  ListFloatingToolbar: ({ actions }: { actions?: ReactNode }) =>
    actions ?? null,
}));
vi.mock('../../page-list/components/floating-toolbar', () => ({
  FloatingToolbar: {
    Button: ({ label, onClick }: { label: ReactNode; onClick: () => void }) => (
      <button type="button" onClick={onClick}>
        {label}
      </button>
    ),
  },
}));
vi.mock('../../system-property-types', () => ({ SystemPropertyTypes: {} }));
vi.mock('../../workspace-property-types', () => ({
  WorkspacePropertyTypes: {},
}));
vi.mock('./doc-list-item', () => ({ DocListItem: () => null }));

import { createDocExplorerContext, DocExplorerContext } from '../context';
import { DocsExplorer } from './docs-list';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  deck.available = false;
  deck.open.mockReset();
});

test('masonry measures content, grid keeps equal heights, and switching views discards stale measurements', () => {
  const observers = new Map<Element, ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      private element?: Element;
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.element = element;
        observers.set(element, this.callback);
      }
      unobserve(element: Element) {
        observers.delete(element);
      }
      disconnect() {
        if (this.element) observers.delete(this.element);
      }
    }
  );
  const resize = (title: string, height: number) => {
    const element = screen.getByText(title).parentElement!;
    const callback = observers.get(element)!;
    act(() =>
      callback(
        [
          {
            target: element,
            contentRect: new DOMRect(0, 0, 240, height),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        {} as ResizeObserver
      )
    );
  };
  const context = createDocExplorerContext({ view: 'masonry' });
  context.groups$.next([{ key: 'all', items: ['page', 'file'] }]);
  const view = (mode: 'masonry' | 'grid' | 'list') => (
    <DocExplorerContext.Provider value={context}>
      <DocsExplorer
        toolbar={null}
        renderItem={id => <span>{id}</span>}
        measureResourceItems={mode !== 'grid'}
        resourceItemHeight={mode === 'list' ? 44 : 320}
      />
    </DocExplorerContext.Provider>
  );
  const result = render(view('masonry'));
  resize('page', 280);
  resize('file', 180);
  expect(screen.getByTestId('page').dataset.height).toBe('280');
  expect(screen.getByTestId('file').dataset.height).toBe('180');

  act(() => context.displayPreference$.next({ view: 'grid' }));
  result.rerender(view('grid'));
  expect(screen.getByTestId('page').dataset.height).toBe('320');
  expect(screen.getByTestId('file').dataset.height).toBe('320');

  act(() => context.displayPreference$.next({ view: 'list' }));
  result.rerender(view('list'));
  expect(screen.getByTestId('page').dataset.height).toBe('44');
  resize('page', 64);
  act(() => context.displayPreference$.next({ view: 'masonry' }));
  result.rerender(view('masonry'));
  expect(screen.getByTestId('page').dataset.height).toBe('320');
  resize('page', 280);
  expect(screen.getByTestId('page').dataset.height).toBe('280');
});

test('catalog reconciliation preserves an open row action and its unsaved input', () => {
  const context = createDocExplorerContext();
  context.groups$.next([{ key: 'today', items: ['native:workspace:file:id'] }]);
  function ResourceAction({ title }: { title: string }) {
    const [draft, setDraft] = useState('');
    return (
      <label>
        {title}
        <input
          aria-label="Rename draft"
          value={draft}
          onChange={event => setDraft(event.target.value)}
        />
      </label>
    );
  }
  const view = (title: string) => (
    <DocExplorerContext.Provider value={context}>
      <DocsExplorer
        toolbar={null}
        renderItem={() => <ResourceAction title={title} />}
      />
    </DocExplorerContext.Provider>
  );
  const result = render(view('Before refresh'));
  fireEvent.change(screen.getByLabelText('Rename draft'), {
    target: { value: 'Unsaved rename' },
  });
  result.rerender(view('After refresh'));
  expect(screen.getByLabelText<HTMLInputElement>('Rename draft').value).toBe(
    'Unsaved rename'
  );
  expect(screen.getByText('After refresh')).toBeTruthy();
});

test('the floating toolbar presents the selected documents as a report deck', () => {
  const context = createDocExplorerContext();
  context.groups$.next([{ key: 'today', items: ['doc-a', 'doc-b'] }]);
  context.selectMode$?.next(true);
  context.selectedDocIds$.next(['doc-a', 'doc-b']);
  const view = () => (
    <DocExplorerContext.Provider value={context}>
      <DocsExplorer />
    </DocExplorerContext.Provider>
  );
  const result = render(view());
  expect(
    screen.queryByRole('button', {
      name: 'com.affine.localmind.reportDeck.entry',
    })
  ).toBeNull();
  deck.available = true;
  result.rerender(view());
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.reportDeck.entry',
    })
  );
  expect(deck.open).toHaveBeenCalledExactlyOnceWith([
    {
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      kind: 'doc',
      resourceId: 'doc-a',
      title: 'Title doc-a',
    },
    {
      scopeKind: 'workspace',
      scopeId: 'workspace-1',
      kind: 'doc',
      resourceId: 'doc-b',
      title: 'Title doc-b',
    },
  ]);
});

test('the deck entry is not offered from trash', () => {
  deck.available = true;
  const context = createDocExplorerContext();
  context.groups$.next([{ key: 'today', items: ['doc-a'] }]);
  render(
    <DocExplorerContext.Provider value={context}>
      <DocsExplorer onRestore={vi.fn()} />
    </DocExplorerContext.Provider>
  );
  expect(
    screen.queryByRole('button', {
      name: 'com.affine.localmind.reportDeck.entry',
    })
  ).toBeNull();
});
