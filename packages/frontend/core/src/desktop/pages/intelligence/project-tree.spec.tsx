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

vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: vi.fn(),
}));
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
  AiIcon: () => <svg />,
  DeleteTemporarilyIcon: () => <svg />,
  EditIcon: () => <svg />,
  FolderIcon: () => <svg />,
  MoreHorizontalIcon: () => <svg />,
  PageIcon: () => <svg />,
  PinedIcon: () => <svg />,
  PlusIcon: () => <svg />,
}));

import { ProjectTree } from './project-tree';
import type { WorkbenchConversationCard, WorkbenchProject } from './types';

afterEach(cleanup);

const project: WorkbenchProject = {
  id: 'project-1',
  createdByUserId: 'user-1',
  name: 'Project one',
  description: '',
  status: 'active',
  aiPolicy: 'read_only',
  role: 'owner',
  members: [],
  canManage: true,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
};

const conversation: WorkbenchConversationCard = {
  sessionId: 'session-1',
  scopeType: 'project',
  pinned: false,
  title: 'Conversation one',
  titleRevision: 1,
  column: 'progress',
  attentionReasons: [],
  activeRunCount: 0,
  workOrderId: null,
  workOrderStatus: null,
  lastBusinessAt: '2026-09-22T00:00:00.000Z',
  version: 1,
  project: { id: project.id, name: project.name },
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
      onRefresh={vi.fn()}
      onSelectProject={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onManageCollaboration={vi.fn()}
      {...overrides}
    />
  );

describe('ProjectTree', () => {
  test('expands a Project without changing the main-area selection', () => {
    const onSelectProject = vi.fn();
    renderTree({
      selectedProjectId: null,
      conversations: [conversation],
      onSelectProject,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Project one' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Conversation one' })
    ).not.toBeNull();
  });

  test('opens a conversation and renames it with F2', async () => {
    const onOpenConversation = vi.fn();
    const onRenameConversation = vi.fn().mockResolvedValue(undefined);
    renderTree({
      conversations: [conversation],
      onOpenConversation,
      onRenameConversation,
    });

    const conversationButton = screen.getByRole('button', {
      name: 'Conversation one',
    });
    fireEvent.click(conversationButton);
    expect(onOpenConversation).toHaveBeenCalledWith(conversation);

    fireEvent.keyDown(conversationButton, { key: 'F2' });
    const renameInput = screen.getByDisplayValue('Conversation one');
    fireEvent.change(renameInput, { target: { value: '  Renamed session  ' } });
    fireEvent.blur(renameInput);

    await waitFor(() => {
      expect(onRenameConversation).toHaveBeenCalledWith(
        conversation,
        'Renamed session'
      );
    });
  });

  test('places a pinned conversation first and marks it for highlighting', () => {
    const pinned = {
      ...conversation,
      sessionId: 'session-pinned',
      title: 'Older pinned conversation',
      pinned: true,
      lastBusinessAt: '2025-01-01T00:00:00.000Z',
    };
    renderTree({
      conversations: [conversation, pinned],
      selectedSessionId: conversation.sessionId,
    });

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[data-pinned]')
    );
    expect(buttons.map(button => button.textContent)).toEqual([
      'Older pinned conversation',
      'Conversation one',
    ]);
    expect(buttons[0].dataset.pinned).toBe('true');
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[1].dataset.pinned).toBe('false');
    expect(buttons[1].getAttribute('aria-current')).toBe('page');
  });

  test('renders conversation paging, retry, and loading states', () => {
    const onLoadMoreConversations = vi.fn();
    const { rerender } = renderTree({
      conversations: [conversation],
      conversationsHasMore: true,
      onLoadMoreConversations,
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.loadMoreConversations',
      })
    );
    expect(onLoadMoreConversations).toHaveBeenCalledTimes(1);

    const onRefreshConversations = vi.fn();
    rerender(
      <ProjectTree
        projects={[project]}
        selectedProjectId="project-1"
        loading={false}
        conversationsError="Conversation load failed"
        mutationsPending={false}
        onRefresh={vi.fn()}
        onRefreshConversations={onRefreshConversations}
        onSelectProject={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onArchive={vi.fn()}
        onManageCollaboration={vi.fn()}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Conversation load failed'
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.retry',
      })
    );
    expect(onRefreshConversations).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectTree
        projects={[project]}
        selectedProjectId="project-1"
        loading={false}
        conversationsLoading
        mutationsPending={false}
        onRefresh={vi.fn()}
        onSelectProject={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onArchive={vi.fn()}
        onManageCollaboration={vi.fn()}
      />
    );
    expect(
      screen.getByText('com.affine.localmind.workbench.v9.loadingConversations')
    ).not.toBeNull();
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
});
