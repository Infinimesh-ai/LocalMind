import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { NativeFileCreateService } from '../../core/office/create-service';
import { StorageRuntimeProvider } from '../../core/storage-runtime';
import { WorkOrderJobs } from '../../plugins/copilot/work-order-jobs';
import { WorkOrderStorage } from '../../plugins/copilot/work-order-storage';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;

test.before(async () => {
  app = await createTestingApp();
});

test.beforeEach(async () => {
  await app.initTestingDB();
});

test.after.always(async () => {
  await app.close();
});

const textRequirement = {
  itemKey: 'summary',
  kind: 'text' as const,
  title: 'Summary',
  instructions: 'Return a non-empty private summary.',
  required: true,
  acceptedMimeTypes: [],
  minCount: 1,
  maxCount: 1,
  validationMode: 'non_empty_text' as const,
};

async function fixture() {
  const db = app.get(PrismaClient);
  const [sender, recipientB, recipientC, outsider] = await Promise.all(
    ['sender', 'recipient-b', 'recipient-c', 'outsider'].map(name =>
      db.user.create({
        data: {
          name,
          email: `${name}-${randomUUID()}@example.com`,
          registered: true,
        },
      })
    )
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Source project',
      createdByUserId: sender.id,
      members: { create: { userId: sender.id, role: 'owner' } },
    },
  });
  await db.aiPrompt.create({
    data: {
      name: 'Chat With LocalMind AI',
      action: '',
      model: '',
      optionalModels: [],
      config: {},
    },
  });
  const sourceSession = await db.aiSession.create({
    data: {
      userId: sender.id,
      workspaceId: null,
      selectedContextProjectId: project.id,
      scopeType: 'project',
      promptName: 'Chat With LocalMind AI',
      promptAction: '',
      title: 'Source conversation',
      titleSource: 'auto',
      titleGenerationStatus: 'complete',
      workState: { create: { ownerUserId: sender.id } },
    },
  });
  await db.aiProjectByokConfig.create({
    data: {
      id: 'global',
      revision: 1,
      provider: 'openai',
      encryptedApiKey: 'isolated-test-only',
      modelId: 'isolated-test-model',
      enabled: true,
      workOrderEnabled: true,
      lastValidatedAt: new Date(),
      updatedBy: sender.id,
    },
  });
  return {
    db,
    sender,
    recipientB,
    recipientC,
    outsider,
    project,
    sourceSession,
  };
}

async function dispatchTextOrders(
  sourceSessionId: string,
  senderId: string,
  recipientIds: string[],
  requestKey = `dispatch-${randomUUID()}`
) {
  const prepared = await app.models.copilotWorkOrder.prepareDispatch({
    actorId: senderId,
    sourceSessionId,
    requestKey,
    recipients: recipientIds.map((recipientId, index) => ({
      recipientId,
      title: `Private assignment ${index + 1}`,
      purpose: 'Produce one private delivery.',
      requirements: [textRequirement],
      relationKind: 'original',
      background: { sharedMaterialIds: [] },
    })),
  });
  return app.models.copilotWorkOrder.confirmDispatch({
    actorId: senderId,
    dispatchId: prepared.dispatch.id,
    confirmationToken: prepared.confirmationToken!,
    expectedDraftVersion: prepared.dispatch.draftVersion,
    requestKey: `confirm-${requestKey}`,
  });
}

test.serial(
  'personal work orders isolate recipients, gate partial results and adopt immutable complete revisions once',
  async t => {
    const { db, sender, recipientB, recipientC, outsider, sourceSession } =
      await fixture();
    const dispatch = await dispatchTextOrders(sourceSession.id, sender.id, [
      recipientB.id,
      recipientC.id,
    ]);
    const orderB = dispatch.orders.find(
      order => order.recipientId === recipientB.id
    )!;
    const orderC = dispatch.orders.find(
      order => order.recipientId === recipientC.id
    )!;

    for (const order of [orderB, orderC]) {
      const session = await db.aiSession.findUniqueOrThrow({
        where: { id: order.sessionBinding!.sessionId },
      });
      t.is(session.scopeType, 'work_order');
      t.is(session.workspaceId, null);
      t.is(session.selectedContextProjectId, null);
      t.false(session.allowMemoryCapture);
    }
    t.is(
      await db.aiContextProjectMember.count({
        where: { userId: { in: [recipientB.id, recipientC.id] } },
      }),
      0
    );
    t.is(
      await db.workspaceMember.count({
        where: { userId: { in: [recipientB.id, recipientC.id] } },
      }),
      0
    );
    await t.throwsAsync(
      app.models.copilotWorkOrder.getOwned(orderB.id, outsider.id)
    );

    const deliveredB = await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: orderB.id,
      actorId: recipientB.id,
      expectedVersion: orderB.version,
      requestKey: 'delivery-b-v1',
      items: [
        {
          requirementId: orderB.requirements[0].id,
          blobIds: [],
          text: 'Recipient B private result',
        },
      ],
    });
    const senderBeforeComplete = await app.models.copilotWorkOrder.getOwned(
      orderB.id,
      sender.id
    );
    t.false(senderBeforeComplete.deliveryProgress.released);
    t.is(senderBeforeComplete.deliveries.length, 0);
    await t.throwsAsync(
      app.models.copilotWorkOrder.adoptDeliveries({
        actorId: sender.id,
        sourceSessionId: sourceSession.id,
        expectedContextVersion: sourceSession.contextEpoch,
        requestKey: 'adopt-too-early',
        revisions: [
          {
            workOrderId: orderB.id,
            deliveryRevisionId: deliveredB.delivery.id,
          },
        ],
      })
    );

    const deliveredC = await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: orderC.id,
      actorId: recipientC.id,
      expectedVersion: orderC.version,
      requestKey: 'delivery-c-v1',
      items: [
        {
          requirementId: orderC.requirements[0].id,
          blobIds: [],
          text: 'Recipient C private result',
        },
      ],
    });
    const senderAfterComplete = await app.models.copilotWorkOrder.getOwned(
      orderB.id,
      sender.id
    );
    t.true(senderAfterComplete.deliveryProgress.released);
    t.is(senderAfterComplete.deliveries.length, 1);

    const revisions = [
      {
        workOrderId: orderB.id,
        deliveryRevisionId: deliveredB.delivery.id,
      },
      {
        workOrderId: orderC.id,
        deliveryRevisionId: deliveredC.delivery.id,
      },
    ];
    const adoption = await app.models.copilotWorkOrder.adoptDeliveries({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      expectedContextVersion: sourceSession.contextEpoch,
      requestKey: 'adopt-complete-v1',
      revisions,
    });
    const replay = await app.models.copilotWorkOrder.adoptDeliveries({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      expectedContextVersion: sourceSession.contextEpoch,
      requestKey: 'adopt-complete-v1',
      revisions,
    });
    t.is(replay.id, adoption.id);
    t.is(
      (
        await db.aiSession.findUniqueOrThrow({
          where: { id: sourceSession.id },
        })
      ).contextEpoch,
      sourceSession.contextEpoch + 1
    );
    const workState = await db.aiSessionWorkState.findUniqueOrThrow({
      where: { sessionId: sourceSession.id },
    });
    const completed = await app.models.copilotWorkOrder.completeConversation({
      actorId: sender.id,
      sessionId: sourceSession.id,
      expectedVersion: workState.version,
      requestKey: 'complete-source-once',
    });
    const completionReplay =
      await app.models.copilotWorkOrder.completeConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        expectedVersion: workState.version,
        requestKey: 'complete-source-once',
      });
    t.is(completionReplay.version, completed.version);
    t.truthy(completed.completedAt);
    const reopened =
      await app.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
        sourceSession.id,
        sender.id
      );
    t.is(reopened?.completedAt, null);
    t.is(reopened?.completionRequestKey, null);

    const graphB = await app.models.copilotWorkOrder.collaborationGraph(
      recipientB.id
    );
    t.deepEqual(
      graphB.edges.map(edge => edge.id),
      [orderB.id]
    );
    t.is(graphB.edges[0].from, recipientB.id);
    t.is(graphB.edges[0].to, sender.id);
    t.deepEqual(
      await app.models.copilotWorkOrder.collaborationGraph(outsider.id),
      { nodes: [], edges: [], truncated: false }
    );

    let outboxDeliveries = 0;
    while (
      outboxDeliveries < 20 &&
      (await app.models.copilotWorkOrder.deliverNextOutboxEvent())
    ) {
      outboxDeliveries += 1;
    }
    t.true(outboxDeliveries >= 4);
    t.is(
      await db.notification.count({ where: { type: 'WorkOrder' } }),
      outboxDeliveries
    );
    t.false(await app.models.copilotWorkOrder.deliverNextOutboxEvent());
  }
);

test.serial(
  'question, refusal, explicit withdrawal, feature disable and manual-title races preserve authoritative state',
  async t => {
    const { db, sender, recipientB, sourceSession } = await fixture();
    const dispatch = await dispatchTextOrders(sourceSession.id, sender.id, [
      recipientB.id,
    ]);
    const order = dispatch.orders[0];
    const asked = await app.models.copilotWorkOrder.ask({
      workOrderId: order.id,
      actorId: recipientB.id,
      body: 'Which reporting period should I use?',
      expectedVersion: order.version,
      requestKey: 'question-1',
    });
    t.is(asked.order.status, 'waiting_sender');
    await t.throwsAsync(
      app.models.copilotWorkOrder.completeConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        expectedVersion: 2,
        requestKey: 'complete-with-open-question',
      })
    );
    const answered = await app.models.copilotWorkOrder.answer({
      workOrderId: order.id,
      actorId: sender.id,
      body: 'Use the current quarter.',
      expectedVersion: asked.order.version,
      requestKey: 'answer-1',
    });
    t.is(answered.order.status, 'open');
    await t.throwsAsync(
      app.models.copilotWorkOrder.refuse({
        workOrderId: order.id,
        actorId: recipientB.id,
        reason: ' ',
        expectedVersion: answered.order.version,
        requestKey: 'refuse-empty',
      })
    );
    const refused = await app.models.copilotWorkOrder.refuse({
      workOrderId: order.id,
      actorId: recipientB.id,
      reason: 'The required source is unavailable.',
      expectedVersion: answered.order.version,
      requestKey: 'refuse-1',
    });
    t.is(refused.order.status, 'refused');
    await t.throwsAsync(
      app.models.copilotWorkOrder.completeConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        expectedVersion: 4,
        requestKey: 'complete-with-refusal',
      })
    );
    const cancelled = await app.models.copilotWorkOrder.cancel({
      workOrderId: order.id,
      actorId: sender.id,
      reason: 'Close the refused item.',
      expectedVersion: refused.order.version,
      requestKey: 'withdraw-refusal-1',
    });
    const cancelReplay = await app.models.copilotWorkOrder.cancel({
      workOrderId: order.id,
      actorId: sender.id,
      reason: 'Close the refused item.',
      expectedVersion: refused.order.version,
      requestKey: 'withdraw-refusal-1',
    });
    t.is(cancelled.order.status, 'cancelled');
    t.is(cancelReplay.exchange.id, cancelled.exchange.id);

    await db.aiProjectByokConfig.update({
      where: { id: 'global' },
      data: { workOrderEnabled: false },
    });
    await t.throwsAsync(
      app.models.copilotWorkOrder.prepareDispatch({
        actorId: sender.id,
        sourceSessionId: sourceSession.id,
        requestKey: 'disabled-new-dispatch',
        recipients: [
          {
            recipientId: recipientB.id,
            title: 'Must stay disabled',
            purpose: 'This must not be created.',
            requirements: [textRequirement],
          },
        ],
      }),
      { message: /disabled by the instance administrator/ }
    );
    t.is(
      (await app.models.copilotWorkOrder.getOwned(order.id, sender.id)).status,
      'cancelled'
    );

    await db.aiSession.update({
      where: { id: sourceSession.id },
      data: {
        title: 'Late generated title',
        titleSource: 'auto',
        titleRevision: 2,
      },
    });
    const manual = await app.models.copilotWorkOrder.renameConversation({
      actorId: sender.id,
      sessionId: sourceSession.id,
      title: 'Manual authoritative title',
      expectedRevision: 1,
    });
    t.is(manual.title, 'Manual authoritative title');
    t.is(manual.titleSource, 'manual');
    await t.throwsAsync(
      app.models.copilotWorkOrder.renameConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        title: 'Stale competing manual title',
        expectedRevision: 2,
      })
    );
  }
);

test.serial(
  'exact recipient resolution, refusal gating, cancellation notification and terminal private chat stay isolated',
  async t => {
    const { db, sender, recipientB, recipientC, outsider, sourceSession } =
      await fixture();
    t.is(
      (
        await app.models.copilotWorkOrder.resolveRecipient({
          actorId: sender.id,
          exact: recipientB.email.toUpperCase(),
        })
      ).id,
      recipientB.id
    );
    await db.user.update({
      where: { id: outsider.id },
      data: { disabled: true },
    });
    await t.throwsAsync(
      app.models.copilotWorkOrder.resolveRecipient({
        actorId: sender.id,
        exact: outsider.email,
      }),
      { message: /unavailable/ }
    );
    await t.throwsAsync(
      app.models.copilotWorkOrder.resolveRecipient({
        actorId: sender.id,
        exact: 'off-instance@example.invalid',
      }),
      { message: /unavailable/ }
    );

    const dispatch = await dispatchTextOrders(sourceSession.id, sender.id, [
      recipientB.id,
      recipientC.id,
    ]);
    const orderB = dispatch.orders.find(
      order => order.recipientId === recipientB.id
    )!;
    const orderC = dispatch.orders.find(
      order => order.recipientId === recipientC.id
    )!;
    const refused = await app.models.copilotWorkOrder.refuse({
      workOrderId: orderB.id,
      actorId: recipientB.id,
      reason: 'Required source access is unavailable.',
      expectedVersion: orderB.version,
      requestKey: 'multi-recipient-refusal',
    });
    await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: orderC.id,
      actorId: recipientC.id,
      expectedVersion: orderC.version,
      requestKey: 'multi-recipient-c-delivery',
      items: [
        {
          requirementId: orderC.requirements[0].id,
          blobIds: [],
          text: 'C completed independently.',
        },
      ],
    });
    const gated = await app.models.copilotWorkOrder.getOwned(
      orderC.id,
      sender.id
    );
    t.false(gated.deliveryProgress.released);
    t.is(gated.deliveries.length, 0);
    await t.throwsAsync(
      app.models.copilotWorkOrder.completeConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        expectedVersion: 3,
        requestKey: 'refusal-still-unresolved',
      }),
      { message: /unresolved work/ }
    );

    const cancelled = await app.models.copilotWorkOrder.cancel({
      workOrderId: orderB.id,
      actorId: sender.id,
      reason: 'Withdraw after the documented refusal.',
      expectedVersion: refused.order.version,
      requestKey: 'cancel-refused-order',
    });
    const replay = await app.models.copilotWorkOrder.cancel({
      workOrderId: orderB.id,
      actorId: sender.id,
      reason: 'Withdraw after the documented refusal.',
      expectedVersion: refused.order.version,
      requestKey: 'cancel-refused-order',
    });
    t.is(replay.exchange.id, cancelled.exchange.id);
    t.true(
      (await app.models.copilotWorkOrder.getOwned(orderC.id, sender.id))
        .deliveryProgress.released
    );
    t.is(
      await db.workOrderOutbox.count({
        where: {
          workOrderId: orderB.id,
          topic: 'work-order.cancelled',
          recipientId: recipientB.id,
        },
      }),
      1
    );

    // The durable outbox remains pending while the client/worker is absent.
    t.is(
      await db.notification.count({
        where: { userId: recipientB.id, type: 'WorkOrder' },
      }),
      0
    );
    let delivered = 0;
    while (
      delivered < 20 &&
      (await app.models.copilotWorkOrder.deliverNextOutboxEvent())
    )
      delivered += 1;
    const cancellationNotifications = await db.notification.findMany({
      where: { userId: recipientB.id, type: 'WorkOrder' },
    });
    t.is(
      cancellationNotifications.filter(notification =>
        JSON.stringify(notification.body).includes('work-order.cancelled')
      ).length,
      1
    );
    t.false(await app.models.copilotWorkOrder.deliverNextOutboxEvent());

    const binding = await db.workOrderSessionBinding.findUniqueOrThrow({
      where: { workOrderId: orderB.id },
    });
    await app.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
      binding.sessionId,
      recipientB.id
    );
    t.is(
      (await db.workOrder.findUniqueOrThrow({ where: { id: orderB.id } }))
        .status,
      'cancelled'
    );
    t.is(
      (
        await db.aiSessionWorkState.findUniqueOrThrow({
          where: { sessionId: binding.sessionId },
        })
      ).completedAt,
      null
    );
  }
);

test.serial(
  'delivery revisions stay immutable, adoption advances only explicitly and supplements create independent sessions',
  async t => {
    const { db, sender, recipientB, project, sourceSession } = await fixture();
    const originalDispatch = await dispatchTextOrders(
      sourceSession.id,
      sender.id,
      [recipientB.id],
      'immutable-original'
    );
    const original = originalDispatch.orders[0];
    const v1 = await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: original.id,
      actorId: recipientB.id,
      expectedVersion: original.version,
      requestKey: 'immutable-v1',
      items: [
        {
          requirementId: original.requirements[0].id,
          blobIds: [],
          text: 'Immutable version one',
        },
      ],
    });
    const adoptionV1 = await app.models.copilotWorkOrder.adoptDeliveries({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      expectedContextVersion: 1,
      requestKey: 'adopt-immutable-v1',
      revisions: [
        { workOrderId: original.id, deliveryRevisionId: v1.delivery.id },
      ],
    });
    const adoptedSource = await db.aiSessionContextSource.findFirstOrThrow({
      where: {
        sessionId: sourceSession.id,
        workOrderId: original.id,
        kind: 'work_order_delivery',
      },
    });
    t.is(adoptedSource.sourceId, `${v1.delivery.id}@1`);
    await t.throwsAsync(
      app.models.copilotContext.withProjectSourcesShared(
        {
          actorId: sender.id,
          sessionId: sourceSession.id,
          projectId: project.id,
          sink: {
            type: 'project_memory',
            id: 'must-not-share-private-delivery',
            projectId: project.id,
            phase: 'prepare',
          },
        },
        async () => 'must not run'
      ),
      { message: /private or unverified sources/ }
    );
    await t.throwsAsync(
      app.models.copilotWorkOrder.submitDelivery({
        workOrderId: original.id,
        actorId: recipientB.id,
        expectedVersion: v1.order.version,
        requestKey: 'abandoned-invalid-v2',
        items: [
          {
            requirementId: original.requirements[0].id,
            blobIds: [],
            text: '   ',
          },
        ],
      }),
      { message: /Missing required text/ }
    );
    t.is(
      await db.workOrderDeliveryRevision.count({
        where: { workOrderId: original.id },
      }),
      1
    );
    const v2 = await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: original.id,
      actorId: recipientB.id,
      expectedVersion: v1.order.version,
      requestKey: 'immutable-v2',
      items: [
        {
          requirementId: original.requirements[0].id,
          blobIds: [],
          text: 'Immutable version two',
        },
      ],
    });
    t.is(v2.delivery.revision, 2);
    t.is(
      (
        await db.workOrderAdoption.findUniqueOrThrow({
          where: { id: adoptionV1.id },
          include: { items: true },
        })
      ).items[0].deliveryRevisionId,
      v1.delivery.id
    );
    t.is(
      (
        await db.aiSession.findUniqueOrThrow({
          where: { id: sourceSession.id },
        })
      ).contextEpoch,
      2
    );
    await app.models.copilotWorkOrder.adoptDeliveries({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      expectedContextVersion: 2,
      requestKey: 'adopt-immutable-v2',
      revisions: [
        { workOrderId: original.id, deliveryRevisionId: v2.delivery.id },
      ],
    });
    const materialized = await app
      .get(WorkOrderStorage)
      .materializeAdoptedContext({
        actorId: sender.id,
        sourceSessionId: sourceSession.id,
      });
    t.truthy(materialized);
    t.true(materialized!.content.includes('Immutable version two'));
    t.false(materialized!.content.includes('Immutable version one'));
    t.is(
      (
        await db.aiSession.findUniqueOrThrow({
          where: { id: sourceSession.id },
        })
      ).contextEpoch,
      3
    );
    t.is(
      await db.aiContextMemory.count({ where: { projectId: project.id } }),
      0
    );

    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'supplement-dispatch',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Supplemental evidence',
          purpose: 'Provide an independent supplement.',
          requirements: [textRequirement],
          relationKind: 'supplement',
          relatedWorkOrderId: original.id,
          background: { sharedMaterialIds: [] },
        },
      ],
    });
    const supplemented = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: prepared.dispatch.id,
      confirmationToken: prepared.confirmationToken!,
      expectedDraftVersion: prepared.dispatch.draftVersion,
      requestKey: 'supplement-confirm',
    });
    const supplement = supplemented.orders[0];
    t.not(supplement.id, original.id);
    t.not(
      supplement.sessionBinding?.sessionId,
      original.sessionBinding?.sessionId
    );
    t.is(supplement.relatedWorkOrderId, original.id);
    t.is(supplement.relationKind, 'supplement');
    t.is(
      (await db.workOrder.findUniqueOrThrow({ where: { id: original.id } }))
        .status,
      'delivered'
    );
  }
);

test.serial(
  'conversation completion and dispatch confirmation serialize without losing new obligations',
  async t => {
    const { db, sender, recipientB, sourceSession } = await fixture();
    const completed = await app.models.copilotWorkOrder.completeConversation({
      actorId: sender.id,
      sessionId: sourceSession.id,
      expectedVersion: 1,
      requestKey: 'complete-before-race',
    });
    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'complete-dispatch-race',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Concurrent obligation',
          purpose: 'The new obligation must not be hidden by completion.',
          requirements: [textRequirement],
        },
      ],
    });
    await Promise.allSettled([
      app.models.copilotWorkOrder.confirmDispatch({
        actorId: sender.id,
        dispatchId: prepared.dispatch.id,
        confirmationToken: prepared.confirmationToken!,
        expectedDraftVersion: prepared.dispatch.draftVersion,
        requestKey: 'confirm-complete-dispatch-race',
      }),
      app.models.copilotWorkOrder.completeConversation({
        actorId: sender.id,
        sessionId: sourceSession.id,
        expectedVersion: completed.version,
        requestKey: 'competing-completion',
      }),
    ]);
    t.is(
      await db.workOrder.count({
        where: { sourceSessionId: sourceSession.id, status: 'open' },
      }),
      1
    );
    t.is(
      (
        await db.aiSessionWorkState.findUniqueOrThrow({
          where: { sessionId: sourceSession.id },
        })
      ).completedAt,
      null
    );
  }
);

test.serial(
  'conversation cards preserve independent attention reasons and only a successful new message reopens completion',
  async t => {
    const { db, sender, recipientB, project, sourceSession } = await fixture();
    const firstDispatch = await dispatchTextOrders(
      sourceSession.id,
      sender.id,
      [recipientB.id],
      'multi-attention-delivery'
    );
    const deliveredOrder = firstDispatch.orders[0];
    await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: deliveredOrder.id,
      actorId: recipientB.id,
      expectedVersion: deliveredOrder.version,
      requestKey: 'multi-attention-delivery-v1',
      items: [
        {
          requirementId: deliveredOrder.requirements[0].id,
          blobIds: [],
          text: 'First result is ready for adoption.',
        },
      ],
    });
    const secondDispatch = await dispatchTextOrders(
      sourceSession.id,
      sender.id,
      [recipientB.id],
      'multi-attention-question'
    );
    const questionedOrder = secondDispatch.orders[0];
    const asked = await app.models.copilotWorkOrder.ask({
      workOrderId: questionedOrder.id,
      actorId: recipientB.id,
      body: 'Which period should this cover?',
      expectedVersion: questionedOrder.version,
      requestKey: 'multi-attention-question-v1',
    });
    const todoCard = (
      await app.models.copilotWorkOrder.listCards({
        actorId: sender.id,
        column: 'todo',
        first: 30,
      })
    ).items.find(card => card.sessionId === sourceSession.id);
    t.truthy(todoCard);
    t.deepEqual(todoCard!.attentionReasons.toSorted(), [
      'work_order_delivery_ready',
      'work_order_question',
    ]);

    await app.models.copilotWorkOrder.answer({
      workOrderId: questionedOrder.id,
      actorId: sender.id,
      body: 'Use the current quarter.',
      expectedVersion: asked.order.version,
      requestKey: 'multi-attention-answer-v1',
    });
    const remainingReasons = await db.aiSessionAttention.findMany({
      where: {
        sessionId: sourceSession.id,
        actorId: sender.id,
        status: 'open',
      },
      select: { reason: true },
    });
    t.deepEqual(
      remainingReasons.map(item => item.reason),
      ['work_order_delivery_ready']
    );
    await app.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
      sourceSession.id,
      sender.id
    );
    t.is(
      await db.aiSessionAttention.count({
        where: {
          sessionId: sourceSession.id,
          actorId: sender.id,
          status: 'open',
          reason: 'work_order_delivery_ready',
        },
      }),
      1
    );

    const isolatedSession = await db.aiSession.create({
      data: {
        userId: sender.id,
        workspaceId: null,
        selectedContextProjectId: project.id,
        scopeType: 'project',
        promptName: 'Chat With LocalMind AI',
        promptAction: '',
        title: 'Completion projection',
        titleSource: 'manual',
        titleGenerationStatus: 'complete',
        workState: { create: { ownerUserId: sender.id } },
      },
    });
    const completed = await app.models.copilotWorkOrder.completeConversation({
      actorId: sender.id,
      sessionId: isolatedSession.id,
      expectedVersion: 1,
      requestKey: 'completion-projection-v1',
    });
    const cardsBefore = await app.models.copilotWorkOrder.listCards({
      actorId: sender.id,
      column: 'done',
      first: 30,
    });
    t.true(
      cardsBefore.items.some(card => card.sessionId === isolatedSession.id)
    );
    const afterViewing = await db.aiSessionWorkState.findUniqueOrThrow({
      where: { sessionId: isolatedSession.id },
    });
    t.is(afterViewing.version, completed.version);
    t.deepEqual(afterViewing.completedAt, completed.completedAt);

    await app.models.copilotWorkOrder.reopenAfterSuccessfulMessage(
      isolatedSession.id,
      sender.id
    );
    const afterMessage = await db.aiSessionWorkState.findUniqueOrThrow({
      where: { sessionId: isolatedSession.id },
    });
    t.is(afterMessage.completedAt, null);
    t.true(
      (
        await app.models.copilotWorkOrder.listCards({
          actorId: sender.id,
          column: 'progress',
          first: 30,
        })
      ).items.some(card => card.sessionId === isolatedSession.id)
    );
  }
);

test.serial(
  'real private PPTX staging validates containers, replays once and records work-order runtime evidence',
  async t => {
    const { db, sender, recipientB, outsider, sourceSession } = await fixture();
    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'pptx-dispatch',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Create a private deck',
          purpose: 'Return a real PPTX container.',
          requirements: [
            {
              itemKey: 'deck',
              kind: 'file',
              title: 'Deck',
              instructions: 'Create a readable PPTX.',
              required: true,
              acceptedMimeTypes: [
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              ],
              minCount: 1,
              maxCount: 1,
              validationMode: 'mime_and_container',
            },
          ],
        },
      ],
    });
    const dispatch = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: prepared.dispatch.id,
      confirmationToken: prepared.confirmationToken!,
      expectedDraftVersion: prepared.dispatch.draftVersion,
      requestKey: 'pptx-confirm',
    });
    const order = dispatch.orders[0];
    const file = {
      title: 'private-result',
      content: {
        format: 'pptx' as const,
        slides: [
          {
            title: 'LocalMind v9',
            paragraphs: ['Private delivery', 'Immutable receipt'],
          },
        ],
      },
    };
    const generated = app.get(NativeFileCreateService).generatePrivate(file);
    const storage = app.get(WorkOrderStorage);
    const generationInput = {
      workOrderId: order.id,
      actorId: recipientB.id,
      sessionId: order.sessionBinding!.sessionId,
      requirementId: order.requirements[0].id,
      requestKey: 'agent-file-stable-call',
      title: 'Generate private-result.pptx',
      file,
    };
    const queued = await storage.queuePrivateFileGeneration(generationInput);
    const crashedLease =
      await app.models.copilotWorkOrderAgentRuntime.acquirePrivateFile({
        workOrderId: order.id,
        runId: queued.id,
        workerLeaseId: 'crashed-worker',
        leaseMs: 100,
      });
    t.truthy(crashedLease);
    await new Promise(resolve => setTimeout(resolve, 120));
    await app.get(WorkOrderJobs).runPrivateFileGeneration({
      workOrderId: order.id,
      runId: queued.id,
    });
    const replay = await storage.queuePrivateFileGeneration(generationInput);
    t.is(replay.id, queued.id);
    await app.get(WorkOrderJobs).runPrivateFileGeneration({
      workOrderId: order.id,
      runId: queued.id,
    });
    const blob = await db.workOrderBlob.findUniqueOrThrow({
      where: {
        workOrderId_requestKey: {
          workOrderId: order.id,
          requestKey: generationInput.requestKey,
        },
      },
    });
    t.is(await db.workOrderBlob.count({ where: { workOrderId: order.id } }), 1);
    t.is(await db.aiAgentRun.count({ where: { workOrderId: order.id } }), 1);
    t.is(await db.aiAgentStep.count({ where: { workOrderId: order.id } }), 1);
    const completedRun = await db.aiAgentRun.findUniqueOrThrow({
      where: { id: queued.id },
    });
    t.is(completedRun.status, 'completed');
    t.is(completedRun.workerAttempt, 2);
    t.true(
      (await db.aiAgentTimelineEvent.count({
        where: { workOrderId: order.id },
      })) > 2
    );
    t.is(
      await db.aiAgentRuntimeExecutionResult.count({
        where: { workOrderId: order.id },
      }),
      1
    );
    await t.throwsAsync(
      storage.stage({
        workOrderId: order.id,
        actorId: recipientB.id,
        requirementId: order.requirements[0].id,
        requestKey: 'damaged-pptx',
        fileName: generated.fileName,
        mimeType: generated.mimeType,
        bytes: Buffer.from('not a zip container'),
      }),
      { message: /container is unreadable or damaged/ }
    );
    await t.throwsAsync(
      storage.read({
        workOrderId: order.id,
        blobId: blob.id,
        actorId: outsider.id,
      })
    );
    const delivered = await app.models.copilotWorkOrder.submitDelivery({
      workOrderId: order.id,
      actorId: recipientB.id,
      expectedVersion: order.version,
      requestKey: 'pptx-delivery-v1',
      items: [
        {
          requirementId: order.requirements[0].id,
          blobIds: [blob.id],
        },
      ],
    });
    t.is(delivered.order.status, 'delivered');
    const downloaded = await storage.read({
      workOrderId: order.id,
      blobId: blob.id,
      actorId: sender.id,
    });
    t.deepEqual(downloaded.bytes, generated.bytes);
  }
);

test.serial(
  'expired private drafts are physically cleaned while legal hold freezes scheduled and account cleanup',
  async t => {
    const { db, sender, recipientB, sourceSession } = await fixture();
    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'cleanup-dispatch',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Private draft cleanup',
          purpose: 'Validate expiring private payload cleanup.',
          requirements: [
            {
              itemKey: 'draft',
              kind: 'file',
              title: 'Draft text',
              instructions: 'Create a private text draft.',
              required: true,
              acceptedMimeTypes: ['text/plain'],
              minCount: 1,
              maxCount: 1,
              validationMode: 'mime_and_container',
            },
          ],
        },
      ],
    });
    const dispatch = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: prepared.dispatch.id,
      confirmationToken: prepared.confirmationToken!,
      expectedDraftVersion: prepared.dispatch.draftVersion,
      requestKey: 'cleanup-confirm',
    });
    const order = dispatch.orders[0];
    const requirementId = order.requirements[0].id;
    const storage = app.get(WorkOrderStorage);
    await t.throwsAsync(
      storage.stage({
        workOrderId: order.id,
        actorId: recipientB.id,
        requirementId,
        requestKey: 'empty-private-text',
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        bytes: Buffer.from('  '),
      }),
      { message: /cannot be empty/ }
    );
    const expired = await storage.stage({
      workOrderId: order.id,
      actorId: recipientB.id,
      requirementId,
      requestKey: 'expired-private-text',
      fileName: 'expired.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('expired private draft'),
    });
    await db.workOrderBlob.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    t.is(await storage.cleanupExpired(), 1);
    t.is(
      (await db.workOrderBlob.findUniqueOrThrow({ where: { id: expired.id } }))
        .status,
      'deleted'
    );
    const removedObject = await app
      .get(StorageRuntimeProvider)
      .getObject(
        'blob',
        `work-orders/${encodeURIComponent(order.id)}/${expired.key}`
      );
    t.falsy(removedObject.body);

    const held = await storage.stage({
      workOrderId: order.id,
      actorId: recipientB.id,
      requirementId,
      requestKey: 'held-private-text',
      fileName: 'held.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('held private draft'),
    });
    await db.workOrderBlob.update({
      where: { id: held.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await db.localMindLogPolicy.create({
      data: { id: 'default', legalHold: true },
    });
    t.is(await storage.cleanupExpired(), 0);
    t.is(await storage.cleanupUserStagedBlobs(recipientB.id), 0);
    t.is(
      (await db.workOrderBlob.findUniqueOrThrow({ where: { id: held.id } }))
        .status,
      'staged'
    );
    await db.localMindLogPolicy.update({
      where: { id: 'default' },
      data: { legalHold: false },
    });
    t.is(await storage.cleanupExpired(), 1);
    t.is(
      (await db.workOrderBlob.findUniqueOrThrow({ where: { id: held.id } }))
        .status,
      'deleted'
    );
  }
);

test.serial(
  'bounded projections page 1000 historical conversations and truncate 500 relationship edges without merging same-person orders',
  async t => {
    const { db, sender, recipientB, project, sourceSession } = await fixture();
    const sessionRows = Array.from({ length: 1_000 }, (_, index) => ({
      id: randomUUID(),
      userId: sender.id,
      workspaceId: null,
      selectedContextProjectId: project.id,
      scopeType: 'project',
      promptName: 'Chat With LocalMind AI',
      promptAction: '',
      title: `历史会话 ${String(index).padStart(4, '0')} — 超长中文标题用于验证稳定分页`,
      titleSource: 'manual',
      titleGenerationStatus: 'complete',
    }));
    await db.aiSession.createMany({ data: sessionRows });
    await db.aiSessionWorkState.createMany({
      data: sessionRows.map((session, index) => ({
        sessionId: session.id,
        ownerUserId: sender.id,
        lastBusinessAt: new Date(Date.now() - index * 1_000),
      })),
    });
    const cardsStartedAt = performance.now();
    const cards = await app.models.copilotWorkOrder.listCards({
      actorId: sender.id,
      first: 30,
    });
    const cardsElapsedMs = performance.now() - cardsStartedAt;
    t.is(cards.items.length, 30);
    t.true(cards.pageInfo.hasNextPage);
    t.truthy(cards.pageInfo.endCursor);
    t.is(cards.counts.progress, 1_001);

    const dispatch = await db.workOrderDispatch.create({
      data: {
        sourceSessionId: sourceSession.id,
        senderId: sender.id,
        status: 'confirmed',
        draftFingerprint: 'd'.repeat(64),
        draft: {},
        requestKey: 'scale-graph-dispatch',
        confirmationHash: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        confirmedAt: new Date(),
      },
    });
    const graphSessions = Array.from({ length: 501 }, (_, index) => ({
      id: randomUUID(),
      userId: recipientB.id,
      workspaceId: null,
      selectedContextProjectId: null,
      scopeType: 'work_order',
      promptName: 'Chat With LocalMind AI',
      promptAction: '',
      title: `Same-recipient work order ${index}`,
      titleSource: 'manual',
      titleGenerationStatus: 'complete',
      allowMemoryCapture: false,
    }));
    const orders = graphSessions.map((_, index) => ({
      id: randomUUID(),
      dispatchId: dispatch.id,
      sourceSessionId: sourceSession.id,
      senderId: sender.id,
      recipientId: recipientB.id,
      relationKind: 'original',
      title: `Same-recipient edge ${index}`,
      purpose: 'Scale projection evidence',
      requirementsFingerprint: 'r'.repeat(64),
      background: {},
    }));
    await db.$transaction(async tx => {
      await tx.aiSession.createMany({ data: graphSessions });
      await tx.aiSessionWorkState.createMany({
        data: graphSessions.map(session => ({
          sessionId: session.id,
          ownerUserId: recipientB.id,
        })),
      });
      await tx.workOrder.createMany({ data: orders });
      await tx.workOrderSessionBinding.createMany({
        data: orders.map((order, index) => ({
          workOrderId: order.id,
          sessionId: graphSessions[index].id,
          ownerUserId: recipientB.id,
          ownerUserIdSnapshot: recipientB.id,
        })),
      });
    });
    const graphStartedAt = performance.now();
    const graph = await app.models.copilotWorkOrder.collaborationGraph(
      sender.id
    );
    const graphElapsedMs = performance.now() - graphStartedAt;
    t.is(graph.edges.length, 500);
    t.true(graph.truncated);
    t.is(new Set(graph.edges.map(edge => edge.id)).size, 500);
    t.is(graph.nodes.length, 2);
    t.log({ cardsElapsedMs, graphElapsedMs });
  }
);

test.serial(
  'database rejects mixed ownership and account deletion removes private payload while preserving counterpart evidence',
  async t => {
    const { db, sender, recipientB, project, sourceSession } = await fixture();
    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'deletion-dispatch',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Deletion boundary',
          purpose: 'Exercise private payload cleanup.',
          requirements: [
            {
              itemKey: 'private-text',
              kind: 'file',
              title: 'Private text',
              instructions: 'Create a private text file.',
              required: true,
              acceptedMimeTypes: ['text/plain'],
              minCount: 1,
              maxCount: 1,
              validationMode: 'mime_and_container',
            },
          ],
        },
      ],
    });
    const dispatch = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: prepared.dispatch.id,
      confirmationToken: prepared.confirmationToken!,
      expectedDraftVersion: prepared.dispatch.draftVersion,
      requestKey: 'deletion-confirm',
    });
    const order = dispatch.orders[0];
    const storage = app.get(WorkOrderStorage);
    const queued = await storage.queuePrivateFileGeneration({
      workOrderId: order.id,
      actorId: recipientB.id,
      sessionId: order.sessionBinding!.sessionId,
      requirementId: order.requirements[0].id,
      requestKey: 'deletion-private-file',
      title: 'Generate private.txt',
      file: {
        title: 'private',
        content: { format: 'txt', text: 'private recipient payload' },
      },
    });
    await app.get(WorkOrderJobs).runPrivateFileGeneration({
      workOrderId: order.id,
      runId: queued.id,
    });
    const blob = await db.workOrderBlob.findUniqueOrThrow({
      where: {
        workOrderId_requestKey: {
          workOrderId: order.id,
          requestKey: 'deletion-private-file',
        },
      },
    });
    const run = await db.aiAgentRun.findFirstOrThrow({
      where: { workOrderId: order.id },
    });
    await t.throwsAsync(
      db.aiAgentRun.update({
        where: { id: run.id },
        data: { projectId: project.id },
      })
    );
    await t.throwsAsync(
      db.aiSession.create({
        data: {
          userId: recipientB.id,
          workspaceId: null,
          selectedContextProjectId: project.id,
          scopeType: 'work_order',
          promptName: 'Chat With LocalMind AI',
          promptAction: '',
        },
      })
    );

    await db.user.delete({ where: { id: recipientB.id } });
    const retained = await db.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { events: true, sessionBinding: true },
    });
    t.is(retained.recipientId, null);
    t.is(retained.status, 'cancelled');
    t.is(retained.terminalReason, 'account_deleted');
    t.is(retained.sessionBinding, null);
    t.true(
      retained.events.some(
        event => event.eventType === 'participant_account_deleted'
      )
    );
    t.is(await db.aiAgentRun.count({ where: { workOrderId: order.id } }), 0);
    const cleanedBlob = await db.workOrderBlob.findUniqueOrThrow({
      where: { id: blob.id },
    });
    t.is(cleanedBlob.ownerId, null);
    t.is(cleanedBlob.status, 'deleted');
    let consumed = 0;
    while (
      consumed < 10 &&
      (await app.models.copilotWorkOrder.deliverNextOutboxEvent())
    ) {
      consumed += 1;
    }
    t.true(consumed >= 2);
    t.false(await app.models.copilotWorkOrder.deliverNextOutboxEvent());
    t.true(
      (await db.notification.count({
        where: { userId: sender.id, type: 'WorkOrder' },
      })) >= 1
    );
  }
);

test.serial(
  'cancellation stops only the active work-order run and rejects its late write',
  async t => {
    const { db, sender, recipientB, sourceSession } = await fixture();
    const prepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey: 'cancel-active-run-dispatch',
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Cancelable private file',
          purpose:
            'Prove an active private worker cannot publish after cancel.',
          requirements: [
            {
              itemKey: 'private-text',
              kind: 'file',
              title: 'Private text',
              instructions: 'Create a text file.',
              required: true,
              acceptedMimeTypes: ['text/plain'],
              minCount: 1,
              maxCount: 1,
              validationMode: 'mime_and_container',
            },
          ],
        },
      ],
    });
    const dispatch = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: prepared.dispatch.id,
      confirmationToken: prepared.confirmationToken!,
      expectedDraftVersion: prepared.dispatch.draftVersion,
      requestKey: 'cancel-active-run-confirm',
    });
    const order = dispatch.orders[0];
    const queued = await app.get(WorkOrderStorage).queuePrivateFileGeneration({
      workOrderId: order.id,
      actorId: recipientB.id,
      sessionId: order.sessionBinding!.sessionId,
      requirementId: order.requirements[0].id,
      requestKey: 'cancel-active-run-file',
      title: 'Generate cancelled.txt',
      file: {
        title: 'cancelled',
        content: { format: 'txt', text: 'must not be staged' },
      },
    });
    const leased =
      await app.models.copilotWorkOrderAgentRuntime.acquirePrivateFile({
        workOrderId: order.id,
        runId: queued.id,
        workerLeaseId: 'active-worker-before-cancel',
      });
    t.truthy(leased);

    await app.models.copilotWorkOrder.cancel({
      workOrderId: order.id,
      actorId: sender.id,
      reason: 'No longer needed',
      expectedVersion: order.version,
      requestKey: 'cancel-active-run',
    });
    await app.get(WorkOrderJobs).runPrivateFileGeneration({
      workOrderId: order.id,
      runId: queued.id,
    });

    const cancelledRun = await db.aiAgentRun.findUniqueOrThrow({
      where: { id: queued.id },
    });
    t.is(cancelledRun.status, 'cancelled');
    t.is(await db.workOrderBlob.count({ where: { workOrderId: order.id } }), 0);
    t.is(
      await db.aiAgentRuntimeExecutionResult.count({
        where: { runId: queued.id },
      }),
      0
    );
  }
);

test.serial(
  'concurrent cancellation and delivery produce one terminal result without duplicate evidence',
  async t => {
    const { db, sender, recipientB, sourceSession } = await fixture();
    const requestKey = 'concurrent-terminal-dispatch';
    const firstPrepared = await app.models.copilotWorkOrder.prepareDispatch({
      actorId: sender.id,
      sourceSessionId: sourceSession.id,
      requestKey,
      recipients: [
        {
          recipientId: recipientB.id,
          title: 'Concurrent terminal state',
          purpose: 'Race delivery against withdrawal.',
          requirements: [textRequirement],
        },
      ],
    });
    const refreshedPrepared = await app.models.copilotWorkOrder.prepareDispatch(
      {
        actorId: sender.id,
        sourceSessionId: sourceSession.id,
        requestKey,
        recipients: [
          {
            recipientId: recipientB.id,
            title: 'Concurrent terminal state',
            purpose: 'Race delivery against withdrawal.',
            requirements: [textRequirement],
          },
        ],
      }
    );
    t.is(refreshedPrepared.dispatch.id, firstPrepared.dispatch.id);
    t.not(refreshedPrepared.confirmationToken, firstPrepared.confirmationToken);
    await t.throwsAsync(
      app.models.copilotWorkOrder.prepareDispatch({
        actorId: sender.id,
        sourceSessionId: sourceSession.id,
        requestKey,
        recipients: [
          {
            recipientId: recipientB.id,
            title: 'Changed payload',
            purpose: 'Must be rejected under the same request key.',
            requirements: [textRequirement],
          },
        ],
      }),
      { message: /reused with different requirements/ }
    );
    const dispatch = await app.models.copilotWorkOrder.confirmDispatch({
      actorId: sender.id,
      dispatchId: refreshedPrepared.dispatch.id,
      confirmationToken: refreshedPrepared.confirmationToken!,
      expectedDraftVersion: refreshedPrepared.dispatch.draftVersion,
      requestKey: 'concurrent-terminal-confirm',
    });
    const order = dispatch.orders[0];
    const outcomes = await Promise.allSettled([
      app.models.copilotWorkOrder.cancel({
        workOrderId: order.id,
        actorId: sender.id,
        reason: 'Race withdrawal',
        expectedVersion: order.version,
        requestKey: 'concurrent-cancel',
      }),
      app.models.copilotWorkOrder.submitDelivery({
        workOrderId: order.id,
        actorId: recipientB.id,
        expectedVersion: order.version,
        requestKey: 'concurrent-delivery',
        items: [
          {
            requirementId: order.requirements[0].id,
            blobIds: [],
            text: 'Race delivery',
          },
        ],
      }),
    ]);
    t.is(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    t.is(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
    const terminal = await db.workOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    t.true(['cancelled', 'delivered'].includes(terminal.status));
    t.is(terminal.version, order.version + 1);
    t.true(
      (await db.workOrderDeliveryRevision.count({
        where: { workOrderId: order.id },
      })) <= 1
    );
    t.true(
      (await db.workOrderExchange.count({
        where: { workOrderId: order.id, kind: 'cancellation' },
      })) <= 1
    );
    const events = await db.workOrderEvent.findMany({
      where: { workOrderId: order.id },
      select: { version: true },
    });
    t.is(new Set(events.map(event => event.version)).size, events.length);
  }
);
