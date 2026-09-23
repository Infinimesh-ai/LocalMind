import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BadRequest, CopilotSessionNotFound, NotFound } from '../base';
import { BaseModel } from './base';
import { toPgVector } from './common';

export const AUTO_MEMORY_SCOPE_LIMIT = 200;
export const SHARED_PROJECT_MEMORY_CONTRACT = 'shared-project-memory/v1';

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

export type CopilotContextMemorySourceDocumentInput = {
  workspaceId: string;
  docId: string;
};

export const COPILOT_CONTEXT_PROJECT_STATUSES = ['active', 'archived'] as const;
export type CopilotContextProjectStatus =
  (typeof COPILOT_CONTEXT_PROJECT_STATUSES)[number];

export const COPILOT_CONTEXT_PROJECT_ROLES = ['owner', 'member'] as const;
export type CopilotContextProjectRole =
  (typeof COPILOT_CONTEXT_PROJECT_ROLES)[number];

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
  sourceDocuments?: CopilotContextMemorySourceDocumentInput[];
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
  workspaceId: string | null;
  docId?: string | null;
  projectId?: string | null;
  sourceSessionId?: string | null;
  sourceTurnId?: string | null;
  scope: Exclude<CopilotContextMemoryScope, 'user'>;
  explicit: boolean;
  writerVersion: string;
  decisionFingerprint: string;
  sourceDocuments?: CopilotContextMemorySourceDocumentInput[];
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
  summaryData?: Record<string, unknown>;
};

export type CopilotContextCompactionRequestInput = {
  sessionId: string;
  actorUserId: string;
  sourceMessageIds: string[];
  sourceFingerprint: string;
  summarizedMessageCount: number;
  strategyVersion: string;
  strategyFingerprint: string;
  modelId?: string | null;
  routeFingerprint: string;
  inputBudget?: number | null;
  candidateSummary: string;
  candidateSummaryData?: Record<string, unknown>;
  candidateDiagnostics: Record<string, unknown>;
};

export type CopilotContextCompactionStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'stale';

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
  createdByUserId: string;
  name: string;
  description?: string;
};

export type CopilotContextDocumentRef = {
  workspaceId: string;
  docId: string;
};

function normalizeMemoryContent(content: string) {
  return content.replace(/\s+/g, ' ').trim();
}

export function fingerprintContextCompactionMessages(
  messages: Array<{ role: string; content: string }>
) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        messages.map(message => ({
          role: message.role,
          content: message.content,
        }))
      )
    )
    .digest('hex');
}

function fingerprintContextCompactionRequest(input: {
  sessionId: string;
  contextEpoch: number;
  sourceFingerprint: string;
  summarizedMessageCount: number;
  previousCheckpointId: string | null;
  strategyVersion: string;
  strategyFingerprint: string;
  modelId: string | null;
  routeFingerprint: string;
  projectMemoryRevision: number | null;
  projectContextVersion: number | null;
  workspaceContextFingerprint: string | null;
  sourceLedgerFingerprint: string;
  authorizationFingerprint: string;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function fingerprintContextCompactionDependency(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
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
  workspaceId: string | null;
  scope: CopilotContextMemoryScope;
  docId?: string | null;
  projectId?: string | null;
  factKey?: string | null;
  fallback: string;
}) {
  return [
    'context-memory-writer/v3-shared-project',
    input.scope === 'project' ? '' : input.ownerUserId,
    input.scope === 'project' ? '' : input.workspaceId,
    input.scope,
    input.docId ?? '',
    input.projectId ?? '',
    normalizeFactKey(input.factKey) ?? input.fallback,
  ].join(':');
}

function memoryScopeWorkspaceId(input: {
  scope: CopilotContextMemoryScope;
  workspaceId?: string | null;
}) {
  return input.scope === 'project' ? null : (input.workspaceId ?? null);
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
    ...(input.visibility === 'private' && input.scope !== 'project'
      ? { ownerUserId: input.ownerUserId }
      : {}),
    workspaceId: memoryScopeWorkspaceId(input),
    docId: input.docId ?? null,
    projectId: input.projectId ?? null,
    kind: input.kind,
    status: 'active',
    ...(input.scope === 'project' ? { sharingStatus: 'shared' } : {}),
    fingerprint: fingerprintContextMemory(input),
  } satisfies Prisma.AiContextMemoryWhereInput;
}

export function buildContextMemoryVisibilityWhere(input: {
  userId: string;
  workspaceId?: string | null;
  docId?: string | null;
  docIds?: string[];
  documentRefs?: CopilotContextDocumentRef[];
  projectIds?: string[];
  includeDisabled?: boolean;
}) {
  const documentRefs = new Map<string, CopilotContextDocumentRef>();
  if (input.workspaceId) {
    for (const docId of [input.docId, ...(input.docIds ?? [])]) {
      if (!docId) continue;
      documentRefs.set(`${input.workspaceId}\u0000${docId}`, {
        workspaceId: input.workspaceId,
        docId,
      });
    }
  }
  for (const document of input.documentRefs ?? []) {
    if (!document.workspaceId || !document.docId) continue;
    documentRefs.set(`${document.workspaceId}\u0000${document.docId}`, {
      workspaceId: document.workspaceId,
      docId: document.docId,
    });
  }
  const documentIdsByWorkspace = new Map<string, string[]>();
  for (const document of documentRefs.values()) {
    const current = documentIdsByWorkspace.get(document.workspaceId) ?? [];
    current.push(document.docId);
    documentIdsByWorkspace.set(document.workspaceId, current);
  }
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
  }
  for (const [workspaceId, docIds] of documentIdsByWorkspace) {
    scopes.push({
      ownerUserId: input.userId,
      scope: 'document',
      workspaceId,
      docId: { in: docIds },
      projectId: null,
    });
  }
  if (input.projectIds?.length) {
    scopes.push({
      scope: 'project',
      workspaceId: null,
      docId: null,
      projectId: { in: input.projectIds },
      sharingStatus: 'shared',
      project: {
        status: 'active',
        members: { some: { userId: input.userId } },
      },
    });
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
  private memoryManagementWhere(id: string, actorUserId: string) {
    return {
      id,
      OR: [
        {
          ownerUserId: actorUserId,
          scope: { not: 'project' },
        },
        {
          scope: 'project',
          project: {
            status: 'active',
            members: {
              some: { userId: actorUserId, role: 'owner' },
            },
          },
        },
      ],
    } satisfies Prisma.AiContextMemoryWhereInput;
  }

  private async lockWriterKey(key: string) {
    await this.db.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
    `;
  }

  private projectMemorySourceDocuments(input: {
    scope: CopilotContextMemoryScope;
    projectId?: string | null;
    sourceDocuments?: CopilotContextMemorySourceDocumentInput[];
  }) {
    if (input.scope !== 'project') return null;
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new BadRequest('Project memory requires a projectId');
    }
    const documents = new Map<
      string,
      CopilotContextMemorySourceDocumentInput
    >();
    for (const document of input.sourceDocuments ?? []) {
      const workspaceId = document.workspaceId.trim();
      const docId = document.docId.trim();
      if (!workspaceId || !docId) {
        throw new BadRequest(
          'Project memory source workspaceId and docId are required'
        );
      }
      documents.set(`${workspaceId}\0${docId}`, { workspaceId, docId });
    }
    if (!documents.size) {
      throw new BadRequest(
        'Project memory requires at least one source document'
      );
    }
    return {
      projectId,
      documents: [...documents.values()].sort(
        (left, right) =>
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.docId.localeCompare(right.docId)
      ),
    };
  }

  private async attachProjectMemorySources(input: {
    memoryId: string;
    projectId: string;
    sourceDocuments: CopilotContextMemorySourceDocumentInput[];
  }) {
    await this.models.intelligenceWorkbenchAuthorization.attachProjectMemorySources(
      {
        memoryId: input.memoryId,
        projectId: input.projectId,
        documents: input.sourceDocuments,
      }
    );
  }

  private async attachProjectContribution(input: {
    memoryId: string;
    projectId: string;
    contributorUserId: string;
    sourceSessionId?: string | null;
    sourceTurnId?: string | null;
    contributionKind: 'create' | 'confirm' | 'correction';
    contentFingerprint: string;
    requestFingerprint: string;
  }) {
    try {
      await this.db.aiContextMemoryContribution.create({
        data: {
          ...input,
          sourceSessionId: input.sourceSessionId ?? null,
          sourceTurnId: input.sourceTurnId ?? null,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  private async bumpProjectMemoryRevision(projectId: string) {
    return await this.db.aiProjectMemorySettings.upsert({
      where: { projectId },
      create: {
        projectId,
        autoMemoryEnabled: false,
        projectMemoryRevision: 1,
      },
      update: { projectMemoryRevision: { increment: 1 } },
    });
  }

  async canManageProjectMemory(
    actorUserId: string,
    memoryId: string
  ): Promise<boolean> {
    const memory = await this.db.aiContextMemory.findFirst({
      where: {
        id: memoryId,
        scope: 'project',
        sharingStatus: 'shared',
        project: {
          status: 'active',
          members: { some: { userId: actorUserId } },
        },
      },
      select: {
        ownerUserId: true,
        lastEditedByUserId: true,
        project: {
          select: {
            members: {
              where: { userId: actorUserId },
              select: { role: true },
              take: 1,
            },
          },
        },
        contributions: {
          where: { status: 'active' },
          select: { contributorUserId: true },
        },
      },
    });
    if (!memory) return false;
    if (memory.project?.members[0]?.role === 'owner') return true;
    const contributors = new Set(
      memory.contributions.flatMap(contribution =>
        contribution.contributorUserId ? [contribution.contributorUserId] : []
      )
    );
    return (
      contributors.size === 1 &&
      contributors.has(actorUserId) &&
      memory.ownerUserId === actorUserId &&
      (memory.lastEditedByUserId === null ||
        memory.lastEditedByUserId === actorUserId)
    );
  }

  private async lockProjectOwner(projectId: string, actorUserId: string) {
    await this.db.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`context-project-documents:${projectId}`}, 0)
      )
    `;
    const rows = await this.db.$queryRaw<
      Array<{ id: string; status: CopilotContextProjectStatus }>
    >`
      SELECT project.id, project.status
      FROM ai_context_projects project
      JOIN ai_context_project_members member
        ON member.project_id = project.id
       AND member.user_id = ${actorUserId}
       AND member.role = 'owner'
      WHERE project.id = ${projectId}
      LIMIT 1
      FOR UPDATE OF project, member
    `;
    return rows[0] ?? null;
  }

  private async lockActiveProjectOwner(projectId: string, actorUserId: string) {
    const project = await this.lockProjectOwner(projectId, actorUserId);
    return project?.status === 'active' ? project : null;
  }

  async getPreference(userId: string, workspaceId: string) {
    return await this.db.aiContextPreference.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });
  }

  async getProjectPreference(userId: string, projectId: string) {
    const member = await this.db.aiContextProjectMember.findFirst({
      where: { userId, projectId, project: { status: 'active' } },
      select: { projectId: true },
    });
    if (!member) throw new NotFound('Project memory settings not found');
    return await this.db.aiProjectMemorySettings.findUnique({
      where: { projectId },
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
  async putProjectPreference(input: {
    userId: string;
    projectId: string;
    autoMemoryEnabled: boolean;
    expectedRevision?: number;
  }) {
    await this.lockWriterKey(`project-memory-settings/v1:${input.projectId}`);
    const member = await this.db.aiContextProjectMember.findFirst({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        role: 'owner',
        project: { status: 'active' },
      },
      select: { projectId: true },
    });
    if (!member) throw new NotFound('Project context settings not found');

    const current = await this.db.aiProjectMemorySettings.findUnique({
      where: { projectId: input.projectId },
    });
    if (!current) {
      if (input.expectedRevision !== undefined && input.expectedRevision !== 0)
        throw new BadRequest('Project context settings changed; reload first');
      try {
        return await this.db.aiProjectMemorySettings.create({
          data: {
            projectId: input.projectId,
            autoMemoryEnabled: input.autoMemoryEnabled,
            updatedByUserId: input.userId,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    }

    const expectedRevision = input.expectedRevision ?? current?.revision ?? 1;
    const updated = await this.db.aiProjectMemorySettings.updateMany({
      where: {
        projectId: input.projectId,
        revision: expectedRevision,
      },
      data: {
        autoMemoryEnabled: input.autoMemoryEnabled,
        revision: { increment: 1 },
        updatedByUserId: input.userId,
      },
    });
    if (updated.count !== 1)
      throw new BadRequest('Project context settings changed; reload first');
    return await this.db.aiProjectMemorySettings.findUniqueOrThrow({
      where: { projectId: input.projectId },
    });
  }

  @Transactional()
  async createProjectSummary(
    actorId: string,
    projectId: string,
    content: string
  ) {
    await this.assertActiveProjectMember(actorId, projectId);
    const normalized = normalizeMemoryContent(content);
    if (!normalized || normalized.length > 8000)
      throw new BadRequest('Project summary content is invalid');
    const fingerprint = fingerprintContextMemory({
      scope: 'project',
      kind: 'project_summary',
      content: normalized,
    });
    await this.lockWriterKey(`project-summary:${projectId}:${fingerprint}`);
    const existing = await this.db.aiContextMemory.findFirst({
      where: {
        projectId,
        kind: 'project_summary',
        fingerprint,
        status: 'active',
        sharingStatus: 'shared',
      },
    });
    if (existing) {
      const attached = await this.attachProjectContribution({
        memoryId: existing.id,
        projectId,
        contributorUserId: actorId,
        contributionKind: 'confirm',
        contentFingerprint: fingerprint,
        requestFingerprint: createHash('sha256')
          .update(`project-summary:${projectId}:${fingerprint}:${actorId}`)
          .digest('hex'),
      });
      if (attached) await this.bumpProjectMemoryRevision(projectId);
      return existing;
    }
    const memory = await this.db.aiContextMemory.create({
      data: {
        ownerUserId: actorId,
        lastEditedByUserId: actorId,
        projectId,
        scope: 'project',
        kind: 'project_summary',
        content: normalized,
        fingerprint,
        captureMode: 'manual',
        writerVersion: 'project-summary/v1',
        sharingStatus: 'shared',
        contractVersion: SHARED_PROJECT_MEMORY_CONTRACT,
      },
    });
    await this.db.projectSummaryRevision.create({
      data: {
        memoryId: memory.id,
        projectId,
        actorIdSnapshot: actorId,
        contentFingerprint: createHash('sha256')
          .update(memory.content)
          .digest('hex'),
      },
    });
    await this.attachProjectContribution({
      memoryId: memory.id,
      projectId,
      contributorUserId: actorId,
      contributionKind: 'create',
      contentFingerprint: fingerprint,
      requestFingerprint: createHash('sha256')
        .update(`project-summary:${projectId}:${fingerprint}:${actorId}`)
        .digest('hex'),
    });
    await this.bumpProjectMemoryRevision(projectId);
    return memory;
  }

  private async assertActiveProjectMember(actorId: string, projectId: string) {
    const member = await this.db.aiContextProjectMember.findFirst({
      where: {
        userId: actorId,
        projectId,
        project: { status: 'active' },
      },
      select: { projectId: true },
    });
    if (!member) {
      throw new NotFound('Project memory is unavailable');
    }
  }

  @Transactional()
  async put(input: CopilotContextMemoryInput) {
    if (input.scope === 'project') {
      if (!input.projectId) {
        throw new BadRequest('Project memory requires a projectId');
      }
      await this.assertActiveProjectMember(input.ownerUserId, input.projectId);
    }
    if (input.scope === 'project' && input.sourceSessionId && input.projectId) {
      await this.models.copilotContext.assertProjectSourcesShared({
        sessionId: input.sourceSessionId,
        actorId: input.ownerUserId,
        projectId: input.projectId,
        sink: {
          type: 'project_memory',
          id: input.sourceSessionId,
          phase: 'execute',
        },
      });
    }
    const projectSource = this.projectMemorySourceDocuments(input);
    const content = normalizeMemoryContent(input.content);
    const identity = memoryIdentityWhere({ ...input, content });
    const existing = await this.db.aiContextMemory.findFirst({
      where: identity,
    });
    const data = {
      ownerUserId: input.ownerUserId,
      lastEditedByUserId: input.ownerUserId,
      workspaceId: memoryScopeWorkspaceId(input),
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
      sharingStatus: input.scope === 'project' ? 'shared' : 'private',
      contractVersion:
        input.scope === 'project'
          ? SHARED_PROJECT_MEMORY_CONTRACT
          : 'personal-memory/v1',
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      expiresAt: input.expiresAt ?? null,
      supersedesId: input.supersedesId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    };

    if (existing) {
      if (projectSource) {
        await this.attachProjectMemorySources({
          memoryId: existing.id,
          projectId: projectSource.projectId,
          sourceDocuments: projectSource.documents,
        });
        const attached = await this.attachProjectContribution({
          memoryId: existing.id,
          projectId: projectSource.projectId,
          contributorUserId: input.ownerUserId,
          sourceSessionId: input.sourceSessionId,
          contributionKind: 'confirm',
          contentFingerprint: existing.fingerprint,
          requestFingerprint: createHash('sha256')
            .update(
              `memory-contribution:${existing.id}:${input.ownerUserId}:${input.sourceSessionId ?? 'manual'}`
            )
            .digest('hex'),
        });
        if (attached)
          await this.bumpProjectMemoryRevision(projectSource.projectId);
        return existing;
      }
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
      const created = await this.db.aiContextMemory.create({ data });
      if (projectSource) {
        await this.attachProjectMemorySources({
          memoryId: created.id,
          projectId: projectSource.projectId,
          sourceDocuments: projectSource.documents,
        });
        await this.attachProjectContribution({
          memoryId: created.id,
          projectId: projectSource.projectId,
          contributorUserId: input.ownerUserId,
          sourceSessionId: input.sourceSessionId,
          contributionKind: 'create',
          contentFingerprint: created.fingerprint,
          requestFingerprint: createHash('sha256')
            .update(
              `memory-contribution:${created.id}:${input.ownerUserId}:${input.sourceSessionId ?? 'manual'}`
            )
            .digest('hex'),
        });
        await this.bumpProjectMemoryRevision(projectSource.projectId);
      }
      return created;
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
      if (projectSource) {
        await this.attachProjectMemorySources({
          memoryId: raced.id,
          projectId: projectSource.projectId,
          sourceDocuments: projectSource.documents,
        });
        const attached = await this.attachProjectContribution({
          memoryId: raced.id,
          projectId: projectSource.projectId,
          contributorUserId: input.ownerUserId,
          sourceSessionId: input.sourceSessionId,
          contributionKind: 'confirm',
          contentFingerprint: raced.fingerprint,
          requestFingerprint: createHash('sha256')
            .update(
              `memory-contribution:${raced.id}:${input.ownerUserId}:${input.sourceSessionId ?? 'manual'}`
            )
            .digest('hex'),
        });
        if (attached)
          await this.bumpProjectMemoryRevision(projectSource.projectId);
        return raced;
      }
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
    workspaceId: string | null;
    projectId?: string | null;
    sourceSessionId?: string | null;
    sourceTurnId?: string | null;
    operation:
      | 'ADD'
      | 'UPDATE'
      | 'DELETE'
      | 'NOOP'
      | 'UNDO'
      | 'WITHDRAW'
      | 'PENDING_CONFLICT';
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
        projectId: input.projectId ?? null,
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
    if (!input.workspaceId && input.scope !== 'project')
      throw new BadRequest('Workspace memory requires a workspace');
    if (input.scope === 'project' && !input.sourceSessionId)
      throw new BadRequest(
        'Project memory writer requires a source conversation'
      );
    let sessionDocuments: CopilotContextMemorySourceDocumentInput[] = [];
    let projectSourceCheckId: string | undefined;
    let projectMemberRole: CopilotContextProjectRole | undefined;
    if (input.scope === 'project' && input.sourceSessionId) {
      if (!input.projectId)
        throw new BadRequest('Project memory requires a project');
      const session = await this.models.copilotSession.getMeta(
        input.sourceSessionId
      );
      if (
        !session ||
        session.userId !== input.ownerUserId ||
        session.workspaceId !== input.workspaceId ||
        session.selectedContextProjectId !== input.projectId
      )
        throw new BadRequest('Memory conversation owner does not match');
      if (
        !input.workspaceId &&
        (!input.sourceTurnId ||
          !(await this.db.aiSessionMessage.findFirst({
            where: {
              id: input.sourceTurnId,
              sessionId: input.sourceSessionId,
              role: 'user',
            },
            select: { id: true },
          })))
      )
        throw new BadRequest('Project memory requires a persisted user turn');
      await this.lockWriterKey(`project-memory-settings/v1:${input.projectId}`);
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
      const [settings, member] = await Promise.all([
        this.db.aiProjectMemorySettings.findUnique({
          where: { projectId: input.projectId },
        }),
        this.db.aiContextProjectMember.findFirst({
          where: {
            projectId: input.projectId,
            userId: input.ownerUserId,
            project: { status: 'active' },
          },
          select: { role: true },
        }),
      ]);
      if (!member) throw new BadRequest('Project memory membership changed');
      projectMemberRole = member.role as CopilotContextProjectRole;
      const replay = await this.db.aiContextMemoryEvent.findUnique({
        where: { decisionFingerprint: input.decisionFingerprint },
        include: { memory: true, previousMemory: true },
      });
      if (replay) return replay;
      if (
        !input.explicit &&
        (settings?.autoMemoryEnabled !== true ||
          session.allowMemoryCapture === false)
      ) {
        return await this.appendWriterEvent({
          ownerUserId: input.ownerUserId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          sourceSessionId: input.sourceSessionId,
          sourceTurnId: input.sourceTurnId,
          operation: 'NOOP',
          factKey: input.decision.factKey,
          explicit: false,
          reasonCode:
            settings?.autoMemoryEnabled !== true
              ? 'project_auto_memory_disabled'
              : 'session_memory_capture_disabled',
          writerVersion: input.writerVersion,
          decisionFingerprint: input.decisionFingerprint,
        });
      }
      const checkId =
        await this.models.copilotContext.checkProjectSourcesShared({
          sessionId: input.sourceSessionId,
          actorId: input.ownerUserId,
          projectId: input.projectId,
          sink: {
            type: 'project_memory',
            id: input.decisionFingerprint,
            phase: input.decision.operation === 'NOOP' ? 'noop' : 'execute',
          },
        });
      if (!input.workspaceId) projectSourceCheckId = checkId;
      sessionDocuments = (
        await this.models.copilotContext.getSessionSources(
          input.sourceSessionId
        )
      ).documentRefs;
    }
    if (input.scope !== 'project')
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
    const sourceDocuments = [
      ...(input.sourceDocuments ?? []),
      ...sessionDocuments,
    ];
    const projectSource =
      projectSourceCheckId && !sourceDocuments.length
        ? null
        : this.projectMemorySourceDocuments({
            ...input,
            sourceDocuments,
          });

    const factKey = normalizeFactKey(input.decision.factKey);
    const scopeWorkspaceId = memoryScopeWorkspaceId(input);
    const scopeWhere = {
      ...(input.scope === 'project'
        ? { sharingStatus: 'shared' }
        : { ownerUserId: input.ownerUserId }),
      workspaceId: scopeWorkspaceId,
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
      projectId: input.projectId,
      sourceSessionId: input.sourceSessionId,
      sourceTurnId: input.sourceTurnId,
      factKey,
      explicit: input.explicit,
      writerVersion: input.writerVersion,
      decisionFingerprint: input.decisionFingerprint,
    };

    if (input.decision.operation === 'NOOP') {
      if (projectSource && current) {
        await this.attachProjectMemorySources({
          memoryId: current.id,
          projectId: projectSource.projectId,
          sourceDocuments: projectSource.documents,
        });
      }
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
      if (input.scope === 'project' && input.projectId) {
        const contributions =
          await this.db.aiContextMemoryContribution.findMany({
            where: { memoryId: current.id, status: 'active' },
            select: { id: true, contributorUserId: true },
          });
        const own = contributions.filter(
          contribution => contribution.contributorUserId === input.ownerUserId
        );
        const others = contributions.filter(
          contribution => contribution.contributorUserId !== input.ownerUserId
        );
        if (projectMemberRole !== 'owner' && !own.length) {
          throw new NotFound('Project memory is unavailable');
        }
        if (projectMemberRole !== 'owner' && others.length) {
          await this.db.aiContextMemoryContribution.updateMany({
            where: { id: { in: own.map(contribution => contribution.id) } },
            data: { status: 'withdrawn', withdrawnAt: new Date() },
          });
          await this.bumpProjectMemoryRevision(input.projectId);
          return await this.appendWriterEvent({
            ...eventBase,
            operation: 'WITHDRAW',
            memoryId: current.id,
            reasonCode: 'contribution_withdrawn_shared_fact_retained',
          });
        }
      }
      await this.db.aiContextMemory.update({
        where: { id: current.id },
        data: {
          status: 'deleted',
          revision: { increment: 1 },
          lastEditedByUserId: input.ownerUserId,
        },
      });
      if (input.scope === 'project' && input.projectId) {
        await this.bumpProjectMemoryRevision(input.projectId);
      }
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
    const identicalProjectMemory =
      input.scope === 'project' && input.projectId
        ? await this.db.aiContextMemory.findFirst({
            where: {
              projectId: input.projectId,
              scope: 'project',
              kind: 'auto_memory',
              sharingStatus: 'shared',
              status: 'active',
              fingerprint,
            },
          })
        : null;
    const identical =
      current?.fingerprint === fingerprint ? current : identicalProjectMemory;
    if (identical) {
      if (projectSource) {
        await this.attachProjectMemorySources({
          memoryId: identical.id,
          projectId: projectSource.projectId,
          sourceDocuments: projectSource.documents,
        });
      }
      if (input.scope === 'project' && input.projectId) {
        const attached = await this.attachProjectContribution({
          memoryId: identical.id,
          projectId: input.projectId,
          contributorUserId: input.ownerUserId,
          sourceSessionId: input.sourceSessionId,
          sourceTurnId: input.sourceTurnId,
          contributionKind: 'confirm',
          contentFingerprint: fingerprint,
          requestFingerprint: createHash('sha256')
            .update(`project-contribution:${input.decisionFingerprint}`)
            .digest('hex'),
        });
        if (attached) {
          await this.bumpProjectMemoryRevision(input.projectId);
        }
      }
      return await this.appendWriterEvent({
        ...eventBase,
        operation: 'NOOP',
        memoryId: identical.id,
        reasonCode: 'same_fact_value',
      });
    }

    if (current && input.scope === 'project' && input.projectId) {
      const contributors = await this.db.aiContextMemoryContribution.findMany({
        where: { memoryId: current.id, status: 'active' },
        select: { contributorUserId: true },
      });
      const contributorIds = new Set(
        contributors.flatMap(contribution =>
          contribution.contributorUserId ? [contribution.contributorUserId] : []
        )
      );
      const actorOwnsCurrentVersion =
        contributorIds.size <= 1 &&
        (contributorIds.size === 0
          ? current.ownerUserId === input.ownerUserId
          : contributorIds.has(input.ownerUserId)) &&
        (current.lastEditedByUserId === null ||
          current.lastEditedByUserId === input.ownerUserId);
      const ownerExplicitlyResolves =
        projectMemberRole === 'owner' && input.explicit;
      if (!actorOwnsCurrentVersion && !ownerExplicitlyResolves) {
        await this.db.aiProjectMemoryConflict.upsert({
          where: { requestFingerprint: input.decisionFingerprint },
          create: {
            projectId: input.projectId,
            baseMemoryId: current.id,
            proposedByUserId: input.ownerUserId,
            sourceSessionId: input.sourceSessionId,
            sourceTurnId: input.sourceTurnId,
            factKey,
            proposedContent: content,
            proposedFingerprint: fingerprint,
            expectedMemoryRevision: current.revision,
            requestFingerprint: input.decisionFingerprint,
          },
          update: {},
        });
        await this.bumpProjectMemoryRevision(input.projectId);
        return await this.appendWriterEvent({
          ...eventBase,
          operation: 'PENDING_CONFLICT',
          memoryId: current.id,
          reasonCode: 'shared_fact_conflict_requires_owner',
        });
      }
    }

    const requestedValidFrom = input.decision.validFrom ?? new Date();
    const validFrom =
      current?.validFrom && requestedValidFrom <= current.validFrom
        ? new Date(current.validFrom.getTime() + 1)
        : requestedValidFrom;
    if (current) {
      await this.db.aiContextMemory.update({
        where: { id: current.id },
        data: {
          status: 'superseded',
          validUntil: validFrom,
        },
      });
    }
    const memory = await this.db.aiContextMemory.create({
      data: {
        ownerUserId: input.ownerUserId,
        lastEditedByUserId: input.ownerUserId,
        workspaceId: scopeWorkspaceId,
        docId: input.docId ?? null,
        projectId: input.projectId ?? null,
        sourceSessionId: input.sourceSessionId,
        projectSourceCheckId,
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
        sharingStatus: input.scope === 'project' ? 'shared' : 'private',
        contractVersion:
          input.scope === 'project'
            ? SHARED_PROJECT_MEMORY_CONTRACT
            : 'personal-memory/v1',
        validFrom,
        validUntil: input.decision.validUntil ?? null,
        expiresAt: input.decision.expiresAt ?? null,
        supersedesId: current?.id ?? null,
        metadata: {
          reasonCode: input.decision.reasonCode,
          sourceTurnId: input.sourceTurnId ?? null,
        },
      },
    });
    if (projectSource) {
      await this.attachProjectMemorySources({
        memoryId: memory.id,
        projectId: projectSource.projectId,
        sourceDocuments: projectSource.documents,
      });
    }
    if (input.scope === 'project' && input.projectId) {
      await this.attachProjectContribution({
        memoryId: memory.id,
        projectId: input.projectId,
        contributorUserId: input.ownerUserId,
        sourceSessionId: input.sourceSessionId,
        sourceTurnId: input.sourceTurnId,
        contributionKind: current ? 'correction' : 'create',
        contentFingerprint: fingerprint,
        requestFingerprint: createHash('sha256')
          .update(`project-contribution:${input.decisionFingerprint}`)
          .digest('hex'),
      });
      await this.bumpProjectMemoryRevision(input.projectId);
    }
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
    workspaceId: string | null;
    projectId?: string | null;
  }) {
    const candidate = await this.db.aiContextMemoryEvent.findFirst({
      where: {
        id: input.eventId,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        ...(input.projectId
          ? {
              projectId: input.projectId,
              memory: {
                projectId: input.projectId,
                sharingStatus: 'shared',
              },
            }
          : {}),
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
        ...(input.projectId
          ? {
              projectId: input.projectId,
              memory: {
                projectId: input.projectId,
                sharingStatus: 'shared',
              },
            }
          : {}),
        operation: { in: ['ADD', 'UPDATE', 'DELETE'] },
        undoneAt: null,
      },
      include: { memory: true },
    });
    if (!event?.memoryId || !event.memory) return null;
    if (
      input.projectId &&
      event.operation !== 'ADD' &&
      !(await this.canManageProjectMemory(input.ownerUserId, event.memoryId))
    ) {
      return null;
    }
    const activeFact = await this.db.aiContextMemory.findFirst({
      where: {
        ...(input.projectId ? {} : { ownerUserId: input.ownerUserId }),
        workspaceId: event.memory.workspaceId,
        scope: event.memory.scope,
        docId: event.memory.docId,
        projectId: event.memory.projectId,
        factKey: event.factKey,
        kind: 'auto_memory',
        status: 'active',
        ...(input.projectId ? { sharingStatus: 'shared' } : {}),
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
      if (input.projectId) {
        const otherContributions =
          await this.db.aiContextMemoryContribution.count({
            where: {
              memoryId: event.memoryId,
              status: 'active',
              NOT: { contributorUserId: input.ownerUserId },
            },
          });
        if (otherContributions) {
          await this.db.aiContextMemoryContribution.updateMany({
            where: {
              memoryId: event.memoryId,
              contributorUserId: input.ownerUserId,
              status: 'active',
            },
            data: { status: 'withdrawn', withdrawnAt: new Date() },
          });
        } else {
          const deleted = await this.db.aiContextMemory.updateMany({
            where: { id: event.memoryId, status: 'active' },
            data: {
              status: 'deleted',
              revision: { increment: 1 },
              lastEditedByUserId: input.ownerUserId,
            },
          });
          if (deleted.count !== 1) {
            throw new Error('Context memory changed while undoing an add');
          }
        }
        await this.bumpProjectMemoryRevision(input.projectId);
      } else {
        const deleted = await this.db.aiContextMemory.updateMany({
          where: { id: event.memoryId, status: 'active' },
          data: { status: 'deleted' },
        });
        if (deleted.count !== 1) {
          throw new Error('Context memory changed while undoing an add');
        }
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
      projectId: input.projectId,
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
    workspaceId: string | null;
    projectId?: string | null;
    limit?: number;
  }) {
    return await this.db.aiContextMemoryEvent.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        ...(input.projectId ? { memory: { projectId: input.projectId } } : {}),
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

  @Transactional()
  async enforceAutoMemoryQuota(
    input: {
      ownerUserId: string;
      workspaceId: string | null;
      scope: Exclude<CopilotContextMemoryScope, 'user'>;
      docId?: string | null;
      projectId?: string | null;
    },
    limit = AUTO_MEMORY_SCOPE_LIMIT
  ) {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
    const scopeWorkspaceId = memoryScopeWorkspaceId(input);
    const overflow = await this.db.$queryRaw<Array<{ id: string }>>`
      WITH automatic AS (
        SELECT memory."id", memory."status", memory."last_used_at",
          memory."updated_at"
        FROM "ai_context_memories" memory
        WHERE
          (${input.scope} = 'project' OR memory."owner_user_id" = ${input.ownerUserId}) AND
          memory."workspace_id" IS NOT DISTINCT FROM ${scopeWorkspaceId} AND
          memory."scope" = ${input.scope} AND
          memory."doc_id" IS NOT DISTINCT FROM ${input.docId ?? null} AND
          memory."project_id" IS NOT DISTINCT FROM ${input.projectId ?? null} AND
          memory."kind" = 'auto_memory' AND
          memory."status" IN ('active', 'disabled') AND
          memory."capture_mode" NOT IN ('manual', 'explicit') AND
          (${input.scope} <> 'project' OR memory."sharing_status" = 'shared')
      ), budget AS (
        SELECT GREATEST(count(*) - ${boundedLimit}, 0)::INTEGER AS "count"
        FROM automatic
      )
      SELECT automatic."id"
      FROM automatic
      WHERE NOT EXISTS (
        SELECT 1
        FROM "ai_project_memory_conflicts" conflict
        WHERE conflict."base_memory_id" = automatic."id"
          AND conflict."status" = 'pending'
      )
      ORDER BY
        CASE automatic."status" WHEN 'disabled' THEN 0 ELSE 1 END ASC,
        COALESCE(automatic."last_used_at", automatic."updated_at") ASC,
        automatic."updated_at" ASC,
        automatic."id" ASC
      LIMIT (SELECT "count" FROM budget)
    `;
    if (!overflow.length) return { count: 0 };
    const ids = overflow.map(memory => memory.id);
    const expiredAt = new Date();
    const expired = await this.db.aiContextMemory.updateMany({
      where: { id: { in: ids }, status: { in: ['active', 'disabled'] } },
      data: { status: 'expired', validUntil: expiredAt },
    });
    if (expired.count) {
      await this.db.$executeRaw`
        UPDATE "ai_context_memories"
        SET "embedding" = NULL
        WHERE "id" IN (${Prisma.join(ids)})
      `;
      if (input.scope === 'project' && input.projectId) {
        await this.bumpProjectMemoryRevision(input.projectId);
      }
    }
    return expired;
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
    documentRefs?: CopilotContextDocumentRef[];
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
    const personalScopes: Prisma.AiContextMemoryWhereInput[] = input.workspaceId
      ? [
          {
            ownerUserId: input.userId,
            scope: 'user',
            workspaceId: null,
            docId: null,
            projectId: null,
          },
          {
            ownerUserId: input.userId,
            workspaceId: input.workspaceId,
            OR: [{ scope: 'workspace' }, { scope: 'document' }],
          },
        ]
      : [
          {
            ownerUserId: input.userId,
            scope: { not: 'project' },
          },
        ];
    const projectFilter =
      input.projectIds === undefined
        ? {}
        : input.projectIds.length
          ? { projectId: { in: input.projectIds } }
          : null;
    const projectScopes: Prisma.AiContextMemoryWhereInput[] = projectFilter
      ? [
          {
            scope: 'project',
            workspaceId: null,
            sharingStatus: 'shared',
            ...projectFilter,
            project: {
              status: 'active',
              members: { some: { userId: input.userId } },
            },
          },
        ]
      : [];
    return await this.db.aiContextMemory.findMany({
      where: {
        status: input.includeDisabled
          ? { in: ['active', 'disabled'] }
          : 'active',
        visibility: 'private',
        OR: [...personalScopes, ...projectScopes],
      },
      include: {
        contributions: {
          where: { status: 'active' },
          select: {
            contributorUserId: true,
            contributionKind: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        conflicts: {
          where: { status: 'pending' },
          select: { id: true },
        },
      },
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async listProjectMemoryConflicts(projectId: string) {
    return await this.db.aiProjectMemoryConflict.findMany({
      where: { projectId, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  @Transactional()
  async resolveProjectMemoryConflict(input: {
    projectId: string;
    conflictId: string;
    actorUserId: string;
    resolution: 'accept' | 'reject';
  }) {
    if (
      !(await this.lockActiveProjectOwner(input.projectId, input.actorUserId))
    ) {
      return null;
    }
    const conflict = await this.db.aiProjectMemoryConflict.findFirst({
      where: {
        id: input.conflictId,
        projectId: input.projectId,
        status: 'pending',
      },
    });
    if (!conflict) return null;
    if (input.resolution === 'reject') {
      const changed = await this.db.aiProjectMemoryConflict.updateMany({
        where: { id: conflict.id, status: 'pending' },
        data: {
          status: 'rejected',
          resolution: 'owner_rejected',
          resolvedByUserId: input.actorUserId,
          resolvedAt: new Date(),
        },
      });
      if (!changed.count) return null;
      await this.bumpProjectMemoryRevision(input.projectId);
      return await this.db.aiProjectMemoryConflict.findUnique({
        where: { id: conflict.id },
      });
    }
    const current = await this.db.aiContextMemory.findFirst({
      where: {
        id: conflict.baseMemoryId,
        projectId: input.projectId,
        scope: 'project',
        sharingStatus: 'shared',
        status: 'active',
      },
    });
    if (!current || current.revision !== conflict.expectedMemoryRevision) {
      await this.db.aiProjectMemoryConflict.updateMany({
        where: { id: conflict.id, status: 'pending' },
        data: {
          status: 'stale',
          resolution: 'base_memory_changed',
          resolvedByUserId: input.actorUserId,
          resolvedAt: new Date(),
        },
      });
      await this.bumpProjectMemoryRevision(input.projectId);
      return await this.db.aiProjectMemoryConflict.findUnique({
        where: { id: conflict.id },
      });
    }
    const replacement = await this.update(
      current.id,
      {
        content: conflict.proposedContent,
        expectedRevision: conflict.expectedMemoryRevision,
      },
      input.actorUserId
    );
    if (!replacement) return null;
    if (conflict.proposedByUserId) {
      await this.attachProjectContribution({
        memoryId: replacement.id,
        projectId: input.projectId,
        contributorUserId: conflict.proposedByUserId,
        sourceSessionId: conflict.sourceSessionId,
        sourceTurnId: conflict.sourceTurnId,
        contributionKind: 'correction',
        contentFingerprint: conflict.proposedFingerprint,
        requestFingerprint: createHash('sha256')
          .update(`accepted-project-memory-conflict:${conflict.id}`)
          .digest('hex'),
      });
    }
    await this.db.aiProjectMemoryConflict.updateMany({
      where: { id: conflict.id, status: 'pending' },
      data: {
        status: 'accepted',
        resolution: 'owner_accepted',
        resolvedByUserId: input.actorUserId,
        resolvedAt: new Date(),
      },
    });
    await this.db.aiProjectMemoryConflict.updateMany({
      where: {
        baseMemoryId: current.id,
        status: 'pending',
        id: { not: conflict.id },
      },
      data: { status: 'stale', resolution: 'base_memory_changed' },
    });
    return await this.db.aiProjectMemoryConflict.findUnique({
      where: { id: conflict.id },
    });
  }

  @Transactional()
  async update(
    id: string,
    input: {
      content?: string;
      status?: CopilotContextMemoryStatus;
      expectedRevision?: number;
    },
    actorUserId?: string
  ) {
    const current = await this.get(id);
    if (!current) return null;
    if (
      current.scope === 'project' &&
      (!actorUserId || !(await this.canManageProjectMemory(actorUserId, id)))
    ) {
      throw new NotFound('AI context memory not found');
    }
    if (
      input.expectedRevision !== undefined &&
      current.revision !== input.expectedRevision
    ) {
      throw new BadRequest('Context memory changed; reload first');
    }
    const manualSummary =
      current.writerVersion === 'project-summary/v1' ? current.projectId : null;
    if (manualSummary) {
      if (!actorUserId) throw new NotFound('Project summary actor is required');
      const manageable = await this.db.aiContextMemory.findFirst({
        where: this.memoryManagementWhere(id, actorUserId),
        select: { id: true },
      });
      if (!manageable) throw new NotFound('Project summary is unavailable');
    }
    const content =
      input.content === undefined
        ? current.content
        : normalizeMemoryContent(input.content);
    if (manualSummary && (!content || content.length > 8000)) {
      throw new BadRequest('Project summary content is invalid');
    }
    const projectId = current.projectId;
    if (
      current.scope === 'project' &&
      projectId &&
      actorUserId &&
      input.content !== undefined &&
      content !== current.content
    ) {
      await this.lockWriterKey(
        memoryWriterLockKey({
          ownerUserId: actorUserId,
          workspaceId: null,
          scope: 'project',
          projectId,
          factKey: current.factKey,
          fallback: current.id,
        })
      );
      const moved = await this.db.aiContextMemory.updateMany({
        where: {
          id,
          status: current.status,
          revision: input.expectedRevision ?? current.revision,
        },
        data: {
          status: 'superseded',
          validUntil: new Date(),
          revision: { increment: 1 },
          lastEditedByUserId: actorUserId,
        },
      });
      if (moved.count !== 1) {
        throw new BadRequest('Context memory changed; reload first');
      }
      const fingerprint = fingerprintContextMemory({
        scope: 'project',
        kind: current.kind as CopilotContextMemoryKind,
        content,
      });
      const replacement = await this.db.aiContextMemory.create({
        data: {
          ownerUserId: current.ownerUserId,
          lastEditedByUserId: actorUserId,
          workspaceId: null,
          docId: null,
          projectId,
          sourceSessionId: current.sourceSessionId,
          scope: 'project',
          kind: current.kind,
          visibility: current.visibility,
          status: input.status ?? 'active',
          content,
          fingerprint,
          factKey: current.factKey,
          confidence: current.confidence,
          importance: current.importance,
          sensitivity: current.sensitivity,
          captureMode: current.captureMode,
          writerVersion: current.writerVersion,
          sharingStatus: 'shared',
          contractVersion: SHARED_PROJECT_MEMORY_CONTRACT,
          validFrom: new Date(),
          validUntil: null,
          expiresAt: current.expiresAt,
          supersedesId: current.id,
          projectSourceCheckId: current.projectSourceCheckId,
          metadata: current.metadata as Prisma.InputJsonValue,
        },
      });
      const sources = await this.db.aiContextMemorySource.findMany({
        where: { memoryId: current.id },
        select: {
          projectId: true,
          projectGrantId: true,
          workspaceId: true,
          docId: true,
        },
      });
      if (sources.length) {
        await this.db.aiContextMemorySource.createMany({
          data: sources.map(source => ({
            ...source,
            memoryId: replacement.id,
          })),
          skipDuplicates: true,
        });
      }
      const contributions = await this.db.aiContextMemoryContribution.findMany({
        where: { memoryId: current.id, status: 'active' },
        select: {
          contributorUserId: true,
          sourceSessionId: true,
          sourceTurnId: true,
          contributionKind: true,
          contentFingerprint: true,
          requestFingerprint: true,
          createdAt: true,
        },
      });
      if (contributions.length) {
        await this.db.aiContextMemoryContribution.createMany({
          data: contributions.map(contribution => ({
            id: randomUUID(),
            memoryId: replacement.id,
            projectId,
            contributorUserId: contribution.contributorUserId,
            sourceSessionId: contribution.sourceSessionId,
            sourceTurnId: contribution.sourceTurnId,
            contributionKind: contribution.contributionKind,
            status: 'active',
            contentFingerprint: contribution.contentFingerprint,
            requestFingerprint: createHash('sha256')
              .update(
                `carried-project-contribution:${replacement.id}:${contribution.requestFingerprint}`
              )
              .digest('hex'),
            createdAt: contribution.createdAt,
          })),
        });
      }
      await this.attachProjectContribution({
        memoryId: replacement.id,
        projectId,
        contributorUserId: actorUserId,
        sourceSessionId: current.sourceSessionId,
        contributionKind: 'correction',
        contentFingerprint: fingerprint,
        requestFingerprint: createHash('sha256')
          .update(
            `manual-project-memory-update:${current.id}:${current.revision}:${fingerprint}:${actorUserId}`
          )
          .digest('hex'),
      });
      if (manualSummary) {
        await this.db.projectSummaryRevision.create({
          data: {
            memoryId: replacement.id,
            projectId,
            actorIdSnapshot: actorUserId,
            contentFingerprint: createHash('sha256')
              .update(content)
              .digest('hex'),
          },
        });
      }
      await this.bumpProjectMemoryRevision(projectId);
      return replacement;
    }
    try {
      const updated = await this.db.aiContextMemory.updateMany({
        where: {
          ...(actorUserId
            ? current.scope === 'project'
              ? { id, projectId: current.projectId, sharingStatus: 'shared' }
              : this.memoryManagementWhere(id, actorUserId)
            : { id }),
          ...(input.expectedRevision === undefined
            ? {}
            : { revision: input.expectedRevision }),
        },
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
          revision: { increment: 1 },
          ...(actorUserId ? { lastEditedByUserId: actorUserId } : {}),
        },
      });
      if (updated.count !== 1) {
        if (input.expectedRevision !== undefined) {
          throw new BadRequest('Context memory changed; reload first');
        }
        throw new NotFound('AI context memory not found');
      }
      if (manualSummary && actorUserId && input.content !== undefined) {
        await this.db.projectSummaryRevision.create({
          data: {
            memoryId: id,
            projectId: manualSummary,
            actorIdSnapshot: actorUserId,
            contentFingerprint: createHash('sha256')
              .update(content)
              .digest('hex'),
          },
        });
      }
      if (current.scope === 'project' && current.projectId) {
        await this.bumpProjectMemoryRevision(current.projectId);
      }
      return await this.get(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequest(
            'An identical active AI context memory already exists in this scope'
          );
        }
        if (error.code === 'P2025') {
          throw new NotFound('AI context memory not found');
        }
      }
      throw error;
    }
  }

  async retireDisabledVersion(id: string, validUntil = new Date()) {
    return await this.db.aiContextMemory.updateMany({
      where: { id, status: 'disabled' },
      data: { status: 'superseded', validUntil },
    });
  }

  @Transactional()
  async delete(id: string, actorUserId?: string, expectedRevision?: number) {
    const current = await this.get(id);
    if (!current) return false;
    if (current.scope === 'project') {
      if (
        !current.projectId ||
        !actorUserId ||
        !(await this.canManageProjectMemory(actorUserId, id))
      ) {
        return false;
      }
      const result = await this.db.aiContextMemory.updateMany({
        where: {
          id,
          projectId: current.projectId,
          sharingStatus: 'shared',
          status: { in: ['active', 'disabled'] },
          ...(expectedRevision === undefined
            ? {}
            : { revision: expectedRevision }),
        },
        data: {
          status: 'deleted',
          revision: { increment: 1 },
          lastEditedByUserId: actorUserId,
        },
      });
      if (result.count) {
        await this.clearEmbedding(id);
        await this.bumpProjectMemoryRevision(current.projectId);
      }
      return result.count > 0;
    }
    const result = await this.db.aiContextMemory.deleteMany({
      where: {
        ...(actorUserId ? this.memoryManagementWhere(id, actorUserId) : { id }),
        ...(expectedRevision === undefined
          ? {}
          : { revision: expectedRevision }),
      },
    });
    return result.count > 0;
  }

  async getProject(id: string) {
    return await this.db.aiContextProject.findUnique({
      where: { id },
      include: {
        members: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  async listProjects(input: { userId: string; includeArchived?: boolean }) {
    return await this.db.aiContextProject.findMany({
      where: {
        members: { some: { userId: input.userId } },
        ...(input.includeArchived ? {} : { status: 'active' }),
      },
      include: {
        members: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @Transactional()
  async removeDocumentReferences(input: {
    workspaceId: string;
    docId: string;
  }) {
    await this.models.intelligenceWorkbenchAuthorization.removeSourceDocumentAuthorizations(
      input
    );
    const memories = await this.db.aiContextMemory.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        docId: input.docId,
        scope: 'document',
      },
    });
    return {
      memoryCount: memories.count,
    };
  }

  @Transactional()
  async createProject(input: CopilotContextProjectInput) {
    const project = await this.db.aiContextProject.create({
      data: {
        createdByUserId: input.createdByUserId,
        name: input.name,
        description: input.description ?? '',
        members: {
          create: {
            userId: input.createdByUserId,
            role: 'owner',
          },
        },
        memorySettings: {
          create: {
            autoMemoryEnabled: true,
            updatedByUserId: input.createdByUserId,
          },
        },
      },
    });
    const created = await this.getProject(project.id);
    if (!created) throw new Error('Created context project disappeared');
    return created;
  }

  @Transactional()
  async updateProject(
    id: string,
    actorUserId: string,
    input: {
      name?: string;
      description?: string;
      status?: CopilotContextProjectStatus;
    }
  ) {
    if (!(await this.lockActiveProjectOwner(id, actorUserId))) return null;
    if (input.status === 'archived') {
      await this.models.intelligenceWorkbenchAuthorization.withdrawPendingProjectWorkForArchive(
        { projectId: id, actorUserId }
      );
    }
    const project = await this.db.aiContextProject.update({
      where: { id },
      data: input,
      include: {
        members: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return project;
  }

  @Transactional()
  async deleteProject(id: string, actorUserId: string) {
    if (!(await this.lockProjectOwner(id, actorUserId))) return null;
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
    const pointer = await this.db.aiContextCheckpointPointer.findUnique({
      where: { sessionId },
      include: {
        checkpoint: true,
        session: {
          select: {
            contextEpoch: true,
            selectedContextProject: {
              select: {
                memorySettings: { select: { projectMemoryRevision: true } },
              },
            },
          },
        },
      },
    });
    const checkpoint = pointer?.checkpoint;
    if (
      !checkpoint ||
      checkpoint.strategyVersion !== strategyVersion ||
      checkpoint.contextEpoch !== pointer.session.contextEpoch ||
      checkpoint.projectMemoryRevision !==
        (pointer.session.selectedContextProject?.memorySettings
          ?.projectMemoryRevision ?? null)
    ) {
      return null;
    }
    return checkpoint;
  }

  @Transactional()
  async putCheckpoint(input: CopilotContextCheckpointInput) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'context-checkpoint:' + input.sessionId}, 0))`;
    const session = await this.db.aiSession.findUnique({
      where: { id: input.sessionId, deletedAt: null },
      select: {
        contextEpoch: true,
        selectedContextProject: {
          select: {
            memorySettings: { select: { projectMemoryRevision: true } },
          },
        },
      },
    });
    if (!session) throw new CopilotSessionNotFound();
    const projectMemoryRevision =
      session.selectedContextProject?.memorySettings?.projectMemoryRevision ??
      null;
    const current = await this.db.aiContextCheckpointPointer.findUnique({
      where: { sessionId: input.sessionId },
      include: { checkpoint: true },
    });
    if (
      current?.checkpoint.strategyVersion === input.strategyVersion &&
      current.checkpoint.strategyFingerprint === input.strategyFingerprint &&
      current.checkpoint.sourceFingerprint === input.sourceFingerprint &&
      current.checkpoint.contextEpoch === session.contextEpoch &&
      current.checkpoint.projectMemoryRevision === projectMemoryRevision
    ) {
      return current.checkpoint;
    }
    const latest = await this.db.aiContextCheckpoint.aggregate({
      where: { sessionId: input.sessionId },
      _max: { revision: true },
    });
    const checkpoint = await this.db.aiContextCheckpoint.create({
      data: {
        ...input,
        revision: (latest._max.revision ?? 0) + 1,
        contextEpoch: session.contextEpoch,
        projectMemoryRevision,
        status: 'completed',
        diagnostics: input.diagnostics as Prisma.InputJsonValue,
        summaryData: (input.summaryData ?? {
          format: 'bullet_facts/v1',
          facts: input.summary
            .split('\n')
            .map(line => line.replace(/^\s*-\s*/, '').trim())
            .filter(Boolean),
        }) as Prisma.InputJsonValue,
      },
    });
    await this.db.aiContextCheckpointPointer.upsert({
      where: { sessionId: input.sessionId },
      create: { sessionId: input.sessionId, checkpointId: checkpoint.id },
      update: { checkpointId: checkpoint.id },
    });
    return checkpoint;
  }

  private async appendContextCompactionEvent(
    task: {
      id: string;
      sessionId: string;
      contextEpoch: number;
      attempt: number;
      summarizedMessageCount: number;
      inputBudget: number | null;
      inputTokensEstimated?: number | null;
      outputTokensEstimated?: number | null;
      outputCharacters?: number | null;
      failureCode?: string | null;
    },
    status: CopilotContextCompactionStatus
  ) {
    return await this.db.aiContextCompactionEvent.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        sessionId: task.sessionId,
        contextEpoch: task.contextEpoch,
        status,
        attempt: task.attempt,
        statistics: {
          summarizedMessageCount: task.summarizedMessageCount,
          inputBudget: task.inputBudget,
          inputTokensEstimated: task.inputTokensEstimated ?? null,
          outputTokensEstimated: task.outputTokensEstimated ?? null,
          outputCharacters: task.outputCharacters ?? null,
          failureCode: task.failureCode ?? null,
        },
      },
    });
  }

  @Transactional()
  async requestContextCompaction(input: CopilotContextCompactionRequestInput) {
    if (
      input.summarizedMessageCount <= 0 ||
      input.sourceMessageIds.length !== input.summarizedMessageCount ||
      input.sourceMessageIds.length > 20_000 ||
      new Set(input.sourceMessageIds).size !== input.sourceMessageIds.length ||
      !input.candidateSummary.trim() ||
      input.candidateSummary.length > 10_000
    ) {
      throw new BadRequest('Invalid context compaction input');
    }
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'context-compaction-request:' + input.sessionId}, 0))`;
    const session = await this.db.aiSession.findUnique({
      where: { id: input.sessionId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        selectedContextProjectId: true,
        contextEpoch: true,
        activeContextCheckpoint: { select: { checkpointId: true } },
        context: { select: { config: true, updatedAt: true } },
        projectChatContext: { select: { version: true } },
        selectedContextProject: {
          select: {
            status: true,
            updatedAt: true,
            members: {
              where: { userId: input.actorUserId },
              select: {
                userId: true,
                role: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            memorySettings: { select: { projectMemoryRevision: true } },
          },
        },
      },
    });
    if (!session || session.userId !== input.actorUserId) {
      throw new CopilotSessionNotFound();
    }
    if (
      session.selectedContextProjectId &&
      (session.selectedContextProject?.status !== 'active' ||
        session.selectedContextProject.members.length !== 1)
    ) {
      throw new CopilotSessionNotFound();
    }
    const workspaceMember = session.workspaceId
      ? await this.db.workspaceMember.findFirst({
          where: {
            workspaceId: session.workspaceId,
            userId: input.actorUserId,
            state: 'active',
          },
          select: {
            id: true,
            role: true,
            source: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;
    if (session.workspaceId && !workspaceMember) {
      throw new CopilotSessionNotFound();
    }
    const sourceMessages = await this.db.aiSessionMessage.findMany({
      where: { sessionId: input.sessionId },
      select: { id: true, role: true, content: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.summarizedMessageCount,
    });
    if (
      sourceMessages.length !== input.sourceMessageIds.length ||
      sourceMessages.some(
        (message, index) => message.id !== input.sourceMessageIds[index]
      ) ||
      fingerprintContextCompactionMessages(sourceMessages) !==
        input.sourceFingerprint
    ) {
      throw new BadRequest('Context compaction source changed');
    }
    const previousCheckpointId =
      session.activeContextCheckpoint?.checkpointId ?? null;
    const projectMemoryRevision = session.selectedContextProjectId
      ? (session.selectedContextProject?.memorySettings
          ?.projectMemoryRevision ?? null)
      : null;
    const projectContextVersion = session.selectedContextProjectId
      ? (session.projectChatContext?.version ?? 0)
      : null;
    const sourceLedger = await this.db.aiSessionContextSource.findMany({
      where: { sessionId: input.sessionId },
      select: {
        workspaceId: true,
        projectId: true,
        kind: true,
        sourceId: true,
        evidence: true,
      },
      orderBy: [
        { workspaceId: 'asc' },
        { projectId: 'asc' },
        { kind: 'asc' },
        { sourceId: 'asc' },
        { id: 'asc' },
      ],
    });
    const workspaceContextFingerprint = session.workspaceId
      ? fingerprintContextCompactionDependency(
          session.context
            ? {
                updatedAt: session.context.updatedAt.toISOString(),
                config: session.context.config,
              }
            : null
        )
      : null;
    const sourceLedgerFingerprint =
      fingerprintContextCompactionDependency(sourceLedger);
    const authorizationFingerprint = fingerprintContextCompactionDependency(
      session.selectedContextProjectId
        ? {
            type: 'project',
            projectStatus: session.selectedContextProject?.status,
            projectUpdatedAt:
              session.selectedContextProject?.updatedAt.toISOString(),
            member: session.selectedContextProject?.members[0] ?? null,
          }
        : {
            type: 'workspace',
            workspaceId: session.workspaceId,
            member: workspaceMember,
          }
    );
    const requestFingerprint = fingerprintContextCompactionRequest({
      sessionId: input.sessionId,
      contextEpoch: session.contextEpoch,
      sourceFingerprint: input.sourceFingerprint,
      summarizedMessageCount: input.summarizedMessageCount,
      previousCheckpointId,
      strategyVersion: input.strategyVersion,
      strategyFingerprint: input.strategyFingerprint,
      modelId: input.modelId ?? null,
      routeFingerprint: input.routeFingerprint,
      projectMemoryRevision,
      projectContextVersion,
      workspaceContextFingerprint,
      sourceLedgerFingerprint,
      authorizationFingerprint,
    });
    const existing = await this.db.aiContextCompactionTask.findUnique({
      where: { requestFingerprint },
    });
    if (existing) return existing;
    const created = await this.db.aiContextCompactionTask.create({
      data: {
        sessionId: input.sessionId,
        actorUserIdSnapshot: input.actorUserId,
        workspaceIdSnapshot: session.workspaceId,
        projectIdSnapshot: session.selectedContextProjectId,
        contextEpoch: session.contextEpoch,
        requestFingerprint,
        sourceFingerprint: input.sourceFingerprint,
        sourceMessageIds: input.sourceMessageIds,
        summarizedMessageCount: input.summarizedMessageCount,
        previousCheckpointId,
        strategyVersion: input.strategyVersion,
        strategyFingerprint: input.strategyFingerprint,
        modelId: input.modelId ?? null,
        routeFingerprint: input.routeFingerprint,
        projectMemoryRevision,
        projectContextVersion,
        dependencies: {
          contextEpoch: session.contextEpoch,
          previousCheckpointId,
          projectMemoryRevision,
          projectContextVersion,
          workspaceContextFingerprint,
          sourceLedgerFingerprint,
          authorizationFingerprint,
        },
        candidateSummary: input.candidateSummary,
        candidateSummaryData: (input.candidateSummaryData ?? {
          format: 'bullet_facts/v1',
          facts: input.candidateSummary
            .split('\n')
            .map(line => line.replace(/^\s*-\s*/, '').trim())
            .filter(Boolean),
        }) as Prisma.InputJsonValue,
        candidateDiagnostics:
          input.candidateDiagnostics as Prisma.InputJsonValue,
        inputBudget: input.inputBudget ?? null,
      },
    });
    await this.appendContextCompactionEvent(created, 'queued');
    return created;
  }

  async getContextCompactionTask(taskId: string, actorUserId?: string) {
    return await this.db.aiContextCompactionTask.findFirst({
      where: {
        id: taskId,
        ...(actorUserId ? { actorUserIdSnapshot: actorUserId } : {}),
      },
    });
  }

  async getLatestContextCompactionTask(sessionId: string, actorUserId: string) {
    return await this.db.aiContextCompactionTask.findFirst({
      where: { sessionId, actorUserIdSnapshot: actorUserId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      include: { checkpoint: true },
    });
  }

  async listContextCompactionEvents(input: {
    sessionId: string;
    actorUserId: string;
    afterSequence?: number;
    limit?: number;
  }) {
    return await this.db.aiContextCompactionEvent.findMany({
      where: {
        sessionId: input.sessionId,
        sequence: { gt: Math.max(0, input.afterSequence ?? 0) },
        task: { actorUserIdSnapshot: input.actorUserId },
      },
      orderBy: { sequence: 'asc' },
      take: Math.min(Math.max(input.limit ?? 100, 1), 200),
    });
  }

  async getContextCompactionGenerationInput(input: {
    taskId: string;
    leaseId: string;
  }) {
    const task = await this.db.aiContextCompactionTask.findFirst({
      where: {
        id: input.taskId,
        status: 'running',
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: { gt: new Date() },
      },
    });
    if (!task) return null;
    const sourceMessageIds = Array.isArray(task.sourceMessageIds)
      ? task.sourceMessageIds.filter(
          (id): id is string => typeof id === 'string'
        )
      : [];
    const [messages, previousCheckpoint, actionReceipts, runIds] =
      await Promise.all([
        this.db.aiSessionMessage.findMany({
          where: { sessionId: task.sessionId, id: { in: sourceMessageIds } },
          select: { id: true, role: true, content: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        task.previousCheckpointId
          ? this.db.aiContextCheckpoint.findUnique({
              where: { id: task.previousCheckpointId },
              select: {
                id: true,
                summarizedMessageCount: true,
                summaryData: true,
              },
            })
          : null,
        this.db.aiActionRun.findMany({
          where: { sessionId: task.sessionId, status: 'succeeded' },
          select: { id: true },
          take: 256,
        }),
        this.db.aiAgentRun
          .findMany({
            where: { sessionId: task.sessionId },
            select: { id: true },
            take: 256,
          })
          .then(rows => rows.map(row => row.id)),
      ]);
    const runtimeReceipts = runIds.length
      ? await this.db.aiAgentRuntimeExecutionResult.findMany({
          where: { runId: { in: runIds }, resultStatus: 'completed' },
          select: { id: true },
          take: 256,
        })
      : [];
    return {
      task,
      messages,
      previousCheckpoint,
      receiptIds: [
        ...actionReceipts.map(receipt => receipt.id),
        ...runtimeReceipts.map(receipt => receipt.id),
      ],
    };
  }

  @Transactional()
  async storeContextCompactionResult(input: {
    taskId: string;
    leaseId: string;
    summary: string;
    summaryData: Record<string, unknown>;
    diagnostics: Record<string, unknown>;
    inputTokensEstimated: number;
    outputTokensEstimated: number;
  }) {
    if (!input.summary.trim() || input.summary.length > 10_000) {
      throw new BadRequest('Invalid context compaction result');
    }
    const updated = await this.db.aiContextCompactionTask.updateMany({
      where: {
        id: input.taskId,
        status: 'running',
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: { gt: new Date() },
        resultSummary: null,
      },
      data: {
        resultSummary: input.summary,
        resultSummaryData: input.summaryData as Prisma.InputJsonValue,
        resultDiagnostics: input.diagnostics as Prisma.InputJsonValue,
        inputTokensEstimated: Math.max(0, input.inputTokensEstimated),
        outputTokensEstimated: Math.max(0, input.outputTokensEstimated),
      },
    });
    if (updated.count !== 1) {
      const existing = await this.db.aiContextCompactionTask.findFirst({
        where: {
          id: input.taskId,
          status: 'running',
          workerLeaseId: input.leaseId,
        },
      });
      if (!existing?.resultSummary) return null;
      return existing;
    }
    return await this.db.aiContextCompactionTask.findUnique({
      where: { id: input.taskId },
    });
  }

  async listDueContextCompactions(limit = 100) {
    const now = new Date();
    return await this.db.aiContextCompactionTask.findMany({
      where: {
        OR: [
          {
            status: { in: ['queued', 'retry_wait'] },
            nextAttemptAt: { lte: now },
          },
          { status: 'running', workerLeaseExpiresAt: { lte: now } },
        ],
      },
      select: { id: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  @Transactional()
  async claimContextCompaction(input: {
    taskId: string;
    leaseId: string;
    leaseExpiresAt: Date;
  }) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'context-compaction-task:' + input.taskId}, 0))`;
    const task = await this.db.aiContextCompactionTask.findUnique({
      where: { id: input.taskId },
    });
    if (!task) return null;
    const now = new Date();
    const due =
      ((task.status === 'queued' || task.status === 'retry_wait') &&
        task.nextAttemptAt <= now) ||
      (task.status === 'running' &&
        !!task.workerLeaseExpiresAt &&
        task.workerLeaseExpiresAt <= now);
    if (!due) return null;
    if (task.attempt >= task.maxAttempts) {
      const failed = await this.db.aiContextCompactionTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          failureCode: 'CONTEXT_COMPACTION_RETRY_EXHAUSTED',
          failureMessage: 'Context compaction retry limit was reached',
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
        },
      });
      await this.appendContextCompactionEvent(failed, 'failed');
      return failed;
    }
    const running = await this.db.aiContextCompactionTask.update({
      where: { id: task.id },
      data: {
        status: 'running',
        attempt: task.attempt + 1,
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: input.leaseExpiresAt,
        failureCode: null,
        failureMessage: null,
      },
    });
    await this.appendContextCompactionEvent(running, 'running');
    return running;
  }

  async renewContextCompactionLease(input: {
    taskId: string;
    leaseId: string;
    leaseExpiresAt: Date;
  }) {
    const renewed = await this.db.aiContextCompactionTask.updateMany({
      where: {
        id: input.taskId,
        status: 'running',
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: { gt: new Date() },
      },
      data: { workerLeaseExpiresAt: input.leaseExpiresAt },
    });
    if (renewed.count !== 1) {
      throw new Error('CONTEXT_COMPACTION_LEASE_LOST');
    }
  }

  @Transactional()
  async publishContextCompaction(input: { taskId: string; leaseId: string }) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'context-compaction-task:' + input.taskId}, 0))`;
    const task = await this.db.aiContextCompactionTask.findFirst({
      where: {
        id: input.taskId,
        status: 'running',
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: { gt: new Date() },
      },
    });
    if (!task) return null;

    const markStale = async (failureCode: string) => {
      const stale = await this.db.aiContextCompactionTask.update({
        where: { id: task.id },
        data: {
          status: 'stale',
          failureCode,
          failureMessage:
            'Context changed before the compaction result could be published',
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
          completedAt: new Date(),
        },
      });
      await this.appendContextCompactionEvent(stale, 'stale');
      return stale;
    };

    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'context-checkpoint:' + task.sessionId}, 0))`;
    const session = await this.db.aiSession.findUnique({
      where: { id: task.sessionId },
      select: {
        userId: true,
        workspaceId: true,
        selectedContextProjectId: true,
        contextEpoch: true,
        deletedAt: true,
        activeContextCheckpoint: { select: { checkpointId: true } },
        context: { select: { config: true, updatedAt: true } },
        projectChatContext: { select: { version: true } },
        selectedContextProject: {
          select: {
            status: true,
            updatedAt: true,
            members: {
              where: { userId: task.actorUserIdSnapshot },
              select: {
                userId: true,
                role: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            memorySettings: { select: { projectMemoryRevision: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.deletedAt ||
      session.userId !== task.actorUserIdSnapshot ||
      session.workspaceId !== task.workspaceIdSnapshot ||
      session.selectedContextProjectId !== task.projectIdSnapshot ||
      session.contextEpoch !== task.contextEpoch
    ) {
      return await markStale('CONTEXT_COMPACTION_SESSION_STALE');
    }
    if (
      task.projectIdSnapshot &&
      (session.selectedContextProject?.status !== 'active' ||
        session.selectedContextProject.members.length !== 1)
    ) {
      return await markStale('CONTEXT_COMPACTION_PERMISSION_STALE');
    }
    const workspaceMember = task.workspaceIdSnapshot
      ? await this.db.workspaceMember.findFirst({
          where: {
            workspaceId: task.workspaceIdSnapshot,
            userId: task.actorUserIdSnapshot,
            state: 'active',
          },
          select: {
            id: true,
            role: true,
            source: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;
    if (task.workspaceIdSnapshot && !workspaceMember) {
      return await markStale('CONTEXT_COMPACTION_PERMISSION_STALE');
    }
    const projectMemoryRevision = task.projectIdSnapshot
      ? (session.selectedContextProject?.memorySettings
          ?.projectMemoryRevision ?? null)
      : null;
    const projectContextVersion = task.projectIdSnapshot
      ? (session.projectChatContext?.version ?? 0)
      : null;
    const dependencies =
      task.dependencies &&
      typeof task.dependencies === 'object' &&
      !Array.isArray(task.dependencies)
        ? (task.dependencies as Record<string, unknown>)
        : {};
    const workspaceContextFingerprint = session.workspaceId
      ? fingerprintContextCompactionDependency(
          session.context
            ? {
                updatedAt: session.context.updatedAt.toISOString(),
                config: session.context.config,
              }
            : null
        )
      : null;
    const sourceLedger = await this.db.aiSessionContextSource.findMany({
      where: { sessionId: task.sessionId },
      select: {
        workspaceId: true,
        projectId: true,
        kind: true,
        sourceId: true,
        evidence: true,
      },
      orderBy: [
        { workspaceId: 'asc' },
        { projectId: 'asc' },
        { kind: 'asc' },
        { sourceId: 'asc' },
        { id: 'asc' },
      ],
    });
    const sourceLedgerFingerprint =
      fingerprintContextCompactionDependency(sourceLedger);
    const authorizationFingerprint = fingerprintContextCompactionDependency(
      task.projectIdSnapshot
        ? {
            type: 'project',
            projectStatus: session.selectedContextProject?.status,
            projectUpdatedAt:
              session.selectedContextProject?.updatedAt.toISOString(),
            member: session.selectedContextProject?.members[0] ?? null,
          }
        : {
            type: 'workspace',
            workspaceId: task.workspaceIdSnapshot,
            member: workspaceMember,
          }
    );
    if (
      projectMemoryRevision !== task.projectMemoryRevision ||
      projectContextVersion !== task.projectContextVersion ||
      workspaceContextFingerprint !==
        (dependencies.workspaceContextFingerprint ?? null) ||
      sourceLedgerFingerprint !== dependencies.sourceLedgerFingerprint ||
      authorizationFingerprint !== dependencies.authorizationFingerprint
    ) {
      return await markStale('CONTEXT_COMPACTION_DEPENDENCY_STALE');
    }
    if (
      (session.activeContextCheckpoint?.checkpointId ?? null) !==
      task.previousCheckpointId
    ) {
      return await markStale('CONTEXT_COMPACTION_CHECKPOINT_STALE');
    }
    const sourceMessageIds = Array.isArray(task.sourceMessageIds)
      ? task.sourceMessageIds.filter(
          (id): id is string => typeof id === 'string'
        )
      : [];
    if (sourceMessageIds.length !== task.summarizedMessageCount) {
      return await markStale('CONTEXT_COMPACTION_SOURCE_STALE');
    }
    const sourceMessages = await this.db.aiSessionMessage.findMany({
      where: { sessionId: task.sessionId },
      select: { id: true, role: true, content: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: task.summarizedMessageCount,
    });
    if (
      sourceMessages.length !== sourceMessageIds.length ||
      sourceMessages.some(
        (message, index) => message.id !== sourceMessageIds[index]
      ) ||
      fingerprintContextCompactionMessages(sourceMessages) !==
        task.sourceFingerprint
    ) {
      return await markStale('CONTEXT_COMPACTION_SOURCE_STALE');
    }
    const summary = task.resultSummary ?? task.candidateSummary;
    const summaryData = task.resultSummaryData ?? task.candidateSummaryData;
    const diagnostics = task.resultDiagnostics ?? task.candidateDiagnostics;
    const latest = await this.db.aiContextCheckpoint.aggregate({
      where: { sessionId: task.sessionId },
      _max: { revision: true },
    });
    const checkpoint = await this.db.aiContextCheckpoint.create({
      data: {
        sessionId: task.sessionId,
        revision: (latest._max.revision ?? 0) + 1,
        contextEpoch: task.contextEpoch,
        projectMemoryRevision: task.projectMemoryRevision,
        status: 'completed',
        strategyVersion: task.strategyVersion,
        strategyFingerprint: task.strategyFingerprint,
        summary,
        summarizedMessageCount: task.summarizedMessageCount,
        sourceFingerprint: task.sourceFingerprint,
        diagnostics: diagnostics as Prisma.InputJsonValue,
        summaryData: summaryData as Prisma.InputJsonValue,
      },
    });
    await this.db.aiContextCheckpointPointer.upsert({
      where: { sessionId: task.sessionId },
      create: { sessionId: task.sessionId, checkpointId: checkpoint.id },
      update: { checkpointId: checkpoint.id },
    });
    const completed = await this.db.aiContextCompactionTask.updateMany({
      where: {
        id: task.id,
        status: 'running',
        workerLeaseId: input.leaseId,
      },
      data: {
        status: 'succeeded',
        checkpointId: checkpoint.id,
        outputCharacters: summary.length,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) {
      throw new Error('CONTEXT_COMPACTION_LEASE_LOST');
    }
    const published = await this.db.aiContextCompactionTask.findUnique({
      where: { id: task.id },
    });
    if (published) {
      await this.appendContextCompactionEvent(published, 'succeeded');
    }
    return published;
  }

  @Transactional()
  async failContextCompaction(input: {
    taskId: string;
    leaseId: string;
    failureCode: string;
  }) {
    const task = await this.db.aiContextCompactionTask.findFirst({
      where: {
        id: input.taskId,
        status: 'running',
        workerLeaseId: input.leaseId,
      },
      select: { id: true, attempt: true, maxAttempts: true },
    });
    if (!task) return null;
    const exhausted = task.attempt >= task.maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.max(task.attempt - 1, 0));
    const failed = await this.db.aiContextCompactionTask.update({
      where: { id: task.id },
      data: {
        status: exhausted ? 'failed' : 'retry_wait',
        failureCode: input.failureCode.slice(0, 160),
        failureMessage: 'Context compaction did not complete',
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    });
    await this.appendContextCompactionEvent(
      failed,
      exhausted ? 'failed' : 'retry_wait'
    );
    return failed;
  }

  @Transactional()
  async retryContextCompaction(taskId: string, actorUserId: string) {
    const task = await this.db.aiContextCompactionTask.findFirst({
      where: { id: taskId, actorUserIdSnapshot: actorUserId },
    });
    if (!task || !['failed', 'retry_wait', 'cancelled'].includes(task.status))
      return null;
    const retried = await this.db.aiContextCompactionTask.update({
      where: { id: task.id },
      data: {
        status: 'retry_wait',
        maxAttempts:
          task.status === 'failed'
            ? Math.max(task.maxAttempts, task.attempt + 3)
            : task.maxAttempts,
        nextAttemptAt: new Date(),
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        cancelledAt: null,
      },
    });
    await this.appendContextCompactionEvent(retried, 'retry_wait');
    return retried;
  }

  @Transactional()
  async cancelContextCompaction(taskId: string, actorUserId: string) {
    const task = await this.db.aiContextCompactionTask.findFirst({
      where: {
        id: taskId,
        actorUserIdSnapshot: actorUserId,
        status: { in: ['queued', 'running', 'retry_wait'] },
      },
      select: { id: true },
    });
    if (!task) return null;
    const cancelled = await this.db.aiContextCompactionTask.update({
      where: { id: task.id },
      data: {
        status: 'cancelled',
        failureCode: 'CONTEXT_COMPACTION_CANCELLED',
        failureMessage: 'Context compaction was cancelled',
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        cancelledAt: new Date(),
        completedAt: new Date(),
      },
    });
    await this.appendContextCompactionEvent(cancelled, 'cancelled');
    return cancelled;
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
