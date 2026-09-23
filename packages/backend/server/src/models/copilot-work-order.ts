import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { BadRequest, NotFound } from '../base';
import { BaseModel } from './base';

const id = z.string().trim().min(1).max(256);
const requestKey = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(20_000);
const title = z.string().trim().min(1).max(256);
const mime = z.string().trim().min(1).max(256);

const requirementSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(64),
    kind: z.enum(['file', 'text']),
    title,
    instructions: boundedText,
    required: z.boolean().default(true),
    acceptedMimeTypes: z.array(mime).max(32).default([]),
    minCount: z.number().int().min(0).max(32).default(1),
    maxCount: z.number().int().min(1).max(32).default(1),
    validationMode: z.enum([
      'mime_and_container',
      'non_empty_text',
      'bounded_model',
    ]),
  })
  .superRefine((value, context) => {
    if (value.maxCount < value.minCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxCount must be at least minCount',
      });
    }
    if (
      value.kind === 'file' &&
      (value.acceptedMimeTypes.length === 0 ||
        value.validationMode !== 'mime_and_container')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'File requirements need supported MIME types and container validation',
      });
    }
    if (
      value.kind === 'text' &&
      value.validationMode === 'mime_and_container'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Text requirements cannot use file validation',
      });
    }
  });

const recipientDraftSchema = z.object({
  recipientId: id,
  title,
  purpose: boundedText,
  requirements: z.array(requirementSchema).min(1).max(32),
  relationKind: z
    .enum(['original', 'supplement', 'replacement'])
    .default('original'),
  relatedWorkOrderId: id.optional(),
  background: z
    .object({
      label: z.string().trim().max(256).optional(),
      sharedMaterialIds: z.array(id).max(64).default([]),
    })
    .strict()
    .default({ sharedMaterialIds: [] }),
});

const prepareDispatchSchema = z.object({
  actorId: id,
  sourceSessionId: id,
  requestKey,
  recipients: z.array(recipientDraftSchema).min(1).max(20),
});

const deliveryItemSchema = z.object({
  requirementId: id,
  blobIds: z.array(id).max(32).default([]),
  text: z.string().trim().max(200_000).optional(),
});

export type WorkOrderRequirementDraft = z.infer<typeof requirementSchema>;
export type WorkOrderRecipientDraft = z.infer<typeof recipientDraftSchema>;
export type PrepareWorkOrderDispatchInput = z.input<
  typeof prepareDispatchSchema
>;
export type WorkOrderDeliveryItemInput = z.infer<typeof deliveryItemSchema>;

export const WORK_ORDER_TERMINAL_STATUSES = [
  'delivered',
  'refused',
  'cancelled',
] as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function confirmationHash(token: string) {
  return createHash('sha256')
    .update(`work-order-confirm:${token}`)
    .digest('hex');
}

function pageCursor(value: { lastBusinessAt: Date; sessionId: string }) {
  return Buffer.from(
    JSON.stringify({
      at: value.lastBusinessAt.toISOString(),
      id: value.sessionId,
    })
  ).toString('base64url');
}

function parsePageCursor(cursor?: string | null) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      at?: unknown;
      id?: unknown;
    };
    if (typeof value.at !== 'string' || typeof value.id !== 'string') {
      throw new Error('invalid cursor');
    }
    const at = new Date(value.at);
    if (Number.isNaN(at.valueOf())) throw new Error('invalid cursor');
    return { at, id: value.id };
  } catch {
    throw new BadRequest('Conversation cursor is invalid');
  }
}

@Injectable()
export class CopilotWorkOrderModel extends BaseModel {
  private async assertNewWorkOrdersEnabled() {
    const config = await this.db.aiProjectByokConfig.findUnique({
      where: { id: 'global' },
      select: { enabled: true, workOrderEnabled: true },
    });
    if (!config?.enabled || !config.workOrderEnabled) {
      throw new BadRequest(
        'New personal work orders are disabled by the instance administrator'
      );
    }
  }

  async resolveRecipient(input: { actorId: string; exact: string }) {
    const actorId = id.parse(input.actorId);
    const exact = z.string().trim().min(1).max(320).parse(input.exact);
    const recipient = await this.db.user.findFirst({
      where: {
        id: { not: actorId },
        registered: true,
        disabled: false,
        OR: [{ id: exact }, { email: { equals: exact, mode: 'insensitive' } }],
      },
      select: { id: true, name: true, email: true },
    });
    if (!recipient) throw new NotFound('Recipient unavailable');
    return recipient;
  }

  @Transactional()
  async prepareDispatch(input: PrepareWorkOrderDispatchInput) {
    const data = prepareDispatchSchema.parse(input);
    const source = await this.assertSourceSession(
      data.sourceSessionId,
      data.actorId
    );
    const normalizedRecipients = await Promise.all(
      data.recipients.map(async draft => {
        const recipient = await this.resolveRecipient({
          actorId: data.actorId,
          exact: draft.recipientId,
        });
        if (
          new Set(draft.requirements.map(item => item.itemKey)).size !==
          draft.requirements.length
        ) {
          throw new BadRequest(
            'Requirement keys must be unique within a work order'
          );
        }
        if (draft.relationKind !== 'original' && !draft.relatedWorkOrderId) {
          throw new BadRequest(
            'Supplement and replacement work orders need a related work order'
          );
        }
        if (draft.relationKind === 'original' && draft.relatedWorkOrderId) {
          throw new BadRequest(
            'Original work orders cannot replace another work order'
          );
        }
        if (draft.relatedWorkOrderId) {
          const related = await this.db.workOrder.findFirst({
            where: {
              id: draft.relatedWorkOrderId,
              senderId: data.actorId,
              sourceSessionId: source.id,
            },
            select: { id: true },
          });
          if (!related) throw new NotFound('Related work order unavailable');
        }
        return { ...draft, recipientId: recipient.id };
      })
    );
    const normalized = {
      version: 'project-workbench-v9/work-order-dispatch/v1',
      sourceSessionId: source.id,
      recipients: normalizedRecipients,
    };
    const draftFingerprint = fingerprint(normalized);
    const previous = await this.db.workOrderDispatch.findUnique({
      where: {
        senderId_requestKey: {
          senderId: data.actorId,
          requestKey: data.requestKey,
        },
      },
    });
    if (previous) {
      if (previous.draftFingerprint !== draftFingerprint) {
        throw new BadRequest(
          'Dispatch request key was reused with different requirements'
        );
      }
      if (previous.status === 'draft') {
        await this.assertNewWorkOrdersEnabled();
        const replacementToken = randomBytes(32).toString('base64url');
        const refreshed = await this.db.workOrderDispatch.update({
          where: { id: previous.id, draftVersion: previous.draftVersion },
          data: {
            confirmationHash: confirmationHash(replacementToken),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
        return {
          dispatch: refreshed,
          confirmationToken: replacementToken,
          confirmationRequired: true,
        };
      }
      return {
        dispatch: previous,
        confirmationToken: null,
        confirmationRequired: false,
      };
    }
    await this.assertNewWorkOrdersEnabled();
    const token = randomBytes(32).toString('base64url');
    const dispatch = await this.db.workOrderDispatch.create({
      data: {
        sourceSessionId: source.id,
        senderId: data.actorId,
        requestKey: data.requestKey,
        draftFingerprint,
        draft: normalized,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        // This is an authorization challenge, never the reusable model/provider secret.
        confirmationHash: confirmationHash(token),
      },
    });
    return { dispatch, confirmationToken: token, confirmationRequired: true };
  }

  @Transactional()
  async confirmDispatch(input: {
    actorId: string;
    dispatchId: string;
    confirmationToken: string;
    expectedDraftVersion: number;
    requestKey: string;
  }) {
    const actorId = id.parse(input.actorId);
    const dispatchId = id.parse(input.dispatchId);
    const token = z.string().min(32).max(256).parse(input.confirmationToken);
    const confirmRequestKey = requestKey.parse(input.requestKey);
    await this.lockDispatch(dispatchId);
    const dispatch = await this.db.workOrderDispatch.findFirst({
      where: { id: dispatchId, senderId: actorId },
    });
    if (!dispatch) throw new NotFound('Dispatch unavailable');
    if (dispatch.status === 'confirmed') {
      return this.dispatchResult(dispatch.id, actorId);
    }
    await this.assertNewWorkOrdersEnabled();
    if (
      !dispatch.sourceSessionId ||
      dispatch.status !== 'draft' ||
      dispatch.expiresAt <= new Date() ||
      dispatch.draftVersion !== input.expectedDraftVersion ||
      dispatch.confirmationHash !== confirmationHash(token)
    ) {
      throw new BadRequest('Dispatch confirmation is invalid or expired');
    }
    const sourceSessionId = dispatch.sourceSessionId;
    const draft = prepareDispatchSchema.shape.recipients.parse(
      (dispatch.draft as { recipients?: unknown }).recipients
    );
    const recipients = await this.db.user.findMany({
      where: {
        id: { in: draft.map(item => item.recipientId) },
        registered: true,
        disabled: false,
      },
      select: { id: true },
    });
    if (
      recipients.length !== new Set(draft.map(item => item.recipientId)).size
    ) {
      throw new NotFound('One or more recipients are unavailable');
    }
    // Completion and dispatch confirmation must serialize on the source
    // conversation. If completion wins, this confirmation explicitly reopens
    // the conversation; if confirmation wins, completion observes the new
    // outstanding work orders and refuses to close it.
    await this.lockSession(sourceSessionId);
    await this.db.workOrderDispatch.update({
      where: { id: dispatch.id },
      data: { status: 'confirmed', confirmedAt: new Date() },
    });
    await this.ensureChatPrompt();
    for (const recipientDraft of draft) {
      const workOrderId = randomUUID();
      const sessionId = randomUUID();
      const requirementsFingerprint = fingerprint(
        recipientDraft.requirements.map((item, ordinal) => ({
          ...item,
          ordinal,
        }))
      );
      await this.db.aiSession.create({
        data: {
          id: sessionId,
          userId: recipientDraft.recipientId,
          workspaceId: null,
          selectedContextProjectId: null,
          docId: null,
          scopeType: 'work_order',
          promptName: 'Chat With LocalMind AI',
          promptAction: '',
          title: recipientDraft.title,
          titleSource: 'manual',
          titleGenerationStatus: 'complete',
          allowMemoryCapture: false,
        },
      });
      await this.db.aiSessionWorkState.create({
        data: { sessionId, ownerUserId: recipientDraft.recipientId },
      });
      await this.db.workOrder.create({
        data: {
          id: workOrderId,
          dispatchId: dispatch.id,
          sourceSessionId,
          senderId: actorId,
          recipientId: recipientDraft.recipientId,
          relatedWorkOrderId: recipientDraft.relatedWorkOrderId,
          relationKind: recipientDraft.relationKind,
          title: recipientDraft.title,
          purpose: recipientDraft.purpose,
          requirementsFingerprint,
          background: recipientDraft.background,
          requirements: {
            create: recipientDraft.requirements.map((item, ordinal) => ({
              ...item,
              ordinal,
            })),
          },
        },
      });
      await this.db.workOrderSessionBinding.create({
        data: {
          workOrderId,
          sessionId,
          ownerUserId: recipientDraft.recipientId,
          ownerUserIdSnapshot: recipientDraft.recipientId,
        },
      });
      await this.db.aiSessionAttention.create({
        data: {
          sessionId,
          actorId: recipientDraft.recipientId,
          reason: 'work_order_delivery_required',
          sourceType: 'work_order',
          sourceId: workOrderId,
          evidence: { requirementsFingerprint },
        },
      });
      const event = await this.db.workOrderEvent.create({
        data: {
          workOrderId,
          actorId,
          eventType: 'sent',
          version: 1,
          payload: {
            confirmRequestKey,
            requirementsFingerprint,
          },
          eventFingerprint: fingerprint({
            workOrderId,
            version: 1,
            eventType: 'sent',
          }),
        },
      });
      await this.queueEvent({
        workOrderId,
        eventId: event.id,
        recipientId: recipientDraft.recipientId,
        topic: 'work-order.received',
      });
    }
    await this.reopenConversationForNewWork(sourceSessionId, actorId);
    return this.dispatchResult(dispatch.id, actorId);
  }

  async getOwned(workOrderId: string, actorId: string) {
    const order = await this.db.workOrder.findUnique({
      where: { id: id.parse(workOrderId) },
      include: {
        requirements: { orderBy: { ordinal: 'asc' } },
        exchanges: { orderBy: { createdAt: 'asc' } },
        sessionBinding: true,
        sourceSession: {
          select: { contextEpoch: true, selectedContextProjectId: true },
        },
        blobs: {
          where: { ownerId: actorId, status: 'staged' },
          orderBy: { createdAt: 'asc' },
        },
        deliveries: {
          orderBy: { revision: 'desc' },
          include: { items: { include: { blob: true } } },
        },
      },
    });
    if (!order || ![order.senderId, order.recipientId].includes(actorId)) {
      throw new NotFound('Work order unavailable');
    }
    const isRecipient = order.recipientId === actorId;
    const released =
      isRecipient || (await this.isDispatchReleased(order.dispatchId));
    return {
      ...order,
      viewerRole: isRecipient ? ('recipient' as const) : ('sender' as const),
      stagedBlobs: isRecipient ? order.blobs : [],
      deliveries: released ? order.deliveries : [],
      deliveryProgress: {
        released,
        latestRevision: order.deliveries[0]?.revision ?? null,
        status: order.status,
      },
      ownNavigation: isRecipient
        ? { kind: 'work_order' as const, workOrderId: order.id }
        : order.sourceSessionId
          ? { kind: 'source' as const, sessionId: order.sourceSessionId }
          : null,
    };
  }

  @Transactional()
  async ask(input: {
    workOrderId: string;
    actorId: string;
    body: string;
    expectedVersion: number;
    requestKey: string;
  }) {
    return this.exchange({ ...input, kind: 'question' });
  }

  @Transactional()
  async answer(input: {
    workOrderId: string;
    actorId: string;
    body: string;
    expectedVersion: number;
    requestKey: string;
  }) {
    return this.exchange({ ...input, kind: 'answer' });
  }

  @Transactional()
  async refuse(input: {
    workOrderId: string;
    actorId: string;
    reason: string;
    expectedVersion: number;
    requestKey: string;
  }) {
    return this.terminate({
      ...input,
      body: input.reason,
      kind: 'refusal',
      status: 'refused',
    });
  }

  @Transactional()
  async cancel(input: {
    workOrderId: string;
    actorId: string;
    reason?: string;
    expectedVersion: number;
    requestKey: string;
  }) {
    return this.terminate({
      ...input,
      body: input.reason ?? '',
      kind: 'cancellation',
      status: 'cancelled',
    });
  }

  @Transactional()
  async registerStagedBlob(input: {
    workOrderId: string;
    actorId: string;
    requirementId: string;
    requestKey: string;
    key: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    fingerprint: string;
    expiresAt: Date;
  }) {
    const order = await this.assertRecipient(input.workOrderId, input.actorId);
    await this.lockWorkOrder(order.id);
    if (
      !['open', 'waiting_sender', 'validating', 'delivered'].includes(
        order.status
      )
    ) {
      throw new BadRequest('This work order no longer accepts delivery drafts');
    }
    const requirement = await this.db.workOrderRequirement.findFirst({
      where: {
        id: id.parse(input.requirementId),
        workOrderId: order.id,
        kind: 'file',
      },
    });
    if (!requirement) throw new NotFound('File requirement unavailable');
    if (!requirement.acceptedMimeTypes.includes(input.mimeType)) {
      throw new BadRequest('File MIME type does not match this requirement');
    }
    const stagedRequestKey = requestKey.parse(input.requestKey);
    const normalizedFileName = z
      .string()
      .trim()
      .min(1)
      .max(512)
      .parse(input.fileName);
    const normalizedMimeType = mime.parse(input.mimeType);
    const normalizedByteSize = z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .parse(input.byteSize);
    const normalizedFingerprint = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.fingerprint);
    const existing = await this.db.workOrderBlob.findUnique({
      where: {
        workOrderId_requestKey: {
          workOrderId: order.id,
          requestKey: stagedRequestKey,
        },
      },
    });
    if (existing) {
      if (
        existing.ownerId !== input.actorId ||
        existing.requirementId !== requirement.id ||
        existing.fileName !== normalizedFileName ||
        existing.mimeType !== normalizedMimeType ||
        existing.byteSize !== normalizedByteSize ||
        existing.fingerprint !== normalizedFingerprint ||
        existing.status !== 'staged'
      ) {
        throw new BadRequest(
          'Work order file request was reused with different content'
        );
      }
      return { blob: existing, replayed: true };
    }
    const blob = await this.db.workOrderBlob.create({
      data: {
        workOrderId: order.id,
        ownerId: input.actorId,
        requirementId: requirement.id,
        requestKey: stagedRequestKey,
        key: id.parse(input.key),
        fileName: normalizedFileName,
        mimeType: normalizedMimeType,
        byteSize: normalizedByteSize,
        fingerprint: normalizedFingerprint,
        expiresAt: input.expiresAt,
      },
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.task.changed',
        scopeId: input.actorId,
      },
    });
    return { blob, replayed: false };
  }

  @Transactional()
  async submitDelivery(input: {
    workOrderId: string;
    actorId: string;
    expectedVersion: number;
    requestKey: string;
    items: WorkOrderDeliveryItemInput[];
  }) {
    const workOrderId = id.parse(input.workOrderId);
    const actorId = id.parse(input.actorId);
    const deliveryRequestKey = requestKey.parse(input.requestKey);
    const items = z.array(deliveryItemSchema).min(1).max(64).parse(input.items);
    await this.lockWorkOrder(workOrderId);
    const order = await this.db.workOrder.findFirst({
      where: { id: workOrderId, recipientId: actorId },
      include: { requirements: { orderBy: { ordinal: 'asc' } } },
    });
    if (!order) throw new NotFound('Work order unavailable');
    if (!['open', 'validating', 'delivered'].includes(order.status)) {
      throw new BadRequest('This work order no longer accepts delivery');
    }
    if (order.version !== input.expectedVersion) {
      const replay = await this.findDeliveryReplay(
        order.id,
        deliveryRequestKey
      );
      if (replay) return replay;
      throw new BadRequest('Work order changed; reload before submitting');
    }
    const itemByRequirement = new Map(
      items.map(item => [item.requirementId, item])
    );
    const evidence: Prisma.InputJsonObject[] = [];
    const createItems: Prisma.WorkOrderDeliveryItemCreateManyInput[] = [];
    for (const requirement of order.requirements) {
      const item = itemByRequirement.get(requirement.id);
      if (!item) {
        if (requirement.required)
          throw new BadRequest(`Missing required item: ${requirement.title}`);
        continue;
      }
      if (requirement.kind === 'text') {
        const text = item.text?.trim();
        if (!text && requirement.required)
          throw new BadRequest(`Missing required text: ${requirement.title}`);
        if (item.blobIds.length)
          throw new BadRequest(
            `Text item cannot include files: ${requirement.title}`
          );
        if (text) {
          createItems.push({
            id: randomUUID(),
            deliveryRevisionId: '',
            workOrderId: order.id,
            requirementId: requirement.id,
            textValue: text,
            evidence: { mode: requirement.validationMode, nonEmpty: true },
          });
          evidence.push({
            requirementId: requirement.id,
            passed: true,
            mode: requirement.validationMode,
          });
        }
      } else {
        if (item.text)
          throw new BadRequest(
            `File item cannot include text: ${requirement.title}`
          );
        if (
          item.blobIds.length < requirement.minCount ||
          item.blobIds.length > requirement.maxCount
        ) {
          throw new BadRequest(
            `File count does not match: ${requirement.title}`
          );
        }
        const blobs = await this.db.workOrderBlob.findMany({
          where: {
            id: { in: item.blobIds },
            workOrderId: order.id,
            ownerId: actorId,
            status: 'staged',
            expiresAt: { gt: new Date() },
          },
        });
        if (blobs.length !== new Set(item.blobIds).size) {
          throw new BadRequest(
            `One or more files are unavailable: ${requirement.title}`
          );
        }
        for (const blob of blobs) {
          if (!requirement.acceptedMimeTypes.includes(blob.mimeType)) {
            throw new BadRequest(
              `File type does not match: ${requirement.title}`
            );
          }
          createItems.push({
            id: randomUUID(),
            deliveryRevisionId: '',
            workOrderId: order.id,
            requirementId: requirement.id,
            blobId: blob.id,
            evidence: {
              mode: 'mime_and_container',
              mimeType: blob.mimeType,
              byteSize: blob.byteSize,
              fingerprint: blob.fingerprint,
              containerReadable: true,
            },
          });
        }
        evidence.push({
          requirementId: requirement.id,
          passed: true,
          mode: 'mime_and_container',
          count: blobs.length,
        });
      }
    }
    if (itemByRequirement.size > order.requirements.length) {
      throw new BadRequest('Delivery includes an unknown requirement');
    }
    const latest = await this.db.workOrderDeliveryRevision.aggregate({
      where: { workOrderId: order.id },
      _max: { revision: true },
    });
    const revision = (latest._max.revision ?? 0) + 1;
    const receiptFingerprint = fingerprint({
      workOrderId: order.id,
      revision,
      requestKey: deliveryRequestKey,
      requirementsFingerprint: order.requirementsFingerprint,
      items: createItems.map(item => ({
        requirementId: item.requirementId,
        blobId: item.blobId ?? null,
        textFingerprint: item.textValue ? fingerprint(item.textValue) : null,
      })),
    });
    const delivery = await this.db.workOrderDeliveryRevision.create({
      data: {
        workOrderId: order.id,
        revision,
        submittedBy: actorId,
        requirementsFingerprint: order.requirementsFingerprint,
        receiptFingerprint,
        validationEvidence: {
          version: 'project-workbench-v9/delivery-validation/v1',
          requestKey: deliveryRequestKey,
          requirements: evidence,
        },
      },
    });
    if (createItems.length) {
      await this.db.workOrderDeliveryItem.createMany({
        data: createItems.map(item => ({
          ...item,
          deliveryRevisionId: delivery.id,
        })),
      });
      const blobIds = createItems.flatMap(item =>
        item.blobId ? [item.blobId] : []
      );
      if (blobIds.length) {
        await this.db.workOrderBlob.updateMany({
          where: {
            id: { in: blobIds },
            workOrderId: order.id,
            status: 'staged',
          },
          data: { status: 'delivered', expiresAt: null },
        });
      }
    }
    const nextVersion = order.version + 1;
    const event = await this.db.workOrderEvent.create({
      data: {
        workOrderId: order.id,
        actorId,
        eventType: revision === 1 ? 'delivered' : 'delivery_revised',
        version: nextVersion,
        payload: {
          revision,
          receiptFingerprint,
          requestKey: deliveryRequestKey,
        },
        eventFingerprint: fingerprint({
          orderId: order.id,
          nextVersion,
          receiptFingerprint,
        }),
      },
    });
    const updated = await this.db.workOrder.update({
      where: { id: order.id, version: order.version },
      data: {
        status: 'delivered',
        version: nextVersion,
        completedAt: order.completedAt ?? new Date(),
        terminalReason: null,
      },
    });
    await this.resolveAttention(order.id, actorId);
    await this.completeRecipientConversation(order.id, actorId);
    if (order.senderId) {
      await this.queueEvent({
        workOrderId: order.id,
        eventId: event.id,
        recipientId: order.senderId,
        topic:
          revision === 1
            ? 'work-order.delivered'
            : 'work-order.delivery-revised',
      });
    }
    await this.releaseSourceConversationIfComplete(
      order.sourceSessionId,
      order.senderId
    );
    return { order: updated, delivery };
  }

  @Transactional()
  async adoptDeliveries(input: {
    actorId: string;
    sourceSessionId: string;
    expectedContextVersion: number;
    requestKey: string;
    revisions: Array<{ workOrderId: string; deliveryRevisionId: string }>;
  }) {
    const actorId = id.parse(input.actorId);
    const sourceSessionId = id.parse(input.sourceSessionId);
    const adoptionRequestKey = requestKey.parse(input.requestKey);
    const revisions = z
      .array(z.object({ workOrderId: id, deliveryRevisionId: id }))
      .min(1)
      .max(100)
      .parse(input.revisions);
    const previous = await this.db.workOrderAdoption.findUnique({
      where: {
        sourceSessionIdSnapshot_requestKey: {
          sourceSessionIdSnapshot: sourceSessionId,
          requestKey: adoptionRequestKey,
        },
      },
      include: { items: true },
    });
    if (previous) return previous;
    await this.lockSession(sourceSessionId);
    const source = await this.assertSourceSession(sourceSessionId, actorId);
    if (source.contextEpoch !== input.expectedContextVersion) {
      throw new BadRequest(
        'Conversation context changed; reload before adopting deliveries'
      );
    }
    const orders = await this.db.workOrder.findMany({
      where: {
        id: { in: revisions.map(item => item.workOrderId) },
        senderId: actorId,
        sourceSessionId,
      },
      include: { deliveries: true },
    });
    if (
      orders.length !== new Set(revisions.map(item => item.workOrderId)).size
    ) {
      throw new NotFound('Delivery unavailable');
    }
    for (const revision of revisions) {
      const order = orders.find(item => item.id === revision.workOrderId);
      if (
        !order ||
        order.status !== 'delivered' ||
        !order.deliveries.some(item => item.id === revision.deliveryRevisionId)
      ) {
        throw new BadRequest('Only complete delivery revisions can be adopted');
      }
      if (!(await this.isDispatchReleased(order.dispatchId))) {
        throw new BadRequest(
          'Wait for the complete dispatch before adopting delivery'
        );
      }
    }
    const revisionSetFingerprint = fingerprint(
      [...revisions].sort((a, b) => a.workOrderId.localeCompare(b.workOrderId))
    );
    const contextVersion = source.contextEpoch + 1;
    const adoption = await this.db.workOrderAdoption.create({
      data: {
        sourceSessionId,
        sourceSessionIdSnapshot: sourceSessionId,
        actorId,
        contextVersion,
        requestKey: adoptionRequestKey,
        revisionSetFingerprint,
        items: { create: revisions },
      },
      include: { items: true },
    });
    await this.db.aiSessionContextSource.createMany({
      data: revisions.map(revision => {
        const order = orders.find(item => item.id === revision.workOrderId);
        const delivery = order?.deliveries.find(
          item => item.id === revision.deliveryRevisionId
        );
        if (!order || !delivery)
          throw new BadRequest('Adopted delivery revision is unavailable');
        return {
          sessionId: sourceSessionId,
          workspaceId: null,
          projectId: null,
          workOrderId: order.id,
          kind: 'work_order_delivery',
          sourceId: `${delivery.id}@${delivery.revision}`,
          evidence: {
            adoptionId: adoption.id,
            contextVersion,
            audience: 'source_session_actor_only',
          },
        };
      }),
      skipDuplicates: true,
    });
    await this.db.aiSession.update({
      where: { id: sourceSessionId, contextEpoch: source.contextEpoch },
      data: { contextEpoch: { increment: 1 } },
    });
    await this.db.aiSessionAttention.updateMany({
      where: {
        sessionId: sourceSessionId,
        actorId,
        status: 'open',
        sourceType: 'work_order_dispatch',
      },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: actorId,
        resolutionEvidence: { adoptionId: adoption.id, revisionSetFingerprint },
        version: { increment: 1 },
      },
    });
    await this.touchConversation(sourceSessionId, actorId);
    return adoption;
  }

  async adoptedDeliveriesForSession(input: {
    actorId: string;
    sourceSessionId: string;
  }) {
    const actorId = id.parse(input.actorId);
    const sourceSessionId = id.parse(input.sourceSessionId);
    const source = await this.assertSourceSession(sourceSessionId, actorId);
    const adoptions = await this.db.workOrderAdoption.findMany({
      where: {
        sourceSessionIdSnapshot: sourceSessionId,
        actorId,
        contextVersion: { lte: source.contextEpoch },
      },
      orderBy: { contextVersion: 'desc' },
      take: 100,
      include: {
        items: {
          include: {
            adoption: { select: { id: true, title: true } },
            delivery: {
              include: {
                items: {
                  orderBy: { createdAt: 'asc' },
                  include: {
                    requirement: {
                      select: { id: true, itemKey: true, title: true },
                    },
                    blob: {
                      select: {
                        id: true,
                        fileName: true,
                        mimeType: true,
                        byteSize: true,
                        fingerprint: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const latestByOrder = new Map<
      string,
      (typeof adoptions)[number]['items'][number]
    >();
    for (const adoption of adoptions) {
      for (const item of adoption.items) {
        if (!latestByOrder.has(item.workOrderId)) {
          latestByOrder.set(item.workOrderId, item);
        }
      }
    }
    return {
      contextVersion: source.contextEpoch,
      truncated: adoptions.length === 100,
      items: [...latestByOrder.values()],
    };
  }

  @Transactional()
  async completeConversation(input: {
    actorId: string;
    sessionId: string;
    expectedVersion: number;
    requestKey: string;
    reason?: string;
  }) {
    const actorId = id.parse(input.actorId);
    const sessionId = id.parse(input.sessionId);
    const completionRequestKey = requestKey.parse(input.requestKey);
    await this.lockSession(sessionId);
    const state = await this.db.aiSessionWorkState.findFirst({
      where: { sessionId, ownerUserId: actorId, session: { deletedAt: null } },
    });
    if (!state) throw new NotFound('Conversation unavailable');
    if (
      state.completedAt &&
      state.completionRequestKey === completionRequestKey
    ) {
      return state;
    }
    if (state.version !== input.expectedVersion)
      throw new BadRequest('Conversation changed; reload before completing');
    const [attentions, activeRuns, openOrders] = await Promise.all([
      this.db.aiSessionAttention.findMany({
        where: { sessionId, actorId, status: 'open' },
        select: { reason: true, sourceType: true, sourceId: true },
      }),
      this.db.aiAgentRun.count({
        where: {
          sessionId,
          actorId,
          status: {
            in: [
              'queued',
              'running',
              'cancel_requested',
              'waiting_for_location',
            ],
          },
        },
      }),
      this.db.workOrder.count({
        where: {
          sourceSessionId: sessionId,
          senderId: actorId,
          status: { notIn: ['delivered', 'cancelled'] },
        },
      }),
    ]);
    if (attentions.length || activeRuns || openOrders) {
      throw new BadRequest(
        `Conversation still has unresolved work: ${attentions.length} actions, ${activeRuns} runs, ${openOrders} work orders`
      );
    }
    return this.db.aiSessionWorkState.update({
      where: { sessionId, version: state.version },
      data: {
        completedAt: new Date(),
        completionReason: input.reason?.trim().slice(0, 256) || 'manual',
        completionRequestKey,
        version: { increment: 1 },
        lastBusinessAt: new Date(),
      },
    });
  }

  @Transactional()
  async reopenAfterSuccessfulMessage(sessionId: string, actorId: string) {
    const state = await this.db.aiSessionWorkState.findFirst({
      where: { sessionId: id.parse(sessionId), ownerUserId: id.parse(actorId) },
    });
    if (!state) return null;
    return this.db.aiSessionWorkState.update({
      where: { sessionId, version: state.version },
      data: {
        completedAt: null,
        completionReason: null,
        completionRequestKey: null,
        version: { increment: 1 },
        lastBusinessAt: new Date(),
      },
    });
  }

  @Transactional()
  async renameConversation(input: {
    actorId: string;
    sessionId: string;
    title: string;
    expectedRevision: number;
  }) {
    const sessionId = id.parse(input.sessionId);
    const actorId = id.parse(input.actorId);
    await this.lockSession(sessionId);
    const current = await this.db.aiSession.findFirst({
      where: { id: sessionId, userId: actorId, deletedAt: null },
    });
    if (!current) throw new NotFound('Conversation unavailable');
    // A late automatic title may legitimately win the first CAS. A manual title
    // is still authoritative, while two competing manual renames remain a
    // conflict so one user's stale tab cannot silently overwrite the other.
    if (
      current.titleRevision !== input.expectedRevision &&
      current.titleSource === 'manual'
    ) {
      throw new BadRequest(
        'Conversation title changed; reload before renaming'
      );
    }
    const result = await this.db.aiSession.updateMany({
      where: {
        id: sessionId,
        userId: actorId,
        deletedAt: null,
        titleRevision: current.titleRevision,
      },
      data: {
        title: title.parse(input.title),
        titleSource: 'manual',
        titleGenerationStatus: 'complete',
        titleRevision: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new BadRequest(
        'Conversation title changed; reload before renaming'
      );
    return this.db.aiSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
  }

  async listCards(input: {
    actorId: string;
    column?: 'todo' | 'progress' | 'done';
    first?: number;
    after?: string | null;
  }) {
    const actorId = id.parse(input.actorId);
    const first = z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .parse(input.first);
    const after = parsePageCursor(input.after);
    const rows = await this.db.aiSessionWorkState.findMany({
      where: {
        ownerUserId: actorId,
        session: { deletedAt: null },
        ...(after
          ? {
              OR: [
                { lastBusinessAt: { lt: after.at } },
                { lastBusinessAt: after.at, sessionId: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastBusinessAt: 'desc' }, { sessionId: 'asc' }],
      take: first + 1,
      include: {
        session: {
          include: {
            selectedContextProject: { select: { id: true, name: true } },
            workOrderBinding: {
              include: {
                workOrder: {
                  select: {
                    id: true,
                    title: true,
                    status: true,
                    senderId: true,
                  },
                },
              },
            },
            attentions: {
              where: { actorId, status: 'open' },
              select: { reason: true, sourceType: true, sourceId: true },
            },
          },
        },
      },
    });
    const sessionIds = rows.map(row => row.sessionId);
    const activeRuns = await this.db.aiAgentRun.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: sessionIds },
        actorId,
        status: {
          in: ['queued', 'running', 'cancel_requested', 'waiting_for_location'],
        },
      },
      _count: true,
    });
    const runCount = new Map(
      activeRuns.map(row => [row.sessionId, row._count])
    );
    const projected = rows.map(row => {
      const attention = row.session.attentions;
      const workOrder = row.session.workOrderBinding?.workOrder;
      const column = attention.length
        ? 'todo'
        : row.completedAt
          ? 'done'
          : 'progress';
      return {
        sessionId: row.sessionId,
        scopeType: row.session.scopeType,
        title: row.session.title,
        titleRevision: row.session.titleRevision,
        project: row.session.selectedContextProject,
        workOrder,
        column,
        attentionReasons: attention.map(item => item.reason),
        activeRunCount: runCount.get(row.sessionId) ?? 0,
        lastBusinessAt: row.lastBusinessAt,
        version: row.version,
      };
    });
    const filtered = input.column
      ? projected.filter(item => item.column === input.column)
      : projected;
    const hasNextPage = rows.length > first;
    const page = filtered.slice(0, first);
    const last = rows[Math.min(first, rows.length) - 1];
    const counts = await this.countColumns(actorId);
    return {
      items: page,
      counts,
      pageInfo: {
        hasNextPage,
        endCursor: hasNextPage && last ? pageCursor(last) : null,
      },
    };
  }

  async collaborationGraph(actorId: string) {
    const userId = id.parse(actorId);
    const rows = await this.db.workOrder.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 501,
      include: {
        sender: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
        sessionBinding: { select: { sessionId: true } },
        requirements: {
          orderBy: { ordinal: 'asc' },
          select: { id: true, title: true, kind: true },
        },
        sourceSession: {
          select: {
            id: true,
            selectedContextProject: { select: { id: true, name: true } },
          },
        },
      },
    });
    const truncated = rows.length > 500;
    const orders = rows.slice(0, 500);
    const nodes = new Map<
      string,
      { id: string; label: string; self: boolean }
    >();
    for (const order of orders) {
      if (order.sender)
        nodes.set(order.sender.id, {
          id: order.sender.id,
          label: order.sender.name,
          self: order.sender.id === userId,
        });
      if (order.recipient)
        nodes.set(order.recipient.id, {
          id: order.recipient.id,
          label: order.recipient.name,
          self: order.recipient.id === userId,
        });
    }
    return {
      nodes: [...nodes.values()],
      edges: orders.flatMap(order =>
        order.sender && order.recipient
          ? [
              {
                id: order.id,
                from: order.recipient.id,
                to: order.sender.id,
                status: order.status,
                label: order.title,
                requirements: order.requirements,
                project:
                  order.senderId === userId
                    ? order.sourceSession?.selectedContextProject
                    : null,
                ownNavigation:
                  order.recipientId === userId
                    ? { kind: 'work_order' as const, workOrderId: order.id }
                    : order.sourceSessionId
                      ? {
                          kind: 'source' as const,
                          sessionId: order.sourceSessionId,
                        }
                      : null,
              },
            ]
          : []
      ),
      truncated,
    };
  }

  async authorizeBlobRead(input: {
    workOrderId: string;
    blobId: string;
    actorId: string;
  }) {
    const blob = await this.db.workOrderBlob.findFirst({
      where: {
        id: id.parse(input.blobId),
        workOrderId: id.parse(input.workOrderId),
        status: { not: 'deleted' },
      },
      include: { workOrder: true },
    });
    if (!blob) throw new NotFound('Work order file unavailable');
    if (blob.workOrder.recipientId === input.actorId) return blob;
    if (
      blob.workOrder.senderId !== input.actorId ||
      blob.status !== 'delivered' ||
      !(await this.isDispatchReleased(blob.workOrder.dispatchId))
    ) {
      throw new NotFound('Work order file unavailable');
    }
    return blob;
  }

  async listExpiredStagedBlobs(limit = 100) {
    if (await this.isWorkOrderPayloadRetentionFrozen()) return [];
    return this.db.workOrderBlob.findMany({
      where: { status: 'staged', expiresAt: { lte: new Date() } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: z.number().int().min(1).max(500).parse(limit),
    });
  }

  async listUserStagedBlobsForCleanup(userId: string) {
    if (await this.isWorkOrderPayloadRetentionFrozen()) return [];
    return this.db.workOrderBlob.findMany({
      where: { ownerId: id.parse(userId), status: 'staged' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  @Transactional()
  async markStagedBlobDeleted(blobId: string) {
    return this.db.workOrderBlob.updateMany({
      where: { id: id.parse(blobId), status: 'staged' },
      data: { status: 'deleted', expiresAt: new Date() },
    });
  }

  private async isWorkOrderPayloadRetentionFrozen() {
    const policy = await this.db.localMindLogPolicy.findUnique({
      where: { id: 'default' },
      select: { legalHold: true, retentionFrozen: true },
    });
    return Boolean(policy?.legalHold || policy?.retentionFrozen);
  }

  @Transactional()
  async deliverNextOutboxEvent() {
    const rows = await this.db.$queryRaw<
      Array<{
        id: bigint;
        eventId: string;
        workOrderId: string;
        recipientId: string;
        topic: string;
        actorId: string | null;
      }>
    >`
      SELECT outbox.id, outbox.event_id AS "eventId",
        outbox.work_order_id AS "workOrderId",
        outbox.recipient_id AS "recipientId", outbox.topic,
        event.actor_id AS "actorId"
      FROM work_order_outbox outbox
      JOIN work_order_events event ON event.id = outbox.event_id
        AND event.work_order_id = outbox.work_order_id
      WHERE outbox.delivered_at IS NULL
        AND outbox.available_at <= CURRENT_TIMESTAMP
      ORDER BY outbox.id
      LIMIT 1
      FOR UPDATE OF outbox SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return false;
    const recipients = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE id = ${row.recipientId} FOR KEY SHARE
    `;
    if (!recipients[0]) {
      // Account deletion may leave immutable historical outbox evidence aimed
      // at the removed participant. Consume it without retrying forever or
      // manufacturing a notification for another identity.
      await this.db.workOrderOutbox.update({
        where: { id: row.id },
        data: { deliveredAt: new Date(), attempts: { increment: 1 } },
      });
      return true;
    }
    await this.db.notification.upsert({
      where: {
        id: `work-order:${row.eventId}:${row.recipientId}`,
      },
      create: {
        id: `work-order:${row.eventId}:${row.recipientId}`,
        userId: row.recipientId,
        type: 'WorkOrder',
        level: 'Default',
        read: false,
        body: {
          workOrderId: row.workOrderId,
          eventId: row.eventId,
          topic: row.topic,
          createdByUserId: row.actorId ?? row.recipientId,
        },
      },
      update: {},
    });
    await this.db.notificationRefresh.upsert({
      where: { userId: row.recipientId },
      create: { userId: row.recipientId, revision: randomUUID() },
      update: { revision: randomUUID() },
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.task.changed',
        scopeId: row.recipientId,
      },
    });
    await this.db.workOrderOutbox.update({
      where: { id: row.id },
      data: {
        deliveredAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return true;
  }

  private async exchange(input: {
    workOrderId: string;
    actorId: string;
    body: string;
    expectedVersion: number;
    requestKey: string;
    kind: 'question' | 'answer';
  }) {
    const workOrderId = id.parse(input.workOrderId);
    const actorId = id.parse(input.actorId);
    const body = boundedText.parse(input.body);
    const exchangeRequestKey = requestKey.parse(input.requestKey);
    await this.lockWorkOrder(workOrderId);
    const order = await this.db.workOrder.findUnique({
      where: { id: workOrderId },
      include: { sessionBinding: true },
    });
    if (!order || ![order.senderId, order.recipientId].includes(actorId))
      throw new NotFound('Work order unavailable');
    const expectedActor =
      input.kind === 'question' ? order.recipientId : order.senderId;
    if (expectedActor !== actorId) throw new NotFound('Work order unavailable');
    const replay = await this.db.workOrderExchange.findUnique({
      where: {
        workOrderId_requestKey: { workOrderId, requestKey: exchangeRequestKey },
      },
    });
    if (replay) return { order, exchange: replay };
    if (
      order.version !== input.expectedVersion ||
      !['open', 'waiting_sender'].includes(order.status)
    ) {
      throw new BadRequest('Work order changed; reload before continuing');
    }
    if (input.kind === 'question' && order.status !== 'open')
      throw new BadRequest('A reply is already pending');
    if (input.kind === 'answer' && order.status !== 'waiting_sender')
      throw new BadRequest('No recipient question is pending');
    const exchange = await this.db.workOrderExchange.create({
      data: {
        workOrderId,
        actorId,
        kind: input.kind,
        body,
        requestKey: exchangeRequestKey,
        fingerprint: fingerprint({ kind: input.kind, body }),
      },
    });
    const nextVersion = order.version + 1;
    const event = await this.db.workOrderEvent.create({
      data: {
        workOrderId,
        actorId,
        eventType:
          input.kind === 'question' ? 'question_asked' : 'question_answered',
        version: nextVersion,
        payload: { exchangeId: exchange.id },
        eventFingerprint: fingerprint({
          workOrderId,
          nextVersion,
          exchangeId: exchange.id,
        }),
      },
    });
    const updated = await this.db.workOrder.update({
      where: { id: workOrderId, version: order.version },
      data: {
        status: input.kind === 'question' ? 'waiting_sender' : 'open',
        version: nextVersion,
      },
    });
    const targetId =
      input.kind === 'question' ? order.senderId : order.recipientId;
    const targetSessionId =
      input.kind === 'question'
        ? order.sourceSessionId
        : order.sessionBinding?.sessionId;
    if (targetId && targetSessionId) {
      await this.upsertAttention({
        sessionId: targetSessionId,
        actorId: targetId,
        reason:
          input.kind === 'question'
            ? 'work_order_question'
            : 'work_order_answered',
        sourceType: 'work_order',
        sourceId: order.id,
        evidence: { exchangeId: exchange.id },
      });
      await this.queueEvent({
        workOrderId,
        eventId: event.id,
        recipientId: targetId,
        topic:
          input.kind === 'question'
            ? 'work-order.question'
            : 'work-order.answer',
      });
    }
    await this.resolveAttention(order.id, actorId);
    return { order: updated, exchange };
  }

  private async terminate(input: {
    workOrderId: string;
    actorId: string;
    body: string;
    expectedVersion: number;
    requestKey: string;
    kind: 'refusal' | 'cancellation';
    status: 'refused' | 'cancelled';
  }) {
    const workOrderId = id.parse(input.workOrderId);
    const actorId = id.parse(input.actorId);
    const body =
      input.kind === 'cancellation'
        ? z.string().trim().max(1200).parse(input.body)
        : boundedText.parse(input.body);
    const terminationRequestKey = requestKey.parse(input.requestKey);
    await this.lockWorkOrder(workOrderId);
    const order = await this.db.workOrder.findUnique({
      where: { id: workOrderId },
      include: { sessionBinding: true },
    });
    if (!order || ![order.senderId, order.recipientId].includes(actorId))
      throw new NotFound('Work order unavailable');
    const expectedActor =
      input.kind === 'refusal' ? order.recipientId : order.senderId;
    if (expectedActor !== actorId) throw new NotFound('Work order unavailable');
    const replay = await this.db.workOrderExchange.findUnique({
      where: {
        workOrderId_requestKey: {
          workOrderId,
          requestKey: terminationRequestKey,
        },
      },
    });
    if (replay) return { order, exchange: replay };
    const terminalConflict =
      input.kind === 'refusal'
        ? WORK_ORDER_TERMINAL_STATUSES.includes(order.status as never)
        : ['delivered', 'cancelled'].includes(order.status);
    if (order.version !== input.expectedVersion || terminalConflict) {
      throw new BadRequest('Work order changed or is already complete');
    }
    const exchange = await this.db.workOrderExchange.create({
      data: {
        workOrderId,
        actorId,
        kind: input.kind,
        body,
        requestKey: terminationRequestKey,
        fingerprint: fingerprint({ kind: input.kind, body }),
      },
    });
    const nextVersion = order.version + 1;
    const event = await this.db.workOrderEvent.create({
      data: {
        workOrderId,
        actorId,
        eventType: input.status,
        version: nextVersion,
        payload: { exchangeId: exchange.id },
        eventFingerprint: fingerprint({
          workOrderId,
          nextVersion,
          exchangeId: exchange.id,
        }),
      },
    });
    const updated = await this.db.workOrder.update({
      where: { id: workOrderId, version: order.version },
      data: {
        status: input.status,
        version: nextVersion,
        completedAt: new Date(),
        terminalReason: body || null,
      },
    });
    await this.models.copilotWorkOrderAgentRuntime.cancelForWorkOrder(
      workOrderId,
      input.kind === 'refusal'
        ? 'Work order was refused'
        : 'Work order was cancelled'
    );
    if (order.sessionBinding) {
      await this.resolveAttention(order.id, order.recipientId);
      await this.completeRecipientConversation(order.id, order.recipientId);
    }
    const targetId =
      input.kind === 'refusal' ? order.senderId : order.recipientId;
    const targetSessionId =
      input.kind === 'refusal'
        ? order.sourceSessionId
        : order.sessionBinding?.sessionId;
    if (targetId && targetSessionId) {
      await this.upsertAttention({
        sessionId: targetSessionId,
        actorId: targetId,
        reason:
          input.kind === 'refusal'
            ? 'work_order_refused'
            : 'work_order_cancelled',
        sourceType: 'work_order',
        sourceId: order.id,
        evidence: { exchangeId: exchange.id },
      });
      await this.queueEvent({
        workOrderId,
        eventId: event.id,
        recipientId: targetId,
        topic:
          input.kind === 'refusal'
            ? 'work-order.refused'
            : 'work-order.cancelled',
      });
    }
    return { order: updated, exchange };
  }

  private async assertSourceSession(sessionId: string, actorId: string) {
    const session = await this.db.aiSession.findFirst({
      where: {
        id: sessionId,
        userId: actorId,
        deletedAt: null,
        scopeType: { in: ['workspace', 'project'] },
      },
    });
    if (!session) throw new NotFound('Source conversation unavailable');
    return session;
  }

  private async assertRecipient(workOrderId: string, actorId: string) {
    const order = await this.db.workOrder.findFirst({
      where: { id: id.parse(workOrderId), recipientId: id.parse(actorId) },
    });
    if (!order) throw new NotFound('Work order unavailable');
    return order;
  }

  private async ensureChatPrompt() {
    await this.db.aiPrompt.upsert({
      where: { name: 'Chat With LocalMind AI' },
      update: {},
      create: {
        name: 'Chat With LocalMind AI',
        action: '',
        model: '',
        optionalModels: [],
        config: {},
      },
    });
  }

  private async dispatchResult(dispatchId: string, actorId: string) {
    const dispatch = await this.db.workOrderDispatch.findFirst({
      where: { id: dispatchId, senderId: actorId },
      include: {
        orders: {
          include: {
            sessionBinding: true,
            requirements: { orderBy: { ordinal: 'asc' } },
          },
        },
      },
    });
    if (!dispatch) throw new NotFound('Dispatch unavailable');
    return dispatch;
  }

  private async lockDispatch(dispatchId: string) {
    await this.db.$queryRaw(
      Prisma.sql`SELECT id FROM work_order_dispatches WHERE id = ${dispatchId} FOR UPDATE`
    );
  }

  private async lockWorkOrder(workOrderId: string) {
    await this.db.$queryRaw(
      Prisma.sql`SELECT id FROM work_orders WHERE id = ${workOrderId} FOR UPDATE`
    );
  }

  private async lockSession(sessionId: string) {
    await this.db.$queryRaw(
      Prisma.sql`SELECT id FROM ai_sessions_metadata WHERE id = ${sessionId} FOR UPDATE`
    );
  }

  private async queueEvent(input: {
    workOrderId: string;
    eventId: string;
    recipientId: string;
    topic: string;
  }) {
    await this.db.workOrderOutbox.upsert({
      where: {
        eventId_recipientId_channel: {
          eventId: input.eventId,
          recipientId: input.recipientId,
          channel: 'in_app',
        },
      },
      create: { ...input, channel: 'in_app' },
      update: {},
    });
  }

  private async upsertAttention(input: {
    sessionId: string;
    actorId: string;
    reason: string;
    sourceType: string;
    sourceId: string;
    evidence: Prisma.InputJsonValue;
  }) {
    await this.db.aiSessionAttention.upsert({
      where: {
        sessionId_actorId_sourceType_sourceId: {
          sessionId: input.sessionId,
          actorId: input.actorId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      create: input,
      update: {
        reason: input.reason,
        evidence: input.evidence,
        status: 'open',
        resolvedAt: null,
        resolvedBy: null,
        resolutionEvidence: Prisma.JsonNull,
        version: { increment: 1 },
      },
    });
    await this.touchConversation(input.sessionId, input.actorId);
  }

  private async resolveAttention(workOrderId: string, actorId: string | null) {
    if (!actorId) return;
    await this.db.aiSessionAttention.updateMany({
      where: {
        actorId,
        sourceType: 'work_order',
        sourceId: workOrderId,
        status: 'open',
      },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: actorId,
        version: { increment: 1 },
      },
    });
  }

  private async touchConversation(
    sessionId: string | null,
    actorId: string | null
  ) {
    if (!sessionId || !actorId) return;
    await this.db.aiSessionWorkState.upsert({
      where: { sessionId },
      create: { sessionId, ownerUserId: actorId },
      update: { lastBusinessAt: new Date(), version: { increment: 1 } },
    });
  }

  private async reopenConversationForNewWork(
    sessionId: string,
    actorId: string
  ) {
    await this.db.aiSessionWorkState.upsert({
      where: { sessionId },
      create: { sessionId, ownerUserId: actorId },
      update: {
        completedAt: null,
        completionReason: null,
        completionRequestKey: null,
        lastBusinessAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  private async completeRecipientConversation(
    workOrderId: string,
    actorId: string | null
  ) {
    if (!actorId) return;
    const binding = await this.db.workOrderSessionBinding.findUnique({
      where: { workOrderId },
    });
    if (!binding || binding.ownerUserId !== actorId) return;
    await this.db.aiSessionWorkState.updateMany({
      where: { sessionId: binding.sessionId, ownerUserId: actorId },
      data: {
        completedAt: new Date(),
        completionReason: 'work_order_terminal',
        completionRequestKey: `work-order-terminal:${workOrderId}`,
        lastBusinessAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  private async releaseSourceConversationIfComplete(
    sessionId: string | null,
    actorId: string | null
  ) {
    if (!sessionId || !actorId) return;
    const outstanding = await this.db.workOrder.count({
      where: {
        sourceSessionId: sessionId,
        senderId: actorId,
        status: { notIn: ['delivered', 'cancelled'] },
      },
    });
    if (outstanding) return;
    const latestDispatch = await this.db.workOrder.findFirst({
      where: {
        sourceSessionId: sessionId,
        senderId: actorId,
        status: 'delivered',
      },
      orderBy: { updatedAt: 'desc' },
      select: { dispatchId: true },
    });
    if (!latestDispatch) return;
    await this.upsertAttention({
      sessionId,
      actorId,
      reason: 'work_order_delivery_ready',
      sourceType: 'work_order_dispatch',
      sourceId: latestDispatch.dispatchId,
      evidence: { complete: true },
    });
  }

  private async isDispatchReleased(dispatchId: string) {
    const blocked = await this.db.workOrder.count({
      where: { dispatchId, status: { notIn: ['delivered', 'cancelled'] } },
    });
    return blocked === 0;
  }

  private async findDeliveryReplay(workOrderId: string, requestKey: string) {
    const revision = await this.db.workOrderDeliveryRevision.findFirst({
      where: {
        workOrderId,
        validationEvidence: { path: ['requestKey'], equals: requestKey },
      },
      include: { items: true },
    });
    if (!revision) return null;
    const order = await this.db.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
    });
    return { order, delivery: revision };
  }

  private async countColumns(actorId: string) {
    const states = await this.db.aiSessionWorkState.findMany({
      where: { ownerUserId: actorId, session: { deletedAt: null } },
      select: {
        completedAt: true,
        session: {
          select: {
            attentions: {
              where: { actorId, status: 'open' },
              select: { id: true },
              take: 1,
            },
            workOrderBinding: {
              select: { workOrder: { select: { status: true } } },
            },
          },
        },
      },
    });
    return states.reduce(
      (counts, state) => {
        if (state.session.attentions.length) counts.todo += 1;
        else if (state.completedAt) counts.done += 1;
        else counts.progress += 1;
        return counts;
      },
      { todo: 0, progress: 0, done: 0 }
    );
  }
}
