/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <span>Loading</span>,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => (options?: Record<string, string>) =>
          options
            ? `${String(key)}:${Object.values(options).join(':')}`
            : String(key),
      }
    ),
}));
vi.mock('@blocksuite/icons/rc', () => ({
  PlusIcon: () => <svg />,
  SidebarIcon: () => <svg />,
}));
vi.mock('./collaboration-orbit-board', () => ({
  CollaborationOrbitBoard: () => null,
}));

import { ConversationBoard } from './conversation-board';
import type { WorkbenchConversationCard } from './types';
import type { ConversationCardsState } from './use-conversation-cards';

afterEach(cleanup);

const orderCard: WorkbenchConversationCard = {
  sessionId: 'recipient-session',
  scopeType: 'work_order',
  ownWorkspaceId: null,
  ownDocId: null,
  pinned: false,
  title: 'Return a deck',
  titleRevision: 1,
  column: 'todo',
  attentionReasons: [],
  activeRunCount: 0,
  project: null,
  workOrderId: 'work-order-id',
  workOrderStatus: 'open',
  workOrderSenderName: 'Alice',
  workOrderSourceProjectName: 'Planning',
  workOrderRequiredReturnTitles: ['Summary', 'Deck'],
  workOrderMissingRequiredCount: 1,
  lastBusinessAt: '2026-09-29T00:00:00.000Z',
  version: 1,
};

describe('personal work-order action card', () => {
  test('offers sign-in instead of presenting unauthenticated data as an empty project', () => {
    const empty = {
      items: [] as WorkbenchConversationCard[],
      counts: null,
      loading: false,
      loadingMore: false,
      error: null,
      hasNextPage: false,
      loadMore: async () => {},
      refresh: async () => {},
    };
    const cards: ConversationCardsState = {
      todo: { ...empty, authenticationRequired: true },
      progress: { ...empty, items: [orderCard] },
      done: empty,
      counts: null,
      refresh: async () => [undefined, undefined, undefined] as const,
    };
    const onSignIn = vi.fn();
    render(
      <ConversationBoard
        cards={cards}
        projects={[]}
        onOpenCard={vi.fn()}
        onOpenRelation={() => {}}
        onNewConversation={() => {}}
        onSignIn={onSignIn}
        workspaceExpanded={false}
        onWorkspaceExpandedChange={() => {}}
      />
    );
    expect(screen.getByRole('status').textContent).toContain('signInRequired');
    expect(screen.queryByText('Return a deck')).toBeNull();
    expect(
      screen.queryAllByText('com.affine.localmind.workbench.v9.emptyColumn')
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.signIn',
      })
    );
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  test('hides revoked project metadata while keeping private work-order snapshots', () => {
    const empty = {
      items: [] as WorkbenchConversationCard[],
      counts: null,
      loading: false,
      loadingMore: false,
      error: null,
      hasNextPage: false,
      loadMore: async () => {},
      refresh: async () => {},
    };
    const projectCard: WorkbenchConversationCard = {
      ...orderCard,
      sessionId: 'old-project-session',
      scopeType: 'project',
      project: { id: 'revoked', name: 'Former project' },
      title: 'Private project history',
      workOrderId: null,
      workOrderStatus: null,
      workOrderSenderName: null,
      workOrderSourceProjectName: null,
      workOrderRequiredReturnTitles: [],
      workOrderMissingRequiredCount: 0,
    };
    const cards: ConversationCardsState = {
      todo: { ...empty, items: [projectCard, orderCard] },
      progress: empty,
      done: empty,
      counts: null,
      refresh: async () => [undefined, undefined, undefined] as const,
    };
    render(
      <ConversationBoard
        cards={cards}
        projects={[]}
        projectsResolved
        onOpenCard={vi.fn()}
        onOpenRelation={() => {}}
        onNewConversation={() => {}}
        workspaceExpanded={false}
        onWorkspaceExpandedChange={() => {}}
      />
    );
    expect(screen.queryByText('Private project history')).toBeNull();
    expect(screen.queryByText('Former project')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Return a deck/ })
    ).not.toBeNull();
  });

  test('shows the frozen sender, project, returns and missing count, then opens its conversation', () => {
    const onOpenCard = vi.fn();
    const empty = {
      items: [] as WorkbenchConversationCard[],
      counts: null,
      loading: false,
      loadingMore: false,
      error: null,
      hasNextPage: false,
      loadMore: async () => {},
      refresh: async () => {},
    };
    const cards: ConversationCardsState = {
      todo: { ...empty, items: [orderCard] },
      progress: empty,
      done: empty,
      counts: null,
      refresh: async () => [undefined, undefined, undefined] as const,
    };
    render(
      <ConversationBoard
        cards={cards}
        projects={[]}
        onOpenCard={onOpenCard}
        onOpenRelation={() => {}}
        onNewConversation={() => {}}
        workspaceExpanded={false}
        onWorkspaceExpandedChange={() => {}}
      />
    );
    const card = screen.getByRole('button', { name: /Return a deck/ });
    expect(card.textContent).toContain('Alice');
    expect(card.textContent).toContain('Planning');
    expect(card.textContent).toContain('Summary · Deck');
    expect(card.textContent).toContain('missingRequired:1');
    // Missing required returns mark the card for attention (v10 red border).
    expect(card.dataset.attention).toBe('true');
    fireEvent.click(card);
    expect(onOpenCard).toHaveBeenCalledWith(orderCard);
  });

  test('labels card groups only when a column mixes work orders and AI chats', () => {
    const empty = {
      items: [] as WorkbenchConversationCard[],
      counts: null,
      loading: false,
      loadingMore: false,
      error: null,
      hasNextPage: false,
      loadMore: async () => {},
      refresh: async () => {},
    };
    const chat: WorkbenchConversationCard = {
      ...orderCard,
      sessionId: 'chat',
      scopeType: 'workspace',
      title: 'Plan launch',
      column: 'done',
      workOrderId: null,
      workOrderMissingRequiredCount: 0,
    };
    const cards: ConversationCardsState = {
      todo: {
        ...empty,
        items: [{ ...chat, sessionId: 'solo', column: 'todo' }],
      },
      progress: empty,
      done: { ...empty, items: [{ ...orderCard, column: 'done' }, chat] },
      counts: null,
      refresh: async () => [undefined, undefined, undefined] as const,
    };
    render(
      <ConversationBoard
        cards={cards}
        projects={[]}
        onOpenCard={() => {}}
        onOpenRelation={() => {}}
        onNewConversation={() => {}}
        workspaceExpanded={false}
        onWorkspaceExpandedChange={() => {}}
      />
    );
    expect(
      screen.getAllByText(
        'com.affine.localmind.workbench.overview.conversations'
      )
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: /Plan launch/ })[0].dataset
        .attention
    ).toBe('false');
  });
});
