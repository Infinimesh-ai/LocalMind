import { Button, notify, useConfirmModal } from '@affine/component';
import {
  type AIChatContextItem,
  AIChatRuntime,
  createAIRequestService,
  createRejectedPromptRecovery,
  ProjectAIChatSessionStrategy,
  useAIChatElement,
  useAIChatRuntime,
} from '@affine/core/blocksuite/ai';
import { AIChatContent } from '@affine/core/blocksuite/ai/components/ai-chat-content';
import type { AIChatDraft } from '@affine/core/blocksuite/ai/components/ai-chat-input';
import type {
  BlockerSuggestion,
  BlockerSuggestionConfirmation,
  WorkOrderAgentDraft,
  WorkOrderProposalActions,
} from '@affine/core/blocksuite/ai/components/ai-chat-messages';
import {
  AIChatToolbar,
  configureAIChatToolbar,
} from '@affine/core/blocksuite/ai/components/ai-chat-toolbar';
import { ByokNotConfiguredError } from '@affine/core/blocksuite/ai/provider/error';
import { getViewManager } from '@affine/core/blocksuite/manager/view';
import { NotificationServiceImpl } from '@affine/core/blocksuite/view-extensions/editor-view/notification-service';
import { AIToolsConfigService } from '@affine/core/modules/ai-button';
import {
  AuthService,
  EventSourceService,
  GraphQLService,
  ServerService,
  SubscriptionService,
} from '@affine/core/modules/cloud';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import {
  projectErrorMessage,
  reportProjectError as report,
} from '@affine/core/modules/project-resources/error';
import { AppThemeService } from '@affine/core/modules/theme';
import { UserFriendlyError } from '@affine/error';
import {
  confirmWorkOrderDispatchMutation,
  prepareWorkOrderDispatchMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type {
  OfficeAiContext,
  ProjectReportAiContext,
} from '@localmind/office';
import { useFramework, useService } from '@toeverything/infra';
import { assignInlineVars, setElementVars } from '@vanilla-extract/dynamic';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { prepareConversationDraft } from './prepare-conversation-draft';
import { useProjectChatConfig } from './project-chat-config';
import { ProjectFilePicker } from './project-file-picker';
import type { WorkbenchConversationCard } from './types';
import { useConversationHeaderVisibility } from './use-conversation-header-visibility';
import { useProjectAIAvailability } from './use-project-ai-availability';
import * as styles from './workbench-conversation.css';

function recipientsForDispatch(draft: WorkOrderAgentDraft) {
  return draft.recipients.map(recipient => ({
    recipientId: recipient.recipient.id,
    title: recipient.title,
    purpose: recipient.purpose,
    relationKind: recipient.relationKind,
    relatedWorkOrderId: recipient.relatedWorkOrderId ?? undefined,
    backgroundLabel: undefined,
    sharedMaterialIds: [],
    requirements: recipient.requirements.map((item, index) => ({
      itemKey: String(index + 1),
      kind: item.kind,
      title: item.title,
      instructions: item.instructions,
      required: item.required,
      acceptedMimeTypes: item.kind === 'file' ? item.acceptedMimeTypes : [],
      minCount: item.required ? item.minCount : 0,
      maxCount: item.maxCount,
      validationMode:
        item.kind === 'file' ? 'mime_and_container' : 'non_empty_text',
    })),
  }));
}

type WorkbenchConversationProps = {
  onDocumentsChanged?: () => Promise<unknown>;
  selectedProjectId: string;
  selectedProjectName?: string;
  onOpenResource: (resourceId: string) => void;
  onConfirmBlockerSuggestion?: (suggestion: BlockerSuggestion) => Promise<void>;
  officeContext?: OfficeAiContext;
  reportContext?: ProjectReportAiContext;
  selectedSessionId?: string;
  selectedCard?: WorkbenchConversationCard;
  onCompleteConversation?: (card: WorkbenchConversationCard) => Promise<void>;
  startEmpty?: boolean;
  initialDraftText?: string;
  initialDraft?: AIChatDraft;
  autoSendInitialDraft?: boolean;
  onSessionCreated?: (sessionId: string) => Promise<unknown> | unknown;
  onPinChanged?: () => void;
  onContextPanelChange?: (state: WorkbenchContextPanelState | null) => void;
  /** Extra controls in the title card, e.g. the work order panel toggle. */
  headerActions?: ReactNode;
  /** Shown under the title card, e.g. AI execution progress. */
  banner?: ReactNode;
};

export type WorkbenchContextPanelState = {
  resourceIds: string[];
  items?: AIChatContextItem[];
  error?: Error | null;
  loading: boolean;
  openPicker: () => void;
  referenceResource: (resourceId: string) => Promise<void>;
  refresh?: () => Promise<void>;
};

const useAIRequestService = () => {
  const graphqlService = useService(GraphQLService);
  const eventSourceService = useService(EventSourceService);

  return useMemo(
    () =>
      createAIRequestService(
        graphqlService.gql,
        eventSourceService.eventSource
      ),
    [eventSourceService, graphqlService]
  );
};

export const WorkbenchConversation = ({
  onDocumentsChanged,
  selectedProjectId,
  selectedProjectName,
  onOpenResource,
  onConfirmBlockerSuggestion,
  officeContext,
  reportContext,
  selectedSessionId,
  selectedCard,
  onCompleteConversation,
  startEmpty = false,
  initialDraftText,
  initialDraft,
  autoSendInitialDraft = false,
  onSessionCreated,
  onPinChanged,
  onContextPanelChange,
  headerActions,
  banner,
}: WorkbenchConversationProps) => {
  const t = useI18n();
  const framework = useFramework();
  const graphql = useService(GraphQLService);
  const requestService = useAIRequestService();
  const auth = useService(AuthService);
  const {
    model: projectModel,
    configuration,
    notice,
    sendBlocked,
  } = useProjectAIAvailability(selectedProjectId);
  const [bodyReady, setBodyReady] = useState(false);
  const [toolbarReady, setToolbarReady] = useState(false);
  const headerOverlayRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const overlay = headerOverlayRef.current;
    const root = overlay?.parentElement;
    if (!overlay || !root) return;
    const measure = () => {
      setElementVars(root, {
        [styles.headerHeightVar]: `${overlay.getBoundingClientRect().height}px`,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = contentContainerRef.current;
    if (!bodyReady || !container) return;
    let composer: HTMLElement | null = null;
    let status: HTMLElement | null = null;
    const measure = () => {
      const composerHeight = composer?.getBoundingClientRect().height ?? 0;
      const statusHeight = status?.getBoundingClientRect().height ?? 0;
      setElementVars(container, {
        [styles.composerHeightVar]: `${composerHeight}px`,
        [styles.footerHeightVar]: `${composerHeight + statusHeight}px`,
      });
    };
    const resizeObserver = new ResizeObserver(measure);
    const observe = () => {
      composer = container.querySelector('ai-chat-composer');
      status = container.querySelector('ai-context-compaction-status');
      if (!composer || !status) return;
      resizeObserver.observe(composer);
      resizeObserver.observe(status);
      mutationObserver.disconnect();
      measure();
    };
    // The Lit content mounts asynchronously inside the React host.
    const mutationObserver = new MutationObserver(observe);
    mutationObserver.observe(container, { childList: true, subtree: true });
    observe();
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [bodyReady]);
  const blockerSuggestionConfirmation = useMemo<
    BlockerSuggestionConfirmation | undefined
  >(
    () =>
      onConfirmBlockerSuggestion
        ? {
            onConfirm: onConfirmBlockerSuggestion,
            labels: {
              title: t['com.affine.localmind.workbench.blocker.suggestion'](),
              type: t['com.affine.localmind.workbench.blocker.type'](),
              waitingOn:
                t['com.affine.localmind.workbench.blocker.waitingOnLabel'](),
              dueAt: t['com.affine.localmind.workbench.blocker.dueAt'](),
              create:
                t['com.affine.localmind.workbench.blocker.suggestionCreate'](),
              creating:
                t[
                  'com.affine.localmind.workbench.blocker.suggestionCreating'
                ](),
              created:
                t['com.affine.localmind.workbench.blocker.suggestionCreated'](),
              failed:
                t['com.affine.localmind.workbench.blocker.suggestionFailed'](),
              typeNames: {
                wait_reply:
                  t['com.affine.localmind.workbench.blocker.type.reply'](),
                wait_file:
                  t['com.affine.localmind.workbench.blocker.type.file'](),
                wait_decision:
                  t['com.affine.localmind.workbench.blocker.type.decision'](),
                custom:
                  t['com.affine.localmind.workbench.blocker.type.custom'](),
              },
            },
          }
        : undefined,
    [onConfirmBlockerSuggestion, t]
  );

  const runtime = useMemo(
    () =>
      new AIChatRuntime({
        request: requestService,
        scope: { kind: 'project', projectId: selectedProjectId },
        strategy: new ProjectAIChatSessionStrategy(startEmpty),
        chatSurface: 'intelligence_workbench',
        projectId: selectedProjectId,
        rejectedPromptRecovery: createRejectedPromptRecovery(
          () => auth.session.account$.value?.id
        ),
      }),
    [auth, requestService, selectedProjectId, startEmpty]
  );
  const snapshot = useAIChatRuntime(runtime);
  const headerHidden = useConversationHeaderVisibility({
    contentRef: contentContainerRef,
    headerRef,
    enabled: bodyReady,
    sessionKey:
      snapshot?.activeSessionId ?? selectedSessionId ?? selectedProjectId,
  });
  const previousStatus = useRef(snapshot?.status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = snapshot?.status;
    if (
      previous === 'transmitting' &&
      (snapshot?.status === 'success' || snapshot?.status === 'error')
    ) {
      onDocumentsChanged?.().catch(report);
    }
  }, [onDocumentsChanged, snapshot?.status]);
  const activeSession =
    snapshot?.sessions.find(
      session => session.sessionId === snapshot.activeSessionId
    ) ?? null;
  const workOrderProposalActions = useMemo<WorkOrderProposalActions>(() => {
    const errorMessage = (error: unknown) =>
      UserFriendlyError.fromAny(error).message ===
      'New personal work orders are disabled by the instance administrator'
        ? t['com.affine.localmind.workbench.v9.workOrderModelMissing']()
        : projectErrorMessage(error);
    return {
      sourceProjectName: selectedProjectName,
      canAct: draft =>
        snapshot?.activeSessionId === draft.sourceSessionId &&
        snapshot.uiPolicy.canSend,
      onSend: async draft => {
        if (runtime.getSnapshot().activeSessionId !== draft.sourceSessionId) {
          throw new Error('Work order draft belongs to another conversation');
        }
        try {
          const result = await graphql.gql({
            query: prepareWorkOrderDispatchMutation,
            variables: {
              sourceSessionId: draft.sourceSessionId,
              requestKey: `agent-draft:${draft.draftId}`,
              recipients: recipientsForDispatch(draft),
            },
          });
          const prepared = result.prepareWorkOrderDispatch;
          if (prepared.confirmationToken) {
            await graphql.gql({
              query: confirmWorkOrderDispatchMutation,
              variables: {
                dispatchId: prepared.dispatchId,
                confirmationToken: prepared.confirmationToken,
                expectedDraftVersion: prepared.draftVersion,
                requestKey: `confirm-agent-draft:${draft.draftId}`,
              },
            });
          }
          const refresh = onDocumentsChanged?.();
          if (refresh) void refresh.catch(report);
          notify.success({
            title: t['com.affine.localmind.workbench.v9.workOrdersSent'](),
          });
        } catch (error) {
          notify.error({
            title: t['com.affine.localmind.workbench.v9.sendFailed'](),
            message: errorMessage(error),
          });
          throw error;
        }
      },
      errorMessage,
      onRequestRevision: async (draft, feedback) => {
        const current = runtime.getSnapshot();
        if (
          current.activeSessionId !== draft.sourceSessionId ||
          !current.uiPolicy.canSend
        ) {
          throw new Error('Conversation is not ready for work order revision');
        }
        const titles = draft.recipients.map(item => item.title).join('、');
        await runtime.dispatch({
          type: 'send',
          input: `${t['com.affine.localmind.workbench.v9.revisionPrompt']()}\n${titles}\n${feedback.trim()}`,
        });
        const result = runtime.getSnapshot();
        if (result.status !== 'success') {
          throw result.error ?? new Error('Work order revision was not sent');
        }
      },
      labels: {
        title: t['com.affine.localmind.workbench.v9.workOrderDraft'](),
        notice: t['com.affine.localmind.workbench.v9.proposalNotice'](),
        sourceProject: t['com.affine.localmind.workbench.v9.sourceProject'](),
        sourceProjectDisclosure:
          t['com.affine.localmind.workbench.v9.sourceProjectDisclosure'](),
        recipient: t['com.affine.localmind.workbench.v9.recipient'](),
        requirements: t['com.affine.localmind.workbench.v9.requirements'](),
        required: t['com.affine.localmind.workbench.v9.required'](),
        optional: t['com.affine.localmind.workbench.v9.proposalOptional'](),
        file: t['com.affine.localmind.workbench.v9.proposalFile'](),
        text: t['com.affine.localmind.workbench.v9.proposalText'](),
        formats: t['com.affine.localmind.workbench.v9.proposalFormats'](),
        count: t['com.affine.localmind.workbench.v9.proposalCount'](),
        relation: t['com.affine.localmind.workbench.v9.relationKind'](),
        relationNames: {
          original: t['com.affine.localmind.workbench.v9.proposalOriginal'](),
          supplement:
            t['com.affine.localmind.workbench.v9.proposalSupplement'](),
          replacement:
            t['com.affine.localmind.workbench.v9.proposalReplacement'](),
        },
        feedback: t['com.affine.localmind.workbench.v9.proposalFeedback'](),
        send: t['com.affine.localmind.workbench.v9.proposalSend'](),
        sending: t['com.affine.localmind.workbench.v9.proposalSending'](),
        sent: t['com.affine.localmind.workbench.v9.proposalSent'](),
        revise: t['com.affine.localmind.workbench.v9.proposalRevise'](),
        revising: t['com.affine.localmind.workbench.v9.proposalRevising'](),
        revisionRequested:
          t['com.affine.localmind.workbench.v9.proposalRevisionRequested'](),
        cancel: t['com.affine.localmind.workbench.v9.proposalCancel'](),
        cancelled: t['com.affine.localmind.workbench.v9.proposalCancelled'](),
        failed: t['com.affine.localmind.workbench.v9.proposalFailed'](),
        waiting: t['com.affine.localmind.workbench.v9.proposalWaiting'](),
      },
    };
  }, [
    graphql,
    onDocumentsChanged,
    runtime,
    selectedProjectName,
    snapshot?.activeSessionId,
    snapshot?.uiPolicy.canSend,
    t,
  ]);

  useEffect(() => () => runtime.dispose(), [runtime]);

  const initialDraftApplied = useRef(false);
  const uploadedDraftFiles = useRef(new Set<File>());
  const draftOperation = useRef(false);
  const [draftPreparing, setDraftPreparing] = useState(false);
  const [draftError, setDraftError] = useState<unknown>(null);
  const applyInitialDraft = useCallback(async () => {
    if (draftOperation.current) return;
    draftOperation.current = true;
    setDraftPreparing(true);
    setDraftError(null);
    try {
      const draft = initialDraft ?? {
        text: initialDraftText ?? '',
        files: [],
        images: [],
      };
      await runtime.dispatch({ type: 'setComposerText', text: draft.text });
      if (autoSendInitialDraft) {
        const options = await prepareConversationDraft(
          runtime,
          draft,
          uploadedDraftFiles.current
        );
        setDraftPreparing(false);
        await runtime.dispatch({ type: 'send', ...options });
      }
    } catch (error) {
      setDraftError(error);
    } finally {
      draftOperation.current = false;
      setDraftPreparing(false);
    }
  }, [autoSendInitialDraft, initialDraft, initialDraftText, runtime]);
  useEffect(() => {
    if (
      initialDraftApplied.current ||
      !(initialDraft?.text || initialDraftText) ||
      snapshot?.readiness !== 'ready' ||
      (autoSendInitialDraft && configuration !== 'configured')
    ) {
      return;
    }
    initialDraftApplied.current = true;
    applyInitialDraft().catch(report);
  }, [
    applyInitialDraft,
    autoSendInitialDraft,
    configuration,
    initialDraft,
    initialDraftText,
    snapshot?.readiness,
  ]);

  useEffect(() => {
    if (snapshot?.error instanceof ByokNotConfiguredError)
      projectModel.refresh();
  }, [projectModel, snapshot?.error]);

  const createdSessionReported = useRef(false);
  useEffect(() => {
    const createdWhileSending =
      !startEmpty &&
      snapshot?.activeSessionId !== selectedSessionId &&
      (snapshot?.status === 'loading' || snapshot?.status === 'transmitting');
    if (
      snapshot?.activeSessionId &&
      (createdWhileSending || (startEmpty && snapshot.status === 'success')) &&
      !createdSessionReported.current
    ) {
      createdSessionReported.current = true;
      void onSessionCreated?.(snapshot.activeSessionId);
    }
  }, [
    onSessionCreated,
    snapshot?.activeSessionId,
    snapshot?.status,
    startEmpty,
    selectedSessionId,
  ]);

  const requestedSessionId = useRef<string | null>(null);
  useEffect(() => {
    if (snapshot?.activeSessionId === selectedSessionId) {
      requestedSessionId.current = null;
    }
    if (
      !selectedSessionId ||
      snapshot?.readiness !== 'ready' ||
      snapshot.activeSessionId === selectedSessionId ||
      snapshot.status === 'loading' ||
      snapshot.status === 'transmitting' ||
      requestedSessionId.current === selectedSessionId
    ) {
      return;
    }
    requestedSessionId.current = selectedSessionId;
    runtime
      .dispatch({ type: 'openSession', sessionId: selectedSessionId })
      .catch(report);
  }, [
    runtime,
    selectedSessionId,
    snapshot?.activeSessionId,
    snapshot?.readiness,
    snapshot?.status,
  ]);

  useEffect(() => {
    runtime
      .dispatch({
        type: 'setSelectedContextProject',
        projectId: selectedProjectId,
        projectName: selectedProjectName,
      })
      .catch(report);
  }, [
    runtime,
    selectedProjectId,
    selectedProjectName,
    snapshot?.activeSessionId,
  ]);

  const [documentPicker, setDocumentPicker] = useState<{
    tabId: string | null;
    resourceIds: string[];
    limit: number;
  } | null>(null);
  const openDocuments = useCallback(() => {
    const current = runtime.getSnapshot();
    if (current.composer.context.loading) return;
    const items = current.composer.context.items;
    setDocumentPicker({
      tabId: current.activeTabId,
      resourceIds: items.flatMap(item =>
        item.kind === 'doc' ? [item.docId] : []
      ),
      limit: Math.max(0, 16 - items.filter(item => item.kind !== 'doc').length),
    });
  }, [runtime]);
  const referenceResource = useCallback(
    async (resourceId: string) => {
      const current = runtime.getSnapshot();
      if (current.composer.context.loading) return;
      const resourceIds = current.composer.context.items.flatMap(item =>
        item.kind === 'doc' ? [item.docId] : []
      );
      if (resourceIds.includes(resourceId)) return;
      await runtime.dispatch({
        type: 'setProjectContextResources',
        tabId: current.activeTabId,
        baseResourceIds: resourceIds,
        resourceIds: [...resourceIds, resourceId],
      });
    },
    [runtime]
  );
  const contextResourceIds = useMemo(
    () =>
      snapshot?.composer.context.items.flatMap(item =>
        item.kind === 'doc' ? [item.docId] : []
      ) ?? [],
    [snapshot?.composer.context.items]
  );
  const contextPanelState = useMemo<WorkbenchContextPanelState>(
    () => ({
      resourceIds: contextResourceIds,
      items: snapshot?.composer.context.items ?? [],
      error: snapshot?.composer.context.error,
      loading: snapshot?.composer.context.loading ?? false,
      openPicker: openDocuments,
      referenceResource,
      refresh: () => runtime.dispatch({ type: 'refreshProjectContext' }),
    }),
    [
      contextResourceIds,
      openDocuments,
      referenceResource,
      snapshot?.composer.context.loading,
      snapshot?.composer.context.items,
      snapshot?.composer.context.error,
      runtime,
    ]
  );
  useEffect(() => {
    onContextPanelChange?.(contextPanelState);
    return () => onContextPanelChange?.(null);
  }, [contextPanelState, onContextPanelChange]);
  useEffect(() => {
    setDocumentPicker(null);
  }, [snapshot?.activeTabId, selectedProjectId]);
  const { docDisplayConfig, searchMenuConfig, reasoningConfig } =
    useProjectChatConfig(selectedProjectId, openDocuments);
  const specs = useMemo(
    () => getViewManager().config.init().value.get('page'),
    []
  );
  const confirmModal = useConfirmModal();
  const notificationService = useMemo(
    () =>
      new NotificationServiceImpl(
        confirmModal.closeConfirmModal,
        confirmModal.openConfirmModal
      ),
    [confirmModal.closeConfirmModal, confirmModal.openConfirmModal]
  );

  const deleteSession = useCallback(
    async (session: BlockSuitePresets.AIRecentSession) => {
      const confirmed = await notificationService.confirm({
        title: t['com.affine.ai.chat-panel.session.delete.confirm.title'](),
        message: t['com.affine.ai.chat-panel.session.delete.confirm.message'](),
        confirmText: t['Delete'](),
        cancelText: t['Cancel'](),
      });
      if (!confirmed) return;
      await runtime.dispatch({
        type: 'deleteSession',
        sessionId: session.sessionId,
      });
      notificationService.toast(
        t['com.affine.ai.chat-panel.session.delete.toast.success'](),
        {}
      );
    },
    [notificationService, runtime, t]
  );

  useAIChatElement({
    containerRef: contentContainerRef,
    selector: 'ai-chat-content',
    enabled: bodyReady,
    createElement: () => new AIChatContent(),
    configureElement: content => {
      content.session = activeSession;
      content.runtime = runtime;
      content.runtimeSnapshot = snapshot;
      content.workspaceId = undefined;
      content.officeContext = officeContext;
      content.reportContext = reportContext;
      content.extensions = specs;
      content.docDisplayConfig = docDisplayConfig;
      content.searchMenuConfig = searchMenuConfig;
      content.reasoningConfig = reasoningConfig;
      content.affineFeatureFlagService = framework.get(FeatureFlagService);
      content.affineThemeService = framework.get(AppThemeService);
      content.notificationService = notificationService;
      content.aiToolsConfigService = framework.get(AIToolsConfigService);
      content.serverService = framework.get(ServerService);
      content.subscriptionService = framework.get(SubscriptionService);
      content.aiModelService = projectModel;
      content.composerNotice =
        configuration === 'configured' &&
        snapshot?.error instanceof ByokNotConfiguredError
          ? {
              title: t['com.affine.localmind.project-byok.readyToRetry'](),
              action: {
                label: t['Retry'](),
                onClick: () => {
                  runtime
                    .dispatch({
                      type: 'retry',
                      messageId: snapshot.messages.at(-1)?.id ?? '',
                    })
                    .catch(report);
                },
              },
            }
          : notice;
      content.sendBlocked = sendBlocked;
      content.onOpenDoc = onOpenResource;
      content.blockerSuggestionConfirmation = blockerSuggestionConfirmation;
      content.workOrderProposalActions = workOrderProposalActions;
    },
    onElementReady: content => {
      content.independentMode = true;
      content.onboardingOffsetY = -80;
    },
  });

  useAIChatElement({
    containerRef: toolbarContainerRef,
    selector: 'ai-chat-toolbar',
    enabled: toolbarReady,
    createElement: () => new AIChatToolbar(),
    configureElement: toolbar => {
      configureAIChatToolbar(toolbar, {
        session: activeSession,
        runtime,
        runtimeSnapshot: snapshot ?? runtime.getSnapshot(),
        docDisplayConfig,
        notificationService,
        onOpenDoc: onOpenResource,
        onSessionDelete: session => {
          deleteSession(session).catch(report);
        },
        onPinChanged,
        showNewConversation: false,
      });
    },
  });

  const setContentContainer = useCallback((node: HTMLDivElement | null) => {
    contentContainerRef.current = node;
    setBodyReady(!!node);
  }, []);
  const setToolbarContainer = useCallback((node: HTMLDivElement | null) => {
    toolbarContainerRef.current = node;
    setToolbarReady(!!node);
  }, []);

  return (
    <section
      className={styles.floatingHeaderRoot}
      aria-label={t['com.affine.localmind.workbench.conversation']()}
      data-testid="workbench-conversation"
      style={assignInlineVars({
        [styles.youLabelVar]: JSON.stringify(
          t['com.affine.localmind.workbench.orbit.you']()
        ),
      })}
    >
      <div className={styles.headerOverlay} ref={headerOverlayRef}>
        <header
          ref={headerRef}
          className={styles.header}
          data-hidden={headerHidden}
        >
          <div className={styles.conversationIdentity}>
            <strong title={activeSession?.title ?? undefined}>
              {activeSession?.title ||
                t['com.affine.localmind.workbench.v9.newConversation']()}
            </strong>
            <span>{selectedProjectName}</span>
          </div>
          <div className={styles.tools}>
            {selectedCard ? (
              <span className={styles.status} data-column={selectedCard.column}>
                {t[
                  selectedCard.column === 'todo'
                    ? 'com.affine.localmind.workbench.v9.todo'
                    : selectedCard.column === 'done'
                      ? 'com.affine.localmind.workbench.v9.done'
                      : 'com.affine.localmind.workbench.v9.progress'
                ]()}
              </span>
            ) : null}
            {selectedCard &&
            selectedCard.column !== 'done' &&
            selectedCard.scopeType !== 'work_order' &&
            onCompleteConversation ? (
              <Button onClick={() => void onCompleteConversation(selectedCard)}>
                {t['com.affine.localmind.workbench.v9.markComplete']()}
              </Button>
            ) : null}
            {headerActions}
            <div ref={setToolbarContainer} />
          </div>
        </header>
        {banner ? <div className={styles.banner}>{banner}</div> : null}
        {draftError ? (
          <div role="alert" className={styles.configuration}>
            <span>{projectErrorMessage(draftError)}</span>
            <Button onClick={() => void applyInitialDraft()}>
              {t['Retry']()}
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className={styles.content}
        ref={setContentContainer}
        inert={draftPreparing || !!draftError}
        aria-busy={draftPreparing || undefined}
      />
      {documentPicker ? (
        <ProjectFilePicker
          projectId={selectedProjectId}
          initialSelection={documentPicker.resourceIds}
          limit={documentPicker.limit}
          onClose={() => setDocumentPicker(null)}
          onSave={resourceIds =>
            runtime.dispatch({
              type: 'setProjectContextResources',
              tabId: documentPicker.tabId,
              baseResourceIds: documentPicker.resourceIds,
              resourceIds,
            })
          }
        />
      ) : null}
    </section>
  );
};
