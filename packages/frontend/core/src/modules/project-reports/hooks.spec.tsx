/** @vitest-environment happy-dom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type {
  ProjectReportApi,
  ReportCommandResult,
  ReportComment,
  ReportState,
} from './contracts';
import {
  useReportCollection,
  useReportCommand,
  useReportLease,
  useReportState,
} from './hooks';

const api = (): ProjectReportApi => ({
  query: vi.fn(async () => ({})),
  command: vi.fn(async () => ({})),
  download: vi.fn(async () => {}),
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('keeps the project subscription across searches and refreshes the latest query', async () => {
  const client = api();
  const unsubscribe = vi.fn();
  let changed = () => {};
  client.subscribe = vi.fn((_projectId, callback) => {
    changed = callback;
    return unsubscribe;
  });
  const hook = renderHook(
    ({ search }) =>
      useReportState(client, {
        projectId: 'project',
        view: 'list_results',
        search,
      }),
    { initialProps: { search: '' } }
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  hook.rerender({ search: 'latest' });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(client.subscribe).toHaveBeenCalledOnce();
  expect(unsubscribe).not.toHaveBeenCalled();
  await act(async () => changed());
  expect(client.query).toHaveBeenLastCalledWith(
    { projectId: 'project', view: 'list_results', search: 'latest' },
    expect.any(AbortSignal)
  );
  hook.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('ignores late responses after switching projects', async () => {
  const client = api();
  let resolveFirst: (state: ReportState) => void = () => {};
  client.query = vi.fn(input =>
    input.projectId === 'first'
      ? new Promise<ReportState>(resolve => {
          resolveFirst = resolve;
        })
      : Promise.resolve({ currentActorId: 'second' })
  );
  const hook = renderHook(
    ({ projectId }) => useReportState(client, { projectId }),
    { initialProps: { projectId: 'first' } }
  );
  hook.rerender({ projectId: 'second' });
  await waitFor(() =>
    expect(hook.result.current.state.currentActorId).toBe('second')
  );
  await act(async () => resolveFirst({ currentActorId: 'first' }));
  expect(hook.result.current.state.currentActorId).toBe('second');
});
it('coalesces events while allowing the current response to render', async () => {
  const client = api();
  const requests: Array<(state: ReportState) => void> = [];
  let changed = () => {};
  client.query = vi.fn(
    () => new Promise<ReportState>(resolve => requests.push(resolve))
  );
  client.subscribe = (_projectId, callback) => {
    changed = callback;
    return () => {};
  };
  const hook = renderHook(() =>
    useReportState(client, { projectId: 'project' })
  );
  act(() => {
    changed();
    changed();
    changed();
  });
  expect(client.query).toHaveBeenCalledTimes(1);
  await act(async () => requests[0]!({ currentActorId: 'initial' }));
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.state.currentActorId).toBe('initial');
  expect(client.query).toHaveBeenCalledTimes(2);
  await act(async () => requests[1]!({ currentActorId: 'fresh' }));
  expect(hook.result.current.state.currentActorId).toBe('fresh');
});
it('does not start new polls or discard results while a slow request is pending', async () => {
  vi.useFakeTimers();
  const client = api();
  let resolve = (_state: ReportState) => {};
  client.query = vi.fn(
    () =>
      new Promise<ReportState>(done => {
        resolve = done;
      })
  );
  const hook = renderHook(() =>
    useReportState(client, { projectId: 'project' })
  );
  await act(async () => vi.advanceTimersByTime(45000));
  expect(client.query).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ currentActorId: 'result' }));
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.state.currentActorId).toBe('result');
});
it('clears protected data if the catch-up request loses access', async () => {
  const client = api();
  const requests: Array<{
    resolve: (state: ReportState) => void;
    reject: (error: Error) => void;
  }> = [];
  client.query = vi.fn(
    () =>
      new Promise<ReportState>((resolve, reject) =>
        requests.push({ resolve, reject })
      )
  );
  const hook = renderHook(() =>
    useReportState(client, { projectId: 'project' })
  );
  const refresh = hook.result.current.refresh().catch(() => {});
  await act(async () => requests[0]!.resolve({ currentActorId: 'initial' }));
  const denied = new Error('Access denied');
  await act(async () => {
    requests[1]!.reject(denied);
    await refresh;
  });
  expect(hook.result.current.state).toEqual({});
  expect(hook.result.current.error).toBe(denied);
});
it('aborts background and queued requests when changing queries', async () => {
  const client = api();
  const requests: Array<{
    resolve: (state: ReportState) => void;
    signal?: AbortSignal;
  }> = [];
  client.query = vi.fn(
    (_input, signal) =>
      new Promise<ReportState>(resolve => requests.push({ resolve, signal }))
  );
  const hook = renderHook(
    ({ search }) => useReportState(client, { projectId: 'project', search }),
    { initialProps: { search: 'old' } }
  );
  const queued = hook.result.current.refresh().catch(() => {});
  hook.rerender({ search: 'new' });
  expect(requests[0]!.signal?.aborted).toBe(true);
  await act(async () => {
    requests[0]!.resolve({ currentActorId: 'old' });
    await queued;
  });
  expect(requests).toHaveLength(2);
  await act(async () => requests[1]!.resolve({ currentActorId: 'new' }));
  expect(hook.result.current.state.currentActorId).toBe('new');
});
it('prevents duplicate row commands and exposes a failed operation for retry', async () => {
  const client = api();
  let rejectCommand: (error: Error) => void = () => {};
  client.command = vi.fn(
    () =>
      new Promise<ReportCommandResult>((_, reject) => {
        rejectCommand = reject;
      })
  );
  const refresh = vi.fn(async () => ({}));
  const hook = renderHook(() =>
    useReportCommand(client, { projectId: 'project' }, refresh)
  );
  let pending: Promise<ReportCommandResult | void>;
  act(() => {
    pending = hook.result.current
      .execute(
        { operation: 'lifecycle', lifecycle: 'archived' },
        { reportId: 'report', expectedVersion: 3 }
      )
      .catch(() => {});
  });
  expect(hook.result.current.pending).toBe(true);
  await expect(
    hook.result.current.execute({ operation: 'permanentlyDelete' })
  ).rejects.toThrow('pending');
  const failure = new Error('Version changed');
  await act(async () => {
    rejectCommand(failure);
    await pending!;
  });
  expect(client.command).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
  expect(hook.result.current.error).toBe(failure);
  expect(refresh).not.toHaveBeenCalled();
});
it('does not expose a proof held by someone else', async () => {
  const client = api();
  client.command = vi.fn(async () => ({
    lease: {
      owned: false,
      holderName: 'Another member',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  }));
  const hook = renderHook(() =>
    useReportLease(client, 'project', 'report', true)
  );
  await waitFor(() =>
    expect(hook.result.current.holder).toBe('Another member')
  );
  expect(hook.result.current.proof).toBeUndefined();
});
it('clears expired authority before a delayed renewal can finish', async () => {
  vi.useFakeTimers();
  const client = api();
  client.command = vi.fn(async input =>
    input.command.operation === 'lease.acquire'
      ? {
          lease: {
            owned: true,
            leaseId: 'lease',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        }
      : input.command.operation === 'lease.renew'
        ? new Promise<ReportCommandResult>(() => {})
        : {}
  );
  const hook = renderHook(() =>
    useReportLease(client, 'project', 'report', true)
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.proof?.leaseId).toBe('lease');
  await act(async () => {
    vi.advanceTimersByTime(31000);
  });
  expect(hook.result.current.proof).toBeUndefined();
});
it('releases an owned lease on pagehide and reacquires through the server on pageshow', async () => {
  const client = api();
  client.command = vi.fn(async input =>
    input.command.operation === 'lease.release'
      ? {}
      : {
          lease: {
            owned: true,
            leaseId: 'lease',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        }
  );
  const hook = renderHook(() =>
    useReportLease(client, 'project', 'report', true)
  );
  await waitFor(() => expect(hook.result.current.proof).toBeDefined());
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(hook.result.current.proof).toBeUndefined();
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
  });
  await waitFor(() => expect(hook.result.current.proof).toBeDefined());
  expect(
    vi
      .mocked(client.command)
      .mock.calls.map(([input]) => input.command.operation)
  ).toEqual(['lease.acquire', 'lease.release', 'lease.acquire']);
});

it('keeps earlier history pages accessible and refreshes their mutable review state', async () => {
  const client = api();
  const comment = (id: string, resolved = false): ReportComment => ({
    id,
    version: resolved ? 2 : 1,
    actorId: 'actor',
    body: id,
    resolved,
    revisionId: 'revision',
    createdAt: '2026-10-12T00:00:00Z',
  });
  let resolved = false;
  client.query = vi.fn(async () => ({
    comments: [comment('old', resolved)],
    nextCursors: { comments: null },
  }));
  const first = [comment('new')];
  const hook = renderHook(
    ({ first }) =>
      useReportCollection(
        client,
        'project',
        'report',
        'comments',
        first,
        'cursor'
      ),
    { initialProps: { first } }
  );
  await act(async () => hook.result.current.loadMore());
  await waitFor(() =>
    expect(hook.result.current.items.map(item => item.id)).toEqual([
      'new',
      'old',
    ])
  );
  expect(hook.result.current.hasMore).toBe(false);
  resolved = true;
  hook.rerender({ first: [comment('new')] });
  await waitFor(() =>
    expect(
      hook.result.current.items.find(item => item.id === 'old')?.resolved
    ).toBe(true)
  );
});
