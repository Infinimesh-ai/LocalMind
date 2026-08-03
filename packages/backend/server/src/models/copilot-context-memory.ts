import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';
import { toPgVector } from './common';

export const COPILOT_CONTEXT_MEMORY_SCOPES = [
  'user',
  'workspace',
  'document',
  'project',
] as const;
export type CopilotContextMemoryScope =
  (typeof COPILOT_CONTEXT_MEMORY_SCOPES)[number];

export const COPILOT_CONTEXT_MEMORY_KINDS = [
  'rule',
  'auto_memory',
  'project_summary',
] as const;
export type CopilotContextMemoryKind =
  (typeof COPILOT_CONTEXT_MEMORY_KINDS)[number];

export const COPILOT_CONTEXT_MEMORY_VISIBILITIES = ['private'] as const;
export type CopilotContextMemoryVisibility =
  (typeof COPILOT_CONTEXT_MEMORY_VISIBILITIES)[number];

export const COPILOT_CONTEXT_MEMORY_STATUSES = [
  'active',
  'disabled',
  'superseded',
  'deleted',
  'expired',
] as const;
export type CopilotContextMemoryStatus =
  (typeof COPILOT_CONTEXT_MEMORY_STATUSES)[number];

export const COPILOT_CONTEXT_PROJECT_STATUSES = ['active', 'archived'] as const;
export type CopilotContextProjectStatus =
  (typeof COPILOT_CONTEXT_PROJECT_STATUSES)[number];

export type CopilotContextMemoryInput = {
  ownerUserId: string;
  workspaceId?: string | null;
  docId?: string | null;
  projectId?: string | null;
  sourceSessionId?: string | null;
  scope: CopilotContextMemoryScope;
  kind: CopilotContextMemoryKind;
  visibility: CopilotContextMemoryVisibility;
  status?: CopilotContextMemoryStatus;
  content: string;
  factKey?: string | null;
  confidence?: number;
  importance?: number;
  sensitivity?: 'private' | 'personal' | 'restricted';
  captureMode?: 'manual' | 'explicit' | 'implicit' | 'legacy';
  writerVersion?: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  expiresAt?: Date | null;
  supersedesId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CopilotContextMemoryWriterOperation =
  | 'ADD'
  | 'UPDATE'
  | 'DELETE'
  | 'NOOP';

export type CopilotContextMemoryWriterDecision = {
  operation: CopilotContextMemoryWriterOperation;
  factKey?: string | null;
  content?: string | null;
  confidence: number;
  importance: number;
  sensitivity: 'private' | 'personal' | 'restricted';
  validFrom?: Date | null;
  validUntil?: Date | null;
  expiresAt?: Date | null;
  reasonCode: string;
};

export type CopilotContextMemoryWriterInput = {
  ownerUserId: string;
  workspaceId: string;
  docId?: string | null;
  projectId?: string | null;
  sourceSessionId?: string | null;
  sourceTurnId?: string | null;
  scope: Exclude<CopilotContextMemoryScope, 'user'>;
  explicit: boolean;
  writerVersion: string;
  decisionFingerprint: string;
  decision: CopilotContextMemoryWriterDecision;
};

export type CopilotContextCheckpointInput = {
  sessionId: string;
  strategyVersion: string;
  strategyFingerprint: string;
  summary: string;
  summarizedMessageCount: number;
  sourceFingerprint: string;
  diagnostics: Record<string, unknown>;
};

export type CopilotContextStrategyRevisionInput = {
  version: string;
  fingerprint: string;
  status: 'active' | 'archived';
  config: Record<string, unknown>;
};

export type CopilotContextPlanTraceInput = {
  sessionId: string;
  sourceTurnId?: string | null;
  strategyVersion: string;
  strategyFingerprint: string;
  inputMessageCount: number;
  retainedMessageCount: number;
  omittedMessageCount: number;
  candidateMemoryCount: number;
  selectedMemoryCount: number;
  summaryInjected: boolean;
  planningPasses: number;
  contextCharBudget: number;
  contextCharCount: number;
  sourceFingerprint: string;
  outputFingerprint: string;
  candidateMemoryIds: string[];
  selectedMemories: Array<{
    id: string | null;
    scope: CopilotContextMemoryScope;
    kind: CopilotContextMemoryKind;
    score: number;
    rank: number;
    sourceType?: 'memory' | 'rule' | 'policy';
    sourceRevisionId?: string;
    matchReason?: 'always' | 'condition' | 'semantic' | 'manual';
  }>;
  scope: Record<string, unknown>;
};

export type CopilotContextProjectInput = {
  workspaceId: string;
  createdByUserId: string;
  name: string;
  description?: string;
  documentIds: string[];
};

function normalizeMemoryContent(content: string) {
  return content.replace(/\s+/g, ' ').trim();
}

function normalizeFactKey(factKey?: string | null) {
  const normalized = factKey?.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return normalized || null;
}

function activeMemoryLifecycleWhere(now = new Date()) {
  return {
    status: 'active',
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  } satisfies Prisma.AiContextMemoryWhereInput;
}

function memoryWriterLockKey(input: {
  ownerUserId: string;
  workspaceId: string;
  scope: CopilotContextMemoryScope;
  docId?: string | null;
  projectId?: string | null;
  factKey?: string | null;
  fallback: string;
}) {
  return [
    'context-memory-writer/v1',
    input.ownerUserId,
    input.workspaceId,
    input.scope,
    input.docId ?? '',
    input.projectId ?? '',
    normalizeFactKey(input.factKey) ?? input.fallback,
  ].join(':');
}

export function fingerprintContextMemory(input: {
  scope: CopilotContextMemoryScope;
  kind: CopilotContextMemoryKind;
  content: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        content: normalizeMemoryContent(input.content).toLowerCase(),
      })
    )
    .digest('hex');
}

function memoryIdentityWhere(input: CopilotContextMemoryInput) {
  return {
    ...(input.visibility === 'private'
      ? { ownerUserId: input.ownerUserId }
      : {}),
    workspaceId: input.workspaceId ?? null,
    docId: input.docId ?? null,
    projectId: input.projectId ?? null,
    kind: input.kind,
    status: 'active',
    fingerprint: fingerprintContextMemory(input),
  } satisfies Prisma.AiContextMemoryWhereInput;
}

export function buildContextMemoryVisibilityWhere(input: {
  userId: string;
  workspaceId?: string | null;
  docId?: string | null;
  docIds?: string[];
  projectIds?: string[];
  includeDisabled?: boolean;
}) {
  const docIds = Array.from(
    new Set([input.docId, ...(input.docIds ?? [])].filter(Boolean))
  ) as string[];
  const scopes: Prisma.AiContextMemoryWhereInput[] = [
    {
      ownerUserId: input.userId,
      scope: 'user',
      workspaceId: null,
      docId: null,
      projectId: null,
    },
  ];
  if (input.workspaceId) {
    scopes.push({
      ownerUserId: input.userId,
      scope: 'workspace',
      workspaceId: input.workspaceId,
      docId: null,
      projectId: null,
    });
    if (docIds.length) {
      scopes.push({
        ownerUserId: input.userId,
        scope: 'document',
        workspaceId: input.workspaceId,
        docId: { in: docIds },
        projectId: null,
      });
    }
    if (input.projectIds?.length) {
      scopes.push({
        ownerUserId: input.userId,
        workspaceId: input.workspaceId,
        scope: 'project',
        docId: null,
        projectId: { in: input.projectIds },
      });
    }
  }

  return {
    ...(input.includeDisabled
      ? { status: { in: ['active', 'disabled'] } }
      : activeMemoryLifecycleWhere()),
    visibility: 'private',
    OR: scopes,
  } satisfies Prisma.AiContextMemoryWhereInput;
}

@Injectable()
export class CopilotContextMemoryModel extends BaseModel {
  private async lockWriterKey(key: string) {
    await this.db.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
    `;
  }

  async getPreference(userId: string, workspaceId: string) {
    return await this.db.aiContextPreference.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });
  }

  @Transactional()
  async putPreference(input: {
    userId: string;
    workspaceId: string;
    autoMemoryEnabled: boolean;
  }) {
    return await this.db.aiContextPreference.upsert({
      where: {
        userId_workspaceId: {
          userId: input.userId,
          workspaceId: input.workspaceId,
        },
      },
      create: input,
      update: {
        autoMemoryEnabled: input.autoMemoryEnabled,
      },
    });
  }

  @Transactional()
  async put(input: CopilotContextMemoryInput) {
    const content = normalizeMemoryContent(input.content);
    const identity = memoryIdentityWhere({ ...input, content });
    const existing = await this.db.aiContextMemory.findFirst({
      where: identity,
    });
    const data = {
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId ?? null,
      docId: input.docId ?? null,
      projectId: input.projectId ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      scope: input.scope,
      kind: input.kind,
      visibility: input.visibility,
      status: input.status ?? 'active',
      content,
      fingerprint: identity.fingerprint as string,
      factKey: normalizeFactKey(input.factKey),
      confidence: input.confidence ?? 1,
      importance: input.importance ?? 0.5,
      sensitivity: input.sensitivity ?? 'private',
      captureMode: input.captureMode ?? 'manual',
      writerVersion: input.writerVersion ?? 'legacy/v1',
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      expiresAt: input.expiresAt ?? null,
      supersedesId: input.supersedesId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    };

    if (existing) {
      return await this.db.aiContextMemory.update({
        where: { id: existing.id },
        data: {
          ...data,
          ownerUserId: data.ownerUserId,
          status: input.status ?? existing.status,
        },
      });
    }

    try {
      return await this.db.aiContextMemory.create({ data });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const raced = await this.db.aiContextMemory.findFirst({
        where: identity,
      });
      if (!raced) throw error;
      return await this.db.aiContextMemory.update({
        where: { id: raced.id },
        data: {
          ...data,
          ownerUserId: data.ownerUserId,
          status: input.status ?? raced.status,
        },
      });
    }
  }

  private async appendWriterEvent(input: {
    ownerUserId: string;
    workspaceId: string;
    sourceSessionId?: string | null;
    sourceTurnId?: string | null;
    operation: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP' | 'UNDO';
    memoryId?: string | null;
    previousMemoryId?: string | null;
    targetEventId?: string | null;
    factKey?: string | null;
    explicit: boolean;
    reasonCode: string;
    writerVersion: string;
    decisionFingerprint: string;
  }) {
    return await this.db.aiContextMemoryEvent.create({
      data: {
        ...input,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        memoryId: input.memoryId ?? null,
        previousMemoryId: input.previousMemoryId ?? null,
        targetEventId: input.targetEventId ?? null,
        factKey: normalizeFactKey(input.factKey),
      },
    });
  }

  @Transactional()
  async applyWriterDecision(input: CopilotContextMemoryWriterInput) {
    await this.lockWriterKey(
      memoryWriterLockKey({
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        scope: input.scope,
        docId: input.docId,
        projectId: input.projectId,
        factKey: input.decision.factKey,
        fallback: input.decisionFingerprint,
      })
    );
    const replay = await this.db.aiContextMemoryEvent.findUnique({
      where: { decisionFingerprint: input.decisionFingerprint },
      include: { memory: true, previousMemory: true },
    });
    if (replay) return replay;

    const factKey = normalizeFactKey(input.decision.factKey);
    const scopeWhere = {
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      docId: input.docId ?? null,
      projectId: input.projectId ?? null,
      scope: input.scope,
      kind: 'auto_memory',
      visibility: 'private',
    } satisfies Prisma.AiContextMemoryWhereInput;
    const current = factKey
      ? await this.db.aiContextMemory.findFirst({
          where: {
            ...scopeWhere,
            factKey,
            status: 'active',
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        })
      : null;
    const eventBase = {
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      sourceSessionId: input.sourceSessionId,
      sourceTurnId: input.sourceTurnId,
      factKey,
      explicit: input.explicit,
      writerVersion: input.writerVersion,
      decisionFingerprint: input.decisionFingerprint,
    };

    if (input.decision.operation === 'NOOP') {
      return await this.appendWriterEvent({
        ...eventBase,
        operation: 'NOOP',
        memoryId: current?.id,
        reasonCode: input.decision.reasonCode,
      });
    }

    if (input.decision.operation === 'DELETE') {
      if (!current) {
        return await this.appendWriterEvent({
          ...eventBase,
          operation: 'NOOP',
          reasonCode: 'delete_target_not_found',
        });
      }
      await this.db.aiContextMemory.update({
        where: { id: current.id },
        data: { status: 'deleted' },
      });
      return await this.appendWriterEvent({
        ...eventBase,
        operation: 'DELETE',
        memoryId: current.id,
        reasonCode: input.decision.reasonCode,
      });
    }

    const content = normalizeMemoryContent(input.decision.content ?? '');
    if (!content || !factKey) {
      return await this.appendWriterEvent({
        ...eventBase,
        operation: 'NOOP',
        memoryId: current?.id,
        reasonCode: !content ? 'empty_content' : 'missing_fact_key',
      });
    }
    const fingerprint = fingerprintContextMemory({
      scope: input.scope,
      kind: 'auto_memory',
      content,
    });
    if (current?.fingerprint === fingerprint) {
      return await this.appendWriterEvent({
        ...eventBase,
        operation: 'NOOP',
        memoryId: current.id,
        reasonCode: 'same_fact_value',
      });
    }

    if (current) {
      await this.db.aiContextMemory.update({
        where: { id: current.id },
        data: {
          status: 'superseded',
          validUntil: input.decision.validFrom ?? new Date(),
        },
      });
    }
    const memory = await this.db.aiContextMemory.create({
      data: {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        docId: input.docId ?? null,
        projectId: input.projectId ?? null,
        sourceSessionId: input.sourceSessionId,
        scope: input.scope,
        kind: 'auto_memory',
        visibility: 'private',
        status: 'active',
        content,
        fingerprint,
        factKey,
        confidence: input.decision.confidence,
        importance: input.decision.importance,
        sensitivity: input.decision.sensitivity,
        captureMode: input.explicit ? 'explicit' : 'implicit',
        writerVersion: input.writerVersion,
        validFrom: input.decision.validFrom ?? new Date(),
        validUntil: input.decision.validUntil ?? null,
        expiresAt: input.decision.expiresAt ?? null,
        supersedesId: current?.id ?? null,
        metadata: {
          reasonCode: input.decision.reasonCode,
          sourceTurnId: input.sourceTurnId ?? null,
        },
      },
    });
    return await this.appendWriterEvent({
      ...eventBase,
      operation: current ? 'UPDATE' : 'ADD',
      memoryId: memory.id,
      previousMemoryId: current?.id,
      reasonCode: input.decision.reasonCode,
    });
  }

  @Transactional()
  async undoWriterEvent(input: {
    eventId: string;
    ownerUserId: string;
    workspaceId: string;
  }) {
    const candidate = await this.db.aiContextMemoryEvent.findFirst({
      where: {
        id: input.eventId,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        operation: { in: ['ADD', 'UPDATE', 'DELETE'] },
        undoneAt: null,
      },
      include: { memory: true },
    });
    if (!candidate?.memoryId || !candidate.memory) return null;
    await this.lockWriterKey(
      memoryWriterLockKey({
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        scope: candidate.memory.scope as CopilotContextMemoryScope,
        docId: candidate.memory.docId,
        projectId: candidate.memory.projectId,
        factKey: candidate.factKey,
        fallback: candidate.id,
      })
    );
    const event = await this.db.aiContextMemoryEvent.findFirst({
      where: {
        id: input.eventId,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        operation: { in: ['ADD', 'UPDATE', 'DELETE'] },
        undoneAt: null,
      },
      include: { memory: true },
    });
    if (!event?.memoryId || !event.memory) return null;
    const activeFact = await this.db.aiContextMemory.findFirst({
      where: {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        scope: event.memory.scope,
        docId: event.memory.docId,
        projectId: event.memory.projectId,
        factKey: event.factKey,
        kind: 'auto_memory',
        status: 'active',
      },
      select: { id: true },
    });
    if (
      (event.operation === 'DELETE' && event.memory.status !== 'deleted') ||
      (event.operation !== 'DELETE' && event.memory.status !== 'active') ||
      (event.operation === 'DELETE' && activeFact) ||
      (event.operation !== 'DELETE' && activeFact?.id !== event.memoryId)
    ) {
      return null;
    }
    if (event.operation === 'ADD') {
      const deleted = await this.db.aiContextMemory.updateMany({
        where: { id: event.memoryId, status: 'active' },
        data: { status: 'deleted' },
      });
      if (deleted.count !== 1) {
        throw new Error('Context memory changed while undoing an add');
      }
    } else if (event.operation === 'UPDATE') {
      const superseded = await this.db.aiContextMemory.updateMany({
        where: { id: event.memoryId, status: 'active' },
        data: { status: 'superseded', validUntil: new Date() },
      });
      if (superseded.count !== 1) {
        throw new Error('Context memory changed while undoing an update');
      }
      if (event.previousMemoryId) {
        const restored = await this.db.aiContextMemory.updateMany({
          where: { id: event.previousMemoryId, status: 'superseded' },
          data: { status: 'active', validUntil: null },
        });
        if (restored.count !== 1) {
          throw new Error(
            'Previous context memory changed while undoing an update'
          );
        }
      }
    } else {
      const restored = await this.db.aiContextMemory.updateMany({
        where: { id: event.memoryId, status: 'deleted' },
        data: { status: 'active' },
      });
      if (restored.count !== 1) {
        throw new Error('Context memory changed while undoing a delete');
      }
    }

    const undoneAt = new Date();
    const updated = await this.db.aiContextMemoryEvent.updateMany({
      where: { id: event.id, undoneAt: null },
      data: { undoneAt },
    });
    if (updated.count !== 1) {
      throw new Error('Context memory event changed while undoing');
    }
    return await this.appendWriterEvent({
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      sourceSessionId: event.sourceSessionId,
      sourceTurnId: event.sourceTurnId,
      operation: 'UNDO',
      memoryId: event.previousMemoryId ?? event.memoryId,
      previousMemoryId: event.memoryId,
      targetEventId: event.id,
      factKey: event.factKey,
      explicit: true,
      reasonCode: 'user_undo',
      writerVersion: event.writerVersion,
      decisionFingerprint: createHash('sha256')
        .update(`undo:${event.id}`)
        .digest('hex'),
    });
  }

  async listWriterEvents(input: {
    ownerUserId: string;
    workspaceId: string;
    limit?: number;
  }) {
    return await this.db.aiContextMemoryEvent.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
      },
      include: {
        memory: {
          select: {
            scope: true,
            docId: true,
            projectId: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(input.limit ?? 50, 1), 200),
    });
  }

  @Transactional()
  async expireDueMemories(now = new Date()) {
    return await this.db.aiContextMemory.updateMany({
      where: {
        status: 'active',
        OR: [{ expiresAt: { lte: now } }, { validUntil: { lte: now } }],
      },
      data: { status: 'expired' },
    });
  }

  @Transactional()
  async markMemoriesUsed(ids: string[], usedAt = new Date()) {
    if (!ids.length) return { count: 0 };
    return await this.db.aiContextMemory.updateMany({
      where: { id: { in: [...new Set(ids)] }, status: 'active' },
      data: { lastUsedAt: usedAt, useCount: { increment: 1 } },
    });
  }

  async putEmbedding(id: string, embedding: number[]) {
    const vector = toPgVector(embedding);
    await this.db.$executeRaw`
      UPDATE "ai_context_memories"
      SET "embedding" = ${vector}::vector
      WHERE "id" = ${id}
    `;
  }

  async clearEmbedding(id: string) {
    await this.db.$executeRaw`
      UPDATE "ai_context_memories"
      SET "embedding" = NULL
      WHERE "id" = ${id}
    `;
  }

  async matchAuthorizedEmbeddings(
    ids: string[],
    embedding: number[],
    limit = 64
  ) {
    if (!ids.length) return [];
    const vector = toPgVector(embedding);
    return await this.db.$queryRaw<Array<{ id: string; distance: number }>>`
      SELECT "id", "embedding" <=> ${vector}::vector AS "distance"
      FROM "ai_context_memories"
      WHERE "id" IN (${Prisma.join([...new Set(ids)])})
        AND "embedding" IS NOT NULL
      ORDER BY "distance" ASC
      LIMIT ${Math.min(Math.max(limit, 1), 256)}
    `;
  }

  async get(id: string) {
    return await this.db.aiContextMemory.findUnique({ where: { id } });
  }

  async listVisible(input: {
    userId: string;
    workspaceId?: string | null;
    docId?: string | null;
    docIds?: string[];
    projectIds?: string[];
    includeDisabled?: boolean;
  }) {
    return await this.db.aiContextMemory.findMany({
      where: buildContextMemoryVisibilityWhere(input),
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
      take: 512,
    });
  }

  async listManageable(input: {
    userId: string;
    workspaceId?: string | null;
    projectIds?: string[];
    includeDisabled?: boolean;
  }) {
    return await this.db.aiContextMemory.findMany({
      where: {
        status: input.includeDisabled
          ? { in: ['active', 'disabled'] }
          : 'active',
        ownerUserId: input.userId,
        visibility: 'private',
        ...(input.workspaceId
          ? {
              OR: [
                {
                  scope: 'user',
                  workspaceId: null,
                  docId: null,
                  projectId: null,
                },
                {
                  workspaceId: input.workspaceId,
                  OR: [
                    { scope: 'workspace' },
                    { scope: 'document' },
                    ...(input.projectIds?.length
                      ? [
                          {
                            scope: 'project',
                            projectId: { in: input.projectIds },
                          },
                        ]
                      : []),
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @Transactional()
  async update(
    id: string,
    input: {
      content?: string;
      status?: CopilotContextMemoryStatus;
    }
  ) {
    const current = await this.get(id);
    if (!current) return null;
    const content =
      input.content === undefined
        ? current.content
        : normalizeMemoryContent(input.content);
    return await this.db.aiContextMemory.update({
      where: { id },
      data: {
        content,
        status: input.status,
        fingerprint:
          input.content === undefined
            ? current.fingerprint
            : fingerprintContextMemory({
                scope: current.scope as CopilotContextMemoryScope,
                kind: current.kind as CopilotContextMemoryKind,
                content,
              }),
      },
    });
  }

  async retireDisabledVersion(id: string, validUntil = new Date()) {
    return await this.db.aiContextMemory.updateMany({
      where: { id, status: 'disabled' },
      data: { status: 'superseded', validUntil },
    });
  }

  @Transactional()
  async delete(id: string) {
    const result = await this.db.aiContextMemory.deleteMany({
      where: { id },
    });
    return result.count > 0;
  }

  async getProject(id: string) {
    return await this.db.aiContextProject.findUnique({
      where: { id },
      include: {
        documents: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async listProjects(input: {
    workspaceId: string;
    includeArchived?: boolean;
  }) {
    return await this.db.aiContextProject.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.includeArchived ? {} : { status: 'active' }),
      },
      include: {
        documents: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async listProjectIdsForDoc(input: { workspaceId: string; docId: string }) {
    const projects = await this.db.aiContextProject.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        documents: {
          some: { docId: input.docId },
        },
      },
      select: { id: true },
    });
    return projects.map(project => project.id);
  }

  async listProjectMembershipsForDocs(input: {
    workspaceId: string;
    docIds: string[];
  }) {
    if (!input.docIds.length) return [];
    return await this.db.aiContextProjectDoc.findMany({
      where: {
        docId: { in: input.docIds },
        project: {
          workspaceId: input.workspaceId,
          status: 'active',
        },
      },
      select: {
        docId: true,
        projectId: true,
      },
    });
  }

  @Transactional()
  async removeDocumentReferences(input: {
    workspaceId: string;
    docId: string;
  }) {
    const [memories, projectDocuments] = await Promise.all([
      this.db.aiContextMemory.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          docId: input.docId,
          scope: 'document',
        },
      }),
      this.db.aiContextProjectDoc.deleteMany({
        where: {
          docId: input.docId,
          project: {
            workspaceId: input.workspaceId,
          },
        },
      }),
    ]);
    return {
      memoryCount: memories.count,
      projectDocumentCount: projectDocuments.count,
    };
  }

  @Transactional()
  async createProject(input: CopilotContextProjectInput) {
    return await this.db.aiContextProject.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: input.createdByUserId,
        name: input.name,
        description: input.description ?? '',
        documents: {
          createMany: {
            data: input.documentIds.map(docId => ({ docId })),
            skipDuplicates: true,
          },
        },
      },
      include: {
        documents: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Transactional()
  async updateProject(
    id: string,
    input: {
      name?: string;
      description?: string;
      status?: CopilotContextProjectStatus;
      documentIds?: string[];
    }
  ) {
    return await this.db.aiContextProject.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        ...(input.documentIds
          ? {
              documents: {
                deleteMany: {},
                createMany: {
                  data: input.documentIds.map(docId => ({ docId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
      include: {
        documents: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Transactional()
  async deleteProject(id: string) {
    const memoryCount = await this.db.aiContextMemory.count({
      where: { projectId: id },
    });
    if (memoryCount > 0) return false;
    try {
      const result = await this.db.aiContextProject.deleteMany({
        where: { id },
      });
      return result.count > 0;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        return false;
      }
      throw error;
    }
  }

  async getCheckpoint(sessionId: string, strategyVersion: string) {
    return await this.db.aiContextCheckpoint.findUnique({
      where: {
        sessionId_strategyVersion: { sessionId, strategyVersion },
      },
    });
  }

  @Transactional()
  async putCheckpoint(input: CopilotContextCheckpointInput) {
    return await this.db.aiContextCheckpoint.upsert({
      where: {
        sessionId_strategyVersion: {
          sessionId: input.sessionId,
          strategyVersion: input.strategyVersion,
        },
      },
      create: {
        ...input,
        diagnostics: input.diagnostics as Prisma.InputJsonValue,
      },
      update: {
        strategyFingerprint: input.strategyFingerprint,
        summary: input.summary,
        summarizedMessageCount: input.summarizedMessageCount,
        sourceFingerprint: input.sourceFingerprint,
        diagnostics: input.diagnostics as Prisma.InputJsonValue,
      },
    });
  }

  @Transactional()
  async createPlanTrace(input: CopilotContextPlanTraceInput) {
    return await this.db.aiContextPlanTrace.create({
      data: {
        ...input,
        candidateMemoryIds: input.candidateMemoryIds as Prisma.InputJsonValue,
        selectedMemories: input.selectedMemories as Prisma.InputJsonValue,
        scope: input.scope as Prisma.InputJsonValue,
      },
    });
  }

  async listPlanTraces(sessionId: string, limit = 50) {
    return await this.db.aiContextPlanTrace.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  @Transactional()
  async ensureStrategyRevision(input: CopilotContextStrategyRevisionInput) {
    const existing = await this.db.aiContextStrategyRevision.findUnique({
      where: { version: input.version },
    });
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        throw new Error(
          `Context strategy ${input.version} changed without a version bump`
        );
      }
      if (existing.status !== input.status) {
        return await this.db.aiContextStrategyRevision.update({
          where: { version: input.version },
          data: { status: input.status },
        });
      }
      return existing;
    }

    try {
      return await this.db.aiContextStrategyRevision.create({
        data: {
          ...input,
          config: input.config as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const raced = await this.db.aiContextStrategyRevision.findUnique({
        where: { version: input.version },
      });
      if (!raced || raced.fingerprint !== input.fingerprint) throw error;
      return raced;
    }
  }

  async listStrategyRevisions(input: { userId: string; workspaceId: string }) {
    const [revisions, checkpointStats, traceStats] = await Promise.all([
      this.db.aiContextStrategyRevision.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
      this.db.aiContextCheckpoint.groupBy({
        by: ['strategyVersion'],
        where: {
          session: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.db.aiContextPlanTrace.groupBy({
        by: ['strategyVersion'],
        where: {
          session: {
            userId: input.userId,
            workspaceId: input.workspaceId,
          },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const statsByVersion = new Map(
      checkpointStats.map(item => [item.strategyVersion, item])
    );
    const traceStatsByVersion = new Map(
      traceStats.map(item => [item.strategyVersion, item])
    );
    return revisions.map(revision => {
      const stats = statsByVersion.get(revision.version);
      const traces = traceStatsByVersion.get(revision.version);
      return {
        ...revision,
        checkpointCount: stats?._count._all ?? 0,
        lastCheckpointAt: stats?._max.updatedAt ?? null,
        traceCount: traces?._count._all ?? 0,
        lastTraceAt: traces?._max.createdAt ?? null,
      };
    });
  }
}
