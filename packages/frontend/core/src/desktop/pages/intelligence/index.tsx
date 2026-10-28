import { Button, IconButton, notify, useConfirmModal } from '@affine/component';
import type { BlockerSuggestion } from '@affine/core/blocksuite/ai/components/ai-chat-messages';
import {
  GlobalRail,
  rememberLastProjectId,
} from '@affine/core/components/global-rail';
import { compactUserInfo } from '@affine/core/components/global-rail/global-rail.css';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { getNavigationWidthBounds } from '@affine/core/components/localmind-theme/navigation-width';
import { ProjectFileRequestModal } from '@affine/core/components/project-file-request/detail';
import { SWRConfigProvider } from '@affine/core/components/providers/swr-config-provider';
import {
  useLegacyProjectReportsEnabled,
  useReportDeckEntryAvailable,
} from '@affine/core/components/report-deck-entry';
import { NotificationButton } from '@affine/core/components/root-app-sidebar/notification-button';
import UserInfo from '@affine/core/components/root-app-sidebar/user-info';
import {
  getProjectConversationPath,
  getProjectDocumentsPath,
  getProjectPath,
  getProjectReportPath,
  getWorkOrderPath,
  getWorkspaceDocPath,
  PROJECT_NEW_CONVERSATION_PATH,
} from '@affine/core/desktop/route-paths';
import { AppTabsHeader } from '@affine/core/modules/app-tabs-header';
import {
  DefaultServerService,
  GraphQLService,
} from '@affine/core/modules/cloud';
import { useAppLayoutReady } from '@affine/core/modules/desktop-api';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import {
  ProjectEditorGuard,
  useProjectUnsavedConfirmation,
} from '@affine/core/modules/project-resources/edit-guard';
import {
  projectErrorMessage,
  reportProjectError,
} from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import {
  ProjectsQuickSearchSession,
  QuickSearchContainer,
  QuickSearchService,
} from '@affine/core/modules/quicksearch';
import { stashDeckSources } from '@affine/core/modules/report-decks/source-handoff';
import { ViewIcon, ViewTitle } from '@affine/core/modules/workbench';
import {
  completeConversationMutation,
  confirmCopilotBlockerSuggestionMutation,
  copilotCollaborationGraphGetQuery,
  copilotContextProjectCreateMutation,
  copilotContextProjectUpdateMutation,
  copilotWorkbenchProjectsGetQuery,
  copilotWorkbenchTaskPanelGetQuery,
  createCopilotBlockerMutation,
  leaveCopilotContextProjectMutation,
  openWorkOrderConversationMutation,
  projectResourcePathQuery,
  projectResourceQuery,
  removeCopilotContextProjectMemberMutation,
  renameConversationMutation,
  sendCopilotProjectInvitationMutation,
  transferCopilotContextProjectOwnershipMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  AiIcon,
  CheckBoxCheckLinearIcon,
  CloseIcon,
  FolderIcon,
  SearchIcon,
  SidebarIcon,
} from '@blocksuite/icons/rc';
import type { OfficeAiContext } from '@localmind/office';
import {
  FrameworkScope,
  useFramework,
  useLiveData,
  useService,
} from '@toeverything/infra';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { type State, SWRConfig, type SWRConfiguration } from 'swr';

import { ConversationBoard } from './conversation-board';
import { ExecutionPath, findSessionRun } from './execution-path';
import * as styles from './index.css';
import { NewConversation } from './new-conversation';
import { PaneResizeHandle } from './pane-resize-handle';
import {
  ProjectBrowser,
  ProjectBrowserSidebar,
  recordRecentProjectFile,
  useProjectBrowserState,
  useRecentProjectFiles,
} from './project-browser';
import { type ProjectCollaborationPendingKey } from './project-collaboration';
import { ProjectFiles } from './project-files';
import { ProjectResourcePreview } from './project-resource-preview';
import { ProjectShellSettings } from './project-shell-settings';
import { ProjectSummary } from './project-summary';
import { ProjectTree } from './project-tree';
import { TaskPanel } from './task-panel';
import {
  EMPTY_TASK_PANEL,
  type WorkbenchBlockerDraft,
  type WorkbenchCollaborationGraph,
  type WorkbenchConversationCard,
  type WorkbenchPanelTaskAction,
  type WorkbenchProject,
  type WorkbenchProjectMember,
  type WorkbenchTask,
} from './types';
import { useAccessRequestConfirmation } from './use-access-request-confirmation';
import { useConversationCards } from './use-conversation-cards';
import { useProjectTaskDecision } from './use-project-task-decision';
import { WorkOrderConversation } from './work-order-conversation';
import { type WorkOrder, WorkOrderPanel } from './work-order-panel';
import { WorkOrderPanelToggle } from './work-order-panel-toggle';
import type { WorkbenchContextPanelState } from './workbench-conversation';
import { WorkbenchConversation } from './workbench-conversation';
import { executeWorkbenchTaskAction } from './workbench-task-action';

const projectQueryCache: SWRConfiguration = {
  provider: () => new Map<string, State<unknown, unknown>>(),
};

export const Component = () => {
  useAppLayoutReady();

  const defaultServer = useService(DefaultServerService).server;
  const account = useLiveData(defaultServer?.account$);
  const navigate = useNavigate();
  const location = useLocation();
  const seeded = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    projectId: selectedProjectId = null,
    resourceId: selectedResourceId = null,
    sessionId: selectedSessionId = null,
    workOrderId = null,
  } = useParams();
  const newConversation = location.pathname === PROJECT_NEW_CONVERSATION_PATH;
  const documentsView =
    searchParams.get('view') === 'files' &&
    !selectedSessionId &&
    !workOrderId &&
    !newConversation;

  useEffect(() => {
    rememberLastProjectId(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !selectedResourceId ||
      seeded.current ||
      window.history.state?.idx !== 0 ||
      location.state?.projectHistorySeeded
    )
      return;
    seeded.current = true;
    const target = location.pathname + location.search + location.hash;
    // A shared resource link needs a Project entry to return to on browser Back.
    // Seed the current entry before the router pushes, without racing two navigations.
    window.history.replaceState(
      window.history.state,
      '',
      documentsView
        ? getProjectDocumentsPath(selectedProjectId)
        : getProjectPath(selectedProjectId)
    );
    void Promise.resolve(
      navigate(target, {
        state: { ...location.state, projectHistorySeeded: true },
      })
    ).catch(reportProjectError);
  }, [
    documentsView,
    location,
    navigate,
    selectedProjectId,
    selectedResourceId,
  ]);

  const selectResource = useCallback(
    (
      projectId: string,
      resourceId: string | null,
      returnSessionId?: string | null
    ) => {
      if (documentsView) {
        navigate(getProjectDocumentsPath(projectId, resourceId));
      } else if (resourceId) {
        const path = getProjectPath(projectId, resourceId);
        navigate(
          returnSessionId
            ? `${path}?sessionId=${encodeURIComponent(returnSessionId)}`
            : path
        );
      } else {
        navigate(
          returnSessionId
            ? getProjectConversationPath(projectId, returnSessionId)
            : getProjectPath(projectId)
        );
      }
    },
    [documentsView, navigate]
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      navigate(
        documentsView
          ? getProjectDocumentsPath(projectId)
          : getProjectPath(projectId)
      );
    },
    [documentsView, navigate]
  );

  return (
    <div className={styles.shell} data-framed={BUILD_CONFIG.isElectron}>
      {BUILD_CONFIG.isElectron && (
        <div
          className={styles.desktopTitlebar}
          data-testid="project-desktop-titlebar"
        >
          <AppTabsHeader />
        </div>
      )}
      <FrameworkScope scope={defaultServer?.scope}>
        <SWRConfig
          key={`${defaultServer?.id ?? 'no-server'}:${account?.id ?? 'guest'}`}
          value={projectQueryCache}
        >
          <SWRConfigProvider>
            <QuickSearchContainer />
            <ProjectFileRequestModal
              requestId={searchParams.get('fileRequest')}
              onClose={() =>
                setSearchParams(
                  current => {
                    const next = new URLSearchParams(current);
                    next.delete('fileRequest');
                    return next;
                  },
                  { replace: true }
                )
              }
            />
            <ProjectEditorGuard>
              <IntelligenceWorkbench
                accountId={account?.id ?? null}
                selectedProjectId={selectedProjectId}
                selectedResourceId={selectedResourceId}
                selectedSessionId={selectedSessionId}
                workOrderId={workOrderId}
                newConversation={newConversation}
                documentsView={documentsView}
                onSelectResource={selectResource}
                onSelectProject={selectProject}
              />
            </ProjectEditorGuard>
          </SWRConfigProvider>
        </SWRConfig>
      </FrameworkScope>
    </div>
  );
};

type IntelligenceWorkbenchProps = {
  accountId: string | null;
  selectedProjectId: string | null;
  selectedResourceId: string | null;
  selectedSessionId: string | null;
  workOrderId: string | null;
  newConversation: boolean;
  documentsView: boolean;
  onSelectResource: (
    projectId: string,
    resourceId: string | null,
    returnSessionId?: string | null
  ) => void;
  onSelectProject: (projectId: string | null) => void;
};

type ProjectRightPanelState =
  | { kind: 'context' }
  | { kind: 'projectTree' }
  | {
      kind: 'resource';
      resourceId: string;
      openedFrom: 'context' | 'projectTree';
      treeOpen: boolean;
    };

type PaneWidthKey =
  | 'navigation'
  | 'context'
  | 'projectTree'
  | 'resource'
  | 'workOrder'
  | 'fileTree';
type RightPaneWidthKey = Exclude<PaneWidthKey, 'navigation' | 'fileTree'>;

const PANE_WIDTHS_STORAGE_KEY = 'localmind.project.pane-widths';

const readPaneWidths = (): Partial<Record<PaneWidthKey, number>> => {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(PANE_WIDTHS_STORAGE_KEY) ?? '{}'
    ) as Record<string, unknown>;
    const widths: Partial<Record<PaneWidthKey, number>> = {};
    for (const key of [
      'navigation',
      'context',
      'projectTree',
      'resource',
      'workOrder',
      'fileTree',
    ] as const) {
      const value = saved[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        widths[key] = value;
      }
    }
    // Both views now share navigation width; retain a legacy Files preference
    // when no valid Hub preference was saved.
    const legacyNavigation = saved.documentsNavigation;
    if (
      widths.navigation === undefined &&
      typeof legacyNavigation === 'number' &&
      Number.isFinite(legacyNavigation) &&
      legacyNavigation > 0
    ) {
      widths.navigation = legacyNavigation;
    }
    return widths;
  } catch {
    return {};
  }
};

const IntelligenceWorkbench = ({
  accountId,
  selectedProjectId,
  selectedResourceId,
  selectedSessionId,
  workOrderId,
  newConversation,
  documentsView,
  onSelectResource,
  onSelectProject,
}: IntelligenceWorkbenchProps) => {
  const t = useI18n();
  const navigate = useNavigate();
  const confirmUnsaved = useProjectUnsavedConfirmation();
  const legacyReports = useLegacyProjectReportsEnabled();
  const reportDeckAvailable = useReportDeckEntryAvailable();
  const [workbenchSearchParams] = useSearchParams();
  const workbenchLocation = useLocation();
  const requestedOrderId = workbenchSearchParams.get('workOrderId');
  const resourceReturnSessionId = documentsView
    ? null
    : (selectedSessionId ?? workbenchSearchParams.get('sessionId'));
  const framework = useFramework();
  const quickSearch = useService(QuickSearchService).quickSearch;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [paneWidths, setPaneWidths] = useState(readPaneWidths);
  const rootRef = useRef<HTMLElement>(null);
  const conversationAndPeekRef = useRef<HTMLDivElement>(null);
  const conversationPaneRef = useRef<HTMLDivElement>(null);
  const resourceWorkspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        PANE_WIDTHS_STORAGE_KEY,
        JSON.stringify(paneWidths)
      );
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }, [paneWidths]);
  const setPaneWidth = (key: PaneWidthKey, width: number) =>
    setPaneWidths(current => ({ ...current, [key]: width }));
  const resetPaneWidth = (key: PaneWidthKey) =>
    setPaneWidths(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  useEffect(() => {
    if (!tasksOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTasksOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [tasksOpen]);
  const [fullscreen, setFullscreen] = useState(false);
  const [officeContext, setOfficeContext] = useState<OfficeAiContext>();
  const [mobileView, setMobileView] = useState<'files' | 'chat'>('files');
  const [singlePane, setSinglePane] = useState(
    () => window.matchMedia?.('screen and (max-width: 1040px)').matches ?? false
  );
  useEffect(() => {
    const media = window.matchMedia?.('screen and (max-width: 1040px)');
    if (!media) return;
    const update = () => setSinglePane(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [workOrderPanelCollapsed, setWorkOrderPanelCollapsed] = useState(false);
  const [workOrderDraftState, setWorkOrderDraftState] = useState<{
    workOrderId: string;
    blocked: boolean;
  } | null>(null);
  const onWorkOrderDraftStateChange = useCallback(
    (orderId: string, blocked: boolean) => {
      setWorkOrderDraftState(current =>
        current?.workOrderId === orderId && current.blocked === blocked
          ? current
          : { workOrderId: orderId, blocked }
      );
    },
    []
  );
  const [rightPanel, setRightPanel] = useState<ProjectRightPanelState>(() =>
    selectedResourceId
      ? {
          kind: 'resource',
          resourceId: selectedResourceId,
          openedFrom: 'projectTree',
          treeOpen: false,
        }
      : { kind: 'context' }
  );
  const [contextPanel, setContextPanel] =
    useState<WorkbenchContextPanelState | null>(null);
  const rightPanelTrigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFullscreen(false);
    setMobileView(selectedResourceId ? 'files' : 'chat');
    setWorkOrderPanelCollapsed(false);
  }, [selectedProjectId, selectedResourceId, workOrderId]);
  const openSearch = useCallback(() => {
    quickSearch.show(
      [framework.createEntity(ProjectsQuickSearchSession)],
      result => {
        if (result)
          navigate(
            getProjectPath(result.payload.projectId, result.payload.resourceId)
          );
      },
      { placeholder: { i18nKey: 'com.affine.localmind.workbench.projects' } }
    );
  }, [framework, navigate, quickSearch]);
  useEffect(() => () => quickSearch.hide(), [quickSearch]);
  const graphqlService = useService(GraphQLService);
  const globalDialogService = useService(GlobalDialogService);
  const { openConfirmModal } = useConfirmModal();
  const [pendingMutationKey, setPendingMutationKey] = useState<string | null>(
    null
  );
  const [collaborationProjectId, setCollaborationProjectId] = useState<
    string | null
  >(null);
  const [collaborationPendingKey, setCollaborationPendingKey] =
    useState<ProjectCollaborationPendingKey | null>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [relationWorkspaceExpanded, setRelationWorkspaceExpanded] =
    useState(false);
  const overviewExpanded =
    relationWorkspaceExpanded &&
    !documentsView &&
    !selectedProjectId &&
    !workOrderId &&
    !newConversation;
  useEffect(() => {
    setRelationWorkspaceExpanded(false);
  }, [selectedProjectId, workOrderId, newConversation]);
  const [pendingTaskAction, setPendingTaskAction] = useState<{
    taskId: string;
    action: WorkbenchPanelTaskAction;
  } | null>(null);
  const blockerCreatePending = useRef(false);
  const conversationCards = useConversationCards();
  const [overviewFilter, setOverviewFilter] = useState('');
  const filteredConversationCards = useConversationCards({
    filter: overviewFilter,
    enabled:
      !!overviewFilter &&
      !selectedProjectId &&
      !workOrderId &&
      !newConversation,
  });
  const [loadedWorkOrderState, setLoadedWorkOrderState] = useState<{
    workOrderId: string;
    order: WorkOrder;
  } | null>(null);
  const loadedWorkOrder =
    loadedWorkOrderState?.workOrderId === workOrderId
      ? loadedWorkOrderState.order
      : null;
  const onWorkOrderLoaded = useCallback(
    (order: WorkOrder) => {
      if (!workOrderId) return;
      setLoadedWorkOrderState(current =>
        current?.workOrderId === workOrderId && current.order === order
          ? current
          : { workOrderId, order }
      );
    },
    [workOrderId]
  );
  const allConversationCards = useMemo(() => {
    // Realtime column transitions can briefly leave the same session in a
    // stale column response and its new column response. The project tree is a
    // single list, so collapse that overlap by the stable session identity.
    const seen = new Set<string>();
    return [
      ...conversationCards.todo.items,
      ...conversationCards.progress.items,
      ...conversationCards.done.items,
    ].filter(card => {
      if (seen.has(card.sessionId)) return false;
      seen.add(card.sessionId);
      return true;
    });
  }, [
    conversationCards.done.items,
    conversationCards.progress.items,
    conversationCards.todo.items,
  ]);
  const selectedConversationCard = resourceReturnSessionId
    ? (allConversationCards.find(
        card => card.sessionId === resourceReturnSessionId
      ) ?? null)
    : null;
  // The right card only exists once this conversation has sent work orders.
  const collaborationGraph = useQuery(
    { query: copilotCollaborationGraphGetQuery },
    { suspense: false, shouldRetryOnError: false }
  );
  useProjectRefresh(null, 'task', collaborationGraph.mutate);
  const graphData =
    collaborationGraph.data?.currentUser?.copilot.myCollaborationGraph;
  const sessionOrders = useMemo(() => {
    if (!resourceReturnSessionId || !graphData) return [];
    const labels = new Map(graphData.nodes.map(node => [node.id, node.label]));
    return graphData.edges
      .filter(
        edge =>
          edge.ownSessionId === resourceReturnSessionId && edge.kind !== 'draft'
      )
      .map(edge => ({
        id: edge.id,
        status: edge.status,
        title: edge.label,
        recipient: labels.get(edge.to) ?? edge.label,
      }));
  }, [graphData, resourceReturnSessionId]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(
    requestedOrderId
  );
  const activeOrder = activeOrderId
    ? (sessionOrders.find(order => order.id === activeOrderId) ?? null)
    : (sessionOrders[0] ?? null);
  const [ordersCollapsed, setOrdersCollapsed] = useState(false);
  // Sending the first work order from a conversation pops the card open.
  const orderCount = useRef(sessionOrders.length);
  useEffect(() => {
    if (sessionOrders.length > orderCount.current) setOrdersCollapsed(false);
    orderCount.current = sessionOrders.length;
  }, [sessionOrders.length]);
  useEffect(() => {
    setActiveOrderId(requestedOrderId);
    if (requestedOrderId) {
      setOrdersCollapsed(false);
      setRightPanel({ kind: 'context' });
      setMobileView('files');
    }
    orderCount.current = 0;
  }, [resourceReturnSessionId, requestedOrderId, workbenchLocation.key]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !event
          .composedPath()
          .some(
            target =>
              target instanceof Element &&
              target.matches('[role="dialog"], [role="menu"]')
          )
      ) {
        setMobileNavigationOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavigationOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('screen and (max-width: 760px)');
    const closeOnWideViewport = () => {
      if (!media.matches) {
        setMobileNavigationOpen(false);
      } else {
        setRelationWorkspaceExpanded(false);
      }
    };
    media.addEventListener('change', closeOnWideViewport);
    return () => media.removeEventListener('change', closeOnWideViewport);
  }, []);

  const {
    data: projectsData,
    error: projectsError,
    isLoading: projectsLoading,
    mutate: refreshProjects,
  } = useQuery(
    {
      query: copilotWorkbenchProjectsGetQuery,
      variables: { includeArchived: true },
    },
    {
      suspense: false,
      shouldRetryOnError: false,
    }
  );
  const allProjects = useMemo(
    () => projectsData?.currentUser?.copilot.contextProjects ?? [],
    [projectsData]
  );
  const projects = allProjects.filter(project => project.status === 'active');
  const selectedProject =
    projects.find(project => project.id === selectedProjectId) ?? null;
  useEffect(() => {
    if (
      !overviewFilter ||
      overviewFilter === 'work_order' ||
      projectsLoading ||
      projectsError ||
      !projectsData ||
      allProjects.some(
        project => project.id === overviewFilter && project.status === 'active'
      )
    )
      return;
    setOverviewFilter('');
    notify.error({
      title: t['com.affine.localmind.project-error.unavailable'](),
    });
    void conversationCards.refresh().catch(reportProjectError);
  }, [
    allProjects,
    conversationCards,
    overviewFilter,
    projectsData,
    projectsError,
    projectsLoading,
    t,
  ]);
  const resourceQuery = useQuery(
    selectedProjectId && selectedResourceId
      ? {
          query: projectResourceQuery,
          variables: {
            projectId: selectedProjectId,
            resourceId: selectedResourceId,
          },
        }
      : undefined,
    { suspense: false, shouldRetryOnError: false }
  );
  const resourcePath = useQuery(
    selectedProjectId && selectedResourceId
      ? {
          query: projectResourcePathQuery,
          variables: {
            projectId: selectedProjectId,
            resourceId: selectedResourceId,
          },
        }
      : undefined,
    { suspense: false, shouldRetryOnError: false }
  );
  useProjectRefresh(selectedProjectId, 'resource', () =>
    Promise.all([resourceQuery.mutate(), resourcePath.mutate()])
  );
  const resource = resourceQuery.data?.projectResource;
  const viewTitle =
    resource?.title ??
    (workOrderId
      ? (loadedWorkOrder?.title ??
        t['com.affine.localmind.workbench.v9.personalWorkOrder']())
      : newConversation
        ? t['com.affine.localmind.workbench.v9.newConversation']()
        : documentsView
          ? t['com.affine.localmind.workbench.systemRail.docs']()
          : (selectedConversationCard?.title ??
            selectedProject?.name ??
            t['com.affine.localmind.workbench.v9.overview']()));
  const resourceIsFolder = resource?.kind === 'folder';
  const directoryId = resourceIsFolder
    ? resource.id
    : (resource?.parentId ?? null);
  const recentFiles = useRecentProjectFiles(accountId);
  const selectedProjectName = selectedProject?.name ?? '';
  useEffect(() => {
    if (
      !selectedProjectId ||
      !resource ||
      resource.id !== selectedResourceId ||
      resource.kind === 'folder'
    )
      return;
    // Every project file opened in the workbench feeds the documents "Recent".
    recordRecentProjectFile(accountId, {
      projectId: selectedProjectId,
      projectName: selectedProjectName,
      resourceId: resource.id,
      parentId: resource.parentId ?? null,
      title: resource.title,
      kind: resource.kind,
    });
  }, [
    accountId,
    resource,
    selectedProjectId,
    selectedProjectName,
    selectedResourceId,
  ]);
  const navigateDocuments = useCallback(
    (location: { projectId: string | null; folderId: string | null }) => {
      void confirmUnsaved()
        .then(allowed => {
          if (allowed)
            navigate(
              getProjectDocumentsPath(location.projectId, location.folderId)
            );
        })
        .catch(reportProjectError);
    },
    [confirmUnsaved, navigate]
  );
  const browserState = useProjectBrowserState({
    location: documentsView
      ? {
          projectId: selectedProjectId,
          folderId: !selectedResourceId
            ? null
            : resource?.id === selectedResourceId
              ? directoryId
              : undefined,
        }
      : undefined,
    onNavigate: navigateDocuments,
  });

  useEffect(() => {
    setContextPanel(null);
  }, [selectedProjectId, resourceReturnSessionId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setRightPanel({ kind: 'context' });
      return;
    }
    if (selectedResourceId && resource && !resourceIsFolder) {
      setRightPanel(current =>
        current.kind === 'resource' && current.resourceId === selectedResourceId
          ? current
          : {
              kind: 'resource',
              resourceId: selectedResourceId,
              openedFrom:
                documentsView || current.kind === 'projectTree'
                  ? 'projectTree'
                  : 'context',
              treeOpen: false,
            }
      );
      return;
    }
    if (selectedResourceId && resourceIsFolder) {
      setRightPanel({ kind: 'projectTree' });
      return;
    }
    if (!selectedResourceId) {
      setRightPanel(current =>
        documentsView
          ? { kind: 'projectTree' }
          : current.kind === 'resource'
            ? { kind: current.openedFrom }
            : current
      );
    }
  }, [
    documentsView,
    resource,
    resourceIsFolder,
    selectedProjectId,
    selectedResourceId,
  ]);
  const collaborationProject =
    projects.find(
      project =>
        settingsOpen &&
        project.id === (collaborationProjectId ?? selectedProjectId)
    ) ?? null;

  const {
    data: taskPanelData,
    error: taskPanelError,
    isLoading: taskPanelLoading,
    mutate: refreshTaskPanel,
  } = useQuery(
    {
      query: copilotWorkbenchTaskPanelGetQuery,
      variables: { projectId: selectedProjectId ?? undefined },
    },
    {
      suspense: false,
      shouldRetryOnError: false,
    }
  );
  const taskPanel =
    taskPanelData?.currentUser?.copilot.workbenchTaskPanel ?? EMPTY_TASK_PANEL;
  const sessionRun = useMemo(
    () =>
      findSessionRun(
        [
          ...taskPanel.todo.items,
          ...taskPanel.inProgress.items,
          ...taskPanel.done.items,
        ],
        resourceReturnSessionId
      ),
    [taskPanel, resourceReturnSessionId]
  );

  useProjectRefresh(null, 'list', refreshProjects);
  useProjectRefresh(selectedProjectId, 'task', refreshTaskPanel);
  const refreshWorkbench = useCallback(
    () => Promise.all([refreshProjects(), conversationCards.refresh()]),
    [conversationCards, refreshProjects]
  );

  useEffect(() => {
    if (
      !projectsLoading &&
      !projectsError &&
      projectsData?.currentUser &&
      selectedProjectId &&
      !selectedProject
    ) {
      notify.error({
        title: t['com.affine.localmind.project-error.permission'](),
      });
      onSelectProject(null);
    }
  }, [
    onSelectProject,
    projectsData,
    projectsError,
    projectsLoading,
    selectedProject,
    selectedProjectId,
    t,
  ]);

  const reportMutationError = useCallback((caught: unknown, title: string) => {
    notify.error({
      title,
      message: projectErrorMessage(caught),
    });
  }, []);

  const openConversationCard = useCallback(
    (card: WorkbenchConversationCard) => {
      if (card.scopeType === 'work_order' && card.workOrderId) {
        navigate(getWorkOrderPath(card.workOrderId));
      } else if (card.project) {
        navigate(getProjectConversationPath(card.project.id, card.sessionId));
      } else if (
        card.scopeType === 'workspace' &&
        card.ownWorkspaceId &&
        card.ownDocId
      ) {
        navigate(
          getWorkspaceDocPath(card.ownWorkspaceId, card.ownDocId) +
            '?sessionId=' +
            encodeURIComponent(card.sessionId)
        );
      } else {
        notify.error({
          title:
            t['com.affine.localmind.workbench.v9.graphNavigationUnavailable'](),
        });
      }
      setMobileNavigationOpen(false);
    },
    [navigate, t]
  );
  const openRelation = useCallback(
    async (relation: WorkbenchCollaborationGraph['edges'][number]) => {
      const target =
        relation.kind === 'sent'
          ? (
              await graphqlService.gql({
                query: openWorkOrderConversationMutation,
                variables: { workOrderId: relation.id },
              })
            ).openWorkOrderConversation
          : {
              kind: relation.ownNavigationKind,
              workOrderId: relation.ownWorkOrderId,
              sessionId: relation.ownSessionId,
              projectId: relation.ownProjectId,
              workspaceId: relation.ownWorkspaceId,
              docId: relation.ownDocId,
            };
      if (target.kind === 'work_order' && target.workOrderId)
        navigate(getWorkOrderPath(target.workOrderId));
      else if (
        target.kind === 'project_session' &&
        target.sessionId &&
        target.projectId
      )
        navigate(
          getProjectConversationPath(target.projectId, target.sessionId)
        );
      else if (
        target.kind === 'workspace_session' &&
        target.sessionId &&
        target.workspaceId &&
        target.docId
      )
        navigate(
          getWorkspaceDocPath(target.workspaceId, target.docId) +
            '?sessionId=' +
            encodeURIComponent(target.sessionId)
        );
      else
        throw new Error(
          t['com.affine.localmind.workbench.v9.graphNavigationUnavailable']()
        );
      setMobileNavigationOpen(false);
    },
    [graphqlService, navigate, t]
  );

  const renameConversation = useCallback(
    async (card: WorkbenchConversationCard, title: string) => {
      setPendingMutationKey(`conversation:rename:${card.sessionId}`);
      try {
        await graphqlService.gql({
          query: renameConversationMutation,
          variables: {
            sessionId: card.sessionId,
            title,
            expectedRevision: card.titleRevision,
          },
        });
        await conversationCards.refresh();
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.v9.renameFailed']()
        );
        throw caught;
      } finally {
        setPendingMutationKey(null);
      }
    },
    [conversationCards, graphqlService, reportMutationError, t]
  );

  const completeConversation = useCallback(
    async (card: WorkbenchConversationCard) => {
      setPendingMutationKey(`conversation:complete:${card.sessionId}`);
      try {
        await graphqlService.gql({
          query: completeConversationMutation,
          variables: {
            sessionId: card.sessionId,
            expectedVersion: card.version,
            requestKey: nanoid(),
          },
        });
        await conversationCards.refresh();
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.v9.completeFailed']()
        );
        throw caught;
      } finally {
        setPendingMutationKey(null);
      }
    },
    [conversationCards, graphqlService, reportMutationError, t]
  );

  const createProject = useCallback(
    async (name: string) => {
      setPendingMutationKey('project:create');
      try {
        const result = await graphqlService.gql({
          query: copilotContextProjectCreateMutation,
          variables: { input: { name } },
        });
        await refreshProjects();
        navigate(
          `${PROJECT_NEW_CONVERSATION_PATH}?projectId=${encodeURIComponent(result.createCopilotContextProject.id)}`
        );
        notify.success({
          title: t['com.affine.localmind.workbench.project.created'](),
        });
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.createFailed']()
        );
      } finally {
        setPendingMutationKey(null);
      }
    },
    [graphqlService, navigate, refreshProjects, reportMutationError, t]
  );

  const renameProject = useCallback(
    async (project: WorkbenchProject, name: string) => {
      setPendingMutationKey(`project:${project.id}:rename`);
      try {
        await graphqlService.gql({
          query: copilotContextProjectUpdateMutation,
          variables: { input: { id: project.id, name } },
        });
        await refreshProjects();
        notify.success({
          title: t['com.affine.localmind.workbench.project.renamed'](),
        });
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.renameFailed']()
        );
      } finally {
        setPendingMutationKey(null);
      }
    },
    [graphqlService, refreshProjects, reportMutationError, t]
  );

  const restoreProject = useCallback(
    async (project: WorkbenchProject) => {
      setPendingMutationKey(`project:${project.id}:restore`);
      try {
        await graphqlService.gql({
          query: copilotContextProjectUpdateMutation,
          variables: { input: { id: project.id, status: 'active' } },
        });
        await refreshProjects();
        notify.success({
          title: t['com.affine.localmind.workbench.project.restored'](),
        });
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.restoreFailed']()
        );
      } finally {
        setPendingMutationKey(null);
      }
    },
    [graphqlService, refreshProjects, reportMutationError, t]
  );

  const archiveProject = useCallback(
    async (project: WorkbenchProject) => {
      openConfirmModal({
        title: t['com.affine.localmind.workbench.project.archiveConfirm'](),
        description:
          t['com.affine.localmind.workbench.project.archiveDescription'](),
        confirmText: t['com.affine.localmind.workbench.project.archive'](),
        cancelText: t['Cancel'](),
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          setPendingMutationKey(`project:${project.id}:archive`);
          try {
            await graphqlService.gql({
              query: copilotContextProjectUpdateMutation,
              variables: { input: { id: project.id, status: 'archived' } },
            });
            if (selectedProjectId === project.id) onSelectProject(null);
            await Promise.all([refreshProjects(), refreshTaskPanel()]);
            notify.success({
              title: t['com.affine.localmind.workbench.project.archived'](),
            });
          } catch (caught) {
            reportMutationError(
              caught,
              t['com.affine.localmind.workbench.project.archiveFailed']()
            );
          } finally {
            setPendingMutationKey(null);
          }
        },
      });
    },
    [
      graphqlService,
      onSelectProject,
      openConfirmModal,
      refreshProjects,
      refreshTaskPanel,
      reportMutationError,
      selectedProjectId,
      t,
    ]
  );

  useEffect(() => {
    if (collaborationProjectId && !collaborationProject) {
      setCollaborationProjectId(null);
    }
  }, [collaborationProject, collaborationProjectId]);

  const inviteProjectMember = useCallback(
    async (email: string) => {
      if (!collaborationProject || collaborationPendingKey) return false;
      setCollaborationPendingKey('invite');
      try {
        await graphqlService.gql({
          query: sendCopilotProjectInvitationMutation,
          variables: { input: { projectId: collaborationProject.id, email } },
        });
        await refreshTaskPanel();
        notify.success({
          title: t['com.affine.localmind.workbench.project.inviteSent'](),
        });
        return true;
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.inviteFailed']()
        );
        return false;
      } finally {
        setCollaborationPendingKey(null);
      }
    },
    [
      collaborationPendingKey,
      collaborationProject,
      graphqlService,
      refreshTaskPanel,
      reportMutationError,
      t,
    ]
  );

  const removeProjectMember = useCallback(
    async (member: WorkbenchProjectMember) => {
      if (!collaborationProject || collaborationPendingKey) return false;
      setCollaborationPendingKey(`remove:${member.userId}`);
      try {
        await graphqlService.gql({
          query: removeCopilotContextProjectMemberMutation,
          variables: {
            input: {
              projectId: collaborationProject.id,
              memberUserId: member.userId,
            },
          },
        });
        await Promise.all([refreshProjects(), refreshTaskPanel()]);
        notify.success({
          title: t['com.affine.localmind.workbench.project.memberRemoved'](),
        });
        return true;
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.memberRemoveFailed']()
        );
        return false;
      } finally {
        setCollaborationPendingKey(null);
      }
    },
    [
      collaborationPendingKey,
      collaborationProject,
      graphqlService,
      refreshProjects,
      refreshTaskPanel,
      reportMutationError,
      t,
    ]
  );

  const transferProjectOwnership = useCallback(
    async (member: WorkbenchProjectMember) => {
      if (!collaborationProject || collaborationPendingKey) return false;
      setCollaborationPendingKey(`transfer:${member.userId}`);
      try {
        await graphqlService.gql({
          query: transferCopilotContextProjectOwnershipMutation,
          variables: {
            input: {
              projectId: collaborationProject.id,
              memberUserId: member.userId,
            },
          },
        });
        await Promise.all([refreshProjects(), refreshTaskPanel()]);
        notify.success({
          title:
            t['com.affine.localmind.workbench.project.ownershipTransferred'](),
        });
        return true;
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.project.transferFailed']()
        );
        return false;
      } finally {
        setCollaborationPendingKey(null);
      }
    },
    [
      collaborationPendingKey,
      collaborationProject,
      graphqlService,
      refreshProjects,
      refreshTaskPanel,
      reportMutationError,
      t,
    ]
  );

  const leaveProject = useCallback(async () => {
    if (!collaborationProject || collaborationPendingKey) return false;
    const projectId = collaborationProject.id;
    setCollaborationPendingKey('leave');
    try {
      await graphqlService.gql({
        query: leaveCopilotContextProjectMutation,
        variables: { projectId },
      });
      setCollaborationProjectId(null);
      setSettingsOpen(false);
      if (selectedProjectId === projectId) onSelectProject(null);
      await Promise.all([refreshProjects(), refreshTaskPanel()]);
      notify.success({
        title: t['com.affine.localmind.workbench.project.left'](),
      });
      return true;
    } catch (caught) {
      reportMutationError(
        caught,
        t['com.affine.localmind.workbench.project.leaveFailed']()
      );
      return false;
    } finally {
      setCollaborationPendingKey(null);
    }
  }, [
    collaborationPendingKey,
    collaborationProject,
    graphqlService,
    onSelectProject,
    refreshProjects,
    refreshTaskPanel,
    reportMutationError,
    selectedProjectId,
    t,
  ]);

  const confirmAccessRequest = useAccessRequestConfirmation();
  const decideProjectTask = useProjectTaskDecision();
  const controlTask = useCallback(
    async (task: WorkbenchTask, action: WorkbenchPanelTaskAction) => {
      if (pendingTaskAction || !task.availableActions.includes(action)) return;
      if (
        task.projectTask &&
        (action === 'approve' || action === 'reject' || action === 'cancel')
      ) {
        if (await decideProjectTask(task.projectTask, action))
          await refreshTaskPanel();
        return;
      }
      if (action === 'approve' && task.kind === 'run') {
        navigate(
          `/tasks?${new URLSearchParams({ taskId: task.id, filter: 'approval' })}`
        );
        return;
      }
      setPendingTaskAction({ taskId: task.id, action });
      try {
        const confirmation =
          action === 'approve_access_request' ||
          action === 'reject_access_request'
            ? await confirmAccessRequest(task, action)
            : null;
        if (
          (action === 'approve_access_request' ||
            action === 'reject_access_request') &&
          !confirmation
        )
          return;
        await executeWorkbenchTaskAction(
          graphqlService,
          task,
          action,
          confirmation
        );
        await Promise.all([refreshProjects(), refreshTaskPanel()]);
        notify.success({
          title:
            task.kind === 'blocker'
              ? t['com.affine.localmind.workbench.blocker.updated']()
              : t['com.affine.localmind.tasks.action.success'](),
        });
      } catch (caught) {
        reportMutationError(
          caught,
          task.kind === 'blocker'
            ? t['com.affine.localmind.workbench.blocker.updateFailed']()
            : t['com.affine.localmind.tasks.action.failed']()
        );
      } finally {
        setPendingTaskAction(null);
      }
    },
    [
      confirmAccessRequest,
      decideProjectTask,
      graphqlService,
      navigate,
      pendingTaskAction,
      refreshProjects,
      refreshTaskPanel,
      reportMutationError,
      t,
    ]
  );

  const createBlocker = useCallback(
    async (projectId: string, blocker: WorkbenchBlockerDraft) => {
      if (blockerCreatePending.current) return false;
      blockerCreatePending.current = true;
      try {
        await graphqlService.gql({
          query: createCopilotBlockerMutation,
          variables: {
            input: {
              projectId,
              title: blocker.title,
              type: blocker.type,
              waitingOn: blocker.waitingOn,
              ...(blocker.dueAt ? { dueAt: blocker.dueAt } : {}),
            },
          },
        });
        await refreshTaskPanel();
        notify.success({
          title: t['com.affine.localmind.workbench.blocker.created'](),
        });
        return true;
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.blocker.createFailed']()
        );
        return false;
      } finally {
        blockerCreatePending.current = false;
      }
    },
    [graphqlService, refreshTaskPanel, reportMutationError, t]
  );

  const confirmBlockerSuggestion = useCallback(
    async (suggestion: BlockerSuggestion) => {
      if (suggestion.projectId !== selectedProjectId) {
        const error = new Error(
          t['com.affine.localmind.workbench.blocker.selectSuggestedProject']()
        );
        notify.error({
          title: t['com.affine.localmind.workbench.blocker.createFailed'](),
          message: error.message,
        });
        throw error;
      }
      try {
        await graphqlService.gql({
          query: confirmCopilotBlockerSuggestionMutation,
          variables: {
            input: {
              projectId: suggestion.projectId,
              suggestion: {
                aiSuggestionId: suggestion.aiSuggestionId,
                confirmationProof: suggestion.confirmationProof,
                title: suggestion.title,
                type: suggestion.type,
                waitingOn: suggestion.waitingOn,
                ...(suggestion.dueAt ? { dueAt: suggestion.dueAt } : {}),
                origin: suggestion.origin,
                confirmationRequired: suggestion.confirmationRequired,
              },
            },
          },
        });
        await refreshTaskPanel();
        notify.success({
          title:
            t['com.affine.localmind.workbench.blocker.suggestionCreated'](),
        });
      } catch (caught) {
        reportMutationError(
          caught,
          t['com.affine.localmind.workbench.blocker.createFailed']()
        );
        throw caught;
      }
    },
    [
      graphqlService,
      refreshTaskPanel,
      reportMutationError,
      selectedProjectId,
      t,
    ]
  );

  const openTask = useCallback(
    (task: WorkbenchTask) => {
      navigate(`/tasks?taskId=${encodeURIComponent(task.id)}`);
    },
    [navigate]
  );

  const viewAllTasks = useCallback(
    (segment: 'todo' | 'in-progress' | 'done') => {
      const filter =
        segment === 'todo'
          ? 'all'
          : segment === 'in-progress'
            ? 'active'
            : 'completed';
      navigate(`/tasks?filter=${filter}`);
    },
    [navigate]
  );

  const openProjectResource = useCallback(
    async (resourceId: string, openedFrom?: 'context' | 'projectTree') => {
      if (!selectedProject) return;
      if (
        rightPanel.kind === 'resource' &&
        rightPanel.resourceId === resourceId
      )
        return;
      if (!(await confirmUnsaved())) return;
      setRightPanel(current => ({
        kind: 'resource',
        resourceId,
        openedFrom:
          openedFrom ??
          (current.kind === 'projectTree' ? 'projectTree' : 'context'),
        treeOpen: current.kind === 'resource' ? current.treeOpen : false,
      }));
      onSelectResource(selectedProject.id, resourceId, resourceReturnSessionId);
    },
    [
      onSelectResource,
      resourceReturnSessionId,
      selectedProject,
      confirmUnsaved,
      rightPanel,
    ]
  );

  const closeProjectResource = useCallback(async () => {
    if (!selectedProject || rightPanel.kind !== 'resource') return;
    if (!(await confirmUnsaved())) return;
    const next = rightPanel.openedFrom;
    const resourceId = rightPanel.resourceId;
    setRightPanel({ kind: next });
    onSelectResource(
      selectedProject.id,
      next === 'projectTree' ? directoryId : null,
      resourceReturnSessionId
    );
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const attribute =
          next === 'projectTree'
            ? 'data-project-resource-id'
            : 'data-project-context-resource-id';
        const opener = Array.from(
          document.querySelectorAll<HTMLElement>(
            next === 'projectTree' ? `[${attribute}]` : `button[${attribute}]`
          )
        ).find(element => element.getAttribute(attribute) === resourceId);
        (opener ?? rightPanelTrigger.current?.querySelector('button'))?.focus();
      })
    );
  }, [
    directoryId,
    onSelectResource,
    resourceReturnSessionId,
    rightPanel,
    selectedProject,
    confirmUnsaved,
  ]);

  const openBrowserResource = useCallback(
    (projectId: string, resourceId: string) => {
      if (projectId === selectedProject?.id) {
        void openProjectResource(resourceId, 'projectTree').catch(
          reportProjectError
        );
        return;
      }
      void confirmUnsaved()
        .then(allowed => {
          if (allowed) onSelectResource(projectId, resourceId);
        })
        .catch(reportProjectError);
    },
    [confirmUnsaved, onSelectResource, openProjectResource, selectedProject]
  );

  const toggleRightPanel = useCallback(() => {
    setRightPanel(current =>
      current.kind === 'resource'
        ? { ...current, treeOpen: !current.treeOpen }
        : current.kind === 'context'
          ? { kind: 'projectTree' }
          : { kind: 'context' }
    );
    setMobileView('files');
  }, []);

  const secondaryViewLabel =
    workOrderId || (activeOrder && rightPanel.kind === 'context')
      ? t['com.affine.localmind.workbench.orders.toggle']()
      : rightPanel.kind === 'context'
        ? t['com.affine.localmind.workbench.v9.contextPanel']()
        : t['com.affine.localmind.project-files.title']();

  const receivedOrderExpanded =
    !workOrderPanelCollapsed && (!singlePane || mobileView === 'files');
  const sentOrderExpanded =
    !ordersCollapsed &&
    rightPanel.kind === 'context' &&
    (!singlePane || mobileView === 'files');

  const visiblePanel =
    rightPanel.kind === 'context' && (!activeOrder || ordersCollapsed)
      ? 'none'
      : rightPanel.kind;
  // The sent work order card shares the received work order pane width.
  const paneKind: RightPaneWidthKey =
    workOrderId || rightPanel.kind === 'context'
      ? 'workOrder'
      : rightPanel.kind;
  const defaultPaneWidth = {
    context: '260px',
    projectTree: '320px',
    resource: 'max(420px, 45%)',
    workOrder: 'max(380px, 38%)',
  }[paneKind];
  const getNavigationBounds = () => {
    const width = rootRef.current?.clientWidth ?? window.innerWidth;
    return getNavigationWidthBounds(width);
  };
  const getPaneBounds = () => {
    const width = conversationAndPeekRef.current?.clientWidth ?? 1200;
    const min = {
      context: 220,
      projectTree: 260,
      resource: 420,
      workOrder: 380,
    }[paneKind];
    return { min, max: Math.max(min, width - 320) };
  };
  const getPaneWidth = () =>
    (conversationAndPeekRef.current?.getBoundingClientRect().width ?? 0) -
    (conversationPaneRef.current?.getBoundingClientRect().width ?? 0);
  const getFileTreeBounds = () => {
    const width = resourceWorkspaceRef.current?.clientWidth ?? 660;
    return { min: 160, max: Math.max(160, Math.min(420, width - 240)) };
  };

  return (
    <main
      ref={rootRef}
      className={styles.root}
      style={assignInlineVars({
        [styles.railWidthVar]: `${paneWidths.navigation ?? 240}px`,
      })}
      data-testid="intelligence-workbench"
      data-workspace-expanded={overviewExpanded}
    >
      {BUILD_CONFIG.isElectron ? (
        <>
          <ViewTitle title={viewTitle} />
          <ViewIcon icon="ai" />
        </>
      ) : null}
      <GlobalRail
        projectId={selectedProjectId}
        active={documentsView ? 'docs' : 'projects'}
        onNavigate={path => {
          void confirmUnsaved()
            .then(allowed => {
              if (allowed) navigate(path);
            })
            .catch(reportProjectError);
        }}
        onOpenSettings={() => {
          setCollaborationProjectId(null);
          setSettingsOpen(true);
        }}
      />
      <aside
        id="intelligence-project-navigation"
        hidden={overviewExpanded}
        className={styles.rail}
        data-mobile-open={mobileNavigationOpen}
        aria-label={t['com.affine.localmind.workbench.navigation']()}
      >
        <div className={styles.railHeader}>
          <span className={styles.brand}>
            <span>LOCALMIND</span>
          </span>
          <span className={styles.mobileRailClose}>
            <IconButton
              size="20"
              icon={<CloseIcon />}
              aria-label={t['com.affine.sidebarSwitch.collapse']()}
              onClick={() => setMobileNavigationOpen(false)}
            />
          </span>
        </div>

        {documentsView ? (
          <ProjectBrowserSidebar
            projects={allProjects}
            selectedProjectId={selectedProject?.id ?? null}
            loading={projectsLoading}
            error={
              projectsError ? projectErrorMessage(projectsError) : undefined
            }
            onRetry={() => void refreshProjects().catch(reportProjectError)}
            onSelectProject={projectId => {
              browserState.setTrash(false);
              browserState.setSearch('');
              navigateDocuments({ projectId, folderId: null });
              setMobileNavigationOpen(false);
            }}
            recent={recentFiles}
            onOpenRecent={entry => {
              browserState.setSearch('');
              openBrowserResource(entry.projectId, entry.resourceId);
              setMobileNavigationOpen(false);
            }}
            trash={browserState.trash}
            onOpenTrash={() => {
              browserState.setSearch('');
              browserState.setTrash(true);
              if (selectedProject && rightPanel.kind === 'resource')
                void closeProjectResource().catch(reportProjectError);
              setMobileNavigationOpen(false);
            }}
            onRestoreProject={project =>
              void restoreProject(project).catch(reportProjectError)
            }
          />
        ) : (
          <ProjectTree
            projects={allProjects}
            selectedProjectId={selectedProjectId}
            selectedSessionId={
              resourceReturnSessionId ?? loadedWorkOrder?.ownSessionId ?? null
            }
            conversations={allConversationCards}
            loading={projectsLoading}
            error={
              projectsError ? projectErrorMessage(projectsError) : undefined
            }
            conversationsLoading={
              conversationCards.todo.loading ||
              conversationCards.progress.loading ||
              conversationCards.done.loading
            }
            conversationsLoadingMore={
              conversationCards.todo.loadingMore ||
              conversationCards.progress.loadingMore ||
              conversationCards.done.loadingMore
            }
            conversationsError={
              conversationCards.todo.error ||
              conversationCards.progress.error ||
              conversationCards.done.error
                ? projectErrorMessage(
                    conversationCards.todo.error ??
                      conversationCards.progress.error ??
                      conversationCards.done.error
                  )
                : undefined
            }
            conversationsHasMore={
              conversationCards.todo.hasNextPage ||
              conversationCards.progress.hasNextPage ||
              conversationCards.done.hasNextPage
            }
            mutationsPending={pendingMutationKey !== null}
            onRefresh={() => void refreshProjects()}
            onRefreshConversations={() => void conversationCards.refresh()}
            onLoadMoreConversations={() => {
              Promise.all([
                conversationCards.todo.loadMore(),
                conversationCards.progress.loadMore(),
                conversationCards.done.loadMore(),
              ]).catch(caught =>
                reportMutationError(
                  caught,
                  t[
                    'com.affine.localmind.workbench.v9.loadMoreConversationsFailed'
                  ]()
                )
              );
            }}
            onSelectProject={projectId => {
              onSelectProject(projectId);
              setMobileNavigationOpen(false);
            }}
            onOpenConversation={openConversationCard}
            onNewConversation={() => navigate(PROJECT_NEW_CONVERSATION_PATH)}
            onRenameConversation={renameConversation}
            onCreate={createProject}
            onRename={renameProject}
            onArchive={archiveProject}
            onRestore={restoreProject}
            onOpenReports={
              legacyReports || reportDeckAvailable
                ? project => {
                    void confirmUnsaved()
                      .then(allowed => {
                        if (!allowed) return;
                        navigate(
                          legacyReports
                            ? getProjectReportPath(project.id)
                            : stashDeckSources([
                                {
                                  scopeKind: 'project',
                                  scopeId: project.id,
                                  kind: 'project_all',
                                  title: project.name,
                                },
                              ])
                        );
                      })
                      .catch(reportProjectError);
                  }
                : undefined
            }
            onManageCollaboration={project => {
              setCollaborationProjectId(project.id);
              setSettingsOpen(true);
            }}
          />
        )}
        <PaneResizeHandle
          label={`${t['com.affine.localmind.workbench.navigation']()} · ${t['com.affine.rootAppSidebar.resize-handle.tooltip.drag']()}`}
          testId="project-navigation-resize"
          getBounds={getNavigationBounds}
          onChange={width => setPaneWidth('navigation', width)}
          onReset={() => resetPaneWidth('navigation')}
        />
      </aside>

      <button
        type="button"
        className={styles.railScrim}
        data-mobile-open={mobileNavigationOpen}
        aria-hidden={!mobileNavigationOpen}
        tabIndex={mobileNavigationOpen ? 0 : -1}
        aria-label={t['com.affine.sidebarSwitch.collapse']()}
        onClick={() => setMobileNavigationOpen(false)}
      />

      <section
        className={styles.workArea}
        data-testid="intelligence-work-area"
        inert={mobileNavigationOpen || undefined}
      >
        <header className={styles.projectHeader}>
          <span className={styles.mobileRailClose}>
            <IconButton
              size="20"
              icon={<SidebarIcon />}
              aria-label={t['com.affine.sidebarSwitch.expand']()}
              onClick={() => setMobileNavigationOpen(true)}
            />
          </span>
          <nav
            className={styles.projectBreadcrumbs}
            aria-label={t['com.affine.localmind.project-files.root']()}
          >
            <button
              onClick={() => {
                void confirmUnsaved()
                  .then(allowed => {
                    if (!selectedProject || !allowed) return;
                    setRightPanel({ kind: 'projectTree' });
                    onSelectResource(
                      selectedProject.id,
                      null,
                      resourceReturnSessionId
                    );
                  })
                  .catch(reportProjectError);
              }}
            >
              {workOrderId
                ? (loadedWorkOrder?.title ??
                  t['com.affine.localmind.workbench.v9.personalWorkOrder']())
                : newConversation
                  ? t['com.affine.localmind.workbench.v9.newConversation']()
                  : documentsView && !selectedProject
                    ? t['com.affine.localmind.workbench.systemRail.docs']()
                    : (selectedProject?.name ??
                      t['com.affine.localmind.workbench.projects.all']())}
            </button>
            {resourcePath.data?.projectResourcePath.map(part => (
              <button
                key={part.id}
                aria-current={
                  part.id === selectedResourceId ? 'page' : undefined
                }
                onClick={() => {
                  void openProjectResource(part.id, 'projectTree').catch(
                    reportProjectError
                  );
                }}
              >
                {part.title}
              </button>
            ))}
          </nav>
          {selectedProject?.canManage ? (
            <ProjectSummary
              key={selectedProject.id}
              projectId={selectedProject.id}
              projectName={selectedProject.name}
            />
          ) : null}
          {selectedProject &&
          (!documentsView || rightPanel.kind === 'resource') ? (
            <div ref={rightPanelTrigger} className={styles.rightPanelTrigger}>
              <IconButton
                size="20"
                icon={<FolderIcon />}
                tooltip={
                  rightPanel.kind === 'resource'
                    ? t['com.affine.localmind.workbench.v9.toggleFileTree']()
                    : rightPanel.kind === 'projectTree'
                      ? activeOrder && !ordersCollapsed
                        ? t['com.affine.localmind.workbench.v9.showContext']()
                        : t[
                            'com.affine.localmind.workbench.v9.toggleFileTree'
                          ]()
                      : t['com.affine.localmind.workbench.v9.showFileTree']()
                }
                aria-label={
                  rightPanel.kind === 'resource'
                    ? t['com.affine.localmind.workbench.v9.toggleFileTree']()
                    : rightPanel.kind === 'projectTree'
                      ? activeOrder && !ordersCollapsed
                        ? t['com.affine.localmind.workbench.v9.showContext']()
                        : t[
                            'com.affine.localmind.workbench.v9.toggleFileTree'
                          ]()
                      : t['com.affine.localmind.workbench.v9.showFileTree']()
                }
                aria-pressed={
                  rightPanel.kind === 'projectTree' ||
                  (rightPanel.kind === 'resource' && rightPanel.treeOpen)
                }
                onClick={toggleRightPanel}
              />
            </div>
          ) : null}
          {!documentsView && (selectedProject || workOrderId) ? (
            <div role="tablist" className={styles.mobileViewTabs}>
              <IconButton
                role="tab"
                size="20"
                icon={<FolderIcon />}
                aria-selected={mobileView === 'files'}
                aria-label={secondaryViewLabel}
                tooltip={secondaryViewLabel}
                onClick={() => {
                  setMobileView('files');
                  if (workOrderId) setWorkOrderPanelCollapsed(false);
                  if (activeOrder && rightPanel.kind === 'context')
                    setOrdersCollapsed(false);
                }}
              />
              <IconButton
                role="tab"
                size="20"
                icon={<AiIcon />}
                aria-selected={mobileView === 'chat'}
                aria-label={t['com.affine.localmind.project-files.chat']()}
                tooltip={t['com.affine.localmind.project-files.chat']()}
                onClick={() => setMobileView('chat')}
              />
            </div>
          ) : null}
          <div className={styles.railUtilities}>
            <IconButton
              size="20"
              icon={<CheckBoxCheckLinearIcon />}
              className={styles.tasksTrigger}
              tooltip={t['com.affine.localmind.workbench.tasks']()}
              aria-label={t['com.affine.localmind.workbench.tasks']()}
              aria-expanded={tasksOpen}
              aria-controls="intelligence-tasks-panel"
              onClick={() => setTasksOpen(value => !value)}
            />
            <IconButton
              size="20"
              icon={<SearchIcon />}
              tooltip={t['Quick search']()}
              aria-label={t['Quick search']()}
              onClick={openSearch}
            />
            <NotificationButton iconOnly />
            <UserInfo className={compactUserInfo} />
          </div>
        </header>
        <div
          ref={conversationAndPeekRef}
          className={styles.conversationAndPeek}
          style={assignInlineVars({
            [styles.paneWidthVar]: paneWidths[paneKind]
              ? `${paneWidths[paneKind]}px`
              : defaultPaneWidth,
          })}
          data-project={!documentsView && (!!selectedProject || !!workOrderId)}
          data-work-order={!!workOrderId}
          data-work-order-collapsed={workOrderPanelCollapsed}
          data-panel={visiblePanel}
          data-fullscreen={fullscreen}
          data-view={documentsView ? 'files' : mobileView}
        >
          {documentsView ? (
            <div
              className={styles.filesPane}
              hidden={!!selectedProject && rightPanel.kind === 'resource'}
            >
              <ProjectBrowser
                projects={projects}
                projectsLoading={
                  projectsLoading || (!projectsData && !projectsError)
                }
                projectsError={
                  projectsError ? projectErrorMessage(projectsError) : undefined
                }
                onRetryProjects={() =>
                  void refreshProjects().catch(reportProjectError)
                }
                projectId={selectedProjectId}
                folderId={
                  !selectedResourceId
                    ? null
                    : resource?.id === selectedResourceId
                      ? directoryId
                      : undefined
                }
                state={browserState}
                onOpen={openBrowserResource}
              />
            </div>
          ) : null}
          {!documentsView &&
          !selectedProjectId &&
          !workOrderId &&
          !newConversation ? (
            <ConversationBoard
              workspaceExpanded={overviewExpanded}
              onWorkspaceExpandedChange={setRelationWorkspaceExpanded}
              cards={conversationCards}
              filter={overviewFilter}
              onFilterChange={setOverviewFilter}
              filteredCards={filteredConversationCards}
              projects={projects}
              projectsResolved={!!projectsData && !projectsError}
              onOpenCard={openConversationCard}
              onOpenRelation={openRelation}
              onNewConversation={() => navigate(PROJECT_NEW_CONVERSATION_PATH)}
              onSignIn={() => globalDialogService.open('sign-in', {})}
            />
          ) : null}
          {newConversation ? (
            <NewConversation
              projects={projects}
              initialProjectId={
                workbenchSearchParams.get('projectId') ?? undefined
              }
              onChanged={refreshWorkbench}
              onCreated={(projectId, sessionId) =>
                navigate(getProjectConversationPath(projectId, sessionId), {
                  replace: true,
                })
              }
            />
          ) : null}
          {selectedProject && !documentsView ? (
            <div
              ref={conversationPaneRef}
              className={styles.conversationPane}
              hidden={fullscreen}
            >
              <WorkbenchConversation
                key={selectedProject.id}
                onDocumentsChanged={refreshWorkbench}
                selectedProjectId={selectedProject.id}
                selectedProjectName={selectedProject.name}
                onNewConversation={() =>
                  navigate(
                    `${PROJECT_NEW_CONVERSATION_PATH}?${new URLSearchParams({ projectId: selectedProject.id })}`
                  )
                }
                officeContext={
                  officeContext &&
                  'projectId' in officeContext &&
                  officeContext.projectId === selectedProject.id
                    ? officeContext
                    : undefined
                }
                onOpenResource={resourceId => {
                  void openProjectResource(resourceId).catch(
                    reportProjectError
                  );
                }}
                onContextPanelChange={setContextPanel}
                onConfirmBlockerSuggestion={confirmBlockerSuggestion}
                selectedSessionId={resourceReturnSessionId ?? undefined}
                selectedCard={selectedConversationCard ?? undefined}
                onCompleteConversation={completeConversation}
                onPinChanged={() =>
                  void conversationCards.refresh().catch(reportProjectError)
                }
                headerActions={
                  activeOrder ? (
                    <WorkOrderPanelToggle
                      direction="sent"
                      expanded={sentOrderExpanded}
                      attention={
                        ordersCollapsed &&
                        sessionOrders.some(order =>
                          ['waiting_sender', 'delivered'].includes(order.status)
                        )
                      }
                      onToggle={() => {
                        setOrdersCollapsed(sentOrderExpanded);
                        setMobileView(sentOrderExpanded ? 'chat' : 'files');
                        if (!sentOrderExpanded)
                          setRightPanel({ kind: 'context' });
                      }}
                    />
                  ) : null
                }
                banner={<ExecutionPath run={sessionRun} />}
                onSessionCreated={sessionId =>
                  navigate(
                    getProjectConversationPath(selectedProject.id, sessionId),
                    { replace: true }
                  )
                }
              />
              {visiblePanel !== 'none' ? (
                <PaneResizeHandle
                  label={`${t['com.affine.localmind.project-files.chat']()} / ${secondaryViewLabel} · ${t['com.affine.rootAppSidebar.resize-handle.tooltip.drag']()}`}
                  testId="project-content-resize"
                  direction={-1}
                  getWidth={getPaneWidth}
                  getBounds={getPaneBounds}
                  onChange={width => setPaneWidth(paneKind, width)}
                  onReset={() => resetPaneWidth(paneKind)}
                />
              ) : null}
            </div>
          ) : null}
          {selectedProject &&
          visiblePanel !== 'none' &&
          (!documentsView || rightPanel.kind === 'resource') ? (
            <div className={styles.resourcePane}>
              {rightPanel.kind === 'context' ? (
                activeOrder ? (
                  <div className={styles.orderCard}>
                    {sessionOrders.length > 1 ? (
                      <div
                        role="tablist"
                        className={styles.orderSwitch}
                        aria-label={t[
                          'com.affine.localmind.workbench.orders.switch'
                        ]()}
                      >
                        {sessionOrders.map(order => (
                          <button
                            key={order.id}
                            type="button"
                            role="tab"
                            aria-selected={order.id === activeOrder.id}
                            title={`${order.title} · ${order.recipient}`}
                            onClick={() => setActiveOrderId(order.id)}
                          >
                            {order.title} · {order.recipient}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div
                      id="work-order-details"
                      className={styles.orderCardBody}
                    >
                      <WorkOrderPanel
                        key={activeOrder.id}
                        workOrderId={activeOrder.id}
                        onChanged={() =>
                          Promise.all([
                            conversationCards.refresh(),
                            collaborationGraph.mutate(),
                          ])
                        }
                        onCollapse={() => {
                          setOrdersCollapsed(true);
                          setMobileView('chat');
                        }}
                      />
                    </div>
                  </div>
                ) : null
              ) : rightPanel.kind === 'projectTree' ? (
                <div className={styles.filesPane}>
                  <ProjectFiles
                    key={selectedProject.id}
                    projectId={selectedProject.id}
                    parentId={directoryId}
                    selectedResourceId={selectedResourceId}
                    onOpen={resourceId => {
                      void openProjectResource(resourceId, 'projectTree').catch(
                        reportProjectError
                      );
                    }}
                  />
                </div>
              ) : (
                <div
                  ref={resourceWorkspaceRef}
                  className={styles.resourceWorkspace}
                  data-tree-open={rightPanel.treeOpen && !fullscreen}
                  style={assignInlineVars({
                    [styles.treeWidthVar]: `${paneWidths.fileTree ?? 232}px`,
                  })}
                >
                  {rightPanel.treeOpen && !fullscreen ? (
                    <div className={styles.narrowTree}>
                      <ProjectFiles
                        key={`${selectedProject.id}:narrow`}
                        projectId={selectedProject.id}
                        parentId={directoryId}
                        selectedResourceId={rightPanel.resourceId}
                        onOpen={resourceId => {
                          void openProjectResource(
                            resourceId,
                            rightPanel.openedFrom
                          ).catch(reportProjectError);
                        }}
                      />
                      <PaneResizeHandle
                        label={`${t['com.affine.localmind.project-files.title']()} / ${t['com.affine.localmind.workbench.documentPreview']()} · ${t['com.affine.rootAppSidebar.resize-handle.tooltip.drag']()}`}
                        testId="project-file-tree-resize"
                        getBounds={getFileTreeBounds}
                        onChange={width => setPaneWidth('fileTree', width)}
                        onReset={() => resetPaneWidth('fileTree')}
                      />
                    </div>
                  ) : null}
                  <ProjectResourcePreview
                    key={`${selectedProject.id}:${rightPanel.resourceId}`}
                    projectId={selectedProject.id}
                    resourceId={rightPanel.resourceId}
                    fullscreen={fullscreen}
                    onToggleFullscreen={() => setFullscreen(value => !value)}
                    onOfficeContextChange={setOfficeContext}
                    referenced={
                      contextPanel?.resourceIds.includes(
                        rightPanel.resourceId
                      ) ?? false
                    }
                    onReference={
                      contextPanel
                        ? () =>
                            contextPanel.referenceResource(
                              rightPanel.resourceId
                            )
                        : undefined
                    }
                    onClose={() => {
                      void closeProjectResource().catch(reportProjectError);
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}
          {workOrderId ? (
            <>
              <div
                ref={conversationPaneRef}
                className={styles.conversationPane}
              >
                {loadedWorkOrder?.viewerRole === 'recipient' &&
                loadedWorkOrder.ownSessionId ? (
                  <WorkOrderConversation
                    key={workOrderId}
                    workOrderId={workOrderId}
                    sessionId={loadedWorkOrder.ownSessionId}
                    title={loadedWorkOrder.title}
                    status={loadedWorkOrder.status}
                    deliveryDraftBlocked={
                      workOrderDraftState?.workOrderId !== workOrderId ||
                      workOrderDraftState.blocked
                    }
                    onChanged={conversationCards.refresh}
                    headerActions={
                      <WorkOrderPanelToggle
                        direction="received"
                        expanded={receivedOrderExpanded}
                        attention={
                          workOrderPanelCollapsed &&
                          loadedWorkOrder.status === 'open'
                        }
                        onToggle={() => {
                          setWorkOrderPanelCollapsed(receivedOrderExpanded);
                          setMobileView(
                            receivedOrderExpanded ? 'chat' : 'files'
                          );
                        }}
                      />
                    }
                  />
                ) : (
                  <div className={styles.workOrderSenderState}>
                    {loadedWorkOrder ? (
                      t['com.affine.localmind.workbench.v9.senderUsesSource']()
                    ) : (
                      <>
                        {t['Loading']()}
                        <Button
                          onClick={() => {
                            setMobileView('files');
                            setWorkOrderPanelCollapsed(false);
                          }}
                        >
                          {t[
                            'com.affine.localmind.workbench.fusion.orderTab'
                          ]()}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {!workOrderPanelCollapsed ? (
                  <PaneResizeHandle
                    label={`${t['com.affine.localmind.project-files.chat']()} · ${t['com.affine.rootAppSidebar.resize-handle.tooltip.drag']()}`}
                    testId="project-content-resize"
                    direction={-1}
                    getWidth={getPaneWidth}
                    getBounds={getPaneBounds}
                    onChange={width => setPaneWidth('workOrder', width)}
                    onReset={() => resetPaneWidth('workOrder')}
                  />
                ) : null}
              </div>
              <div className={`${styles.resourcePane} ${styles.workOrderPane}`}>
                <div
                  id="work-order-details"
                  className={styles.workOrderPanelContent}
                >
                  <WorkOrderPanel
                    key={workOrderId}
                    workOrderId={workOrderId}
                    onLoaded={onWorkOrderLoaded}
                    onChanged={conversationCards.refresh}
                    onDraftStateChange={onWorkOrderDraftStateChange}
                    onCollapse={() => {
                      setWorkOrderPanelCollapsed(true);
                      setMobileView('chat');
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.taskScrim}
          hidden={!tasksOpen}
          aria-label={t['Close']()}
          onClick={() => setTasksOpen(false)}
        />
        <div
          id="intelligence-tasks-panel"
          className={styles.taskArea}
          data-open={tasksOpen}
        >
          <TaskPanel
            drawerMode
            panel={taskPanel}
            loading={taskPanelLoading}
            error={
              taskPanelError ? projectErrorMessage(taskPanelError) : undefined
            }
            pendingAction={pendingTaskAction}
            onRefresh={() => void refreshTaskPanel()}
            onOpenTask={openTask}
            onViewAll={viewAllTasks}
            onAction={controlTask}
            selectedProjectId={selectedProjectId}
            onCreateBlocker={createBlocker}
          />
        </div>
      </section>
      <ProjectShellSettings
        key={collaborationProject?.id ?? 'global'}
        open={settingsOpen}
        onOpenChange={open => {
          if (!open && collaborationPendingKey) return;
          setSettingsOpen(open);
          if (!open) setCollaborationProjectId(null);
        }}
        projectId={collaborationProject?.id}
        collaboration={
          collaborationProject
            ? {
                project: collaborationProject,
                pendingKey: collaborationPendingKey,
                onInvite: inviteProjectMember,
                onRemoveMember: removeProjectMember,
                onTransferOwnership: transferProjectOwnership,
                onLeave: leaveProject,
              }
            : undefined
        }
      />
    </main>
  );
};
