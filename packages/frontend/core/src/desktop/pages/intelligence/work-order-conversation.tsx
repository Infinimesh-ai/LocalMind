import { Button, useConfirmModal } from '@affine/component';
import {
  AIChatRuntime,
  createAIRequestService,
  useAIChatElement,
  useAIChatRuntime,
  WorkOrderAIChatSessionStrategy,
} from '@affine/core/blocksuite/ai';
import type { SearchMenuConfig } from '@affine/core/blocksuite/ai/components/ai-chat-add-context/type';
import type { DocDisplayConfig } from '@affine/core/blocksuite/ai/components/ai-chat-chips';
import { AIChatContent } from '@affine/core/blocksuite/ai/components/ai-chat-content';
import {
  AIChatToolbar,
  configureAIChatToolbar,
} from '@affine/core/blocksuite/ai/components/ai-chat-toolbar';
import { getViewManager } from '@affine/core/blocksuite/manager/view';
import { NotificationServiceImpl } from '@affine/core/blocksuite/view-extensions/editor-view/notification-service';
import { AIToolsConfigService } from '@affine/core/modules/ai-button';
import { WorkOrderAIModel } from '@affine/core/modules/ai-button/entities/work-order-model';
import { AIReasoningService } from '@affine/core/modules/ai-button/services/reasoning';
import {
  EventSourceService,
  GraphQLService,
  ServerService,
  SubscriptionService,
  UserFeatureService,
} from '@affine/core/modules/cloud';
import { useSignalValue } from '@affine/core/modules/doc-info/utils';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { AppThemeService } from '@affine/core/modules/theme';
import { useI18n } from '@affine/i18n';
import { PageIcon } from '@blocksuite/icons/lit';
import { signal } from '@preact/signals-core';
import { useFramework, useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './workbench-conversation.css';

type WorkOrderConversationProps = {
  workOrderId: string;
  sessionId: string;
  title: string;
  status: string;
};

function useWorkOrderChatConfig() {
  const reasoning = useService(AIReasoningService);
  return useMemo(() => {
    const docDisplayConfig: DocDisplayConfig = {
      getIcon: () => PageIcon(),
      getTitle: () => '',
      getTitleSignal: () => ({ signal: signal(''), cleanup: () => {} }),
      getDocMeta: () => null,
      getDocPrimaryMode: () => 'page',
      getDoc: () => null,
      getReferenceDocs: () => ({
        signal: signal<Array<{ docId: string; title: string }>>([]),
        cleanup: () => {},
      }),
      getTags: () => ({ signal: signal([]), cleanup: () => {} }),
      getTagTitle: () => '',
      getTagPageIds: () => [],
      getCollections: () => ({ signal: signal([]), cleanup: () => {} }),
      getCollectionPageIds: () => [],
    };
    const searchMenuConfig: SearchMenuConfig = {
      supportsCategories: false,
      getDocMenuGroup: () => ({ name: '', items: [] }),
      getTagMenuGroup: () => ({ name: '', items: [] }),
      getCollectionMenuGroup: () => ({ name: '', items: [] }),
    };
    return {
      docDisplayConfig,
      searchMenuConfig,
      reasoningConfig: {
        enabled: reasoning.enabled,
        setEnabled: reasoning.setEnabled,
      },
    };
  }, [reasoning]);
}

export function WorkOrderConversation({
  workOrderId,
  sessionId,
  title,
  status,
}: WorkOrderConversationProps) {
  const t = useI18n();
  const framework = useFramework();
  const graphql = useService(GraphQLService);
  const eventSource = useService(EventSourceService);
  const request = useMemo(
    () => createAIRequestService(graphql.gql, eventSource.eventSource),
    [eventSource.eventSource, graphql.gql]
  );
  const runtime = useMemo(
    () =>
      new AIChatRuntime({
        request,
        scope: { kind: 'work_order', workOrderId, sessionId },
        strategy: new WorkOrderAIChatSessionStrategy(),
        chatSurface: 'intelligence_workbench',
      }),
    [request, sessionId, workOrderId]
  );
  const snapshot = useAIChatRuntime(runtime);
  const activeSession =
    snapshot?.sessions.find(
      session => session.sessionId === snapshot.activeSessionId
    ) ?? null;
  const model = useMemo(
    () => framework.createEntity(WorkOrderAIModel, { workOrderId }),
    [framework, workOrderId]
  );
  useEffect(() => () => model.dispose(), [model]);
  const configuration = useSignalValue(model.configuration);
  const isAdmin = useLiveData(
    useService(UserFeatureService).userFeature.isAdmin$
  );
  // Work-order conversations deliberately run outside WorkspaceScope. Keep the
  // BlockSuite surface aligned with Project chat instead of asking the full
  // workspace editor hook for WorkspaceService.
  const specs = useMemo(
    () => getViewManager().config.init().value.get('page'),
    []
  );
  const config = useWorkOrderChatConfig();
  const confirmModal = useConfirmModal();
  const notificationService = useMemo(
    () =>
      new NotificationServiceImpl(
        confirmModal.closeConfirmModal,
        confirmModal.openConfirmModal
      ),
    [confirmModal.closeConfirmModal, confirmModal.openConfirmModal]
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [contentReady, setContentReady] = useState(false);
  const [toolbarReady, setToolbarReady] = useState(false);

  useEffect(() => () => runtime.dispose(), [runtime]);

  useAIChatElement({
    containerRef: contentRef,
    selector: 'ai-chat-content',
    enabled: contentReady,
    createElement: () => new AIChatContent(),
    configureElement: content => {
      content.session = activeSession;
      content.runtime = runtime;
      content.runtimeSnapshot = snapshot;
      content.workspaceId = undefined;
      content.extensions = specs;
      content.docDisplayConfig = config.docDisplayConfig;
      content.searchMenuConfig = config.searchMenuConfig;
      content.reasoningConfig = config.reasoningConfig;
      content.affineFeatureFlagService = framework.get(FeatureFlagService);
      content.affineThemeService = framework.get(AppThemeService);
      content.notificationService = notificationService;
      content.aiToolsConfigService = framework.get(AIToolsConfigService);
      content.serverService = framework.get(ServerService);
      content.subscriptionService = framework.get(SubscriptionService);
      content.aiModelService = model;
    },
    onElementReady: content => {
      content.independentMode = true;
      content.onboardingOffsetY = -80;
    },
  });

  useAIChatElement({
    containerRef: toolbarRef,
    selector: 'ai-chat-toolbar',
    enabled: toolbarReady,
    createElement: () => new AIChatToolbar(),
    configureElement: toolbar => {
      configureAIChatToolbar(toolbar, {
        session: activeSession,
        runtime,
        runtimeSnapshot: snapshot ?? runtime.getSnapshot(),
        docDisplayConfig: config.docDisplayConfig,
        notificationService,
        onOpenDoc: () => {},
        onSessionDelete: () => {},
      });
    },
  });

  const setContent = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
    setContentReady(!!node);
  }, []);
  const setToolbar = useCallback((node: HTMLDivElement | null) => {
    toolbarRef.current = node;
    setToolbarReady(!!node);
  }, []);

  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
    >
      <header className={styles.header}>
        <div className={styles.conversationIdentity}>
          <strong>{title}</strong>
          <span>{status}</span>
        </div>
        <div className={styles.tools} ref={setToolbar} />
      </header>
      {configuration === 'missing' || configuration === 'error' ? (
        <div role="status" className={styles.configuration}>
          <span>
            {t[
              configuration === 'missing'
                ? 'com.affine.localmind.workbench.v9.workOrderModelMissing'
                : 'com.affine.localmind.project-byok.error'
            ]()}
          </span>
          {configuration === 'error' ? (
            <Button onClick={model.refresh}>{t['Retry']()}</Button>
          ) : isAdmin ? (
            <a href="/admin/ai/config">
              {t['com.affine.localmind.project-byok.configure']()}
            </a>
          ) : (
            <span>{t['com.affine.localmind.project-byok.contactAdmin']()}</span>
          )}
        </div>
      ) : null}
      <div className={styles.content} ref={setContent} />
    </section>
  );
}
