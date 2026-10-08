import { BrowserWindow, webContents } from 'electron';

let closing = false;

export function closeAllWindows() {
  if (closing) {
    return;
  }
  closing = true;
  try {
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    const windowContents = new Set(windows.map(w => w.webContents.id));

    // Destroying a BrowserWindow does not close its WebContentsViews. Include
    // detached background tabs, and close them before tearing down their windows.
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && !windowContents.has(contents.id)) {
        contents.close({ waitForBeforeUnload: false });
      }
    }

    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
  } finally {
    closing = false;
  }
}
