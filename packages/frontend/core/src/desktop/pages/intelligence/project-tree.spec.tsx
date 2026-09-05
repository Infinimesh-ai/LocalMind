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
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactElement,
} from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      variant?: string;
    }
  >) => <button {...props}>{children}</button>,
  IconButton: ({
    icon,
    size: _size,
    tooltip: _tooltip,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactElement;
    size?: string;
    tooltip?: string;
  }) => <button {...props}>{icon}</button>,
  Input: ({
    autoSelect: _autoSelect,
    onChange,
    onEnter: _onEnter,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    autoSelect?: boolean;
    onChange?: (value: string) => void;
    onEnter?: () => void;
  }) => (
    <input
      {...props}
      onChange={event => onChange?.(event.currentTarget.value)}
    />
  ),
  Loading: () => <div data-testid="loading" />,
  Menu: ({ children, items }: PropsWithChildren<{ items: ReactElement }>) => (
    <>
      {children}
      {items}
    </>
  ),
  MenuItem: ({
    children,
    prefixIcon: _prefixIcon,
    type: _type,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      prefixIcon?: ReactElement;
      type?: string;
    }
  >) => <button {...props}>{children}</button>,
}));

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => () => String(key),
      }
    ),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  DeleteTemporarilyIcon: () => <svg />,
  EditIcon: () => <svg />,
  FolderIcon: () => <svg />,
  MoreHorizontalIcon: () => <svg />,
  PageIcon: () => <svg />,
  PlusIcon: () => <svg />,
}));

import { ProjectTree } from './project-tree';
import type { WorkbenchProject } from './types';

afterEach(cleanup);

const project: WorkbenchProject = {
  id: 'project-1',
  createdByUserId: 'user-1',
  name: 'Project one',
  description: '',
  status: 'active',
  aiPolicy: 'read_only',
  role: 'owner',
  documents: [
    {
      workspaceId: 'workspace-b',
      docId: 'doc-later',
      title: 'Later document',
      groupId: null,
      sortOrder: 20,
      status: 'granted',
      requestedLevel: 'read',
      accessRequestId: null,
      addedByMe: true,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    {
      workspaceId: 'workspace-a',
      docId: 'doc-first',
      title: 'First document',
      groupId: null,
      sortOrder: 10,
      status: 'granted',
      requestedLevel: 'read',
      accessRequestId: null,
      addedByMe: true,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
  ],
  members: [],
  documentCount: 2,
  canManage: true,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
};

const renderTree = (
  overrides: Partial<Parameters<typeof ProjectTree>[0]> = {}
) =>
  render(
    <ProjectTree
      projects={[project]}
      selectedProjectId="project-1"
      loading={false}
      mutationsPending={false}
      canAddDocuments={true}
      onRefresh={vi.fn()}
      onSelectProject={vi.fn()}
      onSelectDocument={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onAddDocuments={vi.fn()}
      onRemoveDocument={vi.fn()}
      onManageCollaboration={vi.fn()}
      {...overrides}
    />
  );

describe('ProjectTree', () => {
  test('renders documents in tree order and returns the full source reference', () => {
    const onSelectDocument = vi.fn();
    renderTree({ onSelectDocument });

    const first = screen.getByRole('button', { name: 'First document' });
    const later = screen.getByRole('button', { name: 'Later document' });
    expect(
      first.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(first);
    expect(onSelectDocument).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        workspaceId: 'workspace-a',
        docId: 'doc-first',
      })
    );
  });

  test('trims and submits a new project name', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderTree({ onCreate });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.project.create',
      })
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        'com.affine.localmind.workbench.project.namePlaceholder'
      ),
      { target: { value: '  New project  ' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('New project');
    });
  });

  test('does not expose a route action for a redacted pending placeholder', () => {
    const onSelectDocument = vi.fn();
    renderTree({
      onSelectDocument,
      projects: [
        {
          ...project,
          documents: [
            {
              ...project.documents[0],
              docId: null,
              title: null,
              status: 'pending',
              accessRequestId: 'request-1',
              addedByMe: false,
            },
          ],
        },
      ],
    });

    const placeholder = screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.document.pending',
    });
    expect(placeholder.hasAttribute('disabled')).toBe(true);
    fireEvent.click(placeholder);
    expect(onSelectDocument).not.toHaveBeenCalled();
  });
});
