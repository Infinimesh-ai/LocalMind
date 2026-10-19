/**
 * @vitest-environment happy-dom
 */

import type * as AffineComponentModule from '@affine/component';
import { readDeckSources } from '@affine/core/modules/report-decks/source-handoff';
import type * as AffineGraphQLModule from '@affine/graphql';
import type * as AffineI18nModule from '@affine/i18n';
import type * as BlockSuiteIconsModule from '@blocksuite/icons/rc';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type * as InfraModule from '@toeverything/infra';
import type {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactElement,
  ReactNode,
} from 'react';
import { useEffect } from 'react';
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { type Cache, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as ProjectBrowserModule from './project-browser';

const state = vi.hoisted(() => ({
  graphEdges: [] as Array<Record<string, unknown>>,
  accountId: 'user-1' as string | null,
  projectQueryCaches: [] as Cache[],
  conversationMounts: 0,
  conversationUnmounts: 0,
  frameworkScopes: [] as unknown[],
  gql: vi.fn(),
  layoutReady: vi.fn(),
  notifyError: vi.fn(),
  openWorkspaceDialog: vi.fn(),
  confirmUnsaved: vi.fn(async () => true),
  legacyReports: false,
  reportDeckAvailable: true,
  projectAvailable: true,
  projectsLoading: false,
  projectsResolved: true,
  projectsError: undefined as Error | undefined,
  quickSearchToggle: vi.fn(),
  project: {
    id: 'project-1',
    createdByUserId: 'user-1',
    name: 'Project one',
    description: '',
    status: 'active',
    aiPolicy: 'read_only',
    role: 'owner',
    members: [
      {
        userId: 'user-1',
        name: 'Owner',
        email: 'owner@example.com',
        avatarUrl: null,
        role: 'owner',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    ],
    canManage: true,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  },
  query: vi.fn(),
  refreshProjects: vi.fn(),
  refreshTaskPanel: vi.fn(),
  revalidateWorkspaces: vi.fn(),
  workspacesRevalidating: false,
  workspaceSelector: vi.fn(),
  sourcePeek: vi.fn(),
  workspaces: [
    { id: 'workspace-a', flavour: 'cloud' },
    { id: 'workspace-b', flavour: 'cloud' },
  ],
}));

const tokens = vi.hoisted(() => ({
  // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the server account stream.
  account$: Symbol('account'),
  GraphQLService: class GraphQLService {},
  DefaultServerService: class DefaultServerService {},
  NotificationCountService: class NotificationCountService {},
  WorkspaceServerService: class WorkspaceServerService {},
  QuickSearchService: class QuickSearchService {},
  WorkspaceDialogService: class WorkspaceDialogService {},
  GlobalDialogService: class GlobalDialogService {},
  WorkspacesService: class WorkspacesService {},
  projectsQuery: Symbol('projectsQuery'),
  resourceQuery: Symbol('resourceQuery'),
  resourcePathQuery: Symbol('resourcePathQuery'),
  tasksQuery: Symbol('tasksQuery'),
  graphQuery: Symbol('graphQuery'),
  confirmBlockerSuggestionMutation: Symbol('confirmBlockerSuggestion'),
  createBlockerMutation: Symbol('createBlocker'),
  updateProjectMutation: Symbol('updateProject'),
  /* eslint-disable rxjs/finnish -- Symbols identify mocked observable sources. */
  workspaces$: Symbol('workspaces$'),
  revalidating$: Symbol('revalidating$'),
  /* eslint-enable rxjs/finnish */
}));

vi.mock('@affine/core/components/report-deck-entry', () => ({
  useLegacyProjectReportsEnabled: () => state.legacyReports,
  useReportDeckEntryAvailable: () => state.reportDeckAvailable,
  useOpenReportDeck: () => vi.fn(),
}));

vi.mock('@affine/core/modules/project-resources/edit-guard', () => ({
  ProjectEditorGuard: ({ children }: PropsWithChildren) => children,
  useProjectUnsavedConfirmation: () => state.confirmUnsaved,
}));

vi.mock('@affine/component', async importOriginal => ({
  ...(await importOriginal<typeof AffineComponentModule>()),
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
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
  Loading: () => <div data-testid="loading" />,
  notify: {
    error: state.notifyError,
    success: vi.fn(),
    warning: vi.fn(),
  },
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
}));

vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (
    request: { query: unknown; variables: unknown },
    config: unknown
  ) => {
    if (!request) return { mutate: state.refreshProjects };
    state.query(request, config);
    if (request.query === tokens.graphQuery)
      return {
        data: {
          currentUser: {
            copilot: {
              myCollaborationGraph: {
                nodes: [],
                edges: state.graphEdges,
                truncated: false,
              },
            },
          },
        },
        isLoading: false,
        mutate: state.refreshProjects,
      };
    if (request.query === tokens.resourceQuery)
      return {
        data: {
          projectResource: {
            id: 'native-doc',
            title: 'Native document',
            kind: 'page',
            parentId: null,
          },
        },
        mutate: state.refreshProjects,
      };
    if (request.query === tokens.resourcePathQuery)
      return {
        data: {
          projectResourcePath: [{ id: 'native-doc', title: 'Native document' }],
        },
        mutate: state.refreshProjects,
      };
    if (request.query === tokens.projectsQuery) {
      if (!state.projectsResolved) {
        return {
          data: undefined,
          error: undefined,
          isLoading: false,
          mutate: state.refreshProjects,
        };
      }
      return {
        data: {
          currentUser: {
            copilot: {
              contextProjects: state.projectAvailable ? [state.project] : [],
            },
          },
        },
        error: state.projectsError,
        isLoading: state.projectsLoading,
        mutate: state.refreshProjects,
      };
    }
    return {
      data: {
        currentUser: {
          copilot: {
            workbenchTaskPanel: {
              todo: { capped: false, items: [] },
              inProgress: { capped: false, items: [] },
              done: { capped: false, items: [] },
            },
          },
        },
      },
      error: undefined,
      isLoading: false,
      mutate: state.refreshTaskPanel,
    };
  },
}));

vi.mock('@affine/core/components/hooks/use-workspace', () => ({
  useWorkspace: (metadata: { id: string } | null) =>
    metadata
      ? {
          id: metadata.id,
          scope: {
            get: (token: unknown) => {
              if (token === tokens.WorkspaceServerService) {
                return { server: { scope: `server-scope:${metadata.id}` } };
              }
              throw new Error('Unexpected scoped service token');
            },
          },
          docCollection: {
            meta: {
              getDocMeta: (docId: string) => ({
                title: docId === 'doc-new' ? 'New document' : docId,
              }),
            },
          },
        }
      : null,
}));

vi.mock('@affine/core/components/providers/swr-config-provider', () => ({
  SWRConfigProvider: ({ children }: PropsWithChildren) => {
    const { cache } = useSWRConfig();
    useEffect(() => {
      state.projectQueryCaches.push(cache);
    }, [cache]);
    return children;
  },
}));

vi.mock('@affine/core/components/workspace-selector', () => ({
  WorkspaceSelector: (props: {
    workspaceMetadata: { id: string };
    showSyncStatus?: boolean;
  }) => {
    state.workspaceSelector(props);
    return <div data-testid="host-workspace">{props.workspaceMetadata.id}</div>;
  },
}));

vi.mock('@affine/core/components/root-app-sidebar/notification-button', () => ({
  NotificationButton: () => <button type="button">Notifications</button>,
}));

vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: vi.fn(),
}));
vi.mock('@affine/core/modules/quicksearch', () => ({
  QuickSearchService: tokens.QuickSearchService,
  ProjectsQuickSearchSession: class {},
  QuickSearchContainer: () => null,
}));
vi.mock('./project-shell-settings', () => ({
  ProjectShellSettings: ({
    open,
    projectId,
    collaboration,
  }: {
    open: boolean;
    projectId?: string;
    collaboration?: { project: { id: string } };
  }) =>
    open ? (
      <div
        data-testid="project-settings"
        data-project-id={projectId}
        data-collaboration-id={collaboration?.project.id}
      />
    ) : null,
}));
vi.mock('./project-summary', () => ({ ProjectSummary: () => null }));
vi.mock('./project-publications', () => ({ ProjectPublications: () => null }));
vi.mock('@affine/core/modules/notification', () => ({
  NotificationCountService: tokens.NotificationCountService,
}));

vi.mock('@affine/core/components/root-app-sidebar/user-info', () => ({
  default: () => <div>User</div>,
}));

vi.mock('@affine/core/desktop/dialogs', () => ({
  WorkspaceDialogs: () => null,
}));

vi.mock('@affine/core/modules/app-sidebar/views', () => ({
  MenuItem: ({
    children,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: tokens.GraphQLService,
  DefaultServerService: tokens.DefaultServerService,
  WorkspaceServerService: tokens.WorkspaceServerService,
}));

vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: tokens.WorkspaceDialogService,
  GlobalDialogService: tokens.GlobalDialogService,
}));

vi.mock('@affine/core/modules/desktop-api', () => ({
  useAppLayoutReady: state.layoutReady,
}));

vi.mock('@affine/core/modules/app-tabs-header', () => ({
  AppTabsHeader: () => <div data-testid="desktop-tabs-header" />,
}));

vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class WorkbenchService {},
  ViewTitle: ({ title }: { title: string }) => (
    <output data-testid="project-tab-title">{title}</output>
  ),
  ViewIcon: ({ icon }: { icon: string }) => (
    <output data-testid="project-tab-icon">{icon}</output>
  ),
}));

vi.mock('@affine/core/modules/quicksearch/services/cmdk', () => ({
  CMDKQuickSearchService: tokens.QuickSearchService,
}));

vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class WorkspaceService {},
  WorkspacesService: tokens.WorkspacesService,
}));

vi.mock('@affine/error', () => ({
  UserFriendlyError: { fromAny: (error: Error) => error },
}));

vi.mock('@affine/graphql', async importOriginal => ({
  ...(await importOriginal<typeof AffineGraphQLModule>()),
  projectResourceQuery: tokens.resourceQuery,
  projectResourcePathQuery: tokens.resourcePathQuery,
  acceptCopilotProjectInvitationMutation: Symbol('acceptInvitation'),
  approveCopilotAccessRequestMutation: Symbol('approveAccess'),
  controlCopilotTaskMutation: Symbol('controlTask'),
  confirmCopilotBlockerSuggestionMutation:
    tokens.confirmBlockerSuggestionMutation,
  copilotContextProjectCreateMutation: Symbol('createProject'),
  copilotContextProjectUpdateMutation: tokens.updateProjectMutation,
  copilotWorkbenchProjectsGetQuery: tokens.projectsQuery,
  copilotWorkbenchTaskPanelGetQuery: tokens.tasksQuery,
  copilotCollaborationGraphGetQuery: tokens.graphQuery,
  createCopilotBlockerMutation: tokens.createBlockerMutation,
  declineCopilotProjectInvitationMutation: Symbol('declineInvitation'),
  leaveCopilotContextProjectMutation: Symbol('leaveProject'),
  rejectCopilotAccessRequestMutation: Symbol('rejectAccess'),
  removeCopilotContextProjectMemberMutation: Symbol('removeMember'),
  sendCopilotProjectInvitationMutation: Symbol('sendInvitation'),
  transferCopilotContextProjectOwnershipMutation: Symbol('transferOwnership'),
  withdrawCopilotAccessRequestMutation: Symbol('withdrawAccess'),
  withdrawCopilotProjectInvitationMutation: Symbol('withdrawInvitation'),
}));

vi.mock('@affine/i18n', async importOriginal => ({
  ...(await importOriginal<typeof AffineI18nModule>()),
  getOrCreateI18n: () => ({ t: (key: string) => key }),
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => () => String(key),
      }
    ),
}));

vi.mock('@blocksuite/icons/rc', async importOriginal => ({
  ...(await importOriginal<typeof BlockSuiteIconsModule>()),
  AiIcon: () => <svg />,
  FolderIcon: () => <svg />,
  ArrowLeftSmallIcon: () => <svg />,
  ArrowRightSmallIcon: () => <svg />,
  CloseIcon: () => <svg />,
  SearchIcon: () => <svg />,
  SettingsIcon: () => <svg />,
  SidebarIcon: () => <svg />,
  WarningIcon: () => <svg />,
}));

vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof InfraModule>()),
  useFramework: () => ({ createEntity: vi.fn() }),
  FrameworkScope: ({
    children,
    scope,
  }: PropsWithChildren<{ scope?: unknown }>) => {
    state.frameworkScopes.push(scope);
    return children;
  },
  useLiveData: (source: unknown) => {
    if (source === tokens.account$)
      return state.accountId ? { id: state.accountId } : null;
    if (source === tokens.workspaces$) return state.workspaces;
    if (source === tokens.revalidating$) return state.workspacesRevalidating;
    return undefined;
  },
  useService: (token: unknown) => {
    if (token === tokens.WorkspacesService) {
      return {
        list: {
          /* eslint-disable rxjs/finnish -- Mock keys mirror the WorkspacesService API. */
          workspaces$: tokens.workspaces$,
          isRevalidating$: tokens.revalidating$,
          /* eslint-enable rxjs/finnish */
          revalidate: state.revalidateWorkspaces,
        },
      };
    }
    if (token === tokens.GraphQLService) return { gql: state.gql };
    if (token === tokens.QuickSearchService)
      return { quickSearch: { show: state.quickSearchToggle, hide: vi.fn() } };
    if (token === tokens.DefaultServerService) {
      return {
        server: {
          id: 'local-server',
          scope: 'default-server-scope',
          // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the server account stream.
          account$: tokens.account$,
        },
      };
    }
    if (token === tokens.NotificationCountService) {
      return {
        // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the NotificationCountService API.
        revision$: { subscribe: () => ({ unsubscribe: vi.fn() }) },
      };
    }
    if (token === tokens.WorkspaceDialogService) {
      return { open: state.openWorkspaceDialog };
    }
    if (token === tokens.GlobalDialogService) {
      return { open: state.openWorkspaceDialog };
    }
    throw new Error('Unexpected service token');
  },
  useServiceOptional: (token: unknown) => {
    if (token === tokens.QuickSearchService) {
      return state.workspaces.length
        ? { toggle: state.quickSearchToggle }
        : null;
    }
    if (token === tokens.WorkspaceDialogService) {
      return state.workspaces.length
        ? { open: state.openWorkspaceDialog }
        : null;
    }
    return null;
  },
}));

vi.mock('./project-resource-preview', () => ({
  ProjectResourcePreview: ({
    onClose,
    onToggleFullscreen,
  }: {
    onClose: () => void;
    onToggleFullscreen: () => void;
  }) => (
    <div data-testid="project-resource-preview">
      <button onClick={onClose}>Close resource</button>
      <button onClick={onToggleFullscreen}>Fullscreen</button>
    </div>
  ),
}));
vi.mock('./project-files', () => ({
  ProjectFiles: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <div data-testid="project-main-files">
      <button
        data-project-resource-id="native-doc"
        onClick={() => onOpen('native-doc')}
      >
        Open native resource
      </button>
    </div>
  ),
}));

vi.mock('./project-browser', async importOriginal => {
  const actual = await importOriginal<typeof ProjectBrowserModule>();
  return {
    ...actual,
    // The project folder browser has its own spec; the shell only needs its
    // open contract. The projects overview (no project) stays real.
    ProjectBrowser: (
      props: Parameters<typeof ProjectBrowserModule.ProjectBrowser>[0]
    ) =>
      props.projectId &&
      props.projects.some(project => project.id === props.projectId) ? (
        <div
          data-testid="project-main-files"
          data-folder-id={String(props.folderId)}
        >
          <button
            data-project-resource-id="native-doc"
            onClick={() =>
              props.onOpen(props.projectId as string, 'native-doc')
            }
          >
            Open native resource
          </button>
          <button onClick={() => props.onOpen('project-2', 'other-doc')}>
            Open other project resource
          </button>
        </div>
      ) : (
        <actual.ProjectBrowser {...props} />
      ),
  };
});

vi.mock('./new-conversation', () => ({
  NewConversation: () => <div data-testid="new-conversation" />,
}));

vi.mock('./work-order-panel', () => ({
  WorkOrderPanel: ({
    onLoaded,
    onDraftStateChange,
  }: {
    onLoaded?: (order: {
      viewerRole: string;
      ownSessionId: string;
      title: string;
      status: string;
    }) => void;
    onDraftStateChange?: (workOrderId: string, blocked: boolean) => void;
  }) => {
    useEffect(() => {
      onLoaded?.({
        viewerRole: 'recipient',
        ownSessionId: 'work-order-session',
        title: 'Review report',
        status: 'active',
      });
      onDraftStateChange?.('work-order-1', false);
    }, [onLoaded, onDraftStateChange]);
    return (
      <div data-testid="work-order-panel">
        <button onClick={() => onDraftStateChange?.('work-order-1', true)}>
          Edit delivery draft
        </button>
        <button onClick={() => onDraftStateChange?.('work-order-1', false)}>
          Save delivery draft
        </button>
      </div>
    );
  },
}));

vi.mock('./work-order-conversation', () => ({
  WorkOrderConversation: ({
    deliveryDraftBlocked,
  }: {
    deliveryDraftBlocked: boolean;
  }) => (
    <output data-testid="work-order-confirmation-blocked">
      {String(deliveryDraftBlocked)}
    </output>
  ),
}));

vi.mock('@affine/core/components/project-file-request/detail', () => ({
  ProjectFileRequestModal: () => null,
}));

vi.mock('./project-tree', () => ({
  ProjectTree: ({
    projects,
    loading,
    error,
    onRefresh,
    onSelectProject,
    onManageCollaboration,
    onOpenReports,
  }: {
    projects: Array<{ id: string; status: string }>;
    loading: boolean;
    error?: string;
    onRefresh: () => void;
    onSelectProject: (projectId: string | null) => void;
    onManageCollaboration: (project: { id: string; status: string }) => void;
    onOpenReports?: (project: { id: string; status: string }) => void;
  }) => {
    const activeProjects = projects.filter(
      project => project.status === 'active'
    );
    return (
      <>
        <button type="button" onClick={() => onSelectProject(null)}>
          All projects
        </button>
        {loading ? <div role="status">Project tree loading</div> : null}
        {error ? (
          <div role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRefresh}>
              com.affine.localmind.workbench.retry
            </button>
          </div>
        ) : null}
        {!loading && !error && activeProjects.length === 0 ? (
          <span>com.affine.localmind.workbench.projects.emptyTitle</span>
        ) : null}
        {activeProjects.length ? (
          <>
            <button type="button" onClick={() => onSelectProject('project-1')}>
              Select project
            </button>
            <button
              type="button"
              onClick={() => onManageCollaboration(activeProjects[0])}
            >
              Manage project settings
            </button>
            {onOpenReports ? (
              <button
                type="button"
                onClick={() => onOpenReports(activeProjects[0])}
              >
                Open project reports
              </button>
            ) : null}
          </>
        ) : null}
      </>
    );
  },
}));

vi.mock('./task-panel', () => ({
  TaskPanel: ({
    onOpenTask,
    onViewAll,
    onCreateBlocker,
    selectedProjectId,
  }: {
    onOpenTask: (task: object) => void;
    onViewAll: (segment: 'todo' | 'in-progress' | 'done') => void;
    onCreateBlocker: (
      projectId: string,
      blocker: {
        title: string;
        type: 'wait_reply';
        waitingOn: string;
        dueAt: string | null;
      }
    ) => Promise<boolean>;
    selectedProjectId: string | null;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onOpenTask({
            id: 'workspace-b-failed',
            workspaceId: 'workspace-b',
            status: 'failed',
          })
        }
      >
        Open cross-workspace task
      </button>
      <button type="button" onClick={() => onViewAll('todo')}>
        View all Todo
      </button>
      <button type="button" onClick={() => onViewAll('in-progress')}>
        View all In progress
      </button>
      <button type="button" onClick={() => onViewAll('done')}>
        View all Done
      </button>
      {selectedProjectId ? (
        <button
          type="button"
          onClick={() =>
            void onCreateBlocker(selectedProjectId, {
              title: 'Waiting for reply',
              type: 'wait_reply',
              waitingOn: 'Vendor',
              dueAt: null,
            })
          }
        >
          Create blocker from panel
        </button>
      ) : null}
    </>
  ),
}));

vi.mock('./workbench-conversation', () => ({
  WorkbenchConversation: ({
    onConfirmBlockerSuggestion,
    onPinChanged,
    headerActions,
  }: {
    headerActions?: ReactNode;
    onPinChanged?: () => void;
    onConfirmBlockerSuggestion?: (suggestion: {
      aiSuggestionId: string;
      confirmationProof: string;
      projectId: string;
      title: string;
      type: 'wait_reply';
      waitingOn: string;
      dueAt: string | null;
      origin: 'ai_suggested';
      confirmationRequired: true;
    }) => Promise<void>;
  }) => {
    useEffect(() => {
      state.conversationMounts += 1;
      return () => {
        state.conversationUnmounts += 1;
      };
    }, []);
    return (
      <div data-testid="conversation">
        {headerActions}
        <button type="button" onClick={onPinChanged}>
          Pin conversation
        </button>
        {onConfirmBlockerSuggestion ? (
          <>
            <button
              type="button"
              onClick={() => {
                void onConfirmBlockerSuggestion({
                  aiSuggestionId: 'b3b94f5e-936d-4d0e-875a-a0475f612f80',
                  confirmationProof: 'signed-proof-project-1',
                  projectId: 'project-1',
                  title: 'Waiting for AI suggested reply',
                  type: 'wait_reply',
                  waitingOn: 'Customer',
                  dueAt: '2026-09-05T17:00:00.000Z',
                  origin: 'ai_suggested',
                  confirmationRequired: true,
                }).catch(() => {});
              }}
            >
              Confirm AI blocker suggestion
            </button>
            <button
              type="button"
              onClick={() => {
                void onConfirmBlockerSuggestion({
                  aiSuggestionId: '2822f003-634d-4692-9d0c-16128d2fbb87',
                  confirmationProof: 'signed-proof-project-2',
                  projectId: 'project-2',
                  title: 'Old project suggestion',
                  type: 'wait_reply',
                  waitingOn: 'Customer',
                  dueAt: null,
                  origin: 'ai_suggested',
                  confirmationRequired: true,
                }).catch(() => {});
              }}
            >
              Confirm other project suggestion
            </button>
          </>
        ) : null}
      </div>
    );
  },
}));

import { Component as ProjectComponent } from './index';

const Component = () => (
  <Routes>
    <Route path="/project/conversations/new" element={<ProjectComponent />} />
    <Route
      path="/project/work-orders/:workOrderId"
      element={<ProjectComponent />}
    />
    <Route path="/project/:projectId?" element={<ProjectComponent />} />
    <Route
      path="/project/:projectId/conversations/:sessionId"
      element={<ProjectComponent />}
    />
    <Route
      path="/project/:projectId/resources/:resourceId"
      element={<ProjectComponent />}
    />
    <Route path="*" element={<ProjectComponent />} />
  </Routes>
);

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
};

const renderWorkbench = (route = '/project/project-1') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Component />
      <LocationProbe />
    </MemoryRouter>
  );

describe('Intelligence workbench shell', () => {
  test('retains the current account state but isolates project cache and conversations after identity changes', () => {
    const view = renderWorkbench('/project/project-1');
    state.projectQueryCaches[0].set('private-first-account', {
      data: 'private',
    });
    const rerender = () =>
      view.rerender(
        <MemoryRouter initialEntries={['/project/project-1']}>
          <Component />
          <LocationProbe />
        </MemoryRouter>
      );
    rerender();
    expect(state.projectQueryCaches).toHaveLength(1);
    expect(state.conversationMounts).toBe(1);
    expect(state.conversationUnmounts).toBe(0);
    state.accountId = 'user-2';
    rerender();
    expect(state.projectQueryCaches).toHaveLength(2);
    expect(
      state.projectQueryCaches[1].get('private-first-account')
    ).toBeUndefined();
    expect(state.conversationMounts).toBe(2);
    expect(state.conversationUnmounts).toBe(1);
    state.accountId = null;
    rerender();
    expect(state.projectQueryCaches).toHaveLength(3);
    expect(
      state.projectQueryCaches[2].get('private-first-account')
    ).toBeUndefined();
    expect(state.conversationUnmounts).toBe(2);
  });

  test('replaces the previous desktop tab metadata with the current project or resource title', () => {
    const isElectron = BUILD_CONFIG.isElectron;
    try {
      BUILD_CONFIG.isElectron = true;
      const overview = renderWorkbench('/project');
      expect(screen.getByTestId('project-tab-title').textContent).toBe(
        'com.affine.localmind.workbench.v9.overview'
      );
      expect(screen.getByTestId('project-tab-icon').textContent).toBe('ai');
      overview.unmount();
      const project = renderWorkbench('/project/project-1');
      expect(screen.getByTestId('project-tab-title').textContent).toBe(
        'Project one'
      );
      project.unmount();
      renderWorkbench('/project/project-1/resources/native-doc');
      expect(screen.getByTestId('project-tab-title').textContent).toBe(
        'Native document'
      );
    } finally {
      BUILD_CONFIG.isElectron = isElectron;
    }
  });

  test('reserves a desktop titlebar on project routes without adding it to the browser', () => {
    const isElectron = BUILD_CONFIG.isElectron;
    try {
      BUILD_CONFIG.isElectron = false;
      const browser = renderWorkbench('/project');
      expect(screen.queryByTestId('project-desktop-titlebar')).toBeNull();
      browser.unmount();

      BUILD_CONFIG.isElectron = true;
      renderWorkbench('/project');
      expect(
        screen
          .getByTestId('project-desktop-titlebar')
          .contains(screen.getByTestId('desktop-tabs-header'))
      ).toBe(true);
      expect(screen.getByTestId('intelligence-workbench')).toBeTruthy();
      expect(screen.queryByTestId('host-workspace')).toBeNull();
    } finally {
      BUILD_CONFIG.isElectron = isElectron;
    }
  });

  beforeEach(() => {
    state.graphEdges = [];
    state.accountId = 'user-1';
    state.projectQueryCaches.length = 0;
    state.conversationMounts = 0;
    state.conversationUnmounts = 0;
    state.frameworkScopes.length = 0;
    state.gql.mockReset();
    state.gql.mockResolvedValue({});
    state.layoutReady.mockReset();
    state.notifyError.mockReset();
    state.openWorkspaceDialog.mockReset();
    state.confirmUnsaved.mockReset().mockResolvedValue(true);
    state.legacyReports = false;
    state.reportDeckAvailable = true;
    state.projectAvailable = true;
    state.projectsLoading = false;
    state.projectsResolved = true;
    state.projectsError = undefined;
    state.project.status = 'active';
    state.openWorkspaceDialog.mockImplementation(
      (_name, _options, onSelect: (ids: string[]) => void) => {
        onSelect?.(['doc-new']);
      }
    );
    state.query.mockReset();
    state.quickSearchToggle.mockReset();
    state.refreshProjects.mockReset();
    state.refreshTaskPanel.mockReset();
    state.revalidateWorkspaces.mockReset();
    state.workspaceSelector.mockReset();
    state.sourcePeek.mockReset();
    state.workspaces = [
      { id: 'workspace-a', flavour: 'cloud' },
      { id: 'workspace-b', flavour: 'cloud' },
    ];
    state.workspacesRevalidating = false;
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(cleanup);

  test('resets an inaccessible overview filter only after the authorized project list resolves', async () => {
    const view = renderWorkbench('/project');
    const filter = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'com.affine.localmind.workbench.v9.projectFilter',
    });
    fireEvent.change(filter, { target: { value: 'project-1' } });
    expect(filter.value).toBe('project-1');
    state.projectsResolved = false;
    view.rerender(
      <MemoryRouter initialEntries={['/project']}>
        <Component />
        <LocationProbe />
      </MemoryRouter>
    );
    expect(state.notifyError).not.toHaveBeenCalled();
    state.projectsResolved = true;
    state.projectAvailable = false;
    view.rerender(
      <MemoryRouter initialEntries={['/project']}>
        <Component />
        <LocationProbe />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(state.notifyError).toHaveBeenCalledWith({
        title: 'com.affine.localmind.project-error.unavailable',
      })
    );
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'com.affine.localmind.workbench.v9.projectFilter',
      }).value
    ).toBe('');
  });

  test('a direct resource entry creates a Project parent for browser Back without writing', async () => {
    const original = window.history.state;
    const originalUrl = window.location.href;
    window.history.replaceState(
      { idx: 0 },
      '',
      '/project/project-1/resources/native-doc?source=share'
    );
    const Back = () => {
      const navigate = useNavigate();
      const location = useLocation();
      return (
        <button
          onClick={() => navigate(-1)}
          disabled={!location.state?.projectHistorySeeded}
        >
          Browser back
        </button>
      );
    };
    try {
      render(
        <BrowserRouter>
          <Component />
          <LocationProbe />
          <Back />
        </BrowserRouter>
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Browser back' })
        ).toHaveProperty('disabled', false)
      );
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/resources/native-doc?source=share'
      );
      fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          '/project/project-1'
        )
      );
      expect(state.gql).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(original, '', originalUrl);
    }
  });

  test('shows the personal board and opens a project from the navigation', () => {
    renderWorkbench('/project');

    expect(screen.queryByTestId('conversation')).toBeNull();
    expect(state.conversationMounts).toBe(0);
    expect(state.query).toHaveBeenCalledWith(
      {
        query: tokens.tasksQuery,
        variables: { projectId: undefined },
      },
      expect.anything()
    );
    expect(
      screen.getByRole('button', { name: 'View all Todo' })
    ).not.toBeNull();
    expect(
      screen.getByRole('heading', {
        name: 'com.affine.localmind.workbench.v9.overview',
      })
    ).not.toBeNull();
    // v10 overview path line: hub / current project filter.
    expect(
      screen.queryByText(
        'com.affine.localmind.workbench.v9.overview / com.affine.localmind.workbench.v9.allProjects'
      )
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select project' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1'
    );
    expect(screen.queryByTestId('conversation')).not.toBeNull();
    expect(state.conversationMounts).toBe(1);
    // No work order belongs to this conversation, so there is no right box.
    expect(
      screen.queryByRole('region', {
        name: 'com.affine.localmind.workbench.v9.contextPanel',
      })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(screen.queryByTestId('conversation')).toBeNull();
    expect(state.conversationUnmounts).toBe(1);
    expect(screen.getByTestId('location').textContent).toBe('/project');
    expect(
      screen.getByRole('heading', {
        name: 'com.affine.localmind.workbench.v9.overview',
      })
    ).not.toBeNull();
  });

  test('opens project documents from the rail, selects a project and returns from an editor to its files', async () => {
    renderWorkbench('/project');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project?view=files'
      )
    );
    expect(
      screen.getByRole('region', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
    ).not.toBeNull();
    // The documents view swaps the project hub tree for the Finder sidebar.
    expect(screen.queryByRole('button', { name: 'Select project' })).toBeNull();
    const locations = screen.getByRole('navigation', {
      name: 'com.affine.localmind.project-browser.sidebar.label',
    });
    fireEvent.click(
      within(locations).getByRole('button', { name: 'Project one' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1?view=files'
      )
    );
    expect(screen.queryByTestId('conversation')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open native resource' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/resources/native-doc?view=files'
      )
    );
    expect(screen.queryByTestId('conversation')).toBeNull();
    // The browser stays mounted (hidden) behind the editor.
    expect(
      screen.getByTestId('project-main-files').closest('[hidden]')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1?view=files'
      )
    );
    expect(
      screen.getByTestId('project-main-files').closest('[hidden]')
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.projects',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/project')
    );
    expect(
      screen.getByRole('heading', {
        name: 'com.affine.localmind.workbench.v9.overview',
      })
    ).not.toBeNull();
  });

  test('does not leave a conversation for project documents when unsaved edits block navigation', async () => {
    renderWorkbench('/project/project-1/conversations/session-1');
    state.confirmUnsaved.mockResolvedValueOnce(false);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
    );
    await waitFor(() => expect(state.confirmUnsaved).toHaveBeenCalledOnce());
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/conversations/session-1'
    );
    expect(screen.getByTestId('conversation')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1?view=files'
      )
    );
    expect(screen.getByTestId('project-main-files')).not.toBeNull();
    expect(screen.queryByTestId('conversation')).toBeNull();
  });

  test.each(['loading', 'error', 'empty', 'archived'] as const)(
    'shows the %s state in the project documents index',
    async status => {
      state.projectsLoading = status === 'loading';
      state.projectAvailable = status !== 'empty';
      if (status === 'archived') state.project.status = 'archived';
      if (status === 'error')
        state.projectsError = new Error('Network unavailable');
      state.refreshProjects.mockResolvedValue(undefined);
      renderWorkbench('/project?view=files');
      const documents = within(
        screen.getByRole('region', {
          name: 'com.affine.localmind.workbench.systemRail.docs',
        })
      );
      expect(
        documents.queryByRole('button', { name: 'Project one' })
      ).toBeNull();
      if (status === 'loading')
        expect(documents.getByRole('status')).not.toBeNull();
      else if (status === 'error') {
        expect(documents.getByRole('alert')).not.toBeNull();
        fireEvent.click(
          documents.getByRole('button', {
            name: 'com.affine.localmind.project-files.retry',
          })
        );
        await waitFor(() =>
          expect(state.refreshProjects).toHaveBeenCalledOnce()
        );
      } else
        expect(
          documents.getByText(
            'com.affine.localmind.workbench.projects.emptyTitle'
          )
        ).not.toBeNull();
    }
  );

  test.each([
    { saved: { navigation: 280, documentsNavigation: 200 }, expected: 280 },
    { saved: { documentsNavigation: 216 }, expected: 216 },
    {
      saved: { navigation: 'invalid', documentsNavigation: 224 },
      expected: 224,
    },
    { saved: { navigation: -1, documentsNavigation: null }, expected: 240 },
  ])(
    'shares the saved sidebar width across Hub and Files: $expected',
    async ({ saved, expected }) => {
      localStorage.setItem(
        'localmind.project.pane-widths',
        JSON.stringify({ ...saved, resource: 540 })
      );
      renderWorkbench('/project?view=files');
      expect(
        screen.getByTestId('intelligence-workbench').getAttribute('style')
      ).toContain(`${expected}px`);
      fireEvent.click(
        screen.getByRole('button', {
          name: 'com.affine.localmind.workbench.systemRail.projects',
        })
      );
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe('/project')
      );
      expect(
        screen.getByTestId('intelligence-workbench').getAttribute('style')
      ).toContain(`${expected}px`);
      const stored = JSON.parse(
        localStorage.getItem('localmind.project.pane-widths') ?? '{}'
      );
      expect(stored.documentsNavigation).toBeUndefined();
      expect(stored.resource).toBe(540);
    }
  );

  test('persists a shared resized sidebar and resets both views to 240px', async () => {
    const view = renderWorkbench('/project');
    const root = screen.getByTestId('intelligence-workbench');
    expect(root.getAttribute('style')).toContain('240px');
    fireEvent.keyDown(screen.getByTestId('project-navigation-resize'), {
      key: 'Home',
    });
    expect(root.getAttribute('style')).toContain('192px');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project?view=files'
      )
    );
    expect(
      screen.getByTestId('intelligence-workbench').getAttribute('style')
    ).toContain('192px');
    view.unmount();
    renderWorkbench('/project?view=files');
    expect(
      screen.getByTestId('intelligence-workbench').getAttribute('style')
    ).toContain('192px');
    fireEvent.doubleClick(screen.getByTestId('project-navigation-resize'));
    expect(
      screen.getByTestId('intelligence-workbench').getAttribute('style')
    ).toContain('240px');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.projects',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/project')
    );
    expect(
      screen.getByTestId('intelligence-workbench').getAttribute('style')
    ).toContain('240px');
    expect(
      JSON.parse(localStorage.getItem('localmind.project.pane-widths') ?? '{}')
        .navigation
    ).toBeUndefined();
  });

  test('keeps the workspace expansion across views and restores navigation only on request', () => {
    localStorage.setItem(
      'localmind.project.pane-widths',
      JSON.stringify({ navigation: 280 })
    );
    renderWorkbench('/project');
    fireEvent.click(
      screen.getByRole('tab', {
        name: 'com.affine.localmind.workbench.v9.relations',
      })
    );
    const navigation = document.getElementById(
      'intelligence-project-navigation'
    );
    const root = screen.getByTestId('intelligence-workbench');
    const originalStyle = root.getAttribute('style');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.graphExpandWorkspace',
      })
    );
    expect(root.dataset.workspaceExpanded).toBe('true');
    expect(navigation?.hidden).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: 'com.affine.localmind.workbench.v9.graphRestoreWorkspace',
        })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.graphRestoreWorkspace',
      })
    );
    expect(navigation?.hidden).toBe(false);
    expect(root.getAttribute('style')).toBe(originalStyle);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.graphExpandWorkspace',
      })
    );
    fireEvent.click(
      screen.getByRole('tab', {
        name: 'com.affine.localmind.workbench.v9.items',
      })
    );
    expect(navigation?.hidden).toBe(true);
    expect(root.dataset.workspaceExpanded).toBe('true');
    fireEvent.click(
      screen.getByRole('tab', {
        name: 'com.affine.localmind.workbench.v9.relations',
      })
    );
    expect(navigation?.hidden).toBe(true);
    fireEvent.click(
      screen.getByRole('tab', {
        name: 'com.affine.localmind.workbench.v9.items',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.graphRestoreWorkspace',
      })
    );
    expect(navigation?.hidden).toBe(false);
    expect(root.dataset.workspaceExpanded).toBe('false');
    expect(
      JSON.parse(localStorage.getItem('localmind.project.pane-widths') ?? '{}')
        .navigation
    ).toBe(280);
  });

  test('shows project navigation loading before an empty result is available', () => {
    state.projectAvailable = false;
    state.projectsLoading = true;
    renderWorkbench('/project');
    expect(screen.getByText('Project tree loading')).not.toBeNull();
    expect(
      screen.queryByText('com.affine.localmind.workbench.projects.emptyTitle')
    ).toBeNull();
  });

  test.each(['empty', 'archived'])(
    'shows the empty project navigation for %s results',
    stateName => {
      state.projectAvailable = stateName !== 'empty';
      if (stateName === 'archived') state.project.status = 'archived';
      renderWorkbench('/project');
      expect(
        screen.getByText('com.affine.localmind.workbench.projects.emptyTitle')
      ).not.toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Select project' })
      ).toBeNull();
    }
  );

  test('retries a failed project query from the navigation', () => {
    state.projectsError = new Error('Network unavailable');
    renderWorkbench('/project');
    expect(screen.getByRole('alert')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.retry',
      })
    );
    expect(state.refreshProjects).toHaveBeenCalledOnce();
  });

  test('does not mount chat before the selected project is available', () => {
    state.projectAvailable = false;
    state.projectsLoading = true;
    const view = renderWorkbench();

    expect(screen.queryByTestId('conversation')).toBeNull();
    expect(state.conversationMounts).toBe(0);

    state.projectAvailable = true;
    state.projectsLoading = false;
    view.rerender(
      <MemoryRouter initialEntries={['/project/project-1']}>
        <Component />
        <LocationProbe />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('conversation')).not.toBeNull();
  });

  test('opens native resources in the main area and restores the tree opener on close', async () => {
    renderWorkbench();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.showFileTree',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open native resource' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/resources/native-doc'
      )
    );
    expect(screen.getByTestId('conversation').closest('[hidden]')).toBeNull();
    expect(state.conversationMounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(
      screen.getByTestId('conversation').closest('[hidden]')
    ).not.toBeNull();
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/resources/native-doc'
    );
    expect(state.gql).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1'
      )
    );
    expect(state.conversationMounts).toBe(1);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Open native resource' })
      )
    );
  });

  test('returns from a resource to its conversation URL', async () => {
    renderWorkbench('/project/project-1/conversations/session-1');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.v9.showFileTree',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open native resource' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/resources/native-doc?sessionId=session-1'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/conversations/session-1'
      )
    );
  });

  test('opens a report deck for the whole project from the project tree after the unsaved check', async () => {
    renderWorkbench('/project/project-1/conversations/session-1');
    state.confirmUnsaved.mockResolvedValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open project reports' })
    );
    await waitFor(() => expect(state.confirmUnsaved).toHaveBeenCalledOnce());
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/conversations/session-1'
    );
    state.confirmUnsaved.mockResolvedValue(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open project reports' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toMatch(
        /^\/reports\/new\?handoff=/
      )
    );
    const handoff = new URLSearchParams(
      screen.getByTestId('location').textContent?.split('?')[1]
    ).get('handoff');
    expect(readDeckSources(handoff)).toEqual([
      {
        scopeKind: 'project',
        scopeId: 'project-1',
        kind: 'project_all',
        title: 'Project one',
      },
    ]);
  });

  test('hides the project report entry without AI and the legacy studio', () => {
    state.reportDeckAvailable = false;
    renderWorkbench('/project/project-1/conversations/session-1');
    expect(
      screen.queryByRole('button', { name: 'Open project reports' })
    ).toBeNull();
  });

  test('opens legacy project reports from the project tree while the legacy studio is enabled', async () => {
    state.legacyReports = true;
    renderWorkbench('/project/project-1/conversations/session-1');
    expect(
      screen.queryByRole('button', {
        name: 'com.affine.localmind.reports.reports',
      })
    ).toBeNull();
    state.confirmUnsaved.mockResolvedValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open project reports' })
    );
    await waitFor(() => expect(state.confirmUnsaved).toHaveBeenCalledOnce());
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/conversations/session-1'
    );
    state.confirmUnsaved.mockResolvedValue(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open project reports' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/reports'
      )
    );
  });

  test('keeps the editor and conversation mounted when closing is cancelled', async () => {
    renderWorkbench(
      '/project/project-1/resources/native-doc?sessionId=session-1'
    );
    state.confirmUnsaved.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
    await waitFor(() => expect(state.confirmUnsaved).toHaveBeenCalledOnce());
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/resources/native-doc?sessionId=session-1'
    );
    expect(screen.getByTestId('project-resource-preview')).not.toBeNull();
    expect(state.conversationMounts).toBe(1);
    expect(state.conversationUnmounts).toBe(0);
    state.confirmUnsaved.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/conversations/session-1'
      )
    );
  });

  test('preserves the Project and resource URL while a suspended query has no resolved data', () => {
    state.projectsResolved = false;
    const view = renderWorkbench('/project/project-1/resources/native-doc');
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/resources/native-doc'
    );
    state.projectsResolved = true;
    view.rerender(
      <MemoryRouter
        initialEntries={['/project/project-1/resources/native-doc']}
      >
        <Component />
        <LocationProbe />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('conversation')).not.toBeNull();
    expect(screen.getByTestId('location').textContent).toBe(
      '/project/project-1/resources/native-doc'
    );
  });

  test('does not mount chat for an unavailable project in the URL', async () => {
    renderWorkbench('/project/unavailable-project');

    expect(state.conversationMounts).toBe(0);
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/project');
    });
    expect(screen.queryByTestId('conversation')).toBeNull();
    expect(state.notifyError).toHaveBeenCalledWith({
      title: 'com.affine.localmind.project-error.permission',
    });
  });

  test('unmounts chat when the selected project is no longer accessible', async () => {
    const view = renderWorkbench();
    expect(state.conversationMounts).toBe(1);

    state.projectAvailable = false;
    view.rerender(
      <MemoryRouter initialEntries={['/project/project-1']}>
        <Component />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('conversation')).toBeNull();
    expect(state.conversationUnmounts).toBe(1);
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/project');
    });
  });

  test('uses the default server and sends project filtering without constructing a Workspace host', async () => {
    localStorage.setItem('last_workspace_id', 'missing-workspace');
    renderWorkbench();

    expect(screen.queryByTestId('host-workspace')).toBeNull();
    expect(state.revalidateWorkspaces).not.toHaveBeenCalled();
    expect(state.layoutReady).toHaveBeenCalled();
    expect(state.frameworkScopes).toContain('default-server-scope');
    expect(state.query).toHaveBeenCalledWith(
      {
        query: tokens.projectsQuery,
        variables: { includeArchived: true },
      },
      expect.not.objectContaining({ refreshInterval: expect.anything() })
    );
    expect(state.query).toHaveBeenCalledWith(
      {
        query: tokens.tasksQuery,
        variables: { projectId: 'project-1' },
      },
      expect.not.objectContaining({ refreshInterval: expect.anything() })
    );
  });

  test('loads project navigation through the server without a workspace', () => {
    state.workspaces = [];
    renderWorkbench();

    expect(
      screen.getByRole('button', { name: 'Select project' })
    ).not.toBeNull();
    expect(screen.queryByTestId('host-workspace')).toBeNull();
    expect(state.frameworkScopes).toContain('default-server-scope');
    expect(state.layoutReady).toHaveBeenCalled();
  });

  test('keeps project navigation available during workspace discovery', () => {
    state.workspaces = [];
    state.workspacesRevalidating = true;
    renderWorkbench();

    expect(
      screen.getByRole('button', { name: 'Select project' })
    ).not.toBeNull();
    expect(state.layoutReady).toHaveBeenCalled();
  });

  test('provides independent search, appearance, account and Workspace return controls', async () => {
    renderWorkbench();

    expect(state.workspaceSelector).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('global-rail')).getByText('User')
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Notifications' })
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Quick search' }));
    expect(state.quickSearchToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'com.affine.settingSidebar.title' })
    );
    expect(screen.getByTestId('project-settings')).not.toBeNull();
    expect(state.gql).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.returnToWorkspace',
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/')
    );
  });

  test('opens project collaboration through the single header settings entry', () => {
    renderWorkbench();

    expect(
      screen.queryByRole('button', {
        name: 'com.affine.localmind.workbench.project.actions',
      })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'com.affine.settingSidebar.title' })
    );
    expect(screen.getByTestId('project-settings').dataset).toMatchObject({
      projectId: 'project-1',
      collaborationId: 'project-1',
    });
  });

  test('opens the same settings for project menu actions', () => {
    renderWorkbench('/project');
    fireEvent.click(
      screen.getByRole('button', { name: 'Manage project settings' })
    );
    expect(screen.getByTestId('project-settings').dataset).toMatchObject({
      projectId: 'project-1',
      collaborationId: 'project-1',
    });
  });

  test('routes task cards and capped segments into the global full history', () => {
    renderWorkbench();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open cross-workspace task' })
    );
    expect(screen.getByTestId('location').textContent).toBe(
      '/tasks?taskId=workspace-b-failed'
    );

    fireEvent.click(screen.getByRole('button', { name: 'View all Todo' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/tasks?filter=all'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View all In progress' })
    );
    expect(screen.getByTestId('location').textContent).toBe(
      '/tasks?filter=active'
    );

    fireEvent.click(screen.getByRole('button', { name: 'View all Done' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/tasks?filter=completed'
    );
  });

  test('refreshes the project conversation list after the pin changes', async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Pin conversation' }));
    await waitFor(() => {
      expect(state.refreshTaskPanel).toHaveBeenCalledTimes(3);
    });
  });

  test.each([
    '/project/work-orders/work-order-1',
    '/project/conversations/new',
  ])('opens and closes the task drawer from %s', route => {
    renderWorkbench(route);

    const trigger = screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.tasks',
    });
    const panel = document.getElementById('intelligence-tasks-panel');
    expect(panel).not.toBeNull();
    expect(panel?.dataset.open).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.dataset.open).toBe('true');
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'View all Todo' })
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel?.dataset.open).toBe('false');
  });

  test('work-order confirmation follows unsaved delivery edits in the adjacent panel', async () => {
    renderWorkbench('/project/work-orders/work-order-1');
    const blocked = await screen.findByTestId(
      'work-order-confirmation-blocked'
    );
    await waitFor(() => expect(blocked.textContent).toBe('false'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit delivery draft' })
    );
    expect(blocked.textContent).toBe('true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save delivery draft' })
    );
    expect(blocked.textContent).toBe('false');
  });

  test('creates a manual blocker only after the panel submits and refreshes the projection', async () => {
    renderWorkbench();

    expect(state.gql).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: tokens.createBlockerMutation })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create blocker from panel' })
    );

    await waitFor(() => {
      expect(state.gql).toHaveBeenCalledWith({
        query: tokens.createBlockerMutation,
        variables: {
          input: {
            projectId: 'project-1',
            title: 'Waiting for reply',
            type: 'wait_reply',
            waitingOn: 'Vendor',
          },
        },
      });
      expect(state.refreshTaskPanel).toHaveBeenCalledTimes(1);
    });
  });

  test('persists an AI blocker suggestion only after explicit confirmation with its idempotency id', async () => {
    renderWorkbench();

    expect(state.gql).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: tokens.confirmBlockerSuggestionMutation,
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm AI blocker suggestion' })
    );

    await waitFor(() => {
      expect(state.gql).toHaveBeenCalledWith({
        query: tokens.confirmBlockerSuggestionMutation,
        variables: {
          input: {
            projectId: 'project-1',
            suggestion: {
              aiSuggestionId: 'b3b94f5e-936d-4d0e-875a-a0475f612f80',
              confirmationProof: 'signed-proof-project-1',
              title: 'Waiting for AI suggested reply',
              type: 'wait_reply',
              waitingOn: 'Customer',
              dueAt: '2026-09-05T17:00:00.000Z',
              origin: 'ai_suggested',
              confirmationRequired: true,
            },
          },
        },
      });
      expect(state.refreshTaskPanel).toHaveBeenCalledTimes(1);
    });
  });

  test('fails closed when a retained suggestion belongs to a different selected project', async () => {
    renderWorkbench();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm other project suggestion',
      })
    );

    await waitFor(() => {
      expect(state.notifyError).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'com.affine.localmind.workbench.blocker.selectSuggestedProject',
        })
      );
    });
    expect(state.gql).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: tokens.confirmBlockerSuggestionMutation,
      })
    );
    expect(state.refreshTaskPanel).not.toHaveBeenCalled();
  });

  test('opens the work order card only after this conversation sends a work order', async () => {
    const workOrderCard = () => screen.queryByTestId('work-order-panel');
    const toggle = () =>
      screen.queryByRole('button', {
        name: 'com.affine.localmind.workbench.orders.toggle',
      });
    state.graphEdges = [
      {
        id: 'draft-1',
        kind: 'draft',
        from: 'user-1',
        to: 'peer',
        status: 'draft',
        label: 'Unsent',
        ownSessionId: 'session-1',
      },
    ];
    renderWorkbench('/project/project-1/conversations/session-1');
    // Drafts and ordinary conversations have no right card at all.
    expect(workOrderCard()).toBeNull();
    expect(toggle()).toBeNull();
    cleanup();

    state.graphEdges = [
      {
        id: 'order-1',
        kind: 'sent',
        from: 'user-1',
        to: 'peer',
        status: 'delivered',
        label: 'Deck',
        ownSessionId: 'session-1',
      },
    ];
    renderWorkbench('/project/project-1/conversations/session-1');
    expect(workOrderCard()).not.toBeNull();
    fireEvent.click(toggle()!);
    expect(workOrderCard()).toBeNull();
    // A delivery awaiting adoption flags the collapsed toggle.
    expect(toggle()!.dataset.attention).toBe('true');
    fireEvent.click(toggle()!);
    await waitFor(() => expect(workOrderCard()).not.toBeNull());
  });

  test('records opened project files as recents and reopens them from the documents sidebar', async () => {
    window.localStorage.clear();
    const view = renderWorkbench('/project/project-1/resources/native-doc');
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem(
            'localmind.project-browser.recent:user-1'
          ) ?? '[]'
        )
      ).toEqual([
        expect.objectContaining({
          projectId: 'project-1',
          projectName: 'Project one',
          resourceId: 'native-doc',
          title: 'Native document',
          kind: 'page',
        }),
      ])
    );
    view.unmount();
    renderWorkbench('/project?view=files');
    const recent = screen.getByRole('list', {
      name: 'com.affine.localmind.project-browser.sidebar.recent',
    });
    fireEvent.click(
      within(recent).getByRole('button', { name: 'Native document' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1/resources/native-doc?view=files'
      )
    );
    // Recents are kept per signed-in account.
    expect(
      window.localStorage.getItem('localmind.project-browser.recent:guest')
    ).toBeNull();
  });

  test('asks for a project before showing the trash and opens the selected project trash', async () => {
    renderWorkbench('/project?view=files');
    const locations = screen.getByRole('navigation', {
      name: 'com.affine.localmind.project-browser.sidebar.label',
    });
    fireEvent.click(
      within(locations).getByRole('button', {
        name: 'com.affine.localmind.project-browser.sidebar.trash',
      })
    );
    expect(within(locations).getByRole('note').textContent).toBe(
      'com.affine.localmind.project-browser.sidebar.trashHint'
    );
    fireEvent.click(
      within(locations).getByRole('button', { name: 'Project one' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/project/project-1?view=files'
      )
    );
    expect(within(locations).queryByRole('note')).toBeNull();
  });
});
