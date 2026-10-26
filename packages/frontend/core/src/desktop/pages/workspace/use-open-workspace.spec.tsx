/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { BehaviorSubject } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';

import type { WorkspaceOpenOptions } from '../../../modules/workspace/open-options';
import { useOpenWorkspace } from './use-open-workspace';

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(ready = true, reused = true) {
  const state$ = new BehaviorSubject({
    ready: false,
    synced: false,
    syncing: false,
    syncRetrying: false,
    syncErrorMessage: null,
  });
  const readiness = deferred();
  const checks: ReturnType<typeof deferred>[] = [];
  const releases: ReturnType<typeof vi.fn>[] = [];
  const workspace = {
    id: 'workspace',
    flavour: 'cloud',
    localRootReady: ready,
    markLocalRootReady() {
      this.localRootReady = true;
    },
    engine: {
      doc: {
        // eslint-disable-next-line rxjs/finnish -- Match the engine's observable-returning method.
        docState$() {
          return state$;
        },
        waitForDocReady: vi.fn(
          (_id: string, _signal?: AbortSignal) => readiness.promise
        ),
      },
    },
  };
  const open = vi.fn(() => {
    const dispose = vi.fn();
    releases.push(dispose);
    return {
      workspace,
      reused,
      dispose,
      validateAccess: vi.fn(() => {
        const check = deferred();
        checks.push(check);
        return check.promise;
      }),
    };
  });
  let current = 0;
  const switches = {
    routeCommitted: () => String(++current),
    isCurrent: (id: string) => id === String(current),
    phase: vi.fn(),
    engineStarted: vi.fn(),
    remoteConnected: vi.fn(),
    fail: vi.fn(),
  };
  const options: WorkspaceOpenOptions = {
    metadata: { id: workspace.id, flavour: 'cloud' },
  };
  const workspaces = { open };
  const mount = (strict = false) =>
    renderHook(
      ({ request }: { request?: string }) =>
        useOpenWorkspace(
          workspaces as never,
          switches as never,
          options,
          undefined,
          request
        ),
      {
        initialProps: { request: undefined as string | undefined },
        wrapper: strict ? StrictMode : undefined,
      }
    );
  return {
    workspace,
    readiness,
    checks,
    releases,
    open,
    switches,
    mount,
    state$,
  };
}

test('StrictMode replay releases the pending lease without invalidating the cached workspace', async () => {
  const s = setup();
  const hook = s.mount(true);
  expect(s.open).toHaveBeenCalledTimes(2);
  expect(s.releases[0]).toHaveBeenCalledExactlyOnceWith();
  expect(hook.result.current).toBeNull();
  // A cancelled access request may still reject after its successor has started.
  await act(async () => s.checks[0].reject(new Error('aborted')));
  expect(s.switches.fail).not.toHaveBeenCalled();
  await act(async () => s.checks[1].resolve());
  expect(hook.result.current?.workspace).toBe(s.workspace);
  hook.unmount();
  expect(s.releases[1]).toHaveBeenCalledExactlyOnceWith();
});

test('local readiness commits without waiting for a throttled progress notification', async () => {
  const s = setup(false, false);
  const hook = s.mount();
  expect(hook.result.current).toBeNull();
  await act(async () => s.readiness.resolve());
  expect(s.state$.value.ready).toBe(false);
  expect(hook.result.current?.workspace).toBe(s.workspace);
  expect(s.workspace.localRootReady).toBe(true);
});

test('a reused workspace waits for both readiness and access', async () => {
  const s = setup(false);
  const hook = s.mount();
  await act(async () => s.readiness.resolve());
  expect(hook.result.current).toBeNull();
  await act(async () => s.checks[0].resolve());
  expect(hook.result.current?.workspace).toBe(s.workspace);
});

test('a denied access check invalidates the candidate and never exposes cached content', async () => {
  const s = setup();
  const hook = s.mount();
  await act(async () => s.checks[0].reject(new Error('forbidden')));
  expect(hook.result.current).toBeNull();
  expect(s.releases[0]).toHaveBeenCalledExactlyOnceWith({ warm: false });
  expect(s.switches.fail).toHaveBeenCalledWith(
    '1',
    'access-check',
    expect.any(Error)
  );
  hook.unmount();
  expect(s.releases[0]).toHaveBeenCalledTimes(1);
});

test('a superseded request cannot commit or invalidate the newer lease', async () => {
  const s = setup();
  const hook = s.mount();
  hook.rerender({ request: 'next' });
  await act(async () => s.checks[1].resolve());
  const committed = hook.result.current;
  await act(async () => s.checks[0].reject(new Error('late failure')));
  expect(hook.result.current).toBe(committed);
  expect(s.switches.fail).not.toHaveBeenCalled();
  expect(s.releases[0]).toHaveBeenCalledExactlyOnceWith();
  expect(s.releases[1]).not.toHaveBeenCalled();
});

test('retry after an access failure opens a fresh candidate and validates it before committing', async () => {
  const s = setup();
  const hook = s.mount();
  await act(async () => s.checks[0].reject(new Error('connection timed out')));
  hook.rerender({ request: 'retry' });
  expect(s.open).toHaveBeenCalledTimes(2);
  expect(hook.result.current).toBeNull();
  expect(s.releases[0]).toHaveBeenCalledExactlyOnceWith({ warm: false });
  await act(async () => s.checks[1].resolve());
  expect(hook.result.current?.workspace).toBe(s.workspace);
  expect(s.releases[1]).not.toHaveBeenCalled();
});

test('unmount cancels readiness and late completion cannot commit', async () => {
  const s = setup(false, false);
  const hook = s.mount();
  const signal = s.workspace.engine.doc.waitForDocReady.mock.calls[0]?.[1] as
    | AbortSignal
    | undefined;
  hook.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => s.readiness.resolve());
  expect(s.workspace.localRootReady).toBe(false);
  expect(s.releases[0]).toHaveBeenCalledExactlyOnceWith();
  expect(s.switches.phase).not.toHaveBeenCalledWith(
    expect.anything(),
    'local-ready'
  );
});
