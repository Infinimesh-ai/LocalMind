/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  graphError: undefined as Error | undefined,
  graphLoading: false,
  mutate: vi.fn(),
}));

const tokens = vi.hoisted(() => ({
  graphQuery: Symbol('graphQuery'),
  resourceQuery: Symbol('resourceQuery'),
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <div data-testid="loading" />,
}));

vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (request: {
    query: unknown;
    variables?: { resourceId: string };
  }) => {
    if (request.query === tokens.graphQuery) {
      return {
        data: {
          currentUser: {
            copilot: {
              myCollaborationGraph: {
                nodes: [
                  { id: 'me', label: 'Me' },
                  { id: 'recipient', label: 'Recipient' },
                  { id: 'other', label: 'Other' },
                ],
                edges: [
                  {
                    id: 'edge-1',
                    from: 'recipient',
                    to: 'me',
                    label: 'Presentation',
                    status: 'delivered',
                    ownSessionId: 'session-1',
                  },
                  {
                    id: 'edge-2',
                    from: 'other',
                    to: 'me',
                    label: 'Hidden from this session',
                    status: 'pending',
                    ownSessionId: 'session-2',
                  },
                ],
              },
            },
          },
        },
        error: state.graphError,
        isLoading: state.graphLoading,
        mutate: state.mutate,
      };
    }
    return {
      data: {
        projectResource: {
          title: `Resource ${request.variables?.resourceId ?? ''}`,
        },
      },
      isLoading: false,
    };
  },
}));

vi.mock('@affine/graphql', () => ({
  copilotCollaborationGraphGetQuery: tokens.graphQuery,
  projectResourceQuery: tokens.resourceQuery,
}));

vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  PageIcon: () => <svg />,
}));

vi.mock('./project-publications', () => ({
  ProjectPublications: () => <div data-testid="project-publications" />,
}));

import { ProjectContextPanel } from './project-context-panel';

describe('ProjectContextPanel', () => {
  beforeEach(() => {
    state.graphError = undefined;
    state.graphLoading = false;
    state.mutate.mockReset();
  });
  afterEach(cleanup);

  test('projects collaboration roles from the same graph for the active session', () => {
    const onOpenResource = vi.fn();
    render(
      <ProjectContextPanel
        projectId="project-1"
        sessionId="session-1"
        state={{
          loading: false,
          resourceIds: ['resource-1'],
          openPicker: vi.fn(),
          referenceResource: vi.fn(),
        }}
        onOpenResource={onOpenResource}
      />
    );

    expect(screen.getByText('Recipient')).not.toBeNull();
    expect(screen.getByText('Presentation')).not.toBeNull();
    expect(screen.queryByText('Hidden from this session')).toBeNull();
    expect(screen.getByTestId('project-publications')).not.toBeNull();
    expect(
      screen.queryByText('com.affine.localmind.project-tasks.title')
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Resource resource-1' })
    );
    expect(onOpenResource).toHaveBeenCalledWith('resource-1');
  });

  test('keeps graph failure retryable without hiding project context', () => {
    state.graphError = new Error('offline');
    render(
      <ProjectContextPanel
        projectId="project-1"
        sessionId="session-1"
        state={{
          loading: false,
          resourceIds: [],
          openPicker: vi.fn(),
          referenceResource: vi.fn(),
        }}
        onOpenResource={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(
      screen.getByText('com.affine.localmind.workbench.v9.contextEmpty')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
});
