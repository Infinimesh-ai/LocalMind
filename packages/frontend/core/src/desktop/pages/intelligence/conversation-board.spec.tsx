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
    fireEvent.click(card);
    expect(onOpenCard).toHaveBeenCalledWith(orderCard);
  });
});
