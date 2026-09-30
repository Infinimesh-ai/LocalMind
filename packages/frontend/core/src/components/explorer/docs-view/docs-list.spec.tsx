/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { type ComponentType, useState } from 'react';
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
        Component: ComponentType<{ itemId: string; groupId: string }>;
      }[];
    }[];
  }) =>
    items.map(group =>
      group.items.map(item => (
        <item.Component key={item.id} itemId={item.id} groupId={group.id} />
      ))
    ),
}));
vi.mock('@affine/core/modules/doc', () => ({ DocsService: class {} }));
vi.mock('@affine/core/modules/workspace-property', () => ({
  WorkspacePropertyService: class {},
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => ({ list: {} }),
}));
vi.mock('@affine/i18n', () => ({ useI18n: () => ({}), Trans: () => null }));
vi.mock('../../affine/empty', () => ({ EmptyDocs: () => null }));
vi.mock('../../page-list/components/list-floating-toolbar', () => ({
  ListFloatingToolbar: () => null,
}));
vi.mock('../../system-property-types', () => ({ SystemPropertyTypes: {} }));
vi.mock('../../workspace-property-types', () => ({
  WorkspacePropertyTypes: {},
}));
vi.mock('./doc-list-item', () => ({ DocListItem: () => null }));

import { createDocExplorerContext, DocExplorerContext } from '../context';
import { DocsExplorer } from './docs-list';

afterEach(cleanup);

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
