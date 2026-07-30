import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';

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

export const COPILOT_CONTEXT_MEMORY_STATUSES = ['active', 'disabled'] as const;
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
  metadata?: Record<string, unknown>;
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
    fingerprint: fingerprintContextMemory(input),
  } satisfies Prisma.AiContextMemoryWhereInput;
}

export function buildContextMemoryVisibilityWhere(input: {
  userId: string;
  workspaceId?: string | null;
  docId?: string | null;
  projectIds?: string[];
  includeDisabled?: boolean;
}) {
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
    if (input.docId) {
      scopes.push({
        ownerUserId: input.userId,
        scope: 'document',
        workspaceId: input.workspaceId,
        docId: input.docId,
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
    ...(input.includeDisabled ? {} : { status: 'active' }),
    visibility: 'private',
    OR: scopes,
  } satisfies Prisma.AiContextMemoryWhereInput;
}

@Injectable()
export class CopilotContextMemoryModel extends BaseModel {
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

  async get(id: string) {
    return await this.db.aiContextMemory.findUnique({ where: { id } });
  }

  async listVisible(input: {
    userId: string;
    workspaceId?: string | null;
    docId?: string | null;
    projectIds?: string[];
    includeDisabled?: boolean;
  }) {
    return await this.db.aiContextMemory.findMany({
      where: buildContextMemoryVisibilityWhere(input),
      orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
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
        ...(input.includeDisabled ? {} : { status: 'active' }),
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
    const [revisions, checkpointStats] = await Promise.all([
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
    ]);
    const statsByVersion = new Map(
      checkpointStats.map(item => [item.strategyVersion, item])
    );
    return revisions.map(revision => {
      const stats = statsByVersion.get(revision.version);
      return {
        ...revision,
        checkpointCount: stats?._count._all ?? 0,
        lastCheckpointAt: stats?._max.updatedAt ?? null,
      };
    });
  }
}
