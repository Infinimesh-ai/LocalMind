import { IconButton, notify, useConfirmModal } from '@affine/component';
import { LocalMindLogo } from '@affine/component/localmind-logo';
import type { BlockerSuggestion } from '@affine/core/blocksuite/ai/components/ai-chat-messages';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { ProjectFileRequestModal } from '@affine/core/components/project-file-request/detail';
import { SWRConfigProvider } from '@affine/core/components/providers/swr-config-provider';
import { NotificationButton } from '@affine/core/components/root-app-sidebar/notification-button';
import UserInfo from '@affine/core/components/root-app-sidebar/user-info';
import {
  getProjectConversationPath,
  getProjectPath,
  getWorkOrderPath,
  PROJECT_NEW_CONVERSATION_PATH,
} from '@affine/core/desktop/route-paths';
import {
  DefaultServerService,
  GraphQLService,
} from '@affine/core/modules/cloud';
import { useAppLayoutReady } from '@affine/core/modules/desktop-api';
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
import {
  completeConversationMutation,
  confirmCopilotBlockerSuggestionMutation,
  copilotContextProjectCreateMutation,
  copilotContextProjectUpdateMutation,
  copilotWorkbenchProjectsGetQuery,
  copilotWorkbenchTaskPanelGetQuery,
  createCopilotBlockerMutation,
  leaveCopilotContextProjectMutation,
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
  CloseIcon,
  FolderIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
} from '@blocksuite/icons/rc';
import type { OfficeAiContext } from '@localmind/office';
import { FrameworkScope, useFramework, useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { ConversationBoard } from './conversation-board';
import * as styles from './index.css';
import { NewConversation } from './new-conversation';
import {
  ProjectCollaboration,
  type ProjectCollaborationPendingKey,
} from './project-collaboration';
import { ProjectContextPanel } from './project-context-panel';
import { ProjectFiles } from './project-files';
import { ProjectResourcePreview } from './project-resource-preview';
import { ProjectShellSettings } from './project-shell-settings';
import { ProjectSummary } from './project-summary';
import { ProjectTree } from './project-tree';
import { TaskPanel } from './task-panel';
import {
  EMPTY_TASK_PANEL,
  type WorkbenchBlockerDraft,
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
import type { WorkbenchContextPanelState } from './workbench-conversation';
import { WorkbenchConversation } from './workbench-conversation';
import { executeWorkbenchTaskAction } from './workbench-task-action';

export const Component = () => {
  useAppLayoutReady();

  const defaultServer = useService(DefaultServerService).server;
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
      getProjectPath(selectedProjectId)
    );
    void Promise.resolve(
      navigate(target, {
        state: { ...location.state, projectHistorySeeded: true },
      })
    ).catch(reportProjectError);
  }, [location, navigate, selectedProjectId, selectedResourceId]);

  const selectResource = useCallback(
    (
      projectId: string,
      resourceId: string | null,
      returnSessionId?: string | null
    ) => {
      if (resourceId) {
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
    [navigate]
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      navigate(getProjectPath(projectId));
    },
    [navigate]
  );

  return (
    <FrameworkScope scope={defaultServer?.scope}>
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
        <IntelligenceWorkbench
          selectedProjectId={selectedProjectId}
          selectedResourceId={selectedResourceId}
          selectedSessionId={selectedSessionId}
          workOrderId={workOrderId}
          newConversation={newConversation}
          onSelectResource={selectResource}
          onSelectProject={selectProject}
        />
      </SWRConfigProvider>
    </FrameworkScope>
  );
};

type IntelligenceWorkbenchProps = {
  selectedProjectId: string | null;
  selectedResourceId: string | null;
  selectedSessionId: string | null;
  workOrderId: string | null;
  newConversation: boolean;
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

const IntelligenceWorkbench = ({
  selectedProjectId,
  selectedResourceId,
  selectedSessionId,
  workOrderId,
  newConversation,
  onSelectResource,
  onSelectProject,
}: IntelligenceWorkbenchProps) => {
  const t = useI18n();
  const navigate = useNavigate();
  const [workbenchSearchParams] = useSearchParams();
  const resourceReturnSessionId =
    selectedSessionId ?? workbenchSearchParams.get('sessionId');
  const framework = useFramework();
  const quickSearch = useService(QuickSearchService).quickSearch;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
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
  const [pendingTaskAction, setPendingTaskAction] = useState<{
    taskId: string;
    action: WorkbenchPanelTaskAction;
  } | null>(null);
  const blockerCreatePending = useRef(false);
  const conversationCards = useConversationCards();
  const [loadedWorkOrder, setLoadedWorkOrder] = useState<WorkOrder | null>(
    null
  );
  useEffect(() => setLoadedWorkOrder(null), [workOrderId]);
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
  const selectedConversationCard = selectedSessionId
    ? (allConversationCards.find(
        card => card.sessionId === selectedSessionId
      ) ?? null)
    : null;

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
      variables: { includeArchived: false },
    },
    {
      suspense: false,
      shouldRetryOnError: false,
    }
  );
  const projects = projectsData?.currentUser?.copilot.contextProjects ?? [];
  const selectedProject =
    projects.find(project => project.id === selectedProjectId) ?? null;
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
  const resourceIsFolder = resource?.kind === 'folder';
  const directoryId = resourceIsFolder
    ? resource.id
    : (resource?.parentId ?? null);

  useEffect(() => {
    setContextPanel(null);
  }, [selectedProjectId, selectedSessionId]);

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
                current.kind === 'projectTree' ? 'projectTree' : 'context',
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
        current.kind === 'resource' ? { kind: current.openedFrom } : current
      );
    }
  }, [resource, resourceIsFolder, selectedProjectId, selectedResourceId]);
  const collaborationProject =
    projects.find(project => project.id === collaborationProjectId) ?? null;

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
      }
      setMobileNavigationOpen(false);
    },
    [navigate]
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
    (resourceId: string, openedFrom?: 'context' | 'projectTree') => {
      if (!selectedProject) return;
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
    [onSelectResource, resourceReturnSessionId, selectedProject]
  );

  const closeProjectResource = useCallback(() => {
    if (!selectedProject || rightPanel.kind !== 'resource') return;
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
          document.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`)
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
  ]);

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
    rightPanel.kind === 'context'
      ? t['com.affine.localmind.workbench.v9.contextPanel']()
      : t['com.affine.localmind.project-files.title']();

  return (
    <main className={styles.root} data-testid="intelligence-workbench">
      <aside
        id="intelligence-project-navigation"
        className={styles.rail}
        data-mobile-open={mobileNavigationOpen}
        aria-label={t['com.affine.localmind.workbench.navigation']()}
      >
        <div className={styles.railHeader}>
          <button
            type="button"
            className={styles.brand}
            title={t['com.affine.localmind.workbench.returnToWorkspace']()}
            aria-label={t['com.affine.localmind.workbench.returnToWorkspace']()}
            onClick={() => navigate('/')}
          >
            <LocalMindLogo size={28} />
            <span>LOCALMIND</span>
          </button>
          <span className={styles.mobileRailClose}>
            <IconButton
              size="20"
              icon={<CloseIcon />}
              aria-label={t['com.affine.sidebarSwitch.collapse']()}
              onClick={() => setMobileNavigationOpen(false)}
            />
          </span>
        </div>

        <ProjectTree
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedSessionId={
            selectedSessionId ?? loadedWorkOrder?.ownSessionId ?? null
          }
          conversations={allConversationCards}
          loading={projectsLoading}
          error={projectsError ? projectErrorMessage(projectsError) : undefined}
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
          onManageCollaboration={project =>
            setCollaborationProjectId(project.id)
          }
        />
      </aside>

      <button
        type="button"
        className={styles.railScrim}
        data-mobile-open={mobileNavigationOpen}
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
                if (!selectedProject) return;
                setRightPanel({ kind: 'projectTree' });
                onSelectResource(
                  selectedProject.id,
                  null,
                  resourceReturnSessionId
                );
              }}
            >
              {workOrderId
                ? (loadedWorkOrder?.title ??
                  t['com.affine.localmind.workbench.v9.personalWorkOrder']())
                : newConversation
                  ? t['com.affine.localmind.workbench.v9.newConversation']()
                  : (selectedProject?.name ??
                    t['com.affine.localmind.workbench.projects.all']())}
            </button>
            {resourcePath.data?.projectResourcePath.map(part => (
              <button
                key={part.id}
                aria-current={
                  part.id === selectedResourceId ? 'page' : undefined
                }
                onClick={() =>
                  selectedProject && openProjectResource(part.id, 'projectTree')
                }
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
          {selectedProject ? (
            <IconButton
              size="20"
              icon={<SettingsIcon />}
              tooltip={t['com.affine.localmind.workbench.project.actions']()}
              aria-label={t['com.affine.localmind.workbench.project.actions']()}
              onClick={() => setCollaborationProjectId(selectedProject.id)}
            />
          ) : null}
          {selectedProject ? (
            <div ref={rightPanelTrigger} className={styles.rightPanelTrigger}>
              <IconButton
                size="20"
                icon={<FolderIcon />}
                tooltip={
                  rightPanel.kind === 'resource'
                    ? t['com.affine.localmind.workbench.v9.toggleFileTree']()
                    : rightPanel.kind === 'projectTree'
                      ? t['com.affine.localmind.workbench.v9.showContext']()
                      : t['com.affine.localmind.workbench.v9.showFileTree']()
                }
                aria-label={
                  rightPanel.kind === 'resource'
                    ? t['com.affine.localmind.workbench.v9.toggleFileTree']()
                    : rightPanel.kind === 'projectTree'
                      ? t['com.affine.localmind.workbench.v9.showContext']()
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
          {selectedProject || workOrderId ? (
            <div role="tablist" className={styles.mobileViewTabs}>
              <IconButton
                role="tab"
                size="20"
                icon={<FolderIcon />}
                aria-selected={mobileView === 'files'}
                aria-label={secondaryViewLabel}
                tooltip={secondaryViewLabel}
                onClick={() => setMobileView('files')}
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
            <button
              type="button"
              className={styles.tasksTrigger}
              aria-expanded={tasksOpen}
              onClick={() => setTasksOpen(value => !value)}
            >
              {t['com.affine.localmind.workbench.tasks']()}
            </button>
            <IconButton
              size="20"
              icon={<SearchIcon />}
              tooltip={t['Quick search']()}
              aria-label={t['Quick search']()}
              onClick={openSearch}
            />
            <NotificationButton />
            <IconButton
              size="20"
              icon={<SettingsIcon />}
              tooltip={t['com.affine.settingSidebar.title']()}
              aria-label={t['com.affine.settingSidebar.title']()}
              onClick={() => setSettingsOpen(true)}
            />
            <UserInfo />
          </div>
        </header>
        <div
          className={styles.conversationAndPeek}
          data-project={!!selectedProject || !!workOrderId}
          data-work-order={!!workOrderId}
          data-panel={rightPanel.kind}
          data-fullscreen={fullscreen}
          data-view={mobileView}
        >
          {!selectedProjectId && !workOrderId && !newConversation ? (
            <ConversationBoard
              cards={conversationCards}
              projects={projects}
              onOpenCard={openConversationCard}
              onNewConversation={() => navigate(PROJECT_NEW_CONVERSATION_PATH)}
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
          {selectedProject ? (
            <div className={styles.conversationPane} hidden={fullscreen}>
              <WorkbenchConversation
                key={selectedProject.id}
                onDocumentsChanged={refreshWorkbench}
                selectedProjectId={selectedProject.id}
                selectedProjectName={selectedProject.name}
                officeContext={
                  officeContext &&
                  'projectId' in officeContext &&
                  officeContext.projectId === selectedProject.id
                    ? officeContext
                    : undefined
                }
                onOpenResource={resourceId => openProjectResource(resourceId)}
                onContextPanelChange={setContextPanel}
                onConfirmBlockerSuggestion={confirmBlockerSuggestion}
                selectedSessionId={selectedSessionId ?? undefined}
                selectedCard={selectedConversationCard ?? undefined}
                onCompleteConversation={completeConversation}
              />
            </div>
          ) : null}
          {selectedProject ? (
            <div className={styles.resourcePane}>
              {rightPanel.kind === 'context' ? (
                <ProjectContextPanel
                  projectId={selectedProject.id}
                  sessionId={selectedSessionId}
                  state={contextPanel}
                  onDocumentsChanged={refreshWorkbench}
                  onOpenResource={resourceId =>
                    openProjectResource(resourceId, 'context')
                  }
                />
              ) : rightPanel.kind === 'projectTree' ? (
                <div className={styles.filesPane}>
                  <ProjectFiles
                    key={selectedProject.id}
                    projectId={selectedProject.id}
                    parentId={directoryId}
                    selectedResourceId={selectedResourceId}
                    onOpen={resourceId =>
                      openProjectResource(resourceId, 'projectTree')
                    }
                  />
                </div>
              ) : (
                <div
                  className={styles.resourceWorkspace}
                  data-tree-open={rightPanel.treeOpen && !fullscreen}
                >
                  {rightPanel.treeOpen && !fullscreen ? (
                    <div className={styles.narrowTree}>
                      <ProjectFiles
                        key={`${selectedProject.id}:narrow`}
                        projectId={selectedProject.id}
                        parentId={directoryId}
                        selectedResourceId={rightPanel.resourceId}
                        onOpen={resourceId =>
                          openProjectResource(resourceId, rightPanel.openedFrom)
                        }
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
                    onClose={closeProjectResource}
                  />
                </div>
              )}
            </div>
          ) : null}
          {workOrderId ? (
            <>
              <div className={styles.conversationPane}>
                {loadedWorkOrder?.viewerRole === 'recipient' &&
                loadedWorkOrder.ownSessionId ? (
                  <WorkOrderConversation
                    key={workOrderId}
                    workOrderId={workOrderId}
                    sessionId={loadedWorkOrder.ownSessionId}
                    title={loadedWorkOrder.title}
                    status={loadedWorkOrder.status}
                  />
                ) : (
                  <div className={styles.workOrderSenderState}>
                    {t['com.affine.localmind.workbench.v9.senderUsesSource']()}
                  </div>
                )}
              </div>
              <div className={styles.resourcePane}>
                <WorkOrderPanel
                  key={workOrderId}
                  workOrderId={workOrderId}
                  onLoaded={setLoadedWorkOrder}
                  onChanged={conversationCards.refresh}
                />
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.taskScrim}
          hidden={!tasksOpen || !!workOrderId || newConversation}
          aria-label={t['Close']()}
          onClick={() => setTasksOpen(false)}
        />
        <div
          className={styles.taskArea}
          data-open={tasksOpen}
          hidden={!!workOrderId || newConversation}
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
      {collaborationProject ? (
        <ProjectCollaboration
          open
          project={collaborationProject}
          pendingKey={collaborationPendingKey}
          onOpenChange={open => {
            if (!open && !collaborationPendingKey) {
              setCollaborationProjectId(null);
            }
          }}
          onInvite={inviteProjectMember}
          onRemoveMember={removeProjectMember}
          onTransferOwnership={transferProjectOwnership}
          onLeave={leaveProject}
        />
      ) : null}
      <ProjectShellSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectId={selectedProject?.id}
      />
    </main>
  );
};
