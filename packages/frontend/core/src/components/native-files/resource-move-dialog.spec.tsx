/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ begin: vi.fn(), move: vi.fn() }));
vi.mock('@affine/core/modules/organize', () => ({
  WorkspacePageTreeService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceResourceMoveService: class {},
  NestedResourceMoveError: class extends Error {},
}));
vi.mock('@toeverything/infra', () => ({
  useService: (service: unknown) =>
    service === WorkspaceResourceMoveService
      ? { begin: state.begin, accountGeneration: 1 }
      : service === WorkspaceService
        ? { workspace: { id: 'workspace' } }
        : { ['enabled$']: false },
  useLiveData: (value: unknown) => value,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Button: ({
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props} />
  ),
  Modal: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
vi.mock('../page-tree/target-select', () => ({
  WorkspacePageTargetSelect: () => null,
}));
vi.mock('./workspace-folder-select', () => ({
  WorkspaceNativeFolderSelect: ({
    value,
    disabled,
    onChange,
    onVersion,
  }: {
    value: string | null;
    disabled?: boolean;
    onChange: (value: string | null) => void;
    onVersion: (value: string) => void;
  }) => {
    useEffect(() => {
      onVersion('version');
    }, [onVersion]);
    return (
      <select
        aria-label="Destination"
        disabled={disabled}
        value={value ?? ''}
        onChange={event => onChange(event.target.value || null)}
      >
        <option value="">Root</option>
        <option value="folder">Folder</option>
      </select>
    );
  },
}));
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  NestedResourceMoveError,
  WorkspaceResourceMoveService,
} from '@affine/core/modules/workspace-resources';

import { ResourceMoveDialog } from './resource-move-dialog';

const targets = [
  { key: 'page', id: 'page', kind: 'doc' as const, title: 'Page' },
  { key: 'text', id: 'text', kind: 'file' as const, title: 'Text' },
  { key: 'office', id: 'office', kind: 'office' as const, title: 'Office' },
];
const submitLabel = 'com.affine.localmind.page-tree.moveHere';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup() {
  state.begin.mockResolvedValue({ move: state.move });
  state.move.mockResolvedValue(undefined);
  const onClose = vi.fn(),
    onResult = vi.fn();
  render(
    <ResourceMoveDialog
      targets={targets}
      onClose={onClose}
      onResult={onResult}
    />
  );
  return { onClose, onResult };
}

test('cancel before submission does not move any resource', () => {
  const { onClose } = setup();
  fireEvent.change(screen.getByLabelText('Destination'), {
    target: { value: 'folder' },
  });
  fireEvent.click(screen.getByText('Cancel'));
  expect(onClose).toHaveBeenCalledOnce();
  expect(state.begin).not.toHaveBeenCalled();
});

test('partial batch freezes destination and retries only failed resources with cumulative results', async () => {
  const { onResult } = setup();
  state.move.mockImplementation(async item => {
    if (item.kind === 'office') throw new Error('private server detail');
  });
  fireEvent.change(screen.getByLabelText('Destination'), {
    target: { value: 'folder' },
  });
  fireEvent.click(screen.getByText(submitLabel));
  await waitFor(() =>
    expect(onResult).toHaveBeenCalledWith(['page', 'text'], ['office'])
  );
  expect(state.begin).toHaveBeenCalledWith(targets, 'folder', 1);
  expect(
    (screen.getByLabelText('Destination') as HTMLSelectElement).disabled
  ).toBe(true);
  expect(screen.queryByText('private server detail')).toBeNull();
  state.move.mockResolvedValue(undefined);
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() =>
    expect(onResult).toHaveBeenLastCalledWith(['page', 'text', 'office'], [])
  );
  expect(state.move.mock.calls.map(([item]) => item.kind)).toEqual([
    'doc',
    'file',
    'office',
    'office',
  ]);
  expect(state.begin).toHaveBeenCalledOnce();
  expect(screen.queryByText('Retry')).toBeNull();
});

test('pending submission prevents double execution and cancel until the response settles', async () => {
  const { onClose, onResult } = setup();
  let finish!: () => void;
  state.move.mockReturnValueOnce(
    new Promise<void>(resolve => {
      finish = resolve;
    })
  );
  fireEvent.click(screen.getByText(submitLabel));
  await waitFor(() => expect(state.move).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Loading'));
  fireEvent.click(screen.getByText('Done'));
  expect(onClose).not.toHaveBeenCalled();
  expect(state.begin).toHaveBeenCalledOnce();
  finish();
  await waitFor(() =>
    expect(onResult).toHaveBeenCalledWith(['page', 'text', 'office'], [])
  );
});

test('nested selection rejection leaves destination editable and performs no writes', async () => {
  setup();
  state.begin.mockRejectedValue(
    new NestedResourceMoveError('private tree path')
  );
  fireEvent.click(screen.getByText(submitLabel));
  await screen.findByText('com.affine.localmind.resources.batchMoveNested');
  expect(
    (screen.getByLabelText('Destination') as HTMLSelectElement).disabled
  ).toBe(false);
  expect(state.move).not.toHaveBeenCalled();
  expect(screen.queryByText('private tree path')).toBeNull();
});
