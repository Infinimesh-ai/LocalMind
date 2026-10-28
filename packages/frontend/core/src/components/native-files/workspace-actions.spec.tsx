/** @vitest-environment happy-dom */
import { UserFriendlyError } from '@affine/error';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { afterEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  gql: vi.fn(),
  invalidate: vi.fn(),
  folderLoads: 0,
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceResourcesService: class {},
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => ({ gql: state.gql }),
  useServiceOptional: (service: unknown) =>
    service === WorkspaceResourcesService
      ? { invalidate: state.invalidate }
      : undefined,
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
  IconButton: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
  Menu: ({ children, items }: { children: ReactNode; items: ReactNode }) => (
    <div>
      {children}
      {items}
    </div>
  ),
  MenuItem: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Input: ({
    onChange,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
  }) => <input {...props} onChange={event => onChange(event.target.value)} />,
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));
vi.mock('./workspace-folder-select', async () => {
  const React = await import('react');
  return {
    WorkspaceNativeFolderSelect: ({
      onVersion,
    }: {
      onVersion: (revision: string | null) => void;
    }) => {
      React.useEffect(() => {
        onVersion(`directory-${++state.folderLoads}`);
      }, [onVersion]);
      return <div>destination-picker</div>;
    },
  };
});
vi.mock('../root-app-sidebar/page-tree', () => ({
  MovePageDialog: () => null,
}));
vi.mock('../page-tree/target-select', () => ({
  WorkspacePageTargetSelect: () => null,
}));
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';
import {
  changeWorkspaceNativeResourceMutation,
  workspaceNativeResourceQuery,
} from '@affine/graphql';

import { WorkspaceNativeActions } from './workspace-actions';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.folderLoads = 0;
});
const props = {
  workspaceId: 'workspace',
  resourceId: 'pdf',
  kind: 'office' as const,
  title: 'report.pdf',
  onChanged: vi.fn(),
};
const label = (key: string) => `com.affine.localmind.native-files.${key}`;

test('a definite move conflict reloads the destination and retries with a fresh request', async () => {
  let attempts = 0;
  state.gql.mockImplementation(async ({ query }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: { metadataVersion: 4, contentVersion: 2 },
      };
    if (query === changeWorkspaceNativeResourceMutation && attempts++ === 0)
      throw new UserFriendlyError({
        status: 409,
        code: 'BAD_REQUEST',
        type: 'BAD_REQUEST',
        name: 'BAD_REQUEST',
        message: 'Directory changed',
      });
    return {};
  });
  render(
    <WorkspaceNativeActions {...props} capabilities={{ canMove: true }} />
  );
  fireEvent.click(screen.getByText(label('move')));
  await waitFor(() => expect(state.folderLoads).toBe(1));
  fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1]);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'com.affine.localmind.native-files.destinationConflict'
  );
  await waitFor(() => expect(state.folderLoads).toBe(2));
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(1));
  const requests = state.gql.mock.calls
    .filter(([input]) => input.query === changeWorkspaceNativeResourceMutation)
    .map(([input]) => input.variables.input);
  expect(requests).toHaveLength(2);
  expect(requests[0].expectedDirectoryVersion).toBe('directory-1');
  expect(requests[1].expectedDirectoryVersion).toBe('directory-2');
  expect(requests[1].requestKey).not.toBe(requests[0].requestKey);
});

test('rate limiting tells the user to wait and preserves the request on retry', async () => {
  let attempts = 0;
  state.gql.mockImplementation(async ({ query }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: { metadataVersion: 4, contentVersion: 2 },
      };
    if (query === changeWorkspaceNativeResourceMutation && attempts++ === 0)
      throw new UserFriendlyError({
        status: 429,
        code: 'TOO_MANY_REQUESTS',
        type: 'TOO_MANY_REQUESTS',
        name: 'TOO_MANY_REQUEST',
        message: 'Too many requests',
      });
    return {};
  });
  render(
    <WorkspaceNativeActions {...props} capabilities={{ canMove: true }} />
  );
  fireEvent.click(screen.getByText(label('move')));
  await waitFor(() => expect(state.folderLoads).toBe(1));
  fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1]);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'com.affine.localmind.native-files.rateLimited'
  );
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(1));
  const requests = state.gql.mock.calls
    .filter(([input]) => input.query === changeWorkspaceNativeResourceMutation)
    .map(([input]) => input.variables.input);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('an active PDF only exposes permitted actions and never permanent delete', () => {
  render(
    <WorkspaceNativeActions
      {...props}
      capabilities={{ canTrash: true, canDeletePermanently: true }}
    />
  );
  expect(
    screen.getByText('com.affine.localmind.resources.moveToTrash')
  ).toBeTruthy();
  expect(screen.queryByText(label('delete'))).toBeNull();
  expect(screen.queryByText(label('rename'))).toBeNull();
});

test('restoration defaults to the original location and uncertain retry retains ID, version and request key', async () => {
  let fail = true;
  state.gql.mockImplementation(async ({ query }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: { metadataVersion: 4, contentVersion: 2 },
      };
    if (query === changeWorkspaceNativeResourceMutation && fail) {
      fail = false;
      throw new Error('network timeout');
    }
    return {};
  });
  render(
    <WorkspaceNativeActions
      {...props}
      trashed
      capabilities={{ canRestore: true }}
    />
  );
  fireEvent.click(screen.getByText(label('restore')));
  expect(screen.queryByText('destination-picker')).toBeNull();
  fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1]);
  await screen.findByRole('alert');
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(1));
  const requests = state.gql.mock.calls
    .filter(([input]) => input.query === changeWorkspaceNativeResourceMutation)
    .map(([input]) => input.variables.input);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({
    resourceId: 'pdf',
    expectedVersion: 4,
    action: 'restore',
  });
  expect(requests[0]).not.toHaveProperty('folderId');
});

test('a rejected restore unlocks its destination and uses a fresh request on retry', async () => {
  state.gql.mockImplementation(async ({ query }) => {
    if (query === workspaceNativeResourceQuery)
      return {
        workspaceNativeResource: { metadataVersion: 4, contentVersion: 2 },
      };
    throw new UserFriendlyError({
      status: 400,
      code: 'BAD_REQUEST',
      type: 'BAD_REQUEST',
      name: 'BAD_REQUEST',
      message: 'Private destination detail must not be displayed',
    });
  });
  render(
    <WorkspaceNativeActions
      {...props}
      trashed
      capabilities={{ canRestore: true }}
    />
  );
  fireEvent.click(screen.getByText(label('restore')));
  fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1]);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'com.affine.localmind.resources.restoreRejected'
  );
  const checkbox = screen.getByRole<HTMLInputElement>('checkbox');
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(screen.getByText('destination-picker')).toBeTruthy();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() =>
    expect(
      state.gql.mock.calls.filter(
        ([input]) => input.query === changeWorkspaceNativeResourceMutation
      )
    ).toHaveLength(2)
  );
  const requests = state.gql.mock.calls
    .filter(([input]) => input.query === changeWorkspaceNativeResourceMutation)
    .map(([input]) => input.variables.input);
  expect(requests[0].requestKey).not.toBe(requests[1].requestKey);
  expect(screen.queryByText(/Private destination detail/)).toBeNull();
});

test('unsaved-change cancellation prevents lifecycle submission', async () => {
  render(
    <WorkspaceNativeActions
      {...props}
      beforeChange={async () => false}
      capabilities={{ canTrash: true }}
    />
  );
  fireEvent.click(
    screen.getByText('com.affine.localmind.resources.moveToTrash')
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.gql).not.toHaveBeenCalled();
});

for (const action of ['rename', 'copy'] as const) {
  test(`${action} validates native names before submitting and recovers on valid input`, async () => {
    render(
      <WorkspaceNativeActions
        {...props}
        capabilities={{ canRename: true, canCopy: true }}
      />
    );
    fireEvent.click(screen.getByText(label(action)));
    const input = screen.getByRole('textbox');
    for (const value of ['   ', 'bad/name', 'bad\\name', 'x'.repeat(481)]) {
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole('alert').textContent).toBe(
        'com.affine.localmind.native-files.invalidName'
      );
      const submit = screen.getByRole('dialog').querySelectorAll('button')[1];
      expect(submit.disabled).toBe(true);
      fireEvent.click(submit);
      expect(state.gql).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: ' 中文有效名称.txt ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('false');
    if (action === 'rename') {
      state.gql.mockResolvedValue({
        workspaceNativeResource: { metadataVersion: 4, contentVersion: 2 },
      });
      fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1]);
      await waitFor(() => expect(state.invalidate).toHaveBeenCalledTimes(1));
    }
  });
}
