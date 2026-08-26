import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  type AiMcpAttachment,
  type AiMcpDelegationRequest,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type McpDelegationRequestStatus =
  | 'processing'
  | 'completed'
  | 'waiting_approval'
  | 'unsupported_task'
  | 'credential_scope_denied'
  | 'permission_denied'
  | 'resource_not_accessible'
  | 'failed'
  | 'rejected'
  | 'cancelled';

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined
          ? null
          : `${JSON.stringify(key)}:${stableStringify(item)}`;
      })
      .filter(Boolean)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function mcpDelegationFingerprint(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export type CreateMcpDelegationRequestInput = {
  workspaceId: string;
  actorId: string;
  credentialId: string;
  credentialFamilyId: string;
  credentialGeneration: number;
  capabilitySnapshot: string[];
  capabilityFingerprint: string;
  idempotencyKey: string;
  requestText: string;
  requestedDocumentIds: string[];
  requestedAttachmentIds: string[];
  requestFingerprint: string;
};

export type CreateMcpAttachmentInput = {
  id: string;
  workspaceId: string;
  actorId: string;
  credentialId: string;
  credentialFamilyId: string;
  credentialGeneration: number;
  idempotencyKey: string;
  fileName: string;
  mimeType: string;
  blobKey: string;
  byteSize: number;
  contentFingerprint: string;
};

@Injectable()
export class CopilotMcpDelegationModel extends BaseModel {
  async createOrReuseAttachment(input: CreateMcpAttachmentInput) {
    const findExisting = () =>
      this.db.aiMcpAttachment.findUnique({
        where: {
          workspaceId_credentialFamilyId_idempotencyKey: {
            workspaceId: input.workspaceId,
            credentialFamilyId: input.credentialFamilyId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
    const existing = await findExisting();
    if (existing) {
      this.assertAttachmentMatches(existing, input);
      return { record: existing, reused: true };
    }

    try {
      return {
        record: await this.db.aiMcpAttachment.create({ data: input }),
        reused: false,
      };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const reused = await findExisting();
      if (!reused) throw error;
      this.assertAttachmentMatches(reused, input);
      return { record: reused, reused: true };
    }
  }

  getAttachmentsForCredentialFamily(input: {
    ids: string[];
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
  }) {
    if (!input.ids.length) return Promise.resolve([]);
    return this.db.aiMcpAttachment.findMany({
      where: {
        id: { in: input.ids },
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        credentialFamilyId: input.credentialFamilyId,
      },
    });
  }

  upsertEndpoint(input: {
    credentialFamilyId: string;
    userId: string;
    workspaceId: string;
    callbackUrl: string;
    encryptedCallbackSecret: string;
    callbackSecretFingerprint: string;
  }) {
    return this.db.aiMcpDelegationEndpoint.upsert({
      where: { credentialFamilyId: input.credentialFamilyId },
      create: input,
      update: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        callbackUrl: input.callbackUrl,
        encryptedCallbackSecret: input.encryptedCallbackSecret,
        callbackSecretFingerprint: input.callbackSecretFingerprint,
      },
    });
  }

  getEndpoint(credentialFamilyId: string) {
    return this.db.aiMcpDelegationEndpoint.findUnique({
      where: { credentialFamilyId },
    });
  }

  async getConfiguredEndpointFamilyIds(credentialFamilyIds: string[]) {
    if (!credentialFamilyIds.length) return new Set<string>();
    const endpoints = await this.db.aiMcpDelegationEndpoint.findMany({
      where: { credentialFamilyId: { in: credentialFamilyIds } },
      select: { credentialFamilyId: true },
    });
    return new Set(endpoints.map(endpoint => endpoint.credentialFamilyId));
  }

  async createOrReuseRequest(input: CreateMcpDelegationRequestInput) {
    const existing = await this.db.aiMcpDelegationRequest.findUnique({
      where: {
        workspaceId_credentialFamilyId_idempotencyKey: {
          workspaceId: input.workspaceId,
          credentialFamilyId: input.credentialFamilyId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      this.assertRequestMatches(existing, input);
      return { record: existing, reused: true };
    }

    try {
      const record = await this.db.aiMcpDelegationRequest.create({
        data: {
          ...input,
          status: 'processing',
          result: {},
        },
      });
      return { record, reused: false };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const reused = await this.db.aiMcpDelegationRequest.findUnique({
        where: {
          workspaceId_credentialFamilyId_idempotencyKey: {
            workspaceId: input.workspaceId,
            credentialFamilyId: input.credentialFamilyId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (!reused) throw error;
      this.assertRequestMatches(reused, input);
      return { record: reused, reused: true };
    }
  }

  getRequest(id: string) {
    return this.db.aiMcpDelegationRequest.findUnique({ where: { id } });
  }

  getRequestForCredentialFamily(input: {
    id: string;
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
  }) {
    return this.db.aiMcpDelegationRequest.findFirst({
      where: {
        id: input.id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        credentialFamilyId: input.credentialFamilyId,
      },
    });
  }

  getRequestStateMarker(input: {
    id: string;
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
  }) {
    return this.db.aiMcpDelegationRequest.findFirst({
      where: {
        id: input.id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        credentialFamilyId: input.credentialFamilyId,
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        planFingerprint: true,
        approvalDecision: true,
        approvalExpiresAt: true,
        approvalResolvedAt: true,
        agentRun: {
          select: {
            id: true,
            status: true,
            timelineFingerprint: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  getRequestByApproval(approvalId: string) {
    return this.db.aiMcpDelegationRequest.findUnique({
      where: { approvalId },
    });
  }

  getRequestByAgentRun(agentRunId: string) {
    return this.db.aiMcpDelegationRequest.findFirst({
      where: { agentRunId },
    });
  }

  updateRequest(
    id: string,
    data: {
      status: McpDelegationRequestStatus;
      result: Record<string, unknown>;
      contextFingerprint?: string | null;
      planSnapshot?: Record<string, unknown>;
      planFingerprint?: string | null;
      agentRunId?: string | null;
      targetDocumentId?: string | null;
      targetDocumentVersion?: Date | null;
      approvalId?: string | null;
      approvalPreviewHash?: string | null;
      approvalExpiresAt?: Date | null;
      approvalDecision?: string | null;
      approvalDecisionFingerprint?: string | null;
      approvalIdempotencyKey?: string | null;
      approvalResolvedAt?: Date | null;
    }
  ) {
    const { planSnapshot, ...rest } = data;
    return this.db.aiMcpDelegationRequest.update({
      where: { id },
      data: {
        ...rest,
        result: data.result as Prisma.InputJsonValue,
        ...(planSnapshot !== undefined
          ? { planSnapshot: planSnapshot as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async setPlan(input: {
    id: string;
    planSnapshot: Record<string, unknown>;
    planFingerprint: string;
  }) {
    const updated = await this.db.aiMcpDelegationRequest.updateMany({
      where: { id: input.id, status: 'processing', planFingerprint: null },
      data: {
        planSnapshot: input.planSnapshot as Prisma.InputJsonValue,
        planFingerprint: input.planFingerprint,
      },
    });
    if (updated.count === 1) {
      return await this.getRequest(input.id);
    }
    const existing = await this.getRequest(input.id);
    if (
      existing?.planFingerprint === input.planFingerprint &&
      stableStringify(existing.planSnapshot) ===
        stableStringify(input.planSnapshot)
    ) {
      return existing;
    }
    throw new Error('MCP delegation plan evidence already differs');
  }

  @Transactional()
  async waitForApproval(input: {
    id: string;
    result: Record<string, unknown>;
    contextFingerprint: string;
    agentRunId: string;
    targetDocumentId: string;
    targetDocumentVersion: Date;
    approvalId: string;
    approvalPreviewHash: string;
    approvalExpiresAt: Date;
    callbackPayload?: Record<string, unknown>;
  }) {
    const record = await this.updateRequest(input.id, {
      status: 'waiting_approval',
      result: input.result,
      contextFingerprint: input.contextFingerprint,
      agentRunId: input.agentRunId,
      targetDocumentId: input.targetDocumentId,
      targetDocumentVersion: input.targetDocumentVersion,
      approvalId: input.approvalId,
      approvalPreviewHash: input.approvalPreviewHash,
      approvalExpiresAt: input.approvalExpiresAt,
    });
    if (input.callbackPayload) {
      await this.db.aiMcpDelegationCallbackDelivery.upsert({
        where: {
          requestId_eventType: {
            requestId: input.id,
            eventType: 'approval_required',
          },
        },
        create: {
          requestId: input.id,
          eventType: 'approval_required',
          status: 'queued',
          payload: input.callbackPayload as Prisma.InputJsonValue,
          payloadFingerprint: mcpDelegationFingerprint(input.callbackPayload),
          nextAttemptAt: new Date(),
        },
        update: {},
      });
    }
    return record;
  }

  @Transactional()
  async resolveApproval(input: {
    id: string;
    expectedUpdatedAt: Date;
    decision: 'approved' | 'rejected';
    decisionFingerprint: string;
    idempotencyKey: string;
    status: McpDelegationRequestStatus;
    result: Record<string, unknown>;
    resolvedAt: Date;
  }) {
    const updated = await this.db.aiMcpDelegationRequest.updateMany({
      where: {
        id: input.id,
        status: 'waiting_approval',
        approvalDecision: null,
        updatedAt: input.expectedUpdatedAt,
      },
      data: {
        status: input.status,
        result: input.result as Prisma.InputJsonValue,
        approvalDecision: input.decision,
        approvalDecisionFingerprint: input.decisionFingerprint,
        approvalIdempotencyKey: input.idempotencyKey,
        approvalResolvedAt: input.resolvedAt,
      },
    });
    if (updated.count !== 1) return null;
    return await this.getRequest(input.id);
  }

  async enqueueCallback(input: {
    requestId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    return this.db.aiMcpDelegationCallbackDelivery.upsert({
      where: {
        requestId_eventType: {
          requestId: input.requestId,
          eventType: input.eventType,
        },
      },
      create: {
        requestId: input.requestId,
        eventType: input.eventType,
        status: 'queued',
        payload: input.payload as Prisma.InputJsonValue,
        payloadFingerprint: mcpDelegationFingerprint(input.payload),
        nextAttemptAt: new Date(),
      },
      update: {},
    });
  }

  async claimControl(input: {
    requestId: string;
    workspaceId: string;
    actorId: string;
    credentialFamilyId: string;
    action: 'cancel';
    idempotencyKey: string;
    requestFingerprint: string;
  }) {
    const id = randomUUID();
    const inserted = await this.db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ai_mcp_delegation_controls (
        id,
        request_id,
        workspace_id,
        actor_id,
        credential_family_id,
        action,
        idempotency_key,
        request_fingerprint,
        status,
        outcome
      )
      VALUES (
        ${id},
        ${input.requestId},
        ${input.workspaceId},
        ${input.actorId},
        ${input.credentialFamilyId},
        ${input.action},
        ${input.idempotencyKey},
        ${input.requestFingerprint},
        ${'processing'},
        ${'{}'}::jsonb
      )
      ON CONFLICT (request_id, credential_family_id, idempotency_key)
      DO NOTHING
      RETURNING id
    `;
    const record = inserted.length
      ? await this.db.aiMcpDelegationControl.findUnique({ where: { id } })
      : await this.db.aiMcpDelegationControl.findUnique({
          where: {
            requestId_credentialFamilyId_idempotencyKey: {
              requestId: input.requestId,
              credentialFamilyId: input.credentialFamilyId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
    if (!record) {
      throw new Error('MCP delegation control claim was not persisted');
    }
    return { record, created: inserted.length === 1 };
  }

  async completeControl(input: {
    id: string;
    requestFingerprint: string;
    outcome: Record<string, unknown>;
    outcomeFingerprint: string;
  }) {
    const updated = await this.db.aiMcpDelegationControl.updateMany({
      where: {
        id: input.id,
        status: 'processing',
        requestFingerprint: input.requestFingerprint,
      },
      data: {
        status: 'completed',
        outcome: input.outcome as Prisma.InputJsonValue,
        outcomeFingerprint: input.outcomeFingerprint,
      },
    });
    const record = await this.db.aiMcpDelegationControl.findUnique({
      where: { id: input.id },
    });
    if (
      updated.count !== 1 &&
      (record?.status !== 'completed' ||
        record.outcomeFingerprint !== input.outcomeFingerprint ||
        stableStringify(record.outcome) !== stableStringify(input.outcome))
    ) {
      throw new Error('MCP delegation control outcome already differs');
    }
    if (!record) {
      throw new Error('Completed MCP delegation control was not found');
    }
    return record;
  }

  latestCompletedCancelControl(requestId: string) {
    return this.db.aiMcpDelegationControl.findFirst({
      where: { requestId, action: 'cancel', status: 'completed' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async finalizeCancellation(input: {
    id: string;
    workspaceId: string;
    actorId: string;
    agentRunId: string;
    controlId: string | null;
    mode: 'immediate' | 'cooperative';
  }) {
    const result = {
      code: 'task_cancelled',
      agentRunId: input.agentRunId,
      controlId: input.controlId,
      cancellationMode: input.mode,
    };
    await this.db.aiMcpDelegationRequest.updateMany({
      where: {
        id: input.id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        agentRunId: input.agentRunId,
        status: { in: ['waiting_approval', 'processing'] },
      },
      data: {
        status: 'cancelled',
        result: result as Prisma.InputJsonValue,
      },
    });
    const record = await this.getRequest(input.id);
    if (
      !record ||
      record.workspaceId !== input.workspaceId ||
      record.actorId !== input.actorId ||
      record.agentRunId !== input.agentRunId ||
      record.status !== 'cancelled'
    ) {
      return null;
    }
    return record;
  }

  cancelPendingApprovalCallback(requestId: string) {
    return this.db.aiMcpDelegationCallbackDelivery.updateMany({
      where: {
        requestId,
        eventType: 'approval_required',
        status: { in: ['queued', 'retry_scheduled', 'processing'] },
      },
      data: {
        status: 'cancelled',
        nextAttemptAt: null,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  async acquireDueCallbackDelivery(input: {
    deliveryId?: string;
    requestId?: string;
    leaseId: string;
    leaseExpiresAt: Date;
  }) {
    const now = new Date();
    const candidate = await this.db.aiMcpDelegationCallbackDelivery.findFirst({
      where: {
        ...(input.deliveryId ? { id: input.deliveryId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        status: { in: ['queued', 'retry_scheduled', 'processing'] },
        OR: [
          {
            status: { in: ['queued', 'retry_scheduled'] },
            nextAttemptAt: { lte: now },
          },
          {
            status: 'processing',
            workerLeaseExpiresAt: { lte: now },
          },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
    });
    if (!candidate) return null;

    const updated = await this.db.aiMcpDelegationCallbackDelivery.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attemptCount: candidate.attemptCount,
        updatedAt: candidate.updatedAt,
        workerLeaseId: candidate.workerLeaseId,
        workerLeaseExpiresAt: candidate.workerLeaseExpiresAt,
      },
      data: {
        status: 'processing',
        attemptCount: { increment: 1 },
        workerLeaseId: input.leaseId,
        workerLeaseExpiresAt: input.leaseExpiresAt,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (updated.count !== 1) return null;
    return this.db.aiMcpDelegationCallbackDelivery.findUnique({
      where: { id: candidate.id },
      include: { request: true },
    });
  }

  markCallbackDelivered(id: string, leaseId: string) {
    return this.db.aiMcpDelegationCallbackDelivery.updateMany({
      where: { id, status: 'processing', workerLeaseId: leaseId },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    });
  }

  markCallbackFailed(input: {
    id: string;
    leaseId: string;
    exhausted: boolean;
    retryAt: Date | null;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.db.aiMcpDelegationCallbackDelivery.updateMany({
      where: {
        id: input.id,
        status: 'processing',
        workerLeaseId: input.leaseId,
      },
      data: {
        status: input.exhausted ? 'failed' : 'retry_scheduled',
        nextAttemptAt: input.retryAt,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage,
      },
    });
  }

  private assertRequestMatches(
    existing: AiMcpDelegationRequest,
    input: CreateMcpDelegationRequestInput
  ) {
    const matches =
      existing.workspaceId === input.workspaceId &&
      existing.actorId === input.actorId &&
      existing.credentialFamilyId === input.credentialFamilyId &&
      existing.capabilityFingerprint === input.capabilityFingerprint &&
      existing.requestFingerprint === input.requestFingerprint &&
      existing.requestText === input.requestText &&
      stableStringify(existing.requestedDocumentIds) ===
        stableStringify(input.requestedDocumentIds) &&
      stableStringify(existing.requestedAttachmentIds) ===
        stableStringify(input.requestedAttachmentIds);
    if (!matches) {
      throw new Error(
        'MCP delegation idempotency key was already used with different request evidence'
      );
    }
  }

  private assertAttachmentMatches(
    existing: AiMcpAttachment,
    input: CreateMcpAttachmentInput
  ) {
    const matches =
      existing.workspaceId === input.workspaceId &&
      existing.actorId === input.actorId &&
      existing.credentialFamilyId === input.credentialFamilyId &&
      existing.fileName === input.fileName &&
      existing.mimeType === input.mimeType &&
      existing.blobKey === input.blobKey &&
      existing.byteSize === input.byteSize &&
      existing.contentFingerprint === input.contentFingerprint;
    if (!matches) {
      throw new Error(
        'MCP attachment idempotency key was already used with different file evidence'
      );
    }
  }
}
