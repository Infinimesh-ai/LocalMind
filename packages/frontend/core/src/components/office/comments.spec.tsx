/**
 * @vitest-environment happy-dom
 */

import type { OfficeCommentAnchor } from '@affine/core/modules/office';
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
const openConfirmModal = vi.hoisted(() => vi.fn());
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

vi.mock('@affine/component', async () => ({
  isComposingKeyboardEvent: (await import('@affine/component/ui/input'))
    .isComposingKeyboardEvent,
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
  useConfirmModal: () => ({ openConfirmModal }),
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
    openConfirmModal.mockClear();
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
    expect(realtimeSubscribe).toHaveBeenCalledWith('office.comment.changed', {
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
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
            owner: { workspaceId: 'workspace-1' },
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
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
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

  test('deletes comments only after the in-app confirmation', async () => {
    const nativeConfirm = vi.fn();
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: nativeConfirm,
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(openConfirmModal).toHaveBeenCalledOnce();
    expect(gql).not.toHaveBeenCalled();
    const [{ onConfirm }] = openConfirmModal.mock.calls[0] as [
      { onConfirm: () => Promise<void> },
    ];
    await onConfirm();
    expect(gql).toHaveBeenCalledWith({
      query: deleteOfficeCommentMutation,
      variables: { id: 'comment-1' },
    });
  });

  test('IME confirmation does not send a partial Office comment reply', async () => {
    renderPanel();
    const input = screen.getByLabelText('Reply to Alice');
    fireEvent.change(input, { target: { value: '完整中文回复' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(gql).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(gql).toHaveBeenCalledOnce());
    expect(gql).toHaveBeenCalledWith({
      query: createOfficeCommentReplyMutation,
      variables: {
        input: {
          commentId: 'comment-1',
          content: {
            version: 'localmind-office-comment-reply/v1',
            text: '完整中文回复',
          },
        },
      },
    });
  });

  test('typing a comment keeps the selected revision and range after editor selection clears', async () => {
    const anchor: OfficeCommentAnchor = {
      kind: 'document',
      revisionId: 'revision-7',
      start: { blockId: 'paragraph-1', offset: 0 },
      end: { blockId: 'paragraph-1', offset: 21 },
    };
    const props = {
      open: true,
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      graphql: { gql } as never,
      realtime: { subscribe: realtimeSubscribe } as never,
      onOpenChange: vi.fn(),
    };
    const { rerender } = render(
      <OfficeCommentsPanel {...props} anchor={anchor} />
    );
    rerender(<OfficeCommentsPanel {...props} anchor={null} />);
    fireEvent.change(screen.getByLabelText('New Office comment'), {
      target: { value: 'Review selected paragraph' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() =>
      expect(gql).toHaveBeenCalledWith({
        query: createOfficeCommentMutation,
        variables: {
          input: {
            owner: { workspaceId: 'workspace-1' },
            artifactId: 'artifact-1',
            content: {
              version: 'localmind-office-comment/v1',
              text: 'Review selected paragraph',
              anchor,
            },
          },
        },
      })
    );
  });

  test('reopening with a different selection captures the new anchor and never reuses an absent one', async () => {
    const anchor: OfficeCommentAnchor = {
      kind: 'workbook',
      revisionId: 'revision-1',
      sheetId: 'sheet-1',
      address: 'A1',
    };
    const props = {
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      graphql: { gql } as never,
      realtime: { subscribe: realtimeSubscribe } as never,
      onOpenChange: vi.fn(),
    };
    const { rerender } = render(
      <OfficeCommentsPanel {...props} open anchor={anchor} />
    );
    fireEvent.change(screen.getByLabelText('New Office comment'), {
      target: { value: 'Draft' },
    });
    rerender(<OfficeCommentsPanel {...props} open={false} anchor={null} />);
    rerender(<OfficeCommentsPanel {...props} open anchor={null} />);
    expect(
      (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    rerender(<OfficeCommentsPanel {...props} open={false} anchor={null} />);
    const next = { ...anchor, revisionId: 'revision-2', address: 'C3' };
    rerender(<OfficeCommentsPanel {...props} open anchor={next} />);
    rerender(<OfficeCommentsPanel {...props} open anchor={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() =>
      expect(gql).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            input: {
              owner: { workspaceId: 'workspace-1' },
              artifactId: 'artifact-1',
              content: {
                version: 'localmind-office-comment/v1',
                text: 'Draft',
                anchor: next,
              },
            },
          },
        })
      )
    );
  });

  test('losing edit permission disables a comment even while its anchor is retained', () => {
    const props = {
      open: true,
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      graphql: { gql } as never,
      realtime: { subscribe: realtimeSubscribe } as never,
      onOpenChange: vi.fn(),
    };
    const { rerender } = render(
      <OfficeCommentsPanel
        {...props}
        anchor={{
          kind: 'workbook',
          revisionId: 'revision-1',
          sheetId: 'sheet-1',
          address: 'A1',
        }}
      />
    );
    fireEvent.change(screen.getByLabelText('New Office comment'), {
      target: { value: 'Draft' },
    });
    rerender(<OfficeCommentsPanel {...props} anchor={null} readOnly />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(gql).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
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
