/** @vitest-environment happy-dom */
import { NavigateContext } from '@affine/core/components/hooks/use-navigate-helper';
import type { Notification } from '@affine/core/modules/notification';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  readNotification: vi.fn(async () => {}),
  gql: vi.fn(),
}));
vi.mock('@affine/core/components/hooks/use-navigate-helper', async () => {
  const { createContext } = await import('react');
  return { NavigateContext: createContext(null) };
});
vi.mock('@affine/component', () => ({
  Avatar: () => null,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Input: () => null,
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? children : null,
  notify: { error: vi.fn() },
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/notification', () => ({
  NotificationListService: class {},
}));
vi.mock('@toeverything/infra', () => ({ useService: () => state }));

import { AccessRequestNotificationItem } from './access-request';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('opens the related project through global navigation without approving the request', () => {
  const navigate = vi.fn();
  render(
    <NavigateContext.Provider value={navigate}>
      <AccessRequestNotificationItem
        notification={
          {
            id: 'notice-1',
            body: {
              requestId: 'request-1',
              status: 'approved',
              canDecide: false,
              projectId: 'project-1',
              projectName: 'QA Project',
              workspace: { id: 'workspace-1', name: 'QA Workspace' },
              docId: 'doc-1',
            },
          } as unknown as Notification
        }
      />
    </NavigateContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
  expect(navigate).toHaveBeenCalledWith('/project/project-1');
  expect(state.readNotification).toHaveBeenCalledWith('notice-1');
  expect(state.gql).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
  expect(navigate).toHaveBeenCalledWith('/workspace/workspace-1/all');
});
