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
import type * as Infra from '@toeverything/infra';
import type { PropsWithChildren } from 'react';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspace: null as unknown,
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  notify: state.notify,
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => ({ workspace: state.workspace }),
}));

import { localDocText, SyncPermissionDeniedTip } from './index';

const docState = (syncPermissionDenied: boolean) => ({
  ready: true,
  loaded: true,
  updating: false,
  syncing: false,
  synced: !syncPermissionDenied,
  syncRetrying: false,
  syncPermissionDenied,
  syncErrorMessage: syncPermissionDenied ? 'No permission' : null,
});

const store = {
  getAllModels: () => [
    { text: { toString: () => 'Title' } },
    { text: undefined },
    { text: { toString: () => 'QA_LOCAL_ONLY_PARAGRAPH' } },
  ],
} as never;

describe('SyncPermissionDeniedTip', () => {
  let state$: BehaviorSubject<ReturnType<typeof docState>>;
  const writeText = vi.fn();

  beforeEach(() => {
    state$ = new BehaviorSubject(docState(false));
    state.workspace = {
      flavour: 'affine-cloud',
      engine: { doc: { ['docState$']: () => state$ } },
    };
    state.notify.success.mockReset();
    state.notify.error.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });
  afterEach(cleanup);

  test('stays hidden while the doc can sync', () => {
    render(<SyncPermissionDeniedTip docId="doc-1" store={store} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('explains unsubmitted local changes and copies them out', async () => {
    state$.next(docState(true));
    render(<SyncPermissionDeniedTip docId="doc-1" store={store} />);

    expect(screen.getByRole('alert').textContent).toContain(
      'com.affine.doc-sync.permission-denied.message'
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.doc-sync.permission-denied.copy',
      })
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Title\nQA_LOCAL_ONLY_PARAGRAPH')
    );
    await waitFor(() => expect(state.notify.success).toHaveBeenCalled());
  });

  test('reports a failed copy instead of claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    state$.next(docState(true));
    render(<SyncPermissionDeniedTip docId="doc-1" store={store} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(state.notify.error).toHaveBeenCalled());
    expect(state.notify.success).not.toHaveBeenCalled();
  });

  test('local workspaces never show the remote permission tip', () => {
    state.workspace = {
      flavour: 'local',
      engine: { doc: { ['docState$']: () => state$ } },
    };
    state$.next(docState(true));
    render(<SyncPermissionDeniedTip docId="doc-1" store={store} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('collects non-empty block text in order', () => {
    expect(localDocText(store)).toBe('Title\nQA_LOCAL_ONLY_PARAGRAPH');
  });
});
