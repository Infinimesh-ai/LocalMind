import { useConfirmModal } from '@affine/component';
import { AIChatComposer } from '@affine/core/blocksuite/ai/components/ai-chat-composer';
import type { AIChatDraft } from '@affine/core/blocksuite/ai/components/ai-chat-input';
import { useAIChatElement } from '@affine/core/blocksuite/ai/runtime/chat/use-element';
import { NotificationServiceImpl } from '@affine/core/blocksuite/view-extensions/editor-view/notification-service';
import { useMemo, useRef } from 'react';

import { useProjectAIAvailability } from './use-project-ai-availability';

export function NewConversationComposer({
  onSend,
  projectId,
}: {
  onSend: (draft: AIChatDraft) => void;
  projectId: string | null;
}) {
  const { notice, sendBlocked } = useProjectAIAvailability(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const { closeConfirmModal, openConfirmModal } = useConfirmModal();
  const notification = useMemo(
    () => new NotificationServiceImpl(closeConfirmModal, openConfirmModal),
    [closeConfirmModal, openConfirmModal]
  );
  useAIChatElement({
    containerRef,
    selector: 'ai-chat-composer',
    enabled: true,
    createElement: () => {
      const composer = new AIChatComposer();
      composer.independentMode = true;
      composer.chatContextValue = {
        messages: [],
        status: 'idle',
        error: null,
        images: [],
        attachments: [],
        docs: [],
        snapshot: null,
        combinedElementsMarkdown: null,
        html: null,
        abortController: null,
      };
      composer.updateContext = context => {
        composer.chatContextValue = {
          ...composer.chatContextValue,
          ...context,
        };
      };
      return composer;
    },
    configureElement: composer => {
      composer.notificationService = notification;
      composer.onDraftSend = onSend;
      composer.notice = notice;
      composer.sendBlocked = sendBlocked;
    },
  });
  return <div ref={containerRef} />;
}
