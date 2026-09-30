/** @vitest-environment happy-dom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  graph: null as unknown,
  graphError: null as Error | null,
  detailError: null as Error | null,
  graphMutate: vi.fn(),
  detailMutate: vi.fn(),
}));
const tokens = vi.hoisted(() => ({
  graph: Symbol('graph'),
  details: Symbol('details'),
}));

vi.mock('@affine/component', () => ({
  Avatar: ({ name, url }: { name?: string; url?: string | null }) => (
    <span data-avatar-url={url ?? ''}>{name}</span>
  ),
  Button: ({
    children,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <span>Loading</span>,
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (input?: { query: symbol; variables?: { workOrderId: string } }) =>
    input?.query === tokens.details
      ? {
          data: {
            currentUser: {
              copilot: {
                myWorkOrder: {
                  id: input.variables?.workOrderId,
                  purpose: `真实目的 ${input.variables?.workOrderId}`,
                  requirements: [
                    {
                      id: 'requirement',
                      title: '交付材料',
                      instructions: '提交文件',
                      required: true,
                    },
                  ],
                },
              },
            },
          },
          isLoading: false,
          error: state.detailError,
          mutate: state.detailMutate,
        }
      : {
          data: {
            currentUser: { copilot: { myCollaborationGraph: state.graph } },
          },
          isLoading: false,
          error: state.graphError,
          mutate: state.graphMutate,
        },
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: (error: Error) => error.message,
}));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: () => {},
}));
vi.mock('@affine/graphql', () => ({
  copilotCollaborationGraphGetQuery: tokens.graph,
  copilotCollaborationOrderDetailsQuery: tokens.details,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));
vi.mock('@blocksuite/icons/rc', () => ({ SidebarIcon: () => <svg /> }));

import { CollaborationOrbitBoard } from './collaboration-orbit-board';

const base = {
  nodes: [
    { id: 'self', label: '我', self: true, avatarUrl: '/api/avatars/me' },
    { id: 'peer', label: '李明', self: false, avatarUrl: '/api/avatars/peer' },
  ],
  edges: [
    {
      id: 'one',
      kind: 'sent',
      from: 'self',
      to: 'peer',
      status: 'open',
      label: '季度预算',
      requirementTitles: ['交付材料'],
      requirementItems: [
        { id: 'requirement', title: '交付材料', kind: 'text' },
      ],
      ownConversationExists: true,
      sourceKind: 'project',
      updatedAt: '2026-09-29T00:00:00.000Z',
      expiresAt: null,
      project: { id: 'project', name: '甲项目' },
      ownNavigationKind: 'project_session',
      ownSessionId: 'session',
      ownWorkOrderId: null,
      ownProjectId: 'project',
      ownWorkspaceId: null,
      ownDocId: null,
    },
  ],
  truncated: false,
};

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1000, height: 650 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  disconnect() {}
}

describe('formal collaboration orbit', () => {
  beforeEach(() => {
    state.graph = base;
    state.graphError = null;
    state.detailError = null;
    state.graphMutate.mockReset().mockResolvedValue(undefined);
    state.detailMutate.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('real avatar and self remain visible without orders', () => {
    state.graph = { ...base, edges: [] };
    const { container } = render(
      <CollaborationOrbitBoard projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(
      container.querySelector('[data-avatar-url="/api/avatars/me"]')
    ).toBeTruthy();
    expect(container.querySelector('[data-person-id]')).toBeNull();
    expect(
      screen.getByText('com.affine.localmind.workbench.orbit.empty')
    ).toBeTruthy();
  });

  test('a search with no matches retains an explicit clear path', () => {
    const { container } = render(
      <CollaborationOrbitBoard projectFilter="" onOpenRelation={vi.fn()} />
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'missing collaborator' },
    });
    expect(container.querySelector('[data-person-id]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /orbit.clearSearch/ }));
    expect(container.querySelector('[data-person-id="peer"]')).toBeTruthy();
  });

  test('history-only people appear only through the history entrance', () => {
    state.graph = {
      ...base,
      edges: [{ ...base.edges[0], status: 'delivered' }],
    };
    const { container } = render(
      <CollaborationOrbitBoard projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(container.querySelector('[data-person-id="peer"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /orbit.history/ }));
    expect(container.querySelector('[data-person-id="peer"]')).toBeTruthy();
  });

  test('selection reads details and only the explicit button opens a conversation', async () => {
    const onOpenRelation = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CollaborationOrbitBoard
        projectFilter=""
        onOpenRelation={onOpenRelation}
      />
    );
    expect(
      container.querySelector('[data-avatar-url="/api/avatars/peer"]')
    ).toBeTruthy();
    fireEvent.click(container.querySelector('[data-person-id="peer"]')!);
    const capsule = await waitFor(() =>
      container.querySelector<HTMLButtonElement>('[data-order-id="one"]')
    );
    expect(capsule).toBeTruthy();
    expect(onOpenRelation).not.toHaveBeenCalled();
    fireEvent.click(capsule!);
    expect(await screen.findByText('真实目的 one')).toBeTruthy();
    expect(onOpenRelation).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: /graphOpenConversation/ })
    );
    await waitFor(() => expect(onOpenRelation).toHaveBeenCalledTimes(1));
    expect(onOpenRelation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one' })
    );
  });

  test('detail failures can be retried without opening a conversation', async () => {
    state.detailError = new Error('详情暂不可用');
    const onOpenRelation = vi.fn();
    const { container } = render(
      <CollaborationOrbitBoard
        projectFilter=""
        onOpenRelation={onOpenRelation}
      />
    );
    fireEvent.click(container.querySelector('[data-person-id="peer"]')!);
    fireEvent.click(container.querySelector('[data-order-id="one"]')!);
    expect((await screen.findByRole('alert')).textContent).toContain(
      '详情暂不可用'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.detailMutate).toHaveBeenCalledTimes(1);
    expect(onOpenRelation).not.toHaveBeenCalled();
  });

  test('opening a conversation rejects duplicate clicks and reports failure', async () => {
    const onOpenRelation = vi.fn().mockRejectedValue(new Error('会话不可用'));
    const { container } = render(
      <CollaborationOrbitBoard
        projectFilter=""
        onOpenRelation={onOpenRelation}
      />
    );
    fireEvent.click(container.querySelector('[data-person-id="peer"]')!);
    fireEvent.click(container.querySelector('[data-order-id="one"]')!);
    const button = screen.getByRole('button', {
      name: /graphOpenConversation/,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('会话不可用')
    );
    expect(onOpenRelation).toHaveBeenCalledTimes(1);
  });

  test('owner draft is separate from delivery capsules and can open its source', async () => {
    state.graph = {
      ...base,
      edges: [
        ...base.edges,
        {
          ...base.edges[0],
          id: 'draft:one',
          kind: 'draft',
          status: 'draft',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      ],
    };
    const onOpenRelation = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CollaborationOrbitBoard
        projectFilter=""
        onOpenRelation={onOpenRelation}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /orbit.drafts/ }));
    fireEvent.click(container.querySelector('[data-draft-trigger]')!);
    expect(onOpenRelation).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: /graphOpenConversation/ })
    );
    await waitFor(() =>
      expect(onOpenRelation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft:one' })
      )
    );
  });
});
