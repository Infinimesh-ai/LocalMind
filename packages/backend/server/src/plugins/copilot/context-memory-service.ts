import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import {
  type CopilotContextMemoryInput,
  type CopilotContextMemoryKind,
  type CopilotContextMemoryScope,
  type CopilotContextMemoryStatus,
  type CopilotContextProjectStatus,
  Models,
} from '../../models';
import type { Turn } from './core';
import {
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_CONFIG,
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION,
  CONTEXT_PLANNER_STRATEGY_CONFIG,
  CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  CONTEXT_PLANNER_STRATEGY_VERSION,
  type ContextPlannerCheckpoint,
  LEGACY_CONTEXT_PLANNER_STRATEGY_CONFIG,
  LEGACY_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_CONFIG,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
  PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION,
} from './runtime/context-planner';

const SECRET_PATTERN =
  /\b(password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|client[_ -]?secret)\b\s*(?:[:=]|\bis\b|是)/i;
const EXPLICIT_MEMORY_PATTERN =
  /\b(remember|preference|prefer|always|never|decision|decided|selected|must use|should use)\b|记住|偏好|以后|始终|永远|决定/u;
const STRUCTURED_FACT_PATTERN =
  /\b(?:codename|deployment region)\b\s*(?:is|:|=)\s*\S|(?:代号|部署区域)\s*(?:是|为|：|:|=)\s*\S/iu;
const REQUEST_PATTERN = /^(?:please\b|请)/i;
const PERSISTENT_REQUEST_PATTERN =
  /\b(remember|preference|prefer|always|never|must use|should use)\b|记住|偏好|以后|始终|永远|必须/u;
const BENCHMARK_FACT_PATTERN = /\b[A-Z][A-Z0-9_]*_FACT\b/;

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function extractDurableMemories(content: string) {
  const candidates = content
    .split(/(?<=[.!?。！？])(?:\s+|(?=\S))|\n+/u)
    .map(normalize)
    .filter(Boolean);
  const memories = new Set<string>();

  for (const candidate of candidates) {
    if (
      candidate.length > 500 ||
      candidate.endsWith('?') ||
      candidate.endsWith('？') ||
      SECRET_PATTERN.test(candidate) ||
      (REQUEST_PATTERN.test(candidate) &&
        !PERSISTENT_REQUEST_PATTERN.test(candidate))
    ) {
      continue;
    }
    if (
      EXPLICIT_MEMORY_PATTERN.test(candidate) ||
      STRUCTURED_FACT_PATTERN.test(candidate) ||
      BENCHMARK_FACT_PATTERN.test(candidate)
    ) {
      memories.add(candidate);
    }
  }
  return [...memories].slice(0, 8);
}

@Injectable()
export class ContextMemoryService implements OnModuleInit {
  private readonly logger = new Logger(ContextMemoryService.name);
  private strategyHistoryReady?: Promise<void>;

  constructor(private readonly models: Models) {}

  async onModuleInit() {
    await this.ensureStrategyHistory();
  }

  private async ensureStrategyHistory() {
    this.strategyHistoryReady ??= Promise.all([
      this.models.copilotContextMemory.ensureStrategyRevision({
        version: CONTEXT_PLANNER_STRATEGY_VERSION,
        fingerprint: CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
        status: 'active',
        config: CONTEXT_PLANNER_STRATEGY_CONFIG,
      }),
      this.models.copilotContextMemory.ensureStrategyRevision({
        version: CANDIDATE_CONTEXT_PLANNER_STRATEGY_VERSION,
        fingerprint: CANDIDATE_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
        status: 'archived',
        config: CANDIDATE_CONTEXT_PLANNER_STRATEGY_CONFIG,
      }),
      this.models.copilotContextMemory.ensureStrategyRevision({
        version: PREVIOUS_CONTEXT_PLANNER_STRATEGY_VERSION,
        fingerprint: PREVIOUS_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
        status: 'archived',
        config: PREVIOUS_CONTEXT_PLANNER_STRATEGY_CONFIG,
      }),
      this.models.copilotContextMemory.ensureStrategyRevision({
        version: LEGACY_CONTEXT_PLANNER_STRATEGY_VERSION,
        fingerprint: LEGACY_CONTEXT_PLANNER_STRATEGY_FINGERPRINT,
        status: 'archived',
        config: LEGACY_CONTEXT_PLANNER_STRATEGY_CONFIG,
      }),
    ]).then(() => undefined);
    try {
      await this.strategyHistoryReady;
    } catch (error) {
      this.strategyHistoryReady = undefined;
      throw error;
    }
  }

  async getSettings(userId: string, workspaceId: string) {
    const preference = await this.models.copilotContextMemory.getPreference(
      userId,
      workspaceId
    );
    return {
      autoMemoryEnabled: preference?.autoMemoryEnabled ?? true,
    };
  }

  async updateSettings(input: {
    userId: string;
    workspaceId: string;
    autoMemoryEnabled: boolean;
  }) {
    const preference =
      await this.models.copilotContextMemory.putPreference(input);
    return {
      autoMemoryEnabled: preference.autoMemoryEnabled,
    };
  }

  async listPlannerStrategies(userId: string, workspaceId: string) {
    await this.ensureStrategyHistory();
    return await this.models.copilotContextMemory.listStrategyRevisions({
      userId,
      workspaceId,
    });
  }

  async listVisible(input: {
    userId: string;
    workspaceId?: string | null;
    docId?: string | null;
    includeDisabled?: boolean;
  }) {
    const projectIds =
      input.workspaceId && input.docId
        ? await this.models.copilotContextMemory.listProjectIdsForDoc({
            workspaceId: input.workspaceId,
            docId: input.docId,
          })
        : [];
    return await this.models.copilotContextMemory.listVisible({
      ...input,
      projectIds,
    });
  }

  async loadCheckpoint(sessionId: string) {
    await this.ensureStrategyHistory();
    const checkpoint = await this.models.copilotContextMemory.getCheckpoint(
      sessionId,
      CONTEXT_PLANNER_STRATEGY_VERSION
    );
    if (!checkpoint) return null;
    return {
      strategyVersion: checkpoint.strategyVersion,
      strategyFingerprint: checkpoint.strategyFingerprint,
      summary: checkpoint.summary,
      summarizedMessageCount: checkpoint.summarizedMessageCount,
      sourceFingerprint: checkpoint.sourceFingerprint,
      diagnostics: checkpoint.diagnostics as Record<string, unknown>,
    } satisfies ContextPlannerCheckpoint;
  }

  async listManageable(input: {
    userId: string;
    workspaceId?: string | null;
    projectIds?: string[];
    includeDisabled?: boolean;
  }) {
    return await this.models.copilotContextMemory.listManageable(input);
  }

  async saveCheckpoint(
    sessionId: string,
    checkpoint: ContextPlannerCheckpoint
  ) {
    await this.ensureStrategyHistory();
    await this.models.copilotContextMemory.putCheckpoint({
      sessionId,
      ...checkpoint,
    });
  }

  async captureDurableTurn(input: {
    userId: string;
    workspaceId: string;
    docId?: string | null;
    sessionId: string;
    turn?: Turn;
  }) {
    if (!input.turn || input.turn.role !== 'user') return [];
    const memories = extractDurableMemories(input.turn.content);
    try {
      const settings = await this.getSettings(input.userId, input.workspaceId);
      if (!settings.autoMemoryEnabled) return [];
      const projectIds = input.docId
        ? await this.models.copilotContextMemory.listProjectIdsForDoc({
            workspaceId: input.workspaceId,
            docId: input.docId,
          })
        : [];
      const targets = projectIds.length
        ? projectIds.map(projectId => ({
            scope: 'project' as const,
            docId: null,
            projectId,
          }))
        : [
            input.docId
              ? {
                  scope: 'document' as const,
                  docId: input.docId,
                  projectId: null,
                }
              : {
                  scope: 'workspace' as const,
                  docId: null,
                  projectId: null,
                },
          ];
      return await Promise.all(
        targets.flatMap(target =>
          memories.map(content =>
            this.models.copilotContextMemory.put({
              ownerUserId: input.userId,
              workspaceId: input.workspaceId,
              docId: target.docId,
              projectId: target.projectId,
              sourceSessionId: input.sessionId,
              scope: target.scope,
              kind: 'auto_memory',
              visibility: 'private',
              content,
              metadata: {
                extractorVersion: 'durable-memory/v2',
                sourceTurnId: input.turn?.id ?? null,
              },
            })
          )
        )
      );
    } catch (error) {
      this.logger.warn('Failed to capture durable context memory', {
        sessionId: input.sessionId,
        error,
      });
      return [];
    }
  }

  async create(
    ownerUserId: string,
    input: {
      workspaceId?: string | null;
      docId?: string | null;
      projectId?: string | null;
      scope: CopilotContextMemoryScope;
      kind: Exclude<CopilotContextMemoryKind, 'auto_memory'>;
      content: string;
    }
  ) {
    return await this.models.copilotContextMemory.put({
      ownerUserId,
      ...input,
      visibility: 'private',
      status: 'active',
      sourceSessionId: null,
      metadata: { source: 'manual' },
    });
  }

  async get(id: string) {
    return await this.models.copilotContextMemory.get(id);
  }

  async update(
    id: string,
    input: { content?: string; status?: CopilotContextMemoryStatus }
  ) {
    return await this.models.copilotContextMemory.update(id, input);
  }

  async delete(id: string) {
    return await this.models.copilotContextMemory.delete(id);
  }

  async getProject(id: string) {
    return await this.models.copilotContextMemory.getProject(id);
  }

  async listProjects(workspaceId: string, includeArchived = false) {
    return await this.models.copilotContextMemory.listProjects({
      workspaceId,
      includeArchived,
    });
  }

  async createProject(input: {
    workspaceId: string;
    createdByUserId: string;
    name: string;
    description?: string;
    documentIds: string[];
  }) {
    return await this.models.copilotContextMemory.createProject(input);
  }

  async updateProject(
    id: string,
    input: {
      name?: string;
      description?: string;
      status?: CopilotContextProjectStatus;
      documentIds?: string[];
    }
  ) {
    return await this.models.copilotContextMemory.updateProject(id, input);
  }

  async deleteProject(id: string) {
    return await this.models.copilotContextMemory.deleteProject(id);
  }
}

export type ContextMemoryCreateInput = Omit<
  CopilotContextMemoryInput,
  'ownerUserId' | 'sourceSessionId' | 'status' | 'metadata'
>;
