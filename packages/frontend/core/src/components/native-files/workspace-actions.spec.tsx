/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ gql: vi.fn(), invalidate: vi.fn() }));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceResourcesService: class {},
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ gql: state.gql }),
  useServiceOptional: () => ({ invalidate: state.invalidate }),
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
  Input: () => null,
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));
vi.mock('./workspace-folder-select', () => ({
  WorkspaceNativeFolderSelect: () => <div>destination-picker</div>,
}));
import {
  changeWorkspaceNativeResourceMutation,
  workspaceNativeResourceQuery,
} from '@affine/graphql';

import { WorkspaceNativeActions } from './workspace-actions';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const props = {
  workspaceId: 'workspace',
  resourceId: 'pdf',
  kind: 'office' as const,
  title: 'report.pdf',
  onChanged: vi.fn(),
};
const label = (key: string) => `com.affine.localmind.native-files.${key}`;

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
  fireEvent.click(screen.getByText('com.affine.error.retry'));
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
