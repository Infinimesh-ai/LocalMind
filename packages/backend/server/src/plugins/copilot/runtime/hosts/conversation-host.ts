import { Injectable, Optional } from '@nestjs/common';

import {
  BadRequest,
  CopilotMessageNotFound,
  CopilotSessionNotFound,
  Mutex,
} from '../../../../base';
import { CopilotAccessPolicy } from '../../access';
import { CompatSubmissionStore } from '../../compat/submission-store';
import { ContextMemoryService } from '../../context-memory-service';
import {
  canonicalizeTurnTrace,
  promptMessageFromTurn,
  type Turn,
  turnFromChatMessage,
} from '../../core';
import type { PromptParams } from '../../providers/types';
import { ChatSession, ChatSessionService } from '../../session';
import { ChatQuerySchema } from '../../types';
import { memoryCaptureReceipt } from '../memory-capture-receipt';

export type PreparedConversationTurn = {
  messageId?: string;
  params: Record<string, string>;
  session: ChatSession;
  latestTurn?: Turn;
  quotaBackedRoutesAllowed?: boolean;
  memoryCaptureReceipt?: string;
};

type AppendedSessionMessage = {
  turn?: Turn;
  quotaBackedRoutesAllowed?: boolean;
};

@Injectable()
export class ConversationHost {
  constructor(
    private readonly sessions: ChatSessionService,
    private readonly submissions: CompatSubmissionStore,
    private readonly mutex: Mutex,
    private readonly access: CopilotAccessPolicy,
    @Optional() private readonly contextMemory?: ContextMemoryService
  ) {}

  private async loadAcceptedTurn(
    session: ChatSession,
    sessionId: string,
    messageId: string,
    retry: boolean
  ): Promise<Turn | undefined> {
    const accepted = await this.submissions.getAccepted(messageId);
    if (!accepted) return;
    if (accepted.sessionId !== sessionId) {
      throw new CopilotMessageNotFound({ messageId });
    }

    if (retry) {
      await this.sessions.revertLatestMessage(sessionId, false);
      session.revertLatestMessage(false);
    }

    const existingTurn = session.findTurn(accepted.turnId);
    if (existingTurn) return existingTurn;

    const acceptedMessage = await this.sessions.getMessage(
      sessionId,
      accepted.turnId
    );
    if (acceptedMessage.role !== 'user') {
      throw new CopilotMessageNotFound({ messageId: accepted.turnId });
    }

    const turn = turnFromChatMessage(acceptedMessage, sessionId);
    session.pushPersistedTurn(turn);
    return turn;
  }

  private async loadDurableTurn(
    session: ChatSession,
    sessionId: string,
    messageId: string,
    retry: boolean
  ): Promise<Turn | undefined> {
    const turn = await this.sessions.findTurnByCompatSubmissionId(
      sessionId,
      messageId
    );
    if (!turn?.id) {
      return;
    }

    if (retry) {
      await this.sessions.revertLatestMessage(sessionId, false);
      session.revertLatestMessage(false);
    }

    await this.submissions.markAccepted(messageId, {
      sessionId,
      turnId: turn.id,
    });

    const existingTurn = session.findTurn(turn.id);
    if (existingTurn) {
      return existingTurn;
    }

    session.pushPersistedTurn(turn);
    return turn;
  }

  private async appendSessionMessage(
    userId: string,
    session: ChatSession,
    sessionId: string,
    messageId?: string,
    retry = false,
    byokLeaseId?: string
  ): Promise<AppendedSessionMessage> {
    const resolveChatRouteAccess = () =>
      this.access.resolveTurnRouteAccess({
        userId,
        sessionId,
        workspaceId: session.config.workspaceId ?? undefined,
        projectId: session.config.selectedContextProjectId ?? undefined,
        byokLeaseId,
        featureKind: 'chat',
      });

    if (!messageId) {
      await this.sessions.revertLatestMessage(sessionId, false);
      session.revertLatestMessage(false);
      if (!session.latestUserTurn) {
        const routeAccess = await resolveChatRouteAccess();
        return {
          turn: session.latestUserTurn,
          quotaBackedRoutesAllowed: routeAccess.quotaBackedRoutesAllowed,
        };
      }
      const routeAccess = await resolveChatRouteAccess();
      return {
        turn: session.latestUserTurn,
        quotaBackedRoutesAllowed: routeAccess.quotaBackedRoutesAllowed,
      };
    }

    const acceptedTurn = await this.loadAcceptedTurn(
      session,
      sessionId,
      messageId,
      retry
    );
    if (acceptedTurn) {
      return { turn: acceptedTurn, quotaBackedRoutesAllowed: false };
    }

    await using lock = await this.mutex.acquire(
      `copilot:submission:${messageId}`
    );
    if (!lock) {
      throw new CopilotMessageNotFound({ messageId });
    }

    const acceptedAfterLock = await this.loadAcceptedTurn(
      session,
      sessionId,
      messageId,
      retry
    );
    if (acceptedAfterLock) {
      return { turn: acceptedAfterLock, quotaBackedRoutesAllowed: false };
    }

    const durableTurn = await this.loadDurableTurn(
      session,
      sessionId,
      messageId,
      retry
    );
    if (durableTurn) {
      return {
        turn: durableTurn,
        quotaBackedRoutesAllowed: false,
      };
    }

    const routeAccess = await resolveChatRouteAccess();

    const submission = await this.submissions.get(messageId);
    if (!submission || submission.sessionId !== sessionId) {
      throw new CopilotMessageNotFound({ messageId });
    }

    if (retry) {
      await this.sessions.revertLatestMessage(sessionId, true);
      session.revertLatestMessage(true);
    }

    const turn = await this.sessions.appendTurn({
      sessionId,
      userId: session.config.userId,
      prompt: { model: session.model },
      compatSubmissionId: messageId,
      turn: {
        conversationId: sessionId,
        role: 'user',
        content: submission.content ?? '',
        attachments: submission.attachments ?? [],
        metadata: submission.params ?? {},
        renderTrace: [],
        toolEvents: [],
        createdAt: submission.createdAt,
      },
    });

    await this.submissions.markAccepted(messageId, {
      sessionId,
      turnId: turn.id ?? '',
    });
    session.pushPersistedTurn(turn);
    return {
      turn,
      quotaBackedRoutesAllowed: routeAccess.quotaBackedRoutesAllowed,
    };
  }

  async prepareTurn(
    userId: string,
    sessionId: string,
    query: Record<string, string | string[]>
  ): Promise<PreparedConversationTurn> {
    const { messageId, retry, params, byokLeaseId, chatSurface } =
      ChatQuerySchema.parse(query);
    await this.sessions.assertOwnedSession(userId, sessionId);
    const session = await this.sessions.get(sessionId);
    if (!session || session.config.userId !== userId) {
      throw new CopilotSessionNotFound();
    }
    const isBoundWorkOrderSession =
      session.config.scopeType === 'work_order' &&
      Boolean(session.config.workOrderId);
    if (
      chatSurface === 'intelligence_workbench' &&
      !isBoundWorkOrderSession &&
      (session.config.docId ||
        !session.contextScope?.selectedProjectId ||
        session.contextScope.projectResolution !== 'selected')
    ) {
      throw new BadRequest(
        'Select an active project you belong to before sending an Intelligence message.'
      );
    }
    if (
      !isBoundWorkOrderSession &&
      session.contextScope?.projectResolution === 'invalid_selection'
    ) {
      throw new BadRequest(
        'The conversation project is no longer available. Select another project and start a new conversation.'
      );
    }
    const appended = await this.appendSessionMessage(
      userId,
      session,
      sessionId,
      messageId,
      retry,
      byokLeaseId
    );
    const currentUserMessage =
      session.stashTurns.findLast(turn => turn.role === 'user') ??
      appended.turn;
    let receipt: string | undefined;
    if (currentUserMessage) {
      const events = await this.contextMemory?.captureDurableTurn({
        userId,
        workspaceId: session.config.workspaceId,
        docId: session.config.docId,
        sessionId,
        turn: currentUserMessage,
        scope: session.contextScope,
        modelId: session.model,
      });
      receipt = memoryCaptureReceipt({
        content: currentUserMessage.content,
        userId,
        workspaceId: session.config.workspaceId,
        projectId:
          !session.config.docId &&
          session.contextScope?.projectIds?.length === 1
            ? session.contextScope.projectIds[0]
            : null,
        sessionId,
        turnId: currentUserMessage.id,
        documentScoped: Boolean(
          session.config.docId ||
          session.contextScope?.readableDocIds?.length === 1
        ),
        events: events ?? [],
      });
      await session.refreshContextMemories(currentUserMessage.content);
    }

    return {
      messageId,
      params,
      session,
      latestTurn: currentUserMessage,
      quotaBackedRoutesAllowed: appended.quotaBackedRoutesAllowed,
      memoryCaptureReceipt: receipt,
    };
  }

  buildLatestTurnPromptParams(latestTurn?: Turn): PromptParams {
    if (!latestTurn) {
      return {};
    }

    return {
      ...latestTurn.metadata,
      content: promptMessageFromTurn(latestTurn).content,
      attachments: latestTurn.attachments,
    };
  }

  async persistAssistantTurn(
    session: ChatSession,
    turn: Turn,
    wasAborted: boolean
  ) {
    const trace = canonicalizeTurnTrace(turn);
    const assistantTurn = {
      ...turn,
      renderTrace: trace.renderTrace,
      toolEvents: trace.toolEvents,
      // Cancellation is a terminal outcome, not a replacement for evidence
      // already emitted by the turn, including completed tool side effects.
      metadata: wasAborted
        ? { ...turn.metadata, generationStatus: 'aborted' }
        : turn.metadata,
    };
    const persisted = await this.sessions.appendTurn({
      sessionId: session.config.sessionId,
      userId: session.config.userId,
      prompt: { model: session.model },
      turn: assistantTurn,
    });
    session.pushPersistedTurn(persisted);
    return persisted.id ?? null;
  }
}
