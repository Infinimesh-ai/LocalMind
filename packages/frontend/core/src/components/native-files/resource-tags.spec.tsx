/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn() }));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceResourceTagsService: class {},
}));
vi.mock('@affine/core/components/providers/current-server-scope', () => ({
  useCurrentServerService: () => undefined,
}));
vi.mock('../explorer/quick-actions.constants', () => ({ quickActions: [] }));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => ({
    begin: () => ({ read: state.read, change: state.change }),
  }),
}));
vi.mock('@affine/i18n', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-Hans' } }),
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('../tags', () => ({
  WorkspaceTagsEditor: ({
    selectedTags,
    onSelectTag,
    onDeselectTag,
  }: {
    selectedTags: string[];
    onSelectTag: (id: string) => void;
    onDeselectTag: (id: string) => void;
  }) => (
    <div>
      {['old', 'new'].map(id => (
        <label key={id}>
          {id}
          <input
            type="checkbox"
            aria-label={id}
            checked={selectedTags.includes(id)}
            onChange={event =>
              event.target.checked ? onSelectTag(id) : onDeselectTag(id)
            }
          />
        </label>
      ))}
    </div>
  ),
}));
vi.mock('@affine/component', async () => ({
  ...(await import('@affine/component/ui/button')),
  ...(await import('@affine/component/ui/menu')),
  Modal: ({ children, title }: { children: ReactNode; title: string }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
  ...(await import('@affine/component/ui/checkbox')),
  Avatar: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

import {
  createDocExplorerContext,
  DocExplorerContext,
} from '../explorer/context';
import { ResourceInlineTags, ResourceTags } from './resource-metadata';
import { ResourceRowShell } from './resource-row-shell';
import { ResourceSelectionModeContext } from './resource-selection-context';
import { ResourceTagDialog } from './resource-tag-dialog';

afterEach(cleanup);
beforeEach(() => {
  state.read.mockReset().mockResolvedValue(['old']);
  state.change.mockReset().mockResolvedValue(undefined);
});
const apply = 'com.affine.m.selector.confirm-default';
const targets = [
  { key: 'doc', id: 'doc', kind: 'doc' as const, title: 'Page' },
  { key: 'file', id: 'file', kind: 'file' as const, title: 'File.docx' },
];

test('tag failures remain visible, preserve the patch and retry only failed resources', async () => {
  state.change
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('permission'))
    .mockResolvedValueOnce(undefined);
  const onResult = vi.fn(),
    onClose = vi.fn();
  render(
    <ResourceTagDialog
      mode="add"
      targets={targets}
      onResult={onResult}
      onClose={onClose}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'new' }));
  fireEvent.click(screen.getByRole('button', { name: apply }));
  await screen.findByRole('alert');
  expect(onResult).toHaveBeenLastCalledWith(['doc'], ['file']);
  expect(screen.getByText('File.docx')).toBeTruthy();
  expect(state.change.mock.calls[0][1]).toEqual({ add: ['new'], remove: [] });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'com.affine.error.retry' })
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(state.change.mock.calls.map(([target]) => target.key)).toEqual([
    'doc',
    'file',
    'file',
  ]);
  expect(state.change.mock.calls[2][1]).toEqual(state.change.mock.calls[1][1]);
});

test('single-resource editing submits additions and removals instead of replacing all tags', async () => {
  render(
    <ResourceTagDialog mode="edit" targets={[targets[0]]} onClose={vi.fn()} />
  );
  const old = await screen.findByRole('checkbox', { name: 'old' });
  fireEvent.click(old);
  fireEvent.click(screen.getByRole('checkbox', { name: 'new' }));
  fireEvent.click(screen.getByRole('button', { name: apply }));
  await waitFor(() => expect(state.change).toHaveBeenCalledOnce());
  expect(state.change.mock.calls[0][1]).toEqual({
    add: ['new'],
    remove: ['old'],
  });
});

test('readonly load rejection never offers an enabled apply action or performs a write', async () => {
  state.read.mockRejectedValue(new Error('readonly'));
  render(
    <ResourceTagDialog mode="edit" targets={[targets[0]]} onClose={vi.fn()} />
  );
  await screen.findByRole('alert');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    (screen.getByRole('button', { name: apply }) as HTMLButtonElement).disabled
  ).toBe(true);
  expect(state.change).not.toHaveBeenCalled();
});

test('long names keep full accessible text, opt-in checkboxes, existing tags and display preferences', () => {
  const title = '长文件名'.repeat(40) + '.docx';
  const context = createDocExplorerContext({
    view: 'list',
    showDocPreview: false,
    resourceProperties: {
      tags: true,
      created: true,
      updated: true,
      documentType: true,
    },
  });
  const open = vi.fn();
  render(
    <DocExplorerContext.Provider value={context}>
      <ResourceSelectionModeContext.Provider value={true}>
        <ResourceRowShell
          id="long"
          title={title}
          icon={null}
          onOpen={open}
          actions={null}
          tags={
            <ResourceInlineTags empty={false}>
              <ResourceTags
                tags={[
                  { id: 'one', name: '标签一', color: '#123456' },
                  { id: 'two', name: '标签二', color: '#123456' },
                ]}
                limit={1}
              />
            </ResourceInlineTags>
          }
        >
          {null}
        </ResourceRowShell>
      </ResourceSelectionModeContext.Provider>
    </DocExplorerContext.Provider>
  );
  expect(screen.getByText('标签一')).toBeTruthy();
  expect(screen.getByText('+1')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText('com.affine.header.option.add-tag')).toBeNull();
  expect(
    screen.getByRole('button', { name: title }).querySelector('span')?.title
  ).toBe(title);
  act(() => context.selectMode$?.next(true));
  fireEvent.click(screen.getByRole('button', { name: title }));
  expect(
    (
      screen
        .getByRole('checkbox', { name: title })
        .querySelector('input') as HTMLInputElement
    ).checked
  ).toBe(true);
  expect(open).not.toHaveBeenCalled();
  act(() =>
    context.displayPreference$.next({
      ...context.displayPreference$.value,
      resourceProperties: {
        tags: false,
        created: true,
        updated: true,
        documentType: true,
      },
    })
  );
  expect(screen.queryByText('标签一')).toBeNull();
  expect(screen.getByRole('button', { name: title })).toBeTruthy();
});

test('the independent children index retains its existing selection and row operations', () => {
  const context = createDocExplorerContext({ view: 'list' });
  context.selectMode$?.next(true);
  const open = vi.fn();
  render(
    <DocExplorerContext.Provider value={context}>
      <ResourceRowShell
        id="child"
        title="Child"
        icon={null}
        onOpen={open}
        actions={<button>Child actions</button>}
      >
        {null}
      </ResourceRowShell>
    </DocExplorerContext.Provider>
  );
  expect(screen.getByRole('checkbox', { name: 'Child' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Child actions' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Child' }));
  expect(open).toHaveBeenCalledOnce();
});
