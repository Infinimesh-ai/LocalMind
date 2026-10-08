import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  getAllWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  webContents: { getAllWebContents: mocks.getAllWebContents },
}));

import { closeAllWindows } from '../../src/main/windows-manager/close-all-windows';

function contents(id: number, events: string[]) {
  let destroyed = false;
  return {
    id,
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      destroyed = true;
      events.push(`close:${id}`);
    }),
  };
}

function window(id: number, events: string[]) {
  let destroyed = false;
  return {
    webContents: contents(id, events),
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true;
      events.push(`destroy:${id}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('window teardown', () => {
  test('closes shell, active and detached tab contents before destroying windows', () => {
    const events: string[] = [];
    const main = window(1, events);
    const worker = window(2, events);
    const shell = contents(3, events);
    const activeTab = contents(4, events);
    const detachedTab = contents(5, events);
    mocks.getAllWindows.mockReturnValue([main, worker]);
    mocks.getAllWebContents.mockReturnValue([
      main.webContents,
      worker.webContents,
      shell,
      activeTab,
      detachedTab,
    ]);

    closeAllWindows();

    expect(events).toEqual([
      'close:3',
      'close:4',
      'close:5',
      'destroy:1',
      'destroy:2',
    ]);
    for (const view of [shell, activeTab, detachedTab]) {
      expect(view.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    }
    expect(main.webContents.close).not.toHaveBeenCalled();
    expect(worker.webContents.close).not.toHaveBeenCalled();
  });

  test('ignores recursive cleanup from destroyed events and can close later windows', () => {
    const events: string[] = [];
    const main = window(1, events);
    const view = contents(2, events);
    view.close.mockImplementation(() => {
      events.push('close:2');
      closeAllWindows();
    });
    mocks.getAllWindows.mockReturnValue([main]);
    mocks.getAllWebContents.mockReturnValue([main.webContents, view]);

    closeAllWindows();

    expect(events).toEqual(['close:2', 'destroy:1']);
    expect(view.close).toHaveBeenCalledOnce();

    const reopened = window(3, events);
    mocks.getAllWindows.mockReturnValue([reopened]);
    mocks.getAllWebContents.mockReturnValue([reopened.webContents]);
    closeAllWindows();
    expect(reopened.destroy).toHaveBeenCalledOnce();
  });

  test('skips contents and windows already destroyed by an earlier close callback', () => {
    const events: string[] = [];
    const main = window(1, events);
    const activeTab = contents(2, events);
    const otherTab = contents(3, events);
    activeTab.close.mockImplementation(() => {
      otherTab.close();
      main.destroy();
    });
    mocks.getAllWindows.mockReturnValue([main]);
    mocks.getAllWebContents.mockReturnValue([activeTab, otherTab]);

    closeAllWindows();

    expect(otherTab.close).toHaveBeenCalledOnce();
    expect(main.destroy).toHaveBeenCalledOnce();
  });
});
