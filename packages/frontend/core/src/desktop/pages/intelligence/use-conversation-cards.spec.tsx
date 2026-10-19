/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  gql: vi.fn(),
  mutate: vi.fn(),
  requests: [] as Array<Record<string, unknown>>,
  authenticated: true,
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@toeverything/infra', () => ({ useService: () => mock }));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: () => {},
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (request?: { variables: Record<string, unknown> }) => {
    if (!request)
      return {
        data: undefined,
        isLoading: false,
        error: null,
        mutate: mock.mutate,
      };
    mock.requests.push(request.variables);
    if (!mock.authenticated) {
      return {
        data: { currentUser: null },
        isLoading: false,
        error: null,
        mutate: mock.mutate,
      };
    }
    const scope = String(
      request.variables.projectId ?? request.variables.scopeType ?? 'all'
    );
    const column = String(request.variables.column);
    return {
      data: {
        currentUser: {
          copilot: {
            myConversationCards: {
              items:
                column === 'todo'
                  ? [{ sessionId: scope + '-base', column }]
                  : [],
              counts: { todo: 3, progress: 0, done: 0 },
              pageInfo: {
                hasNextPage: column === 'todo',
                endCursor: column === 'todo' ? scope + '-cursor' : null,
              },
            },
          },
        },
      },
      isLoading: false,
      error: null,
      mutate: mock.mutate,
    };
  },
}));

import { useConversationCards } from './use-conversation-cards';

const page = (ids: string[]) => ({
  currentUser: {
    copilot: {
      myConversationCards: {
        items: ids.map(sessionId => ({ sessionId, column: 'todo' })),
        counts: { todo: 3, progress: 0, done: 0 },
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  },
});

describe('conversation cards scope and pagination', () => {
  beforeEach(() => {
    mock.gql.mockReset();
    mock.mutate.mockReset();
    mock.requests.length = 0;
    mock.authenticated = true;
  });
  afterEach(cleanup);

  test('distinguishes an unauthenticated response from an empty list and hides cached pages', async () => {
    mock.gql.mockResolvedValue(page(['cached-private-session']));
    const hook = renderHook(() => useConversationCards());
    await act(() => hook.result.current.todo.loadMore());
    expect(hook.result.current.todo.items).toHaveLength(2);
    mock.authenticated = false;
    hook.rerender();
    expect(hook.result.current.todo.authenticationRequired).toBe(true);
    expect(hook.result.current.todo.items).toEqual([]);
    expect(hook.result.current.counts).toBeNull();
    expect(hook.result.current.todo.hasNextPage).toBe(false);
    mock.gql.mockClear();
    await act(() => hook.result.current.todo.loadMore());
    expect(mock.gql).not.toHaveBeenCalled();
    mock.authenticated = true;
    hook.rerender();
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'all-base',
    ]);
  });

  test('sends project and personal-order filters to every column and every subsequent page', async () => {
    mock.gql.mockResolvedValue(page(['project-a-extra']));
    const hook = renderHook(({ filter }) => useConversationCards({ filter }), {
      initialProps: { filter: 'project-a' },
    });
    expect(
      mock.requests
        .slice(0, 3)
        .every(request => request.projectId === 'project-a')
    ).toBe(true);
    await act(() => hook.result.current.todo.loadMore());
    expect(mock.gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          projectId: 'project-a',
          after: 'project-a-cursor',
          column: 'todo',
        }),
      })
    );
    hook.rerender({ filter: 'work_order' });
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'work_order-base',
    ]);
    expect(mock.requests.at(-1)).toMatchObject({
      scopeType: 'work_order',
      projectId: undefined,
    });
  });

  test('ignores a late page after changing scope away and back', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void;
    mock.gql.mockReturnValue(
      new Promise(value => {
        resolve = value;
      })
    );
    const hook = renderHook(({ filter }) => useConversationCards({ filter }), {
      initialProps: { filter: 'project-a' },
    });
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.todo.loadMore();
    });
    hook.rerender({ filter: 'project-b' });
    hook.rerender({ filter: 'project-a' });
    await act(async () => {
      resolve(page(['stale-page']));
      await pending;
    });
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'project-a-base',
    ]);
  });

  test('preserves loaded cards when the next page fails and deduplicates a successful retry', async () => {
    mock.gql.mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(() => useConversationCards());
    await act(() => hook.result.current.todo.loadMore());
    expect(hook.result.current.todo.error).toBeInstanceOf(Error);
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'all-base',
    ]);
    mock.gql.mockResolvedValueOnce(page(['all-base', 'extra']));
    await act(() => hook.result.current.todo.loadMore());
    expect(hook.result.current.todo.error).toBeNull();
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'all-base',
      'extra',
    ]);
  });

  test('coalesces repeated load clicks and ignores an obsolete page after refresh', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void;
    mock.gql.mockReturnValue(
      new Promise(value => {
        resolve = value;
      })
    );
    const hook = renderHook(() => useConversationCards());
    let pending!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      pending = hook.result.current.todo.loadMore();
      duplicate = hook.result.current.todo.loadMore();
    });
    await duplicate;
    expect(mock.gql).toHaveBeenCalledTimes(1);
    await act(() => hook.result.current.todo.refresh());
    await act(async () => {
      resolve(page(['obsolete']));
      await pending;
    });
    expect(hook.result.current.todo.items.map(item => item.sessionId)).toEqual([
      'all-base',
    ]);
  });

  test('does not fetch or paginate an inactive filtered board', async () => {
    const hook = renderHook(() =>
      useConversationCards({ filter: 'project-a', enabled: false })
    );
    await act(() => hook.result.current.todo.loadMore());
    expect(mock.requests).toEqual([]);
    expect(mock.gql).not.toHaveBeenCalled();
  });
});
