import { Button, useConfirmModal } from '@affine/component';
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
import { reportProjectError as report } from '@affine/core/modules/project-resources/error';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import { AppThemeService } from '@affine/core/modules/theme';
import type { ProjectAgentTaskFieldsFragment } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type { OfficeAiContext } from '@localmind/office';
import { useFramework, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProjectChatConfig } from './project-chat-config';
import { ProjectFilePicker } from './project-file-picker';
import { ProjectTasks } from './project-tasks';
import type { WorkbenchConversationCard } from './types';
import {
  type WorkOrderAgentDraft,
  WorkOrderComposer,
} from './work-order-composer';
import * as styles from './workbench-conversation.css';

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function workOrderDraftFromStreamObject(
  value: unknown
): WorkOrderAgentDraft | null {
  const stream = object(value);
  if (
    stream?.type !== 'tool-result' ||
    stream.toolName !== 'work_order_draft' ||
    stream.isError === true
  )
    return null;
  const result = object(stream.result);
  if (
    result?.kind !== 'work_order_draft' ||
    result.origin !== 'ai_generated' ||
    result.confirmationRequired !== true ||
    typeof result.draftId !== 'string' ||
    typeof result.sourceSessionId !== 'string' ||
    !Array.isArray(result.recipients) ||
    !result.recipients.length ||
    result.recipients.length > 20
  )
    return null;
  const recipients: WorkOrderAgentDraft['recipients'] = [];
  for (const candidate of result.recipients) {
    const row = object(candidate);
    const recipient = object(row?.recipient);
    if (
      !row ||
      !recipient ||
      typeof recipient.id !== 'string' ||
      typeof recipient.name !== 'string' ||
      typeof recipient.email !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.purpose !== 'string' ||
      !['original', 'supplement', 'replacement'].includes(
        String(row.relationKind)
      ) ||
      !Array.isArray(row.requirements) ||
      !row.requirements.length ||
      row.requirements.length > 32
    )
      return null;
    const requirements: WorkOrderAgentDraft['recipients'][number]['requirements'] =
      [];
    for (const candidateRequirement of row.requirements) {
      const requirement = object(candidateRequirement);
      if (
        !requirement ||
        !['text', 'file'].includes(String(requirement.kind)) ||
        typeof requirement.title !== 'string' ||
        typeof requirement.instructions !== 'string' ||
        typeof requirement.required !== 'boolean' ||
        !Array.isArray(requirement.acceptedMimeTypes) ||
        !requirement.acceptedMimeTypes.every(
          mimeType => typeof mimeType === 'string'
        ) ||
        typeof requirement.minCount !== 'number' ||
        typeof requirement.maxCount !== 'number'
      )
        return null;
      requirements.push({
        kind: requirement.kind as 'text' | 'file',
        title: requirement.title,
        instructions: requirement.instructions,
        required: requirement.required,
        acceptedMimeTypes: requirement.acceptedMimeTypes as string[],
        minCount: requirement.minCount,
        maxCount: requirement.maxCount,
      });
    }
    recipients.push({
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
      },
      title: row.title,
      purpose: row.purpose,
      relationKind: row.relationKind as
        | 'original'
        | 'supplement'
        | 'replacement',
      relatedWorkOrderId:
        typeof row.relatedWorkOrderId === 'string'
          ? row.relatedWorkOrderId
          : null,
      requirements,
    });
  }
  return {
    draftId: result.draftId,
    sourceSessionId: result.sourceSessionId,
    recipients,
  };
}

type WorkbenchConversationProps = {
  onDocumentsChanged?: () => Promise<unknown>;
  selectedProjectId: string;
  selectedProjectName?: string;
  onOpenResource: (resourceId: string) => void;
  onConfirmBlockerSuggestion?: (suggestion: BlockerSuggestion) => Promise<void>;
  officeContext?: OfficeAiContext;
  onTaskCompleted?: (task: ProjectAgentTaskFieldsFragment) => Promise<unknown>;
  selectedSessionId?: string;
  selectedCard?: WorkbenchConversationCard;
  onCompleteConversation?: (card: WorkbenchConversationCard) => Promise<void>;
  startEmpty?: boolean;
  initialDraftText?: string;
  autoSendInitialDraft?: boolean;
  onSessionCreated?: (sessionId: string) => Promise<unknown> | unknown;
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
  onTaskCompleted,
  selectedSessionId,
  selectedCard,
  onCompleteConversation,
  startEmpty = false,
  initialDraftText,
  autoSendInitialDraft = false,
  onSessionCreated,
  onContextPanelChange,
}: WorkbenchConversationProps) => {
  const t = useI18n();
  const framework = useFramework();
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
  const [workOrderComposerOpen, setWorkOrderComposerOpen] = useState(false);
  const [agentWorkOrderDraft, setAgentWorkOrderDraft] =
    useState<WorkOrderAgentDraft | null>(null);
  const seenAgentDrafts = useRef(new Set<string>());
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
  const handleTaskCompleted = useCallback(
    async (task: ProjectAgentTaskFieldsFragment) => {
      if (onTaskCompleted) await onTaskCompleted(task);
      else await onDocumentsChanged?.();
    },
    [onDocumentsChanged, onTaskCompleted]
  );
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
  useEffect(() => {
    if (!snapshot?.messages.length || !activeSession) return;
    for (let index = snapshot.messages.length - 1; index >= 0; index--) {
      const message = snapshot.messages[index];
      for (
        let objectIndex = (message.streamObjects?.length ?? 0) - 1;
        objectIndex >= 0;
        objectIndex--
      ) {
        const draft = workOrderDraftFromStreamObject(
          message.streamObjects?.[objectIndex]
        );
        if (
          !draft ||
          draft.sourceSessionId !== activeSession.sessionId ||
          seenAgentDrafts.current.has(draft.draftId)
        )
          continue;
        seenAgentDrafts.current.add(draft.draftId);
        setAgentWorkOrderDraft(draft);
        setWorkOrderComposerOpen(true);
        return;
      }
    }
  }, [activeSession, snapshot?.messages]);

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
    if (
      startEmpty &&
      snapshot?.activeSessionId &&
      (snapshot.status === 'success' || snapshot.status === 'error') &&
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
  ]);

  useEffect(() => {
    if (
      !selectedSessionId ||
      snapshot?.readiness !== 'ready' ||
      snapshot.activeSessionId === selectedSessionId
    ) {
      return;
    }
    runtime
      .dispatch({ type: 'openSession', sessionId: selectedSessionId })
      .catch(report);
  }, [
    runtime,
    selectedSessionId,
    snapshot?.activeSessionId,
    snapshot?.readiness,
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
          {activeSession ? (
            <Button
              onClick={() => {
                setAgentWorkOrderDraft(null);
                setWorkOrderComposerOpen(true);
              }}
            >
              {t['com.affine.localmind.workbench.v9.sendWorkOrder']()}
            </Button>
          ) : null}
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
      <ProjectTasks
        key={`${selectedProjectId}:${snapshot?.activeSessionId ?? ''}`}
        projectId={selectedProjectId}
        sessionId={snapshot?.activeSessionId ?? undefined}
        onCompleted={handleTaskCompleted}
        onOpenResource={onOpenResource}
      />
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
      {activeSession ? (
        <WorkOrderComposer
          sourceSessionId={activeSession.sessionId}
          open={workOrderComposerOpen}
          onOpenChange={setWorkOrderComposerOpen}
          agentDraft={agentWorkOrderDraft}
          onSent={() => {
            setAgentWorkOrderDraft(null);
            return onDocumentsChanged?.();
          }}
        />
      ) : null}
    </section>
  );
};
