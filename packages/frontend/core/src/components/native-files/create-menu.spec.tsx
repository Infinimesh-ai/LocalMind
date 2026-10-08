/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import { Framework, LiveData } from '@toeverything/infra';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  services: new Map<unknown, unknown>(),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: (key: unknown) => state.services.get(key),
  useServiceOptional: (key: unknown) => state.services.get(key),
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/organize', () => ({ OrganizeService: class {} }));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceResourcesService: class {},
}));
vi.mock('@affine/core/modules/permissions', async () => ({
  GuardService: (await import('../../modules/permissions/services/guard'))
    .GuardService,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  IconButton: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
  Menu: ({ children, items }: { children: ReactNode; items: ReactNode }) => (
    <div>
      {children}
      {items}
    </div>
  ),
  MenuItem: ({
    prefixIcon: _prefixIcon,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { prefixIcon?: ReactNode }) => (
    <button {...props} />
  ),
  MenuSub: ({
    children,
    items,
    triggerOptions,
  }: {
    children: ReactNode;
    items: ReactNode;
    triggerOptions: { disabled: boolean };
  }) => (
    <div>
      <button disabled={triggerOptions.disabled}>{children}</button>
      {!triggerOptions.disabled && items}
    </div>
  ),
  Modal: () => null,
  toast: vi.fn(),
  usePromptModal: () => ({ openPromptModal: vi.fn() }),
}));
vi.mock('./create-dialog', () => ({
  NativeFileCreateDialog: ({ initialFormat }: { initialFormat: string }) => (
    <div role="dialog">{initialFormat}</div>
  ),
}));
vi.mock('./workspace-upload', () => ({ uploadWorkspaceNativeBlob: vi.fn() }));

import { GraphQLService } from '@affine/core/modules/cloud';
import { OrganizeService } from '@affine/core/modules/organize';
import { GuardService } from '@affine/core/modules/permissions';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { WorkspaceResourcesService } from '@affine/core/modules/workspace-resources';

import { WorkspaceCreateMenu } from './create-menu';

const guards: GuardService[] = [];
const officeLabels = ['Word (.docx)', 'Excel (.xlsx)', 'PowerPoint (.pptx)'];
const uploadLabel = 'com.affine.localmind.resources.uploadLocal';

function setupMenu(parentId: string | null = 'folder-1', canOrganize = true) {
  const getWorkspacePermissions = vi.fn().mockResolvedValue({
    Workspace_Blobs_Write: true,
  });
  const workspace = {
    id: 'workspace-1',
    flavour: 'server-1',
    openOptions: {},
    name$: new LiveData('Workspace'),
  };
  const framework = new Framework();
  framework.service(
    GuardService,
    () =>
      new GuardService(
        { getWorkspacePermissions } as never,
        { workspace } as never,
        {
          permission: {
            isOwner$: new LiveData(false),
            isAdmin$: new LiveData(false),
          },
        } as never
      )
  );
  const guard = framework.provider().get(GuardService);
  guards.push(guard);
  state.services.set(GuardService, guard);
  state.services.set(WorkspaceService, { workspace });
  state.services.set(GraphQLService, { gql: vi.fn() });
  state.services.set(WorkbenchService, { workbench: {} });
  state.services.set(WorkspaceResourcesService, { invalidate: vi.fn() });
  state.services.set(OrganizeService, {
    folderTree: {
      canMutate$: new LiveData(canOrganize),
      // eslint-disable-next-line rxjs/finnish -- Match the FolderTree method name.
      folderNode$() {
        return new LiveData({
          name$: new LiveData('Folder'),
          canMutate$: new LiveData(canOrganize),
        });
      },
    },
  });
  return {
    getWorkspacePermissions,
    renderMenu: () =>
      render(
        <WorkspaceCreateMenu
          parentId={parentId}
          onPage={vi.fn()}
          onEdgeless={vi.fn()}
        />
      ),
  };
}

function expectFileActionsDisabled(disabled: boolean) {
  for (const label of [...officeLabels, uploadLabel]) {
    expect(
      (screen.getByRole('button', { name: label }) as HTMLButtonElement)
        .disabled
    ).toBe(disabled);
  }
  expect(
    (
      screen.getByRole('button', {
        name: 'com.affine.localmind.resources.textFiles',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(disabled);
}

beforeEach(() => state.services.clear());
afterEach(() => {
  cleanup();
  guards.splice(0).forEach(guard => guard.dispose());
  vi.restoreAllMocks();
});

test.each([null, 'folder-1'])(
  'loads member permissions for %s and enables formats and upload after loading',
  async parentId => {
    const { renderMenu, getWorkspacePermissions } = setupMenu(parentId);
    let resolvePermissions!: (permissions: Record<string, boolean>) => void;
    getWorkspacePermissions.mockReturnValue(
      new Promise(resolve => {
        resolvePermissions = resolve;
      })
    );
    renderMenu();
    expectFileActionsDisabled(true);
    await waitFor(() =>
      expect(getWorkspacePermissions).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      resolvePermissions({ Workspace_Blobs_Write: true });
    });

    await waitFor(() => expectFileActionsDisabled(false));
  }
);

test.each([
  ['Word (.docx)', 'docx'],
  ['Excel (.xlsx)', 'xlsx'],
  ['PowerPoint (.pptx)', 'pptx'],
])(
  'selecting %s opens creation with the selected format',
  async (label, format) => {
    setupMenu().renderMenu();
    await waitFor(() => expectFileActionsDisabled(false));

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(screen.getByRole('dialog').textContent).toBe(format);
  }
);

test('the enabled upload action opens an unrestricted multi-file picker', async () => {
  const { container } = setupMenu().renderMenu();
  await waitFor(() => expectFileActionsDisabled(false));
  const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
  const click = vi.spyOn(picker, 'click').mockImplementation(() => {});

  fireEvent.click(screen.getByRole('button', { name: uploadLabel }));

  expect(click).toHaveBeenCalledTimes(1);
  expect(picker.multiple).toBe(true);
  expect(picker.getAttribute('accept')).toBeNull();
});

test('a loaded denial keeps native file creation and upload disabled', async () => {
  const { renderMenu, getWorkspacePermissions } = setupMenu();
  getWorkspacePermissions.mockResolvedValue({ Workspace_Blobs_Write: false });
  renderMenu();
  await waitFor(() => expect(getWorkspacePermissions).toHaveBeenCalledTimes(1));
  await act(async () => {
    await getWorkspacePermissions.mock.results[0].value;
  });

  expectFileActionsDisabled(true);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a read-only destination remains disabled after file permission loads', async () => {
  const { renderMenu, getWorkspacePermissions } = setupMenu('folder-1', false);
  renderMenu();
  await waitFor(() => expect(getWorkspacePermissions).toHaveBeenCalledTimes(1));
  await act(async () => {
    await getWorkspacePermissions.mock.results[0].value;
  });

  expectFileActionsDisabled(true);
  expect(
    (screen.getByRole('button', { name: 'Edgeless' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
