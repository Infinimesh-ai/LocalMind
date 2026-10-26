/** @vitest-environment happy-dom */
import { JournalService } from '@affine/core/modules/journal';
import { WorkbenchService } from '@affine/core/modules/workbench';
import type { FrameworkProvider } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { setupEvents } from './events';
import { getCurrentWorkspace } from './utils';

const menu = vi.hoisted(() => ({ onOpenJournal: vi.fn() }));
vi.mock('@affine/electron-api', () => ({
  apis: undefined,
  events: {
    applicationMenu: {
      ...menu,
      openInSettingModal: vi.fn(),
      onNewPageAction: vi.fn(),
    },
  },
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: class {},
}));
vi.mock('@affine/core/modules/doc', () => ({ DocsService: class {} }));
vi.mock('@affine/core/modules/journal', () => ({ JournalService: class {} }));
vi.mock('@affine/core/modules/lifecycle', () => ({
  LifecycleService: class {},
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('./utils', () => ({ getCurrentWorkspace: vi.fn() }));
vi.mock('./recording', () => ({ setupRecordingEvents: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

function setupJournal() {
  menu.onOpenJournal.mockClear();
  const openDoc = vi.fn();
  const dispose = vi.fn();
  let resolve!: (value: { id: string }) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<{ id: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const ensureJournalByDate = vi.fn(() => pending);
  vi.mocked(getCurrentWorkspace).mockReturnValue({
    workspace: {
      scope: {
        get: (service: unknown) => {
          if (service === JournalService) return { ensureJournalByDate };
          if (service === WorkbenchService) return { workbench: { openDoc } };
          throw new Error('Unexpected service');
        },
      },
    },
    dispose,
    [Symbol.dispose]: dispose,
  } as unknown as ReturnType<typeof getCurrentWorkspace>);
  const framework = {
    get: () => ({ applicationStart: vi.fn() }),
  } as unknown as FrameworkProvider;
  vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  setupEvents(framework);
  const callback = menu.onOpenJournal.mock.calls[0][0] as () => void;
  return { callback, resolve, reject, openDoc, dispose, ensureJournalByDate };
}

test('journal menu waits for its document and keeps the workspace alive until navigation', async () => {
  const ctx = setupJournal();
  ctx.callback();
  expect(ctx.ensureJournalByDate).toHaveBeenCalledWith(expect.any(Date));
  expect(ctx.openDoc).not.toHaveBeenCalled();
  expect(ctx.dispose).not.toHaveBeenCalled();
  ctx.resolve({ id: 'journal-ready' });
  await vi.waitFor(() =>
    expect(ctx.openDoc).toHaveBeenCalledWith('journal-ready')
  );
  expect(ctx.openDoc).toHaveBeenCalledOnce();
  expect(ctx.dispose).toHaveBeenCalledOnce();
  expect(ctx.openDoc.mock.invocationCallOrder[0]).toBeLessThan(
    ctx.dispose.mock.invocationCallOrder[0]
  );
});

test('journal menu reports failure, releases the workspace and never opens an absent document', async () => {
  const ctx = setupJournal();
  const error = new Error('Journal unavailable');
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  ctx.callback();
  ctx.reject(error);
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error));
  expect(ctx.openDoc).not.toHaveBeenCalled();
  expect(ctx.dispose).toHaveBeenCalledOnce();
});
