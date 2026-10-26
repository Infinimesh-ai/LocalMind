/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ service: null as unknown }));
vi.mock('@affine/component', () => ({
  Button: ({ children }: PropsWithChildren) => <button>{children}</button>,
  MenuItem: ({
    children,
    disabled,
    'aria-description': description,
  }: PropsWithChildren<{
    disabled?: boolean;
    'aria-description'?: string;
  }>) => (
    <button role="menuitem" disabled={disabled} aria-description={description}>
      {children}
    </button>
  ),
  MenuSub: () => null,
  Modal: () => null,
  toast: vi.fn(),
  usePromptModal: () => ({ openPromptModal: vi.fn() }),
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
}));
vi.mock('@affine/core/desktop/components/navigation-panel/tree', () => ({
  NavigationPanelTreeRoot: () => null,
  NavigationPanelTreeNode: () => null,
}));
vi.mock(
  '@affine/core/desktop/components/navigation-panel/nodes/folder/sort-menu',
  () => ({ FolderSortButton: () => null, FolderSortMenu: () => null })
);
vi.mock('@affine/core/modules/doc/services/docs', () => ({
  DocsService: class {},
}));
vi.mock('@affine/core/modules/navigation-panel', () => ({
  NavigationPanelService: class {},
  CreatedResourceService: class {},
}));
vi.mock('@affine/core/modules/organize', () => ({
  WorkspacePageTreeService: class {},
}));
vi.mock('@affine/core/modules/organize/stores/folder-sorting', () => ({
  FolderSortingStore: class {},
}));
vi.mock('@affine/core/modules/template-doc/view/template-list-menu', () => ({
  TemplateListMenuContentScrollable: () => null,
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/graphql', () => ({
  WORKSPACE_PAGE_TREE_CONTRACT: 'localmind-page-tree/v2',
  workspaceDocumentTypes: [],
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => state.service,
}));
vi.mock('../native-files/create-menu', () => ({
  WorkspaceCreateMenu: () => null,
}));
vi.mock('../native-files/resource-rows', () => ({
  ResourceTypeIcon: () => null,
}));
vi.mock('../page-tree/created-resource', () => ({
  useCreatedResourceFocus: () => () => {},
  useCreatedResourceNavigation: () => () => {},
}));
vi.mock('../page-tree/load-error', () => ({ PageTreeLoadError: () => null }));

import { LiveData } from '@toeverything/infra';

import { FolderTreeActions } from './page-tree';

const folder = (
  canConvertToPage: boolean,
  convertToPageUnavailableReason: string | null
) =>
  ({
    nodeId: 'folder-1',
    resourceId: 'folder-1',
    kind: 'folder',
    title: 'Folder',
    parentNodeId: null,
    isContainer: true,
    canOrganize: true,
    canRename: true,
    canConvertToPage,
    convertToPageUnavailableReason,
    folder: {
      title: 'Folder',
      metadataVersion: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: 'user-1',
      updatedAt: '2026-10-01T00:00:00.000Z',
      updatedBy: 'user-1',
    },
  }) as never;

state.service = {
  workbench: {},
  writeBlocked$: new LiveData(false),
};

afterEach(cleanup);

test('an unavailable conversion stays visible, disabled and explains why', () => {
  render(<FolderTreeActions item={folder(false, 'public_workspace')} />);
  const convert = screen
    .getAllByRole('menuitem')
    .find(element =>
      element.textContent?.includes(
        'com.affine.localmind.page-tree.convertToPage'
      )
    ) as HTMLButtonElement;
  expect(convert.disabled).toBe(true);
  const reason =
    'com.affine.localmind.page-tree.convertToPageUnavailable.publicWorkspace';
  expect(convert.textContent).toContain(reason);
  expect(convert.getAttribute('aria-description')).toBe(reason);
});

test('an available conversion offers the normal entry without a reason', () => {
  render(<FolderTreeActions item={folder(true, null)} />);
  const convert = screen
    .getAllByRole('menuitem')
    .find(element =>
      element.textContent?.includes(
        'com.affine.localmind.page-tree.convertToPage'
      )
    ) as HTMLButtonElement;
  expect(convert.disabled).toBe(false);
  expect(convert.textContent).not.toContain('convertToPageUnavailable');
});
