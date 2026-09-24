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
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { WorkbenchProject } from './types';

const state = vi.hoisted(() => ({
  gql: vi.fn(),
}));

const tokens = vi.hoisted(() => ({
  rename: Symbol('renameConversation'),
}));

vi.mock('@affine/component', () => ({
  Menu: ({ children, items }: PropsWithChildren<{ items: ReactNode }>) => (
    <div>
      {children}
      <div role="menu">{items}</div>
    </div>
  ),
  MenuItem: ({
    children,
    onSelect,
    prefixIcon,
    selected,
    ...props
  }: PropsWithChildren<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
      onSelect?: (event: Event) => void;
      prefixIcon?: ReactNode;
      selected?: boolean;
    }
  >) => (
    <button
      {...props}
      type="button"
      role="menuitem"
      aria-selected={selected}
      onClick={() => onSelect?.(new Event('select'))}
    >
      {prefixIcon}
      {children}
    </button>
  ),
  notify: { error: vi.fn() },
}));

vi.mock('@blocksuite/icons/rc', () => ({
  ArrowUpSmallIcon: () => <span aria-hidden="true">up</span>,
  FolderIcon: () => <span aria-hidden="true">folder</span>,
}));

vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: class GraphQLService {},
}));

vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: (error: unknown) => String(error),
}));

vi.mock('@affine/graphql', () => ({
  renameConversationMutation: tokens.rename,
}));

vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

vi.mock('@toeverything/infra', () => ({
  useService: () => ({ gql: state.gql }),
}));

vi.mock('./workbench-conversation', () => ({
  WorkbenchConversation: (props: {
    selectedProjectId: string;
    initialDraftText?: string;
    autoSendInitialDraft?: boolean;
    onSessionCreated?: (sessionId: string) => Promise<unknown> | unknown;
  }) => (
    <div data-testid="started-conversation">
      <span>{props.selectedProjectId}</span>
      <span>{props.initialDraftText}</span>
      <span>{String(props.autoSendInitialDraft)}</span>
      <button
        type="button"
        onClick={() => void props.onSessionCreated?.('session-1')}
      >
        Create session
      </button>
    </div>
  ),
}));

import { NewConversation } from './new-conversation';

const projects = ['project-1', 'project-2'].map(
  (id, index): WorkbenchProject => ({
    id,
    createdByUserId: 'user-1',
    name: `Project ${index + 1}`,
    description: '',
    status: 'active',
    aiPolicy: 'read_only',
    role: 'owner',
    members: [],
    canManage: true,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  })
);

describe('NewConversation', () => {
  beforeEach(() => {
    state.gql.mockReset().mockResolvedValue({});
  });
  afterEach(cleanup);

  test('keeps an unscoped draft without mounting chat or calling the server', () => {
    const onChanged = vi.fn();
    const onCreated = vi.fn();
    render(
      <NewConversation
        projects={projects}
        onChanged={onChanged}
        onCreated={onCreated}
      />
    );

    const draft = screen.getByPlaceholderText(
      'com.affine.localmind.workbench.v9.taskPlaceholder'
    );
    fireEvent.change(draft, { target: { value: 'Keep this private draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByRole('alert').textContent).toBe(
      'com.affine.localmind.workbench.v9.chooseProjectError'
    );
    expect((draft as HTMLTextAreaElement).value).toBe(
      'Keep this private draft'
    );
    expect(screen.queryByTestId('started-conversation')).toBeNull();
    expect(state.gql).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.chooseProject',
      })
    );
  });

  test('starts from a project chosen in the attached project selector', () => {
    render(
      <NewConversation
        projects={projects}
        onChanged={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Project 2' }));
    fireEvent.change(
      screen.getByPlaceholderText(
        'com.affine.localmind.workbench.v9.taskPlaceholder'
      ),
      { target: { value: 'First message' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByTestId('started-conversation').textContent).toContain(
      'project-2'
    );
  });

  test('sends on Enter while Shift+Enter and IME confirmation keep the draft', () => {
    render(
      <NewConversation
        projects={projects}
        initialProjectId="project-1"
        onChanged={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    const draft = screen.getByPlaceholderText(
      'com.affine.localmind.workbench.v9.taskPlaceholder'
    );
    fireEvent.change(draft, { target: { value: 'First message' } });
    fireEvent.keyDown(draft, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(draft, { key: 'Enter', isComposing: true });
    expect(screen.queryByTestId('started-conversation')).toBeNull();

    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(screen.getByTestId('started-conversation').textContent).toContain(
      'First message'
    );
  });

  test('preselects the newly chosen project and applies an optional manual title', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();
    render(
      <NewConversation
        projects={projects}
        initialProjectId="project-2"
        onChanged={onChanged}
        onCreated={onCreated}
      />
    );

    fireEvent.change(
      screen.getByLabelText('com.affine.localmind.workbench.v9.optionalTitle'),
      { target: { value: '  Manual title  ' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        'com.affine.localmind.workbench.v9.taskPlaceholder'
      ),
      { target: { value: '  First message  ' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByTestId('started-conversation').textContent).toContain(
      'project-2'
    );
    expect(screen.getByTestId('started-conversation').textContent).toContain(
      'First message'
    );
    expect(screen.getByTestId('started-conversation').textContent).toContain(
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => {
      expect(state.gql).toHaveBeenCalledWith({
        query: tokens.rename,
        variables: {
          sessionId: 'session-1',
          title: 'Manual title',
          expectedRevision: 1,
        },
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith('project-2', 'session-1');
    });
  });
});
