import { Button, notify, useConfirmModal } from '@affine/component';
import {
  AIChatRuntime,
  createAIRequestService,
  ProjectAIChatSessionStrategy,
  useAIChatElement,
  useAIChatRuntime,
} from '@affine/core/blocksuite/ai';
import { AIChatContent } from '@affine/core/blocksuite/ai/components/ai-chat-content';
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
import { getViewManager } from '@affine/core/blocksuite/manager/view';
import { NotificationServiceImpl } from '@affine/core/blocksuite/view-extensions/editor-view/notification-service';
import { AIToolsConfigService } from '@affine/core/modules/ai-button';
import { ProjectAIModel } from '@affine/core/modules/ai-button/entities/project-model';
import {
  EventSourceService,
  GraphQLService,
  ServerService,
  SubscriptionService,
  UserFeatureService,
} from '@affine/core/modules/cloud';
import { useSignalValue } from '@affine/core/modules/doc-info/utils';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import {
  projectErrorMessage,
  reportProjectError as report,
} from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import { AppThemeService } from '@affine/core/modules/theme';
import { UserFriendlyError } from '@affine/error';
import {
  confirmWorkOrderDispatchMutation,
  prepareWorkOrderDispatchMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type { OfficeAiContext } from '@localmind/office';
import { useFramework, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProjectChatConfig } from './project-chat-config';
import { ProjectFilePicker } from './project-file-picker';
import type { WorkbenchConversationCard } from './types';
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
  selectedSessionId?: string;
  selectedCard?: WorkbenchConversationCard;
  onCompleteConversation?: (card: WorkbenchConversationCard) => Promise<void>;
  startEmpty?: boolean;
  initialDraftText?: string;
  autoSendInitialDraft?: boolean;
  onSessionCreated?: (sessionId: string) => Promise<unknown> | unknown;
  onPinChanged?: () => void;
  onContextPanelChange?: (state: WorkbenchContextPanelState | null) => void;
};

export type WorkbenchContextPanelState = {
  resourceIds: string[];
  loading: boolean;
  openPicker: () => void;
  referenceResource: (resourceId: string) => Promise<void>;
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
  selectedSessionId,
  selectedCard,
  onCompleteConversation,
  startEmpty = false,
  initialDraftText,
  autoSendInitialDraft = false,
  onSessionCreated,
  onPinChanged,
  onContextPanelChange,
}: WorkbenchConversationProps) => {
  const t = useI18n();
  const framework = useFramework();
  const graphql = useService(GraphQLService);
  const requestService = useAIRequestService();
  const projectModel = useMemo(
    () =>
      framework.createEntity(ProjectAIModel, { projectId: selectedProjectId }),
    [framework, selectedProjectId]
  );
  useEffect(() => () => projectModel.dispose(), [projectModel]);
  useProjectRefresh(selectedProjectId, 'list', projectModel.refresh);
  const configuration = useSignalValue(projectModel.configuration);
  const isAdmin = useLiveData(
    useService(UserFeatureService).userFeature.isAdmin$
  );
  const [bodyReady, setBodyReady] = useState(false);
  const [toolbarReady, setToolbarReady] = useState(false);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
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
      }),
    [requestService, selectedProjectId, startEmpty]
  );
  const snapshot = useAIChatRuntime(runtime);
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
      },
    };
  }, [graphql, onDocumentsChanged, runtime, selectedProjectName, t]);

  useEffect(() => () => runtime.dispose(), [runtime]);

  const initialDraftApplied = useRef(false);
  useEffect(() => {
    if (
      initialDraftApplied.current ||
      !initialDraftText ||
      snapshot?.readiness !== 'ready'
    ) {
      return;
    }
    initialDraftApplied.current = true;
    void runtime
      .dispatch({ type: 'setComposerText', text: initialDraftText })
      .then(() =>
        autoSendInitialDraft
          ? runtime.dispatch({ type: 'send', input: initialDraftText })
          : undefined
      )
      .catch(report);
  }, [autoSendInitialDraft, initialDraftText, runtime, snapshot?.readiness]);

  const createdSessionReported = useRef(false);
  useEffect(() => {
    const createdWhileSending =
      !startEmpty &&
      snapshot?.activeSessionId !== selectedSessionId &&
      (snapshot?.status === 'loading' || snapshot?.status === 'transmitting');
    if (
      snapshot?.activeSessionId &&
      (createdWhileSending ||
        (startEmpty &&
          (snapshot.status === 'success' || snapshot.status === 'error'))) &&
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
      loading: snapshot?.composer.context.loading ?? false,
      openPicker: openDocuments,
      referenceResource,
    }),
    [
      contextResourceIds,
      openDocuments,
      referenceResource,
      snapshot?.composer.context.loading,
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
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.conversation']()}
      data-testid="workbench-conversation"
    >
      <header className={styles.header}>
        <div className={styles.conversationIdentity}>
          <strong>
            {activeSession?.title ||
              t['com.affine.localmind.workbench.v9.newConversation']()}
          </strong>
          <span>{selectedProjectName}</span>
        </div>
        <div className={styles.tools}>
          {selectedCard &&
          selectedCard.column !== 'done' &&
          selectedCard.scopeType !== 'work_order' &&
          onCompleteConversation ? (
            <Button onClick={() => void onCompleteConversation(selectedCard)}>
              {t['com.affine.localmind.workbench.v9.markComplete']()}
            </Button>
          ) : null}
          <div ref={setToolbarContainer} />
        </div>
      </header>
      {configuration === 'missing' || configuration === 'error' ? (
        <div role="status" className={styles.configuration}>
          <span>
            {t[
              configuration === 'missing'
                ? 'com.affine.localmind.project-byok.missing'
                : 'com.affine.localmind.project-byok.error'
            ]()}
          </span>
          {configuration === 'error' ? (
            <Button onClick={projectModel.refresh}>{t['Retry']()}</Button>
          ) : isAdmin ? (
            <a href="/admin/ai/config">
              {t['com.affine.localmind.project-byok.configure']()}
            </a>
          ) : (
            <span>{t['com.affine.localmind.project-byok.contactAdmin']()}</span>
          )}
        </div>
      ) : null}
      <div className={styles.content} ref={setContentContainer} />
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
