/** @vitest-environment happy-dom */
import { CloudViewExtension } from '@affine/core/blocksuite/view-extensions/cloud';
import { ViewExtensionManager } from '@blocksuite/affine/ext-loader';
import { Framework } from '@toeverything/infra';
import { expect, test, vi } from 'vitest';

import { getCommentEditorViewManager } from './specs';

test('comment extensions retain only their own provider across Workspace/account lifecycles', () => {
  const configure = vi.spyOn(ViewExtensionManager.prototype, 'configure');
  const oldProvider = Framework.EMPTY.provider();
  const nextProvider = Framework.EMPTY.provider();
  const oldManager = getCommentEditorViewManager(oldProvider);
  expect(getCommentEditorViewManager(oldProvider)).toBe(oldManager);
  oldProvider.dispose();
  const nextManager = getCommentEditorViewManager(nextProvider);
  expect(nextManager).not.toBe(oldManager);
  expect(getCommentEditorViewManager(nextProvider)).toBe(nextManager);
  const cloudProviders = configure.mock.calls
    .filter(([provider]) => provider === CloudViewExtension)
    .map(([, options]) => (options as { framework: unknown }).framework);
  expect(cloudProviders).toEqual([oldProvider, nextProvider]);
  configure.mockRestore();
  nextProvider.dispose();
});
