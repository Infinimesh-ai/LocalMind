/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { WorkspaceOpenFailed } from './workspace-open-failed';

const mocks = vi.hoisted(() => ({
  state: { phase: 'failed', targetWorkspaceId: 'workspace-a' },
  begin: vi.fn(),
}));

vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceSwitchService: 'switches',
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ ['state$']: {}, begin: mocks.begin }),
  useLiveData: () => mocks.state,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock(
  '@affine/core/components/affine/affine-error-boundary/error-basic/error-detail',
  () => ({
    ErrorDetail: ({
      title,
      description,
      buttonText,
      resetError,
    }: {
      title: string;
      description: string;
      buttonText: string;
      resetError: () => void;
    }) => (
      <div role="alert">
        {title}
        {description}
        <button onClick={resetError}>{buttonText}</button>
      </div>
    ),
  })
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.state = { phase: 'failed', targetWorkspaceId: 'workspace-a' };
});

test('a failed workspace opens a new checked attempt through the retry button', () => {
  render(<WorkspaceOpenFailed workspaceId="workspace-a" />);
  expect(screen.getByRole('alert').textContent).toContain(
    'com.affine.localmind.aiContext.loadFailed.description'
  );
  fireEvent.click(screen.getByRole('button'));
  expect(mocks.begin).toHaveBeenCalledExactlyOnceWith('workspace-a');
});

test('a failure for another workspace is not shown on the current route', () => {
  render(<WorkspaceOpenFailed workspaceId="workspace-b" />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.begin).not.toHaveBeenCalled();
});

test('the retry control disappears while the new attempt is pending', () => {
  const view = render(<WorkspaceOpenFailed workspaceId="workspace-a" />);
  mocks.state.phase = 'preparing';
  view.rerender(<WorkspaceOpenFailed workspaceId="workspace-a" />);
  expect(screen.queryByRole('button')).toBeNull();
});
