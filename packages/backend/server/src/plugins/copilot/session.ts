import { createHash, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Transactional } from '@nestjs-cls/transactional';
import { AiPromptRole } from '@prisma/client';

import {
  CopilotActionTaken,
  CopilotMessageNotFound,
  CopilotPromptNotFound,
  CopilotSessionInvalidInput,
  CopilotSessionNotFound,
  JobQueue,
  OnJob,
} from '../../base';
import { ProjectBlobStorage } from '../../core/project';
import {
  CleanupSessionOptions,
  type CopilotContextPlanTraceInput,
  ListSessionOptions,
  Models,
  type UpdateChatSession,
  UpdateChatSessionOptions,
} from '../../models';
import { CopilotAccessPolicy } from './access';
import { CompatSubmissionStore } from './compat/submission-store';
import { ContextMemoryService } from './context-memory-service';
import { ContextRuleService } from './context-rule-service';
import {
  type ContextScopeResolution,
  ContextScopeResolver,
} from './context-scope-resolver';
import { ConversationPolicy } from './conversation/policy';
import { ConversationStore } from './conversation/store';
import { type Conversation, promptMessageFromTurn, type Turn } from './core';
import type { ResolvedPrompt } from './prompt';
import { PromptService } from './prompt/service';
import { type PromptMessage, type PromptParams } from './providers/types';
import { CapabilityRuntime } from './runtime/capability-runtime';
import {
  CONTEXT_COMPACTION_PROMPT_VERSION,
  CONTEXT_COMPACTION_RESPONSE_CONTRACT,
  contextCompactionInputBudget,
  contextCompactionMessages,
  ContextCompactionSummarySchema,
  estimateContextCompactionTokens,
  renderContextCompactionSummary,
  splitContextCompactionMessages,
  validateContextCompactionSummary,
} from './runtime/context-compaction';
import {
  ContextCompactionUnavailableError,
  ContextPlanner,
  type ContextPlannerCheckpoint,
  type ContextPlannerMemory,
} from './runtime/context-planner';
import { PromptRuntime } from './runtime/prompt-runtime';
import {
  type ChatSessionForkOptions,
  type ChatSessionOptions,
  type ChatSessionState,
} from './types';

declare global {
  interface Jobs {
    'copilot.session.generateTitle': {
      sessionId: string;
    };
    'copilot.session.deleteDoc': {
      workspaceId: string;
      docId: string;
    };
    'copilot.session.purge': {
      sessionId: string;
    };
    'copilot.session.compactContext': {
      taskId: string;
    };
  }
}

const BACKGROUND_COPILOT_JOB_PRIORITY = 100;

function resolveEffectiveMaxTokenSize(
  promptMaxTokenSize: number,
  contextWindow?: number
) {
  return contextWindow
    ? Math.min(promptMaxTokenSize, contextWindow)
    : promptMaxTokenSize;
}

export class ChatSession implements AsyncDisposable {
  private stashTurnCount = 0;
  private pendingCheckpoint?: ContextPlannerCheckpoint;
  private pendingPlanTrace?: CopilotContextPlanTraceInput;
  private readonly renderPromptSession: (
    prompt: ResolvedPrompt,
    turns: PromptMessage[],
    params: PromptParams,
    maxTokenSize: number,
    sessionId?: string
  ) => PromptMessage[];
  constructor(
    private readonly state: ChatSessionState,
    renderPromptSession: (
      prompt: ResolvedPrompt,
      turns: PromptMessage[],
      params: PromptParams,
      maxTokenSize: number,
      sessionId?: string
    ) => PromptMessage[],
    private readonly dispose?: (state: ChatSessionState) => Promise<void>,
    private readonly maxTokenSize = state.prompt.config?.maxTokens ||
      128 * 1024,
    private readonly context?: {
      planner: ContextPlanner;
      memories: ContextPlannerMemory[];
      checkpoint: ContextPlannerCheckpoint | null;
      saveCheckpoint: (checkpoint: ContextPlannerCheckpoint) => Promise<void>;
      scope: ContextScopeResolution;
      savePlanTrace: (trace: CopilotContextPlanTraceInput) => Promise<void>;
      retrieveMemories: (query: string) => Promise<ContextPlannerMemory[]>;
      compactCheckpoint?: (input: {
        checkpoint: ContextPlannerCheckpoint;
        sourceMessageIds: string[];
        modelId?: string;
        contextWindow?: number;
        signal?: AbortSignal;
      }) => Promise<ContextPlannerCheckpoint>;
    }
  ) {
    this.renderPromptSession = renderPromptSession;
  }

  get model() {
    return this.state.prompt.model;
  }

  get optionalModels() {
    return this.state.prompt.optionalModels;
  }

  get config() {
    const {
      sessionId,
      userId,
      workspaceId,
      selectedContextProjectId,
      scopeType,
      workOrderId,
      docId,
      prompt: { name: promptName, config: promptConfig },
    } = this.state;

    return {
      sessionId,
      userId,
      workspaceId,
      selectedContextProjectId,
      scopeType,
      workOrderId,
      docId,
      promptName,
      promptConfig,
    };
  }

  get stashTurns() {
    if (!this.stashTurnCount) return [];
    return this.state.turns.slice(-this.stashTurnCount);
  }

  get latestUserTurn() {
    return this.state.turns.findLast(({ role }) => role === 'user');
  }

  get contextScope() {
    return this.context?.scope;
  }

  async refreshContextMemories(query: string) {
    if (!this.context) return;
    this.context.memories = await this.context.retrieveMemories(query);
  }

  findTurn(turnId: string) {
    return this.state.turns.find(({ id }) => id === turnId);
  }

  private appendTurn(turn: Turn, persisted: boolean) {
    if (
      this.state.prompt.action &&
      this.state.turns.length > 0 &&
      turn.role === 'user'
    ) {
      throw new CopilotActionTaken();
    }
    this.state.turns.push(turn);
    if (!persisted) {
      this.stashTurnCount += 1;
    }
  }

  pushTurn(turn: Turn) {
    this.appendTurn(turn, false);
  }

  pushPersistedTurn(turn: Turn) {
    this.appendTurn(turn, true);
  }

  revertLatestMessage(removeLatestUserMessage: boolean) {
    const turns = this.state.turns;
    turns.splice(
      turns.findLastIndex(({ role }) => role === AiPromptRole.user) +
        (removeLatestUserMessage ? 0 : 1)
    );
  }

  finish(
    params: PromptParams,
    options: {
      contextWindow?: number;
      referenceMessages?: PromptMessage[];
    } = {}
  ): PromptMessage[] {
    const turns = this.state.turns.map(turn => promptMessageFromTurn(turn));
    const maxTokenSize = resolveEffectiveMaxTokenSize(
      this.maxTokenSize,
      options.contextWindow
    );
    const render = (plannedTurns: PromptMessage[]) => {
      const messages = [...plannedTurns];
      const latestUser = messages.findLastIndex(
        message => message.role === 'user'
      );
      messages.splice(
        latestUser < 0 ? messages.length : latestUser,
        0,
        ...(options.referenceMessages ?? [])
      );
      return this.renderPromptSession(
        this.state.prompt,
        messages,
        params,
        maxTokenSize,
        this.state.sessionId
      );
    };
    if (!this.context) return render(turns);

    const plan = this.context.planner.plan({
      turns,
      memories: this.context.memories,
      checkpoint: this.context.checkpoint,
      render,
    });
    this.pendingCheckpoint = plan.checkpoint;
    this.pendingPlanTrace = {
      sessionId: this.state.sessionId,
      sourceTurnId: this.latestUserTurn?.id ?? null,
      ...plan.trace,
      scope: {
        primaryDocId: this.context.scope.primaryDocId,
        readableDocIds: this.context.scope.readableDocIds,
        readableDocumentRefs: this.context.scope.readableDocumentRefs,
        candidateProjectIds: this.context.scope.candidateProjectIds,
        projectIds: this.context.scope.projectIds,
        selectedProjectId: this.context.scope.selectedProjectId,
        projectResolution: this.context.scope.projectResolution,
      },
    };
    return plan.messages;
  }

  async finishAsync(
    params: PromptParams,
    options: {
      contextWindow?: number;
      referenceMessages?: PromptMessage[];
      modelId?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<PromptMessage[]> {
    const messages = this.finish(params, options);
    const checkpoint = this.pendingCheckpoint;
    if (!checkpoint || !this.context) return messages;
    // A failed/cancelled durable compaction must never fall through to the
    // legacy save-on-dispose path.
    this.pendingCheckpoint = undefined;
    const sourceMessageIds = this.state.turns
      .slice(0, checkpoint.summarizedMessageCount)
      .map(turn => turn.id);
    if (sourceMessageIds.some(id => !id)) {
      throw new ContextCompactionUnavailableError();
    }
    if (!this.context.compactCheckpoint) {
      throw new ContextCompactionUnavailableError();
    }
    const published = await this.context.compactCheckpoint({
      checkpoint,
      sourceMessageIds: sourceMessageIds as string[],
      modelId: options.modelId,
      contextWindow: options.contextWindow,
      signal: options.signal,
    });
    this.context.checkpoint = published;
    // Re-run deterministic assembly against the checkpoint that actually won
    // the lease/CAS. The original render still contained the provisional
    // heuristic candidate and must never be sent to the provider.
    const reassembled = this.finish(params, options);
    this.pendingCheckpoint = undefined;
    return reassembled;
  }

  async save() {
    await this.dispose?.({
      ...this.state,
      turns: this.state.turns.slice(-this.stashTurnCount),
    });
    await Promise.all([
      this.pendingCheckpoint
        ? this.context?.saveCheckpoint(this.pendingCheckpoint)
        : undefined,
      this.pendingPlanTrace
        ? this.context?.savePlanTrace(this.pendingPlanTrace)
        : undefined,
    ]);
    this.pendingCheckpoint = undefined;
    this.pendingPlanTrace = undefined;
    this.stashTurnCount = 0;
  }

  async [Symbol.asyncDispose]() {
    await this.save?.();
  }
}

export type ConversationState = {
  conversation: Conversation;
  turns: Turn[];
  prompt: ResolvedPrompt;
  tokenCost: number;
};

export type ConversationMetaState = {
  conversation: Conversation;
  prompt: ResolvedPrompt;
  tokenCost: number;
};

type StoredConversation = NonNullable<
  Awaited<ReturnType<ConversationStore['get']>>
>;

type StoredConversationMeta = NonNullable<
  Awaited<ReturnType<ConversationStore['getMeta']>>
>;

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(
    private readonly models: Models,
    private readonly jobs: JobQueue,
    private readonly store: ConversationStore,
    private readonly access: CopilotAccessPolicy,
    private readonly conversationPolicy: ConversationPolicy,
    private readonly prompts: PromptService,
    private readonly promptRuntime: PromptRuntime,
    private readonly capabilityRuntime: CapabilityRuntime,
    private readonly contextPlanner: ContextPlanner,
    private readonly contextMemory: ContextMemoryService,
    private readonly contextRules: ContextRuleService,
    private readonly contextScopeResolver: ContextScopeResolver,
    private readonly compatSubmissions: CompatSubmissionStore,
    private readonly projectBlobs: ProjectBlobStorage
  ) {}

  private async retrieveContextMemories(
    scope: ContextScopeResolution,
    query: string
  ): Promise<ContextPlannerMemory[]> {
    const [memories, directives] = await Promise.all([
      this.contextMemory
        .retrieveVisible({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          sessionId: scope.sessionId,
          docIds: scope.readableDocIds,
          documentRefs: scope.readableDocumentRefs,
          projectIds: scope.projectIds,
          query,
        })
        .catch(error => {
          this.logger.warn(
            'Context memory retrieval failed; continuing without memory',
            {
              sessionId: scope.sessionId,
              error,
            }
          );
          return [];
        }),
      this.contextRules
        .retrieveApplicable({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          scope,
          query,
        })
        .catch(error => {
          this.logger.warn(
            'Context rule retrieval failed; continuing without rules',
            {
              sessionId: scope.sessionId,
              error,
            }
          );
          return [];
        }),
    ]);
    {
      const identity = {
        actorId: scope.userId,
        sessionId: scope.sessionId,
        projectId: scope.selectedProjectId,
        workspaceId: scope.workspaceId,
      };
      await this.models.copilotContext.recordRecalledMemorySources({
        ...identity,
        memories: memories.map(memory => ({
          id: memory.id,
          content: memory.content,
        })),
      });
      await this.models.copilotContext.recordInputSources({
        ...identity,
        sources: directives.map(directive => ({
          workspaceId: scope.workspaceId,
          kind: directive.sourceType === 'policy' ? 'workspace' : 'private',
          sourceId: `${directive.sourceType === 'policy' ? 'workspace-policy' : 'private-rule'}:${directive.revisionId}`,
        })),
      });
    }
    return [
      ...directives.map(directive => ({
        id: directive.id,
        scope: directive.scope,
        kind: 'rule' as const,
        content: directive.content,
        updatedAt: directive.updatedAt,
        sourceType: directive.sourceType,
        sourceRevisionId: directive.revisionId,
        matchReason: directive.matchReason,
        priority: directive.priority,
        relevanceScore: directive.score,
      })),
      ...memories.map(memory => ({
        id: memory.id,
        scope: memory.scope as ContextPlannerMemory['scope'],
        kind: memory.kind as ContextPlannerMemory['kind'],
        content: memory.content,
        updatedAt: memory.updatedAt,
        sourceType: 'memory' as const,
        relevanceScore: memory.retrievalScore,
      })),
    ];
  }

  private stripNullBytes(value?: string | null): string {
    if (!value) return '';
    return value.replaceAll('\0', '');
  }

  private isNullByteError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('\\u0000') ||
        error.message.includes('unsupported Unicode escape sequence') ||
        error.message.includes('22P05'))
    );
  }

  private async toConversationState(
    session: StoredConversation
  ): Promise<ConversationState> {
    const { conversation, prompt, tokenCost } =
      await this.toConversationMetaState(session);

    return {
      conversation,
      turns: session.turns,
      prompt,
      tokenCost,
    };
  }

  private async toConversationMetaState(
    session: StoredConversation | StoredConversationMeta
  ): Promise<ConversationMetaState> {
    const prompt = await this.prompts.get(session.promptName);
    if (!prompt) throw new CopilotPromptNotFound({ name: session.promptName });

    return {
      conversation: session.conversation,
      prompt,
      tokenCost: session.tokenCost,
    };
  }

  async getState(sessionId: string): Promise<ConversationState | undefined> {
    const session = await this.store.get(sessionId);
    if (!session) return;

    return await this.toConversationState(session);
  }

  async getMetaState(
    sessionId: string
  ): Promise<ConversationMetaState | undefined> {
    const session = await this.store.getMeta(sessionId);
    if (!session) return;

    return await this.toConversationMetaState(session);
  }

  async count(options: ListSessionOptions): Promise<number> {
    return await this.store.count(options);
  }

  async listStates(options: ListSessionOptions): Promise<ConversationState[]> {
    const sessions = await this.store.list({
      ...options,
      withMessages: true,
    });

    const states = await Promise.all(
      sessions.map(async session => {
        try {
          return await this.toConversationState(session);
        } catch (e) {
          this.logger.error(
            'Unexpected error in list copilot conversations',
            e
          );
        }
        return undefined;
      })
    );

    return states.filter((v): v is NonNullable<typeof v> => !!v);
  }

  async listMetaStates(
    options: ListSessionOptions
  ): Promise<ConversationMetaState[]> {
    const sessions = await this.store.listMeta(options);

    const states = await Promise.all(
      sessions.map(async session => {
        try {
          return await this.toConversationMetaState(session);
        } catch (e) {
          this.logger.error(
            'Unexpected error in list copilot conversation metadata',
            e
          );
        }
        return undefined;
      })
    );

    return states.filter((v): v is NonNullable<typeof v> => !!v);
  }

  async getQuota(userId: string) {
    return await this.access.getQuota(userId);
  }

  async assertOwnedSession(userId: string, sessionId: string) {
    const session = await this.models.copilotSession.getMeta(sessionId);
    if (!session || session.userId !== userId)
      throw new CopilotSessionNotFound();
    if (session.selectedContextProjectId) {
      await this.models.projectResource.assertMember({
        actorId: userId,
        projectId: session.selectedContextProjectId,
      });
    }
    return session;
  }

  async checkQuota(userId: string) {
    await this.access.checkQuota(userId);
  }

  async create(options: ChatSessionOptions): Promise<string> {
    const sessionId = randomUUID();
    const prompt = await this.prompts.get(options.promptName);
    if (!prompt) {
      this.logger.error(`Prompt not found: ${options.promptName}`);
      throw new CopilotPromptNotFound({ name: options.promptName });
    }

    // validate prompt compatibility with session type
    this.models.copilotSession.checkSessionPrompt(options, prompt);

    return await this.store.create(
      {
        ...options,
        sessionId,
        prompt,
        title: null,
        messages: [],
        // when client create chat session, we always find root session
        parentSessionId: null,
      },
      options.reuseLatestChat ?? true
    );
  }

  @Transactional()
  async unpin(workspaceId: string | null, userId: string) {
    await this.store.unpin(workspaceId, userId);
  }

  @Transactional()
  async update(options: UpdateChatSession): Promise<string> {
    const state = await this.getState(options.sessionId);
    if (!state) {
      throw new CopilotSessionNotFound();
    }

    const finalData: UpdateChatSessionOptions = {
      userId: options.userId,
      sessionId: options.sessionId,
    };
    if (options.promptName) {
      const prompt = await this.prompts.get(options.promptName);
      if (!prompt) {
        this.logger.error(`Prompt not found: ${options.promptName}`);
        throw new CopilotPromptNotFound({ name: options.promptName });
      }

      this.models.copilotSession.checkSessionPrompt(
        {
          docId: state.conversation.docId,
          pinned: state.conversation.pinned,
        },
        prompt
      );
      finalData.promptName = prompt.name;
      finalData.promptAction = prompt.action ?? null;
      finalData.promptModel = prompt.model;
    }
    finalData.pinned = options.pinned;
    finalData.docId = options.docId;
    finalData.selectedContextProjectId = options.selectedContextProjectId;

    if (
      options.promptName === undefined &&
      options.pinned === undefined &&
      options.docId === undefined &&
      options.selectedContextProjectId === undefined
    ) {
      throw new CopilotSessionInvalidInput(
        'No valid fields to update in the session'
      );
    }

    return await this.store.update(finalData);
  }

  @Transactional()
  async fork(options: ChatSessionForkOptions): Promise<string> {
    await this.models.copilotSession.assertForkParent({
      parentSessionId: options.sessionId,
      userId: options.userId,
      workspaceId: options.workspaceId,
      docId: options.docId,
      selectedContextProjectId: null,
    });
    const state = await this.getState(options.sessionId);
    if (!state) {
      throw new CopilotSessionNotFound();
    }

    let turns = state.turns;
    if (options.latestMessageId) {
      const lastMessageIdx = state.turns.findLastIndex(
        ({ id, role }) =>
          role === AiPromptRole.assistant && id === options.latestMessageId
      );
      if (lastMessageIdx < 0) {
        throw new CopilotMessageNotFound({
          messageId: options.latestMessageId,
        });
      }
      turns = turns.slice(0, lastMessageIdx + 1);
    }

    return await this.store.fork({
      userId: options.userId,
      workspaceId: state.conversation.workspaceId,
      docId: options.docId,
      selectedContextProjectId: state.conversation.selectedContextProjectId,
      sessionId: randomUUID(),
      parentSessionId: options.sessionId,
      pinned: state.conversation.pinned,
      title: state.conversation.title,
      prompt: {
        name: state.prompt.name,
        action: state.prompt.action,
        model: state.prompt.model,
      },
      turns,
    });
  }

  async cleanup(options: CleanupSessionOptions) {
    const sessionIds = await this.store.cleanup(options);
    await Promise.all(
      sessionIds.map(sessionId =>
        this.jobs.add(
          'copilot.session.purge',
          { sessionId },
          { jobId: `copilot-session-purge-${sessionId}` }
        )
      )
    );
    return sessionIds;
  }

  async getSessionDeletion(userId: string, sessionId: string) {
    return await this.models.copilotSession.getSessionDeletion(
      sessionId,
      userId
    );
  }

  async retrySessionDeletion(userId: string, sessionId: string) {
    const deletion = await this.models.copilotSession.retrySessionDeletion(
      sessionId,
      userId
    );
    if (deletion?.status === 'retry_wait') {
      await this.jobs.add(
        'copilot.session.purge',
        { sessionId },
        { jobId: `copilot-session-purge-${sessionId}` }
      );
    }
    return deletion;
  }

  async requestManualContextCompaction(userId: string, sessionId: string) {
    await this.assertOwnedSession(userId, sessionId);
    const state = await this.getState(sessionId);
    if (!state) throw new CopilotSessionNotFound();
    const checkpoint = await this.contextMemory.loadCheckpoint(sessionId);
    const turns = state.turns.map(turn => promptMessageFromTurn(turn));
    const candidate = this.contextPlanner.createManualCheckpoint({
      turns,
      checkpoint,
    });
    if (!candidate) {
      return await this.models.copilotContextMemory.getLatestContextCompactionTask(
        sessionId,
        userId
      );
    }
    const sourceMessageIds = state.turns
      .slice(0, candidate.summarizedMessageCount)
      .map(turn => turn.id);
    if (sourceMessageIds.some(id => !id)) {
      throw new ContextCompactionUnavailableError();
    }
    const inputBudget = contextCompactionInputBudget();
    const task =
      await this.models.copilotContextMemory.requestContextCompaction({
        sessionId,
        actorUserId: userId,
        sourceMessageIds: sourceMessageIds as string[],
        sourceFingerprint: candidate.sourceFingerprint,
        summarizedMessageCount: candidate.summarizedMessageCount,
        strategyVersion: candidate.strategyVersion,
        strategyFingerprint: candidate.strategyFingerprint,
        modelId: state.prompt.model,
        routeFingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              version: 'context-compaction-route/v1',
              modelId: state.prompt.model,
              contextWindow: null,
              inputBudget,
              schemaHash: CONTEXT_COMPACTION_RESPONSE_CONTRACT.schemaHash,
            })
          )
          .digest('hex'),
        inputBudget,
        candidateSummary: candidate.summary,
        candidateSummaryData: candidate.summaryData,
        candidateDiagnostics: candidate.diagnostics,
      });
    await this.enqueueContextCompaction(task);
    return task;
  }

  async retryContextCompaction(userId: string, taskId: string) {
    const task = await this.models.copilotContextMemory.retryContextCompaction(
      taskId,
      userId
    );
    if (task) await this.enqueueContextCompaction(task);
    return task;
  }

  async cancelContextCompaction(userId: string, taskId: string) {
    return await this.models.copilotContextMemory.cancelContextCompaction(
      taskId,
      userId
    );
  }

  private async enqueueContextCompaction(task: {
    id: string;
    attempt: number;
  }) {
    try {
      await this.jobs.add(
        'copilot.session.compactContext',
        { taskId: task.id },
        { jobId: `copilot-context-compaction-${task.id}-${task.attempt}` }
      );
    } catch (error) {
      // The database task is authoritative. The minute cron can repair a
      // transient enqueue failure without losing or duplicating the result.
      this.logger.warn('Failed to enqueue durable context compaction', {
        taskId: task.id,
        error,
      });
    }
  }

  private async waitForContextCompaction(taskId: string, signal?: AbortSignal) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) return null;
      const task =
        await this.models.copilotContextMemory.getContextCompactionTask(taskId);
      if (!task || task.status !== 'running') return task;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return await this.models.copilotContextMemory.getContextCompactionTask(
      taskId
    );
  }

  private async compactCheckpoint(input: {
    sessionId: string;
    actorUserId: string;
    checkpoint: ContextPlannerCheckpoint;
    sourceMessageIds: string[];
    modelId?: string;
    contextWindow?: number;
    signal?: AbortSignal;
  }): Promise<ContextPlannerCheckpoint> {
    let task = await this.models.copilotContextMemory.requestContextCompaction({
      sessionId: input.sessionId,
      actorUserId: input.actorUserId,
      sourceMessageIds: input.sourceMessageIds,
      sourceFingerprint: input.checkpoint.sourceFingerprint,
      summarizedMessageCount: input.checkpoint.summarizedMessageCount,
      strategyVersion: input.checkpoint.strategyVersion,
      strategyFingerprint: input.checkpoint.strategyFingerprint,
      modelId: input.modelId,
      routeFingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            version: 'context-compaction-route/v1',
            modelId: input.modelId ?? null,
            contextWindow: input.contextWindow ?? null,
            inputBudget: contextCompactionInputBudget(input.contextWindow),
            schemaHash: CONTEXT_COMPACTION_RESPONSE_CONTRACT.schemaHash,
          })
        )
        .digest('hex'),
      inputBudget: contextCompactionInputBudget(input.contextWindow),
      candidateSummary: input.checkpoint.summary,
      candidateSummaryData: input.checkpoint.summaryData,
      candidateDiagnostics: input.checkpoint.diagnostics,
    });
    if (input.signal?.aborted) {
      await this.models.copilotContextMemory.cancelContextCompaction(
        task.id,
        input.actorUserId
      );
      throw new ContextCompactionUnavailableError();
    }
    if (['failed', 'cancelled'].includes(task.status)) {
      task =
        (await this.models.copilotContextMemory.retryContextCompaction(
          task.id,
          input.actorUserId
        )) ?? task;
    }
    await this.enqueueContextCompaction(task);
    task = (await this.executeContextCompaction(task.id)) ?? task;
    if (task.status === 'running') {
      task =
        (await this.waitForContextCompaction(task.id, input.signal)) ?? task;
    }
    if (input.signal?.aborted) {
      await this.models.copilotContextMemory.cancelContextCompaction(
        task.id,
        input.actorUserId
      );
      throw new ContextCompactionUnavailableError();
    }
    if (task.status !== 'succeeded' || !task.checkpointId) {
      throw new ContextCompactionUnavailableError();
    }
    return {
      id: task.checkpointId,
      strategyVersion: task.strategyVersion,
      strategyFingerprint: task.strategyFingerprint,
      summary: task.resultSummary ?? task.candidateSummary,
      summarizedMessageCount: task.summarizedMessageCount,
      sourceFingerprint: task.sourceFingerprint,
      diagnostics: (task.resultDiagnostics ??
        task.candidateDiagnostics) as Record<string, unknown>,
      summaryData: (task.resultSummaryData ??
        task.candidateSummaryData) as Record<string, unknown>,
    };
  }

  private async generateContextCompaction(taskId: string, leaseId: string) {
    const source =
      await this.models.copilotContextMemory.getContextCompactionGenerationInput(
        { taskId, leaseId }
      );
    if (!source || source.task.resultSummary) return source?.task ?? null;
    const previous = ContextCompactionSummarySchema.safeParse(
      source.previousCheckpoint?.summaryData
    );
    const previousSummary = previous.success ? previous.data : null;
    const previousMessageCount = previousSummary
      ? (source.previousCheckpoint?.summarizedMessageCount ?? 0)
      : 0;
    const messages = source.messages.slice(previousMessageCount);
    const inputBudget =
      source.task.inputBudget ?? contextCompactionInputBudget();
    const batches = splitContextCompactionMessages(messages, inputBudget);
    if (!batches.length) {
      throw new Error('CONTEXT_COMPACTION_EMPTY_SOURCE');
    }

    let summary = previousSummary;
    let inputTokensEstimated = 0;
    for (const [batchIndex, batch] of batches.entries()) {
      const prompt = contextCompactionMessages({
        messages: batch,
        previousSummary: summary,
        receiptIds: source.receiptIds,
        batchIndex,
        batchCount: batches.length,
      });
      inputTokensEstimated += prompt.reduce(
        (total, message) =>
          total + estimateContextCompactionTokens(message.content),
        0
      );
      const generated = await this.capabilityRuntime.generateStructuredValue(
        { modelId: source.task.modelId ?? undefined },
        prompt,
        {
          user: source.task.actorUserIdSnapshot,
          workspace: source.task.workspaceIdSnapshot ?? undefined,
          session: source.task.sessionId,
          taskId: source.task.id,
          featureKind: 'chat',
          maxTokens: 4_096,
          responseSchemaJson:
            CONTEXT_COMPACTION_RESPONSE_CONTRACT.responseSchemaJson,
          schemaHash: CONTEXT_COMPACTION_RESPONSE_CONTRACT.schemaHash,
          strict: true,
          maxProviderAttempts: 2,
          signal: AbortSignal.timeout(60_000),
        },
        CONTEXT_COMPACTION_RESPONSE_CONTRACT as Required<
          typeof CONTEXT_COMPACTION_RESPONSE_CONTRACT
        >
      );
      summary = validateContextCompactionSummary({
        value: generated.value,
        sourceMessageIds: source.messages.map(message => message.id),
        receiptIds: source.receiptIds,
      });
      await this.models.copilotContextMemory.renewContextCompactionLease({
        taskId,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    }
    if (!summary) throw new Error('CONTEXT_COMPACTION_EMPTY_RESULT');
    const rendered = renderContextCompactionSummary(summary);
    return await this.models.copilotContextMemory.storeContextCompactionResult({
      taskId,
      leaseId,
      summary: rendered,
      summaryData: summary,
      diagnostics: {
        promptVersion: CONTEXT_COMPACTION_PROMPT_VERSION,
        schemaHash: CONTEXT_COMPACTION_RESPONSE_CONTRACT.schemaHash,
        batchCount: batches.length,
        sourceMessageCount: source.messages.length,
        previousCheckpointUsed: Boolean(previousSummary),
        receiptCount: source.receiptIds.length,
        tokenAccounting: 'provider_neutral_conservative_estimate',
        inputBudget,
      },
      inputTokensEstimated,
      outputTokensEstimated: estimateContextCompactionTokens(rendered),
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async enqueueDueContextCompactions() {
    const tasks =
      await this.models.copilotContextMemory.listDueContextCompactions(100);
    await Promise.all(
      tasks.map(async task => {
        const current =
          await this.models.copilotContextMemory.getContextCompactionTask(
            task.id
          );
        if (current) await this.enqueueContextCompaction(current);
      })
    );
  }

  async executeContextCompaction(taskId: string) {
    const leaseId = randomUUID();
    const claimed =
      await this.models.copilotContextMemory.claimContextCompaction({
        taskId,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    if (!claimed || claimed.status !== 'running') {
      return (
        claimed ??
        (await this.models.copilotContextMemory.getContextCompactionTask(
          taskId
        ))
      );
    }
    try {
      await this.generateContextCompaction(taskId, leaseId);
      return await this.models.copilotContextMemory.publishContextCompaction({
        taskId,
        leaseId,
      });
    } catch (error) {
      const failureCode =
        error instanceof Error &&
        /^CONTEXT_COMPACTION_[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'CONTEXT_COMPACTION_PROVIDER_FAILED';
      await this.models.copilotContextMemory.failContextCompaction({
        taskId,
        leaseId,
        failureCode,
      });
      throw error;
    }
  }

  @OnJob('copilot.session.compactContext')
  async compactContextJob(job: Jobs['copilot.session.compactContext']) {
    await this.executeContextCompaction(job.taskId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async enqueueDueSessionDeletions() {
    const deletions =
      await this.models.copilotSession.listDueSessionDeletions(100);
    await Promise.all(
      deletions.map(deletion =>
        this.jobs.add(
          'copilot.session.purge',
          { sessionId: deletion.sessionId },
          { jobId: `copilot-session-purge-${deletion.sessionId}` }
        )
      )
    );
  }

  @OnJob('copilot.session.purge')
  async purgeDeletedSession(job: Jobs['copilot.session.purge']) {
    const leaseId = randomUUID();
    const deletion = await this.models.copilotSession.claimSessionDeletion({
      sessionId: job.sessionId,
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    if (!deletion) return;
    try {
      await this.compatSubmissions.deleteSession(job.sessionId);
      await this.models.copilotSession.purgeSessionDeletion({
        sessionId: job.sessionId,
        leaseId,
        contextEpoch: deletion.contextEpoch,
      });
      const pending =
        await this.models.projectResource.listPendingSessionBlobDeletions(
          deletion.id
        );
      for (const blob of pending) {
        await this.projectBlobs.deletePendingSessionBlob({
          deletionId: deletion.id,
          projectId: blob.projectId,
          key: blob.key,
        });
      }
      await this.models.copilotSession.completeSessionDeletion({
        sessionId: job.sessionId,
        leaseId,
        contextEpoch: deletion.contextEpoch,
      });
    } catch (error) {
      await this.models.copilotSession.failSessionDeletion({
        sessionId: job.sessionId,
        leaseId,
        failureCode:
          error instanceof Error &&
          ['SESSION_DELETE_EPOCH_STALE', 'SESSION_DELETE_LEASE_LOST'].includes(
            error.message
          )
            ? error.message
            : 'SESSION_DELETE_PURGE_FAILED',
      });
      throw error;
    }
  }

  async getMessage(sessionId: string, messageId: string) {
    const message = await this.models.copilotSession.getMessage(
      sessionId,
      messageId
    );
    if (!message) {
      throw new CopilotMessageNotFound({ messageId });
    }
    return message;
  }

  async appendTurn(input: {
    sessionId: string;
    userId: string;
    prompt: { model: string };
    turn: Turn;
    compatSubmissionId?: string;
  }) {
    return await this.store.appendTurn(input);
  }

  async findTurnByCompatSubmissionId(
    sessionId: string,
    compatSubmissionId: string
  ) {
    return await this.store.findTurnByCompatSubmissionId(
      sessionId,
      compatSubmissionId
    );
  }

  // revert the latest messages not generate by user
  // after revert, we can retry the action
  async revertLatestMessage(
    sessionId: string,
    removeLatestUserMessage: boolean
  ) {
    await this.store.revertLatestTurn(sessionId, removeLatestUserMessage);
  }

  /**
   * usage:
   * ``` typescript
   * {
   *     // allocate a session, can be reused chat in about 12 hours with same session
   *     await using session = await session.get(sessionId);
   *     session.pushTurn(turn);
   *     copilot.text({ modelId }, await session.finishAsync({}, { modelId }));
   * }
   * // session will be disposed after the block
   * @param sessionId session id
   * @returns
   */
  async get(sessionId: string): Promise<ChatSession | null> {
    const state = await this.getState(sessionId);
    if (state) {
      {
        await this.models.copilotContext.recordInputSources({
          sessionId,
          actorId: state.conversation.userId,
          projectId: state.conversation.selectedContextProjectId,
          workOrderId: state.conversation.workOrderId,
          sources: [
            {
              workspaceId: state.conversation.workspaceId,
              kind:
                state.conversation.scopeType === 'work_order'
                  ? 'work_order'
                  : 'workspace',
              sourceId: `system-prompt:${createHash('sha256').update(JSON.stringify(state.prompt)).digest('hex')}`,
            },
          ],
        });
      }
      const contextEnabled =
        state.prompt.category === 'text' &&
        state.conversation.scopeType !== 'work_order';
      const contextScope = contextEnabled
        ? await this.contextScopeResolver.resolve({
            userId: state.conversation.userId,
            workspaceId: state.conversation.workspaceId,
            sessionId,
            primaryDocId: state.conversation.docId,
            selectedProjectId: state.conversation.selectedContextProjectId,
          })
        : null;
      const [memories, checkpoint] =
        contextEnabled && contextScope
          ? await Promise.all([
              this.retrieveContextMemories(
                contextScope,
                state.turns.findLast(turn => turn.role === 'user')?.content ??
                  ''
              ),
              this.contextMemory.loadCheckpoint(sessionId),
            ])
          : [[], null];
      return new ChatSession(
        {
          userId: state.conversation.userId,
          sessionId: state.conversation.id,
          workspaceId: state.conversation.workspaceId,
          docId: state.conversation.docId,
          selectedContextProjectId: state.conversation.selectedContextProjectId,
          scopeType: state.conversation.scopeType,
          workOrderId: state.conversation.workOrderId,
          turns: state.turns,
          prompt: state.prompt,
        },
        (prompt, turns, params, maxTokenSize, sessionId) =>
          this.prompts.renderSession(
            prompt,
            turns,
            params,
            maxTokenSize,
            sessionId
          ),
        async state => {
          await this.store.appendTurns(state);
          if (this.conversationPolicy.shouldScheduleTitle(state.prompt)) {
            await this.jobs.add(
              'copilot.session.generateTitle',
              { sessionId: state.sessionId },
              { priority: BACKGROUND_COPILOT_JOB_PRIORITY }
            );
          }
        },
        undefined,
        contextEnabled && contextScope
          ? {
              planner: this.contextPlanner,
              memories,
              checkpoint,
              scope: contextScope,
              saveCheckpoint: async checkpoint => {
                await this.contextMemory.saveCheckpoint(sessionId, checkpoint);
              },
              savePlanTrace: async trace => {
                await this.contextMemory.savePlanTrace(trace);
              },
              retrieveMemories: async query =>
                await this.retrieveContextMemories(contextScope, query),
              compactCheckpoint: async input =>
                await this.compactCheckpoint({
                  sessionId,
                  actorUserId: state.conversation.userId,
                  ...input,
                }),
            }
          : undefined
      );
    }
    return null;
  }

  @OnJob('copilot.session.deleteDoc')
  async deleteDocSessions(doc: Jobs['copilot.session.deleteDoc']) {
    const [sessionIds] = await Promise.all([
      this.models.copilotSession
        .list({
          userId: undefined,
          workspaceId: doc.workspaceId,
          docId: doc.docId,
        })
        .then(s => s.map(s => [s.userId, s.id])),
      this.models.copilotContextMemory.removeDocumentReferences({
        workspaceId: doc.workspaceId,
        docId: doc.docId,
      }),
    ]);
    for (const [userId, sessionId] of sessionIds) {
      await this.models.copilotSession.update(
        { userId, sessionId, docId: null },
        true
      );
    }
  }

  @OnJob('copilot.session.generateTitle')
  async generateSessionTitle(job: Jobs['copilot.session.generateTitle']) {
    const { sessionId } = job;
    const claim =
      await this.models.copilotSession.beginTitleGeneration(sessionId);
    if (!claim) return;

    try {
      const state = await this.getState(sessionId);
      if (!state) {
        this.logger.warn(
          `Session ${sessionId} not found when generating title`
        );
        return;
      }
      const { conversation } = state;
      const turns = state.turns.map(turn => ({
        ...turn,
        content: this.stripNullBytes(turn.content),
      }));

      if (
        !this.conversationPolicy.shouldGenerateTitle({
          title: conversation.title,
          turns,
        })
      ) {
        await this.models.copilotSession.failTitleGeneration(
          sessionId,
          claim.titleRevision
        );
        return;
      }

      const promptContent =
        this.conversationPolicy.buildTitlePromptContent(turns);
      const generatedTitle = this.stripNullBytes(
        await this.promptRuntime.runText('Summary as title', {
          content: promptContent,
        })
      ).trim();

      if (!generatedTitle) {
        this.logger.warn(
          `Generated empty title for session ${sessionId}, skip updating`
        );
        await this.models.copilotSession.failTitleGeneration(
          sessionId,
          claim.titleRevision
        );
        return;
      }
      await this.models.copilotSession.applyGeneratedTitle({
        sessionId,
        expectedRevision: claim.titleRevision,
        title: generatedTitle,
      });
    } catch (error) {
      await this.models.copilotSession.failTitleGeneration(
        sessionId,
        claim.titleRevision
      );
      const context = {
        sessionId,
        cause: error instanceof Error ? error.cause : error,
      };
      if (this.isNullByteError(error)) {
        this.logger.warn(
          `Skip title generation for session ${sessionId} due to invalid null bytes in stored data`,
          context
        );
        return;
      }
      this.logger.error(
        `Failed to generate title for session ${sessionId}:`,
        context
      );
      throw error;
    }
  }
}
