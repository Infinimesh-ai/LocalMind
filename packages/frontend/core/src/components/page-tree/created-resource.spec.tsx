/** @vitest-environment happy-dom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { LiveData } from '@toeverything/infra';
import { useEffect, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ service: undefined as unknown }));
vi.mock('@affine/core/modules/navigation-panel', () => ({
  CreatedResourceService: class {},
}));
vi.mock('@affine/component', () => ({ notify: { success: vi.fn() } }));
vi.mock('@affine/i18n', () => ({ useI18n: () => ({}) }));
vi.mock('@toeverything/infra', async original => ({
  ...(await original<typeof Infra>()),
  useServiceOptional: () => state.service,
}));
import { createDocExplorerContext } from '../explorer/context';
import {
  useCreatedResourceFocus,
  useCreatedResourceSelection,
} from './created-resource';

afterEach(cleanup);
function setup() {
  const editorFocus$ = new LiveData<{
    kind: string;
    resourceId: string;
  } | null>({ kind: 'file', resourceId: 'new' });
  const consumeEditorFocus = vi.fn((kind, id) => {
    if (
      editorFocus$.value?.kind !== kind ||
      editorFocus$.value.resourceId !== id
    )
      return false;
    editorFocus$.next(null);
    return true;
  });
  state.service = { editorFocus$, consumeEditorFocus };
  return { editorFocus$, consumeEditorFocus };
}
function Editor({ ready = true, readOnly = false }) {
  const ref = useCreatedResourceFocus('file', 'new');
  return (
    <div ref={ref}>
      {ready && (
        <textarea
          aria-label="New file"
          data-created-resource-focus-target
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

test('focus waits for the new editor to mount and is delivered once', async () => {
  const { consumeEditorFocus } = setup();
  const view = render(<Editor ready={false} />);
  expect(consumeEditorFocus).not.toHaveBeenCalled();
  view.rerender(<Editor />);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  );
  expect(consumeEditorFocus).toHaveBeenCalledTimes(1);
});

test('a cleared navigation intent never focuses a later editor', async () => {
  const { editorFocus$, consumeEditorFocus } = setup();
  const view = render(<Editor ready={false} />);
  act(() => editorFocus$.next(null));
  view.rerender(<Editor />);
  expect(consumeEditorFocus).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
});

test('a read-only preview does not claim editing focus', () => {
  const { consumeEditorFocus } = setup();
  render(<Editor readOnly />);
  expect(consumeEditorFocus).not.toHaveBeenCalled();
});

test('focus observes an editor root mounted later by a child portal', async () => {
  setup();
  let mount = () => {};
  function DelayedBody({
    attach,
  }: {
    attach: (node: HTMLDivElement | null) => void;
  }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      mount = () => setReady(true);
    }, []);
    return ready ? (
      <div ref={attach}>
        <textarea
          aria-label="Delayed editor"
          data-created-resource-focus-target
        />
      </div>
    ) : null;
  }
  function OfficeSurface() {
    return <DelayedBody attach={useCreatedResourceFocus('file', 'new')} />;
  }
  render(<OfficeSurface />);
  act(() => mount());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  );
});

test('focus waits until the creation modal releases its focus trap', async () => {
  const { consumeEditorFocus } = setup();
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.dataset.state = 'open';
  document.body.append(modal);
  try {
    render(<Editor />);
    await act(() => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(consumeEditorFocus).not.toHaveBeenCalled();
    modal.remove();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox'))
    );
    expect(consumeEditorFocus).toHaveBeenCalledOnce();
  } finally {
    modal.remove();
  }
});

test('batch selection uses the existing list identity and only affects its target parent', () => {
  const context = createDocExplorerContext();
  state.service = {
    reveal$: new LiveData({
      batch: true,
      parentNodeId: 'folder',
      resources: [
        { kind: 'file', resourceId: 'one' },
        { kind: 'office', resourceId: 'two' },
      ],
    }),
  };
  function List({ parent }: { parent: string }) {
    useCreatedResourceSelection(context, parent, 'workspace');
    return null;
  }
  const view = render(<List parent="elsewhere" />);
  expect(context.selectedDocIds$.value).toEqual([]);
  view.rerender(<List parent="folder" />);
  expect(context.selectedDocIds$.value).toEqual([
    'native:workspace:file:one',
    'native:workspace:office:two',
  ]);
  expect(context.selectMode$.value).toBe(true);
});
