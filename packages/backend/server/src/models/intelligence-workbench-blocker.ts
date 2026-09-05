import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { AiContextProjectBlocker } from '@prisma/client';

import { BadRequest, CryptoHelper, NotFound } from '../base';
import { BaseModel } from './base';

export const INTELLIGENCE_WORKBENCH_BLOCKER_TYPES = [
  'wait_reply',
  'wait_file',
  'wait_decision',
  'custom',
] as const;
export type IntelligenceWorkbenchBlockerType =
  (typeof INTELLIGENCE_WORKBENCH_BLOCKER_TYPES)[number];

export const INTELLIGENCE_WORKBENCH_BLOCKER_STATUSES = [
  'waiting',
  'resolved',
  'abandoned',
] as const;
export type IntelligenceWorkbenchBlockerStatus =
  (typeof INTELLIGENCE_WORKBENCH_BLOCKER_STATUSES)[number];

export const INTELLIGENCE_WORKBENCH_BLOCKER_ORIGINS = [
  'user_created',
  'ai_suggested',
] as const;
export type IntelligenceWorkbenchBlockerOrigin =
  (typeof INTELLIGENCE_WORKBENCH_BLOCKER_ORIGINS)[number];

export type IntelligenceWorkbenchBlockerRecord = AiContextProjectBlocker;

export type IntelligenceWorkbenchBlockerDraft = {
  title: string;
  type: IntelligenceWorkbenchBlockerType;
  waitingOn: string;
  dueAt: Date | null;
};

export type IntelligenceWorkbenchBlockerSuggestion =
  IntelligenceWorkbenchBlockerDraft & {
    aiSuggestionId: string;
    confirmationProof: string;
  };

export type IntelligenceWorkbenchBlockerSuggestionInput = {
  title: unknown;
  type: unknown;
  waitingOn: unknown;
  dueAt?: unknown;
};

const MAX_ID_LENGTH = 512;
const MAX_TEXT_LENGTH = 512;
const MAX_CONFIRMATION_PROOF_LENGTH = 4096;
const MAX_LIST_LIMIT = 100;
const AI_SUGGESTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRMATION_PROOF_PATTERN = /^[A-Za-z0-9_-]+,[A-Za-z0-9+/]+={0,2}$/;
const BLOCKER_SUGGESTION_PROOF_PURPOSE =
  'intelligence_workbench_blocker_confirmation';
const BLOCKER_SUGGESTION_PROOF_KEYS = [
  'v',
  'purpose',
  'actorUserId',
  'projectId',
  'aiSuggestionId',
  'title',
  'type',
  'waitingOn',
  'dueAt',
] as const;

type BlockerSuggestionProofPayload = {
  v: 1;
  purpose: typeof BLOCKER_SUGGESTION_PROOF_PURPOSE;
  actorUserId: string;
  projectId: string;
  aiSuggestionId: string;
  title: string;
  type: IntelligenceWorkbenchBlockerType;
  waitingOn: string;
  dueAt: string | null;
};

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new BadRequest(`${field} must contain 1-${maxLength} characters`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequest(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function requireBlockerType(value: unknown): IntelligenceWorkbenchBlockerType {
  if (
    typeof value !== 'string' ||
    !INTELLIGENCE_WORKBENCH_BLOCKER_TYPES.includes(
      value as IntelligenceWorkbenchBlockerType
    )
  ) {
    throw new BadRequest('Blocker type is invalid');
  }
  return value as IntelligenceWorkbenchBlockerType;
}

function requireAiSuggestionId(value: unknown) {
  if (typeof value !== 'string' || !AI_SUGGESTION_ID_PATTERN.test(value)) {
    throw new BadRequest('aiSuggestionId must be a UUID');
  }
  return value.toLowerCase();
}

function blockerSuggestionProofPayload(input: {
  actorUserId: string;
  projectId: string;
  aiSuggestionId: string;
  suggestion: IntelligenceWorkbenchBlockerDraft;
}): BlockerSuggestionProofPayload {
  return {
    v: 1,
    purpose: BLOCKER_SUGGESTION_PROOF_PURPOSE,
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    aiSuggestionId: input.aiSuggestionId,
    title: input.suggestion.title,
    type: input.suggestion.type,
    waitingOn: input.suggestion.waitingOn,
    dueAt: input.suggestion.dueAt?.toISOString() ?? null,
  };
}

function encodeBlockerSuggestionProofPayload(
  payload: BlockerSuggestionProofPayload
) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function hasStrictBlockerSuggestionProofShape(
  value: unknown
): value is BlockerSuggestionProofPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).length !== BLOCKER_SUGGESTION_PROOF_KEYS.length ||
    !BLOCKER_SUGGESTION_PROOF_KEYS.every(key => key in payload)
  ) {
    return false;
  }
  return (
    payload.v === 1 &&
    payload.purpose === BLOCKER_SUGGESTION_PROOF_PURPOSE &&
    typeof payload.actorUserId === 'string' &&
    typeof payload.projectId === 'string' &&
    typeof payload.aiSuggestionId === 'string' &&
    typeof payload.title === 'string' &&
    typeof payload.type === 'string' &&
    typeof payload.waitingOn === 'string' &&
    (payload.dueAt === null || typeof payload.dueAt === 'string')
  );
}

function normalizeDate(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new BadRequest(`${field} must be a valid date`);
  }
  if (typeof value === 'string' && (!value.trim() || value.length > 128)) {
    throw new BadRequest(`${field} must be a valid date`);
  }
  const normalized =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    throw new BadRequest(`${field} must be a valid date`);
  }
  return normalized;
}

function normalizeStatuses(values: unknown) {
  if (values === undefined || values === null) return undefined;
  if (!Array.isArray(values) || values.length === 0) {
    throw new BadRequest('Blocker statuses must be a non-empty array');
  }
  return [
    ...new Set(
      values.map(value => {
        if (
          typeof value !== 'string' ||
          !INTELLIGENCE_WORKBENCH_BLOCKER_STATUSES.includes(
            value as IntelligenceWorkbenchBlockerStatus
          )
        ) {
          throw new BadRequest('Blocker status is invalid');
        }
        return value as IntelligenceWorkbenchBlockerStatus;
      })
    ),
  ];
}

function normalizeLimit(value: unknown) {
  if (value === undefined) return 50;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequest('limit must be an integer');
  }
  return Math.max(1, Math.min(value, MAX_LIST_LIMIT));
}

export function normalizeIntelligenceWorkbenchBlockerSuggestion(
  input: IntelligenceWorkbenchBlockerSuggestionInput
): IntelligenceWorkbenchBlockerDraft {
  return {
    title: requireString(input.title, 'title', MAX_TEXT_LENGTH),
    type: requireBlockerType(input.type),
    waitingOn: requireString(input.waitingOn, 'waitingOn', MAX_TEXT_LENGTH),
    dueAt: normalizeDate(input.dueAt, 'dueAt'),
  };
}

@Injectable()
export class IntelligenceWorkbenchBlockerModel extends BaseModel {
  constructor(private readonly crypto: CryptoHelper) {
    super();
  }

  async canAccess(input: { projectId: string; userId: string }) {
    try {
      const projectId = requireString(
        input.projectId,
        'projectId',
        MAX_ID_LENGTH
      );
      const userId = requireString(input.userId, 'userId', MAX_ID_LENGTH);
      const membership = await this.db.aiContextProjectMember.findFirst({
        where: { projectId, userId, project: { status: 'active' } },
        select: { projectId: true },
      });
      return Boolean(membership);
    } catch {
      return false;
    }
  }

  async suggestForMember(
    input: IntelligenceWorkbenchBlockerSuggestionInput & {
      projectId: string;
      actorUserId: string;
    }
  ) {
    const projectId = requireString(
      input.projectId,
      'projectId',
      MAX_ID_LENGTH
    );
    const actorUserId = requireString(
      input.actorUserId,
      'actorUserId',
      MAX_ID_LENGTH
    );
    await this.requireActiveProjectMembership(projectId, actorUserId);
    const aiSuggestionId = randomUUID();
    const suggestion = normalizeIntelligenceWorkbenchBlockerSuggestion(input);
    return {
      aiSuggestionId,
      ...suggestion,
      confirmationProof: this.crypto.sign(
        encodeBlockerSuggestionProofPayload(
          blockerSuggestionProofPayload({
            actorUserId,
            projectId,
            aiSuggestionId,
            suggestion,
          })
        )
      ),
    } satisfies IntelligenceWorkbenchBlockerSuggestion;
  }

  @Transactional()
  async createManual(
    input: IntelligenceWorkbenchBlockerSuggestionInput & {
      projectId: string;
      actorUserId: string;
    }
  ) {
    return await this.create(input, 'user_created');
  }

  @Transactional()
  async confirmSuggestion(input: {
    projectId: string;
    actorUserId: string;
    suggestion: IntelligenceWorkbenchBlockerSuggestionInput & {
      aiSuggestionId: unknown;
      confirmationProof: unknown;
    };
  }) {
    const projectId = requireString(
      input.projectId,
      'projectId',
      MAX_ID_LENGTH
    );
    const actorUserId = requireString(
      input.actorUserId,
      'actorUserId',
      MAX_ID_LENGTH
    );
    const aiSuggestionId = requireAiSuggestionId(
      input.suggestion.aiSuggestionId
    );
    const suggestion = normalizeIntelligenceWorkbenchBlockerSuggestion(
      input.suggestion
    );
    this.assertValidSuggestionProof({
      actorUserId,
      projectId,
      aiSuggestionId,
      suggestion,
      confirmationProof: input.suggestion.confirmationProof,
    });
    await this.lockActiveProjectMembership(projectId, actorUserId);
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-workbench:blocker-suggestion:${projectId}:${aiSuggestionId}`}, 0))`;
    const existing = await this.db.aiContextProjectBlocker.findFirst({
      where: { projectId, aiSuggestionId },
    });
    if (existing) {
      const samePayload =
        existing.origin === 'ai_suggested' &&
        existing.creatorUserIdSnapshot === actorUserId &&
        existing.title === suggestion.title &&
        existing.type === suggestion.type &&
        existing.waitingOn === suggestion.waitingOn &&
        (existing.dueAt?.getTime() ?? null) ===
          (suggestion.dueAt?.getTime() ?? null);
      if (!samePayload) {
        throw new BadRequest(
          'AI Blocker suggestion confirmation does not match'
        );
      }
      return existing;
    }
    return await this.persist({
      projectId,
      actorUserId,
      suggestion,
      origin: 'ai_suggested',
      aiSuggestionId,
    });
  }

  async get(input: { blockerId: string; userId: string }) {
    const blockerId = requireString(
      input.blockerId,
      'blockerId',
      MAX_ID_LENGTH
    );
    const userId = requireString(input.userId, 'userId', MAX_ID_LENGTH);
    const blocker = await this.db.aiContextProjectBlocker.findFirst({
      where: {
        id: blockerId,
        project: {
          status: 'active',
          members: { some: { userId } },
        },
      },
    });
    if (!blocker) throw new NotFound('Blocker not found');
    return blocker;
  }

  async list(input: {
    userId: string;
    projectId?: string | null;
    statuses?: IntelligenceWorkbenchBlockerStatus[];
    limit?: number;
  }) {
    const userId = requireString(input.userId, 'userId', MAX_ID_LENGTH);
    const projectId =
      input.projectId === undefined || input.projectId === null
        ? null
        : requireString(input.projectId, 'projectId', MAX_ID_LENGTH);
    const statuses = normalizeStatuses(input.statuses);
    const limit = normalizeLimit(input.limit);
    if (projectId) {
      await this.requireActiveProjectMembership(projectId, userId);
    }
    return await this.db.aiContextProjectBlocker.findMany({
      where: {
        projectId: projectId ?? undefined,
        status: statuses ? { in: statuses } : undefined,
        project: {
          status: 'active',
          members: { some: { userId } },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async resolve(input: { blockerId: string; actorUserId: string; now?: Date }) {
    return await this.transition(input, 'resolved');
  }

  async abandon(input: { blockerId: string; actorUserId: string; now?: Date }) {
    return await this.transition(input, 'abandoned');
  }

  private assertValidSuggestionProof(input: {
    actorUserId: string;
    projectId: string;
    aiSuggestionId: string;
    suggestion: IntelligenceWorkbenchBlockerDraft;
    confirmationProof: unknown;
  }) {
    const invalid = () => {
      throw new BadRequest(
        'AI Blocker suggestion confirmation proof is invalid'
      );
    };
    const proof =
      typeof input.confirmationProof === 'string'
        ? input.confirmationProof
        : '';
    if (
      !proof ||
      proof.length > MAX_CONFIRMATION_PROOF_LENGTH ||
      proof.trim() !== proof ||
      !CONFIRMATION_PROOF_PATTERN.test(proof)
    ) {
      invalid();
    }
    let verified = false;
    try {
      verified = this.crypto.verify(proof);
    } catch {
      invalid();
    }
    if (!verified) invalid();
    const [encodedPayload] = proof.split(',');
    let payload: unknown;
    try {
      const decodedPayload = Buffer.from(encodedPayload, 'base64url').toString(
        'utf8'
      );
      if (
        Buffer.from(decodedPayload, 'utf8').toString('base64url') !==
        encodedPayload
      ) {
        invalid();
      }
      payload = JSON.parse(decodedPayload) as unknown;
    } catch {
      invalid();
    }
    if (!hasStrictBlockerSuggestionProofShape(payload)) invalid();
    const expectedPayload = encodeBlockerSuggestionProofPayload(
      blockerSuggestionProofPayload(input)
    );
    if (!this.crypto.compare(encodedPayload, expectedPayload)) invalid();
  }

  private async create(
    input: IntelligenceWorkbenchBlockerSuggestionInput & {
      projectId: string;
      actorUserId: string;
    },
    origin: 'user_created'
  ) {
    const projectId = requireString(
      input.projectId,
      'projectId',
      MAX_ID_LENGTH
    );
    const actorUserId = requireString(
      input.actorUserId,
      'actorUserId',
      MAX_ID_LENGTH
    );
    const suggestion = normalizeIntelligenceWorkbenchBlockerSuggestion(input);
    await this.lockActiveProjectMembership(projectId, actorUserId);
    return await this.persist({
      projectId,
      actorUserId,
      suggestion,
      origin,
      aiSuggestionId: null,
    });
  }

  private async persist(input: {
    projectId: string;
    actorUserId: string;
    suggestion: IntelligenceWorkbenchBlockerDraft;
    origin: IntelligenceWorkbenchBlockerOrigin;
    aiSuggestionId: string | null;
  }) {
    return await this.db.aiContextProjectBlocker.create({
      data: {
        projectId: input.projectId,
        creatorUserId: input.actorUserId,
        creatorUserIdSnapshot: input.actorUserId,
        ...input.suggestion,
        origin: input.origin,
        aiSuggestionId: input.aiSuggestionId,
      },
    });
  }

  @Transactional()
  private async transition(
    input: { blockerId: string; actorUserId: string; now?: Date },
    targetStatus: Exclude<IntelligenceWorkbenchBlockerStatus, 'waiting'>
  ) {
    const blockerId = requireString(
      input.blockerId,
      'blockerId',
      MAX_ID_LENGTH
    );
    const actorUserId = requireString(
      input.actorUserId,
      'actorUserId',
      MAX_ID_LENGTH
    );
    const explicitNow =
      input.now === undefined ? null : normalizeDate(input.now, 'now');
    const rows = await this.db.$queryRaw<
      Array<{ databaseNow: Date; id: string }>
    >`
      SELECT blocker.id, clock_timestamp() AS "databaseNow"
      FROM ai_context_project_blockers blocker
      JOIN ai_context_projects project
        ON project.id = blocker.project_id
       AND project.status = 'active'
      JOIN ai_context_project_members project_member
        ON project_member.project_id = blocker.project_id
       AND project_member.user_id = ${actorUserId}
      WHERE blocker.id = ${blockerId}
      FOR UPDATE OF blocker
      FOR SHARE OF project, project_member
    `;
    if (!rows[0]) throw new NotFound('Blocker not found');
    const blocker = await this.db.aiContextProjectBlocker.findUniqueOrThrow({
      where: { id: blockerId },
    });
    if (blocker.status === targetStatus) return blocker;
    if (blocker.status !== 'waiting') {
      throw new BadRequest('A completed Blocker cannot change status');
    }
    const resolvedAt = explicitNow ?? rows[0].databaseNow;
    if (resolvedAt.getTime() < blocker.createdAt.getTime()) {
      throw new BadRequest('Blocker resolution time cannot precede creation');
    }
    return await this.db.aiContextProjectBlocker.update({
      where: { id: blockerId },
      data: {
        status: targetStatus,
        resolutionActorUserId: actorUserId,
        resolutionActorUserIdSnapshot: actorUserId,
        resolvedAt,
      },
    });
  }

  private async requireActiveProjectMembership(
    projectId: string,
    userId: string
  ) {
    const membership = await this.db.aiContextProjectMember.findFirst({
      where: { projectId, userId, project: { status: 'active' } },
      select: { projectId: true },
    });
    if (!membership) throw new NotFound('Project not found');
  }

  private async lockActiveProjectMembership(projectId: string, userId: string) {
    const rows = await this.db.$queryRaw<Array<{ projectId: string }>>`
      SELECT project.id AS "projectId"
      FROM ai_context_projects project
      JOIN ai_context_project_members project_member
        ON project_member.project_id = project.id
       AND project_member.user_id = ${userId}
      WHERE project.id = ${projectId}
        AND project.status = 'active'
      FOR SHARE OF project, project_member
    `;
    if (!rows[0]) throw new NotFound('Project not found');
  }
}
