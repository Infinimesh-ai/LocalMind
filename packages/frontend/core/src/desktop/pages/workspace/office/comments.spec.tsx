/**
 * @vitest-environment happy-dom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { MouseEventHandler, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { OfficeCommentsPanel } from './comments';

const gql = vi.hoisted(() => vi.fn(async () => ({})));
const mutateComments = vi.hoisted(() => vi.fn(async () => undefined));
const mutateCollaborators = vi.hoisted(() => vi.fn(async () => undefined));
const officeCommentsQuery = vi.hoisted(() => Symbol('officeCommentsQuery'));
const officeCollaboratorsQuery = vi.hoisted(() =>
  Symbol('officeCollaboratorsQuery')
);
const createOfficeCommentMutation = vi.hoisted(() =>
  Symbol('createOfficeCommentMutation')
);
const updateOfficeCommentMutation = vi.hoisted(() =>
  Symbol('updateOfficeCommentMutation')
);
const resolveOfficeCommentMutation = vi.hoisted(() =>
  Symbol('resolveOfficeCommentMutation')
);
const deleteOfficeCommentMutation = vi.hoisted(() =>
  Symbol('deleteOfficeCommentMutation')
);
const createOfficeCommentReplyMutation = vi.hoisted(() =>
  Symbol('createOfficeCommentReplyMutation')
);
const updateOfficeCommentReplyMutation = vi.hoisted(() =>
  Symbol('updateOfficeCommentReplyMutation')
);
const deleteOfficeCommentReplyMutation = vi.hoisted(() =>
  Symbol('deleteOfficeCommentReplyMutation')
);
const realtimeSubscriber = vi.hoisted(() =>
  vi.fn(() => ({ unsubscribe: vi.fn() }))
);
const realtimeSubscribe = vi.hoisted(() =>
  vi.fn(() => ({ subscribe: realtimeSubscriber }))
);

const queryState = vi.hoisted(() => ({
  comments: [
    {
      id: 'comment-1',
      content: {
        version: 'localmind-office-comment/v1',
        text: 'Check this cell.',
        anchor: {
          kind: 'workbook',
          revisionId: 'revision-1',
          sheetId: 'sheet-1',
          address: 'B4',
        },
      },
      resolved: false,
      createdAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
      user: { id: 'user-1', name: 'Alice', avatarUrl: null },
      replies: [],
    },
  ],
  collaborators: [
    { id: 'user-1', name: 'Alice', avatarUrl: null },
    { id: 'user-2', name: 'Bob', avatarUrl: null },
  ],
}));

vi.mock('@affine/component', () => ({
  Avatar: ({ name }: { name: string }) => <span>{name}</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  IconButton: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Loading: () => <span>loading</span>,
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div>{children}</div> : null,
  Tooltip: ({ children }: PropsWithChildren) => children,
}));

vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: ({ query }: { query: symbol }) =>
    query === officeCommentsQuery
      ? {
          data: { officeComments: queryState.comments },
          error: null,
          isLoading: false,
          mutate: mutateComments,
        }
      : {
          data: { officeCollaborators: queryState.collaborators },
          error: null,
          isLoading: false,
          mutate: mutateCollaborators,
        },
}));

vi.mock('@affine/graphql', () => ({
  officeCommentsQuery,
  officeCollaboratorsQuery,
  createOfficeCommentMutation,
  updateOfficeCommentMutation,
  resolveOfficeCommentMutation,
  deleteOfficeCommentMutation,
  createOfficeCommentReplyMutation,
  updateOfficeCommentReplyMutation,
  deleteOfficeCommentReplyMutation,
}));

vi.mock('@blocksuite/icons/rc', () => ({
  DeleteIcon: () => <span>delete</span>,
}));

describe('Office comments panel', () => {
  afterEach(cleanup);

  beforeEach(() => {
    gql.mockClear();
    mutateComments.mockClear();
    mutateCollaborators.mockClear();
    realtimeSubscribe.mockClear();
    realtimeSubscriber.mockClear();
  });

  function renderPanel() {
    render(
      <OfficeCommentsPanel
        open
        workspaceId="workspace-1"
        artifactId="artifact-1"
        anchor={{
          kind: 'workbook',
          revisionId: 'revision-1',
          sheetId: 'sheet-1',
          address: 'B4',
        }}
        graphql={{ gql } as never}
        realtime={{ subscribe: realtimeSubscribe } as never}
        onOpenChange={vi.fn()}
      />
    );
  }

  test('shows collaborators and comments anchored to native Office content', () => {
    renderPanel();

    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Check this cell.')).toBeTruthy();
    expect(screen.getByText('sheet-1 · B4')).toBeTruthy();
    expect(realtimeSubscribe).toHaveBeenCalledWith('comment.changed', {
      workspaceId: 'workspace-1',
      docId: 'artifact-1',
    });
  });

  test('creates comments and replies through the Office GraphQL API', async () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('New Office comment'), {
      target: { value: 'New review note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() =>
      expect(gql).toHaveBeenCalledWith({
        query: createOfficeCommentMutation,
        variables: {
          input: {
            workspaceId: 'workspace-1',
            artifactId: 'artifact-1',
            content: {
              version: 'localmind-office-comment/v1',
              text: 'New review note',
              anchor: {
                kind: 'workbook',
                revisionId: 'revision-1',
                sheetId: 'sheet-1',
                address: 'B4',
              },
            },
          },
        },
      })
    );

    fireEvent.change(screen.getByLabelText('Reply to Alice'), {
      target: { value: 'Handled' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() =>
      expect(gql).toHaveBeenCalledWith({
        query: createOfficeCommentReplyMutation,
        variables: {
          input: {
            commentId: 'comment-1',
            content: {
              version: 'localmind-office-comment-reply/v1',
              text: 'Handled',
            },
          },
        },
      })
    );
  });

  test('resolves an Office comment without mutating package state', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(gql).toHaveBeenCalledWith({
        query: resolveOfficeCommentMutation,
        variables: { input: { id: 'comment-1', resolved: true } },
      })
    );
  });
});
