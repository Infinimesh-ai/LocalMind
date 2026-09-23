import { createMinimalXlsxFixture } from '@localmind/office/testing';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { OFFICE_FORMATS, OfficeImportService } from '../../core/office';
import { ProjectBlobStorage, ProjectResourceService } from '../../core/project';
import {
  applyContextSessionRecoveryBarrier,
  buildContextSessionRecoveryBarrier,
} from '../../models/common/context-session-recovery-barrier';
import { fingerprintContextCompactionMessages } from '../../models/copilot-context-memory';
import { CompatSubmissionStore } from '../../plugins/copilot/compat/submission-store';
import { ContextMemoryService } from '../../plugins/copilot/context-memory-service';
import { ContextScopeResolver } from '../../plugins/copilot/context-scope-resolver';
import { ConversationInboxService } from '../../plugins/copilot/conversation/inbox';
import { TurnSchema } from '../../plugins/copilot/core';
import { ProjectContextService } from '../../plugins/copilot/project-context-service';
import { CapabilityRuntime } from '../../plugins/copilot/runtime/capability-runtime';
import { ChatSessionService } from '../../plugins/copilot/session';
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
test.afterEach.always(() => Sinon.restore());

async function fixture() {
  const user = await app.createUser();
  await app
    .POST('/api/auth/sign-in')
    .set('x-affine-version', '0.27.0')
    .send({ email: user.email, password: user.password })
    .expect(200);
  const db = app.get(PrismaClient);
  const owner = await app.models.user.create({
    email: 'context-owner@example.com',
  });
  const project = await db.aiContextProject.create({
    data: {
      name: 'Context Project',
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          { userId: user.id, role: 'member' },
        ],
      },
    },
  });
  await db.aiProjectMemorySettings.create({
    data: {
      projectId: project.id,
      autoMemoryEnabled: true,
      updatedByUserId: owner.id,
    },
  });
  const session = await app.gql<{
    createCopilotSessionWithHistory: { sessionId: string };
  }>(
    `mutation($options: CreateChatSessionInput!) { createCopilotSessionWithHistory(options: $options) { sessionId } }`,
    {
      options: {
        projectId: project.id,
        promptName: 'Chat With LocalMind AI',
        reuseLatestChat: false,
      },
    }
  );
  return {
    db,
    projectId: project.id,
    actorId: user.id,
    sessionId: session.createCopilotSessionWithHistory.sessionId,
  };
}

test.serial(
  'scope uses native resources selected for this session and fails closed after membership removal',
  async t => {
    const { db, ...scope } = await fixture();
    const resource = await app.get(ProjectResourceService).createDocument({
      ...scope,
      title: 'Selected resource',
      markdown: 'Native Project content',
      requestKey: 'scope-resource',
    });
    await app.models.copilotProjectContext.set({
      ...scope,
      expectedVersion: 0,
      items: [{ kind: 'resource', resourceId: resource.id, sequence: 1 }],
    });
    const resolver = app.get(ContextScopeResolver);
    const input = {
      userId: scope.actorId,
      workspaceId: null,
      sessionId: scope.sessionId,
      selectedProjectId: scope.projectId,
    };
    const resolved = await resolver.resolve(input);
    t.deepEqual(resolved.readableProjectResourceIds, [resource.id]);
    t.deepEqual(resolved.readableDocumentRefs, []);
    t.deepEqual(resolved.projectIds, [scope.projectId]);
    const otherSession = await app.gql<{
      createCopilotSessionWithHistory: { sessionId: string };
    }>(
      'mutation($options: CreateChatSessionInput!) { createCopilotSessionWithHistory(options: $options) { sessionId } }',
      {
        options: {
          projectId: scope.projectId,
          promptName: 'Chat With LocalMind AI',
          reuseLatestChat: false,
        },
      }
    );
    t.deepEqual(
      (
        await resolver.resolve({
          ...input,
          sessionId: otherSession.createCopilotSessionWithHistory.sessionId,
        })
      ).readableProjectResourceIds,
      []
    );
    t.deepEqual((await resolver.resolve(input)).readableProjectResourceIds, [
      resource.id,
    ]);
    await db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
    });
    const denied = await resolver.resolve(input);
    t.deepEqual(denied.projectIds, []);
    t.deepEqual(denied.readableProjectResourceIds, []);
    t.is(denied.selectedProjectId, null);
  }
);

test.serial(
  'Project session metadata rejects a mismatched wrapper and another user without side effects',
  async t => {
    const { db, ...scope } = await fixture();
    const query = `query($sessionId: String!, $workspaceId: String) {
      currentUser {
        copilot(workspaceId: $workspaceId) {
          session(sessionId: $sessionId) { sessionId }
        }
      }
    }`;
    const baseline = {
      memories: await db.aiContextMemory.count(),
      sources: await db.aiSessionContextSource.count(),
      messages: await db.aiSessionMessage.count(),
    };

    await t.throwsAsync(
      app.gql(query, {
        sessionId: scope.sessionId,
        workspaceId: 'mismatched-workspace',
      })
    );
    const stranger = await app.createUser();
    await app.login(stranger);
    await t.throwsAsync(
      app.gql(query, { sessionId: scope.sessionId, workspaceId: null })
    );

    t.deepEqual(
      {
        memories: await db.aiContextMemory.count(),
        sources: await db.aiSessionContextSource.count(),
        messages: await db.aiSessionMessage.count(),
      },
      baseline
    );
  }
);

test.serial(
  'Project session memory contribution cannot be disabled and uses owner binding and revision CAS',
  async t => {
    const { db, ...scope } = await fixture();
    const query = `query($sessionId: ID!) {
      currentUser {
        copilot {
          projectSessionMemoryCapture(sessionId: $sessionId) {
            sessionId projectId allowMemoryCapture revision
          }
        }
      }
    }`;
    const mutation = `mutation($input: UpdateCopilotProjectSessionMemoryCaptureInput!) {
      updateCopilotProjectSessionMemoryCapture(input: $input) {
        sessionId projectId allowMemoryCapture revision
      }
    }`;
    const initial = await app.gql<{
      currentUser: {
        copilot: {
          projectSessionMemoryCapture: {
            sessionId: string;
            projectId: string;
            allowMemoryCapture: boolean;
            revision: number;
          };
        };
      };
    }>(query, { sessionId: scope.sessionId });
    t.like(initial.currentUser.copilot.projectSessionMemoryCapture, {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      allowMemoryCapture: true,
      revision: 1,
    });
    await t.throwsAsync(
      app.gql(mutation, {
        input: {
          sessionId: scope.sessionId,
          allowMemoryCapture: false,
          expectedRevision: 1,
        },
      })
    );
    const updated = await app.gql<{
      updateCopilotProjectSessionMemoryCapture: {
        allowMemoryCapture: boolean;
        revision: number;
      };
    }>(mutation, {
      input: {
        sessionId: scope.sessionId,
        allowMemoryCapture: true,
        expectedRevision: 1,
      },
    });
    t.like(updated.updateCopilotProjectSessionMemoryCapture, {
      allowMemoryCapture: true,
      revision: 2,
    });
    await t.throwsAsync(
      app.gql(mutation, {
        input: {
          sessionId: scope.sessionId,
          allowMemoryCapture: true,
          expectedRevision: 1,
        },
      })
    );
    t.like(
      await db.aiSession.findUniqueOrThrow({ where: { id: scope.sessionId } }),
      { allowMemoryCapture: true, memoryCaptureRevision: 2 }
    );

    const stranger = await app.createUser();
    await app.login(stranger);
    const denied = await app.gql<{
      currentUser: {
        copilot: { projectSessionMemoryCapture: unknown | null };
      };
    }>(query, { sessionId: scope.sessionId });
    t.is(denied.currentUser.copilot.projectSessionMemoryCapture, null);
    await t.throwsAsync(
      app.gql(mutation, {
        input: {
          sessionId: scope.sessionId,
          allowMemoryCapture: true,
          expectedRevision: 2,
        },
      })
    );
  }
);

test.serial(
  'context compaction tasks deduplicate, recover leases, retry failures, cancel and publish with strict CAS',
  async t => {
    const { db, ...scope } = await fixture();
    const messages = await Promise.all(
      [
        ['user', 'The release target is Friday.'],
        ['assistant', 'I recorded the target.'],
        ['user', 'Keep the migration reversible.'],
      ].map(async ([role, content], index) => {
        const createdAt = new Date(Date.now() + index * 10);
        return await db.aiSessionMessage.create({
          data: {
            sessionId: scope.sessionId,
            role: role as 'user' | 'assistant',
            content,
            createdAt,
          },
        });
      })
    );
    const model = app.models.copilotContextMemory;
    const request = (routeFingerprint: string) =>
      model.requestContextCompaction({
        sessionId: scope.sessionId,
        actorUserId: scope.actorId,
        sourceMessageIds: messages.map(message => message.id),
        sourceFingerprint: fingerprintContextCompactionMessages(messages),
        summarizedMessageCount: messages.length,
        strategyVersion: 'context-compaction-test/v1',
        strategyFingerprint: 'strategy-fingerprint',
        modelId: 'test-model',
        routeFingerprint,
        inputBudget: 8_192,
        candidateSummary:
          '- Release target: Friday\n- Keep migration reversible',
        candidateDiagnostics: { inputMessageCount: messages.length },
      });

    const first = await request('route-a');
    const duplicate = await request('route-a');
    t.is(duplicate.id, first.id);
    t.is(await db.aiContextCompactionTask.count(), 1);

    const expired = await model.claimContextCompaction({
      taskId: first.id,
      leaseId: 'expired-lease',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    t.is(expired?.attempt, 1);
    const takeover = await model.claimContextCompaction({
      taskId: first.id,
      leaseId: 'takeover-lease',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.is(takeover?.attempt, 2);
    t.is(
      await model.publishContextCompaction({
        taskId: first.id,
        leaseId: 'expired-lease',
      }),
      null
    );
    const succeeded = await model.publishContextCompaction({
      taskId: first.id,
      leaseId: 'takeover-lease',
    });
    t.is(succeeded?.status, 'succeeded');
    t.truthy(succeeded?.checkpointId);
    t.is(await db.aiContextCheckpoint.count(), 1);
    const firstEvents = await model.listContextCompactionEvents({
      sessionId: scope.sessionId,
      actorUserId: scope.actorId,
    });
    t.deepEqual(
      firstEvents
        .filter(event => event.taskId === first.id)
        .map(event => event.status),
      ['queued', 'running', 'running', 'succeeded']
    );
    t.true(
      firstEvents.every(
        (event, index) =>
          index === 0 || event.sequence > firstEvents[index - 1].sequence
      )
    );
    const replayed = await model.listContextCompactionEvents({
      sessionId: scope.sessionId,
      actorUserId: scope.actorId,
      afterSequence: Number(firstEvents.at(-2)?.sequence ?? 0),
    });
    t.deepEqual(
      replayed.map(event => event.sequence),
      [firstEvents.at(-1)?.sequence]
    );
    await t.throwsAsync(
      db.aiContextCompactionTask.update({
        where: { id: first.id },
        data: { sourceFingerprint: 'forged-source' },
      })
    );
    await t.throwsAsync(
      db.aiContextCompactionTask.update({
        where: { id: first.id },
        data: { status: 'queued', checkpointId: null, completedAt: null },
      })
    );

    const concurrentA = await request('route-concurrent-a');
    const concurrentB = await request('route-concurrent-b');
    await model.claimContextCompaction({
      taskId: concurrentA.id,
      leaseId: 'concurrent-a',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await model.claimContextCompaction({
      taskId: concurrentB.id,
      leaseId: 'concurrent-b',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.is(
      (
        await model.publishContextCompaction({
          taskId: concurrentA.id,
          leaseId: 'concurrent-a',
        })
      )?.status,
      'succeeded'
    );
    t.is(
      (
        await model.publishContextCompaction({
          taskId: concurrentB.id,
          leaseId: 'concurrent-b',
        })
      )?.status,
      'stale'
    );
    t.is(await db.aiContextCheckpoint.count(), 2);

    const retrying = await request('route-retry');
    await model.claimContextCompaction({
      taskId: retrying.id,
      leaseId: 'retry-lease-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const retryWait = await model.failContextCompaction({
      taskId: retrying.id,
      leaseId: 'retry-lease-1',
      failureCode: 'TEST_TRANSIENT_FAILURE',
    });
    t.is(retryWait?.status, 'retry_wait');
    const retried = await model.retryContextCompaction(
      retrying.id,
      scope.actorId
    );
    t.is(retried?.id, retrying.id);
    const retryClaim = await model.claimContextCompaction({
      taskId: retrying.id,
      leaseId: 'retry-lease-2',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.is(retryClaim?.attempt, 2);
    t.is(
      (
        await model.publishContextCompaction({
          taskId: retrying.id,
          leaseId: 'retry-lease-2',
        })
      )?.status,
      'succeeded'
    );

    const cancelled = await request('route-cancel');
    t.is(
      (await model.cancelContextCompaction(cancelled.id, scope.actorId))
        ?.status,
      'cancelled'
    );
    t.is(
      await model.claimContextCompaction({
        taskId: cancelled.id,
        leaseId: 'cancelled-lease',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      }),
      null
    );
    await model.retryContextCompaction(cancelled.id, scope.actorId);
    await model.claimContextCompaction({
      taskId: cancelled.id,
      leaseId: 'cancel-retry-lease',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.is(
      (
        await model.publishContextCompaction({
          taskId: cancelled.id,
          leaseId: 'cancel-retry-lease',
        })
      )?.status,
      'succeeded'
    );

    const workerTask = await request('route-worker');
    const generatedSourceId = messages[0].id;
    Sinon.stub(app.get(CapabilityRuntime), 'generateStructuredValue').resolves({
      value: {
        currentGoal: 'Prepare the reversible Friday release.',
        userConstraints: [
          {
            statement: 'Keep the migration reversible.',
            sourceMessageIds: [messages[2].id],
          },
        ],
        decisions: [],
        verifiedFacts: [
          {
            statement: 'The release target is Friday.',
            sourceMessageIds: [generatedSourceId],
          },
        ],
        completedActions: [],
        pendingWork: [],
        openQuestions: [],
        sourceRefs: [generatedSourceId, messages[2].id],
      },
      route: { modelId: 'test-model' },
    } as never);
    const workerResult = await app
      .get(ChatSessionService)
      .executeContextCompaction(workerTask.id);
    t.is(workerResult?.status, 'succeeded');
    t.true(
      workerResult?.resultSummary?.includes(
        'Prepare the reversible Friday release.'
      ) ?? false
    );

    const revoked = await request('route-revoked');
    const revokedClaim = await model.claimContextCompaction({
      taskId: revoked.id,
      leaseId: 'revoked-lease',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.is(revokedClaim?.status, 'running');
    await db.aiContextProjectMember.delete({
      where: {
        projectId_userId: {
          projectId: scope.projectId,
          userId: scope.actorId,
        },
      },
    });
    const stale = await model.publishContextCompaction({
      taskId: revoked.id,
      leaseId: 'revoked-lease',
    });
    t.is(stale?.status, 'stale');
    t.is(stale?.failureCode, 'CONTEXT_COMPACTION_PERMISSION_STALE');
    t.is(await db.aiContextCheckpoint.count(), 5);
  }
);

test.serial(
  'native Project context persists exact source versions and uploads across reopen without Workspace records',
  async t => {
    const { db, ...scope } = await fixture();
    const context = app.models.copilotProjectContext;
    const service = app.get(ProjectContextService);
    const resources = app.get(ProjectResourceService);
    const doc = await resources.createDocument({
      ...scope,
      title: 'Reference',
      markdown: 'ORIGINAL_REFERENCE',
      requestKey: 'reference',
    });
    const selected = await context.set({
      ...scope,
      expectedVersion: 0,
      items: [{ kind: 'resource', resourceId: doc.id, sequence: 1 }],
    });
    t.is(selected.version, 1);
    const uploaded = await service.upload({
      ...scope,
      expectedVersion: 1,
      name: 'notes.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from(
        `HEAD_REFERENCE ${'bounded-source '.repeat(800)} PERSISTENT_ATTACHMENT`
      ),
    });
    t.is(uploaded.items.length, 2);
    const snapshot = await context.snapshot(scope);
    const source = await service.materialize({ ...scope, snapshot });
    t.true(source?.content.includes('ORIGINAL_REFERENCE'));
    t.true(source?.content.includes('PERSISTENT_ATTACHMENT'));
    const bounded = await service.materialize({
      ...scope,
      snapshot,
      maxCharacters: 480,
    });
    t.true((bounded?.content.length ?? Infinity) <= 480);
    t.notThrows(() =>
      JSON.parse(bounded!.content.split('\n').slice(1).join('\n'))
    );
    const coverage = await service.materialize({
      ...scope,
      snapshot,
      maxCharacters: 2_400,
    });
    t.true(coverage?.content.includes('PERSISTENT_ATTACHMENT'));
    t.true(coverage?.content.includes('"complete":false'));
    await t.throwsAsync(
      service.materialize({ ...scope, snapshot, maxCharacters: 0 }),
      { message: /budget is too small/ }
    );
    await resources.updateMarkdown({
      ...scope,
      resourceId: doc.id,
      markdown: 'UPDATED_REFERENCE',
      origin: 'user',
      expectedContentVersion: 1,
      requestKey: 'new-content',
      editLease: {
        kind: 'user',
        tabId: 'context-edit',
        leaseId: (
          await app.models.projectResourceEditLease.acquire({
            ...scope,
            resourceId: doc.id,
            kind: 'user',
            tabId: 'context-edit',
          })
        ).lease!.leaseId,
      },
    });
    const reopened = await service.view(scope);
    t.is(
      reopened.items.find(item => item.kind === 'resource')?.currentSequence,
      2
    );
    t.is((await context.get(scope)).items[0].kind, 'resource');
    const old = await service.materialize({ ...scope, snapshot });
    t.true(old?.content.includes('ORIGINAL_REFERENCE'));
    t.false(old?.content.includes('UPDATED_REFERENCE'));
    await context.set({ ...scope, expectedVersion: 2, items: [] });
    t.is((await service.view(scope)).items.length, 0);
    t.true(
      (await service.materialize({ ...scope, snapshot }))?.content.includes(
        'PERSISTENT_ATTACHMENT'
      )
    );
    t.is(await db.workspace.count(), 0);
    t.is(await db.blob.count(), 0);
    t.is(
      await db.aiSessionContextSource.count({
        where: { sessionId: scope.sessionId, kind: 'project_resource' },
      }),
      1
    );
    t.is(
      await db.aiSessionContextSource.count({
        where: { sessionId: scope.sessionId, kind: 'project_blob' },
      }),
      1
    );
  }
);

test.serial(
  'native Project memory captures persisted turns with immutable source proof, isolates recall and refuses revoked or private sources',
  async t => {
    const { db, ...scope } = await fixture();
    const service = app.get(ContextMemoryService);
    const message = await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'Remember that the project codename is Juniper.',
      },
    });
    const resolution = await app.get(ContextScopeResolver).resolve({
      userId: scope.actorId,
      workspaceId: null,
      sessionId: scope.sessionId,
      selectedProjectId: scope.projectId,
    });
    const input = {
      userId: scope.actorId,
      workspaceId: null,
      sessionId: scope.sessionId,
      scope: resolution,
      turn: TurnSchema.parse({
        id: message.id,
        conversationId: scope.sessionId,
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
      }),
    };
    const events = await service.captureDurableTurn(input);
    t.is(events.length, 1);
    t.is(events[0]?.operation, 'ADD');
    const memory = await db.aiContextMemory.findUniqueOrThrow({
      where: { id: events[0]!.memoryId! },
      include: { projectSourceCheck: true },
    });
    t.is(memory.workspaceId, null);
    t.is(memory.projectId, scope.projectId);
    t.true(memory.projectSourceCheck?.allowed);
    t.true(
      JSON.stringify(memory.projectSourceCheck?.sources).includes(message.id)
    );
    await app.models.copilotContext.recordRecalledMemorySources({
      ...scope,
      workspaceId: null,
      memories: [{ id: memory.id, content: memory.content }],
    });
    t.is(
      await db.aiSessionContextSource.count({
        where: { sessionId: scope.sessionId, kind: 'private' },
      }),
      0
    );
    const replay = await service.captureDurableTurn(input);
    t.is(replay[0]?.id, events[0]?.id);
    t.is(await db.aiContextMemory.count(), 1);
    const member = await app.models.user.create({
      email: 'context-member@example.com',
    });
    await db.aiContextProjectMember.create({
      data: { projectId: scope.projectId, userId: member.id, role: 'member' },
    });
    t.true(
      (
        await app.models.copilotContextMemory.listVisible({
          userId: member.id,
          projectIds: [scope.projectId],
        })
      ).some(item => item.id === memory.id)
    );
    t.false(
      (
        await app.models.copilotContextMemory.listVisible({
          userId: member.id,
          projectIds: ['other'],
        })
      ).some(item => item.id === memory.id)
    );
    await t.throwsAsync(
      db.aiContextMemory.update({
        where: { id: memory.id },
        data: { projectSourceCheckId: null },
      })
    );
    await db.aiSessionContextSource.create({
      data: {
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        kind: 'unknown',
        sourceId: 'unverified-memory-material',
      },
    });
    const blockedMessage = await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'Remember that the project codename is Juniper.',
      },
    });
    t.deepEqual(
      await service.captureDurableTurn({
        ...input,
        turn: TurnSchema.parse({
          id: blockedMessage.id,
          conversationId: scope.sessionId,
          role: 'user',
          content: blockedMessage.content,
          createdAt: blockedMessage.createdAt,
        }),
      }),
      []
    );
    t.is(await db.aiContextMemory.count(), 1);
    t.true(
      (await db.aiSharedWriteSourceCheck.count({
        where: {
          sessionId: scope.sessionId,
          sinkType: 'project_memory',
          allowed: false,
        },
      })) > 0
    );
    await db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
    });
    t.deepEqual(await service.captureDurableTurn(input), []);
    t.deepEqual(
      await app.models.copilotContextMemory.listVisible({
        userId: scope.actorId,
        projectIds: [scope.projectId],
      }),
      []
    );
    t.is(await db.workspace.count(), 0);
  }
);

test.serial(
  'manual Project Summary persists owner evidence, deduplicates and retains access boundaries',
  async t => {
    const { db, ...scope } = await fixture();
    const create = `mutation($input: CreateCopilotContextMemoryInput!) {
    createCopilotContextMemory(input: $input) { id content projectId workspaceId }
  }`;
    const input = {
      scope: 'project',
      kind: 'project_summary',
      projectId: scope.projectId,
      content: 'Shared project objective',
    };
    await t.throwsAsync(app.gql(create, { input }));
    await t.throwsAsync(
      app
        .get(ContextMemoryService)
        .create(
          scope.actorId,
          input as Parameters<ContextMemoryService['create']>[1]
        )
    );
    await db.aiContextProjectMember.update({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
      data: { role: 'owner' },
    });
    const responses = await Promise.all([
      app.gql<{ createCopilotContextMemory: { id: string } }>(create, {
        input,
      }),
      app.gql<{ createCopilotContextMemory: { id: string } }>(create, {
        input,
      }),
    ]);
    const id = responses[0].createCopilotContextMemory.id;
    t.is(responses[1].createCopilotContextMemory.id, id);
    t.is(await db.projectSummaryRevision.count({ where: { memoryId: id } }), 1);
    await app.models.copilotContext.recordRecalledMemorySources({
      ...scope,
      workspaceId: null,
      memories: [{ id, content: input.content }],
    });
    t.is(
      await db.aiSessionContextSource.count({
        where: { sessionId: scope.sessionId, kind: 'private' },
      }),
      0
    );
    const update = `mutation($input: UpdateCopilotContextMemoryInput!) {
    updateCopilotContextMemory(input: $input) { id content status }
  }`;
    const updated = await app.gql<{
      updateCopilotContextMemory: { id: string };
    }>(update, {
      input: { id, content: 'Revised shared objective' },
    });
    const revisedId = updated.updateCopilotContextMemory.id;
    t.not(revisedId, id);
    t.is(await db.projectSummaryRevision.count({ where: { memoryId: id } }), 1);
    t.is(
      await db.projectSummaryRevision.count({ where: { memoryId: revisedId } }),
      1
    );
    await app.gql(update, { input: { id: revisedId, status: 'disabled' } });
    await app.gql(update, { input: { id: revisedId, status: 'active' } });
    await t.throwsAsync(
      db.aiContextMemory.update({
        where: { id: revisedId },
        data: { content: 'Unproven replacement' },
      })
    );
    const revision = await db.projectSummaryRevision.findFirstOrThrow({
      where: { memoryId: revisedId },
    });
    await t.throwsAsync(
      db.projectSummaryRevision.update({
        where: { id: revision.id },
        data: { actorIdSnapshot: 'forged' },
      })
    );
    await t.throwsAsync(
      db.projectSummaryRevision.delete({ where: { id: revision.id } })
    );
    await t.throwsAsync(
      db.aiContextMemory.create({
        data: {
          ownerUserId: scope.actorId,
          projectId: scope.projectId,
          scope: 'project',
          kind: 'auto_memory',
          content: 'Unproven automatic memory',
          fingerprint: 'unproven',
        },
      })
    );
    await t.throwsAsync(
      app.models.copilotContextMemory.update(
        id,
        { content: ' ' },
        scope.actorId
      )
    );
    await db.aiContextProjectMember.update({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
      data: { role: 'member' },
    });
    await t.throwsAsync(
      app.gql(update, { input: { id, content: 'Member rewrite' } })
    );
    await t.throwsAsync(
      app.models.copilotContextMemory.update(
        id,
        { status: 'disabled' },
        scope.actorId
      )
    );
    t.true(
      (
        await app.models.copilotContextMemory.listVisible({
          userId: scope.actorId,
          projectIds: [scope.projectId],
        })
      ).some(memory => memory.id === revisedId)
    );
    await db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
    });
    t.deepEqual(
      await app.models.copilotContextMemory.listVisible({
        userId: scope.actorId,
        projectIds: [scope.projectId],
      }),
      []
    );
    await t.throwsAsync(app.gql(create, { input }));
    t.is(await db.workspace.count(), 0);
  }
);

test.serial(
  'Project session deletion immediately revokes access, purges private context and preserves shared memory',
  async t => {
    const { db, ...scope } = await fixture();
    const message = await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'Remember that the project launch window is October.',
      },
    });
    const resolution = await app.get(ContextScopeResolver).resolve({
      userId: scope.actorId,
      workspaceId: null,
      sessionId: scope.sessionId,
      selectedProjectId: scope.projectId,
    });
    const [event] = await app.get(ContextMemoryService).captureDurableTurn({
      userId: scope.actorId,
      workspaceId: null,
      sessionId: scope.sessionId,
      scope: resolution,
      turn: TurnSchema.parse({
        id: message.id,
        conversationId: scope.sessionId,
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
      }),
    });
    t.truthy(event?.memoryId);
    const memoryId = event!.memoryId!;
    await app.models.copilotProjectContext.set({
      ...scope,
      expectedVersion: 0,
      items: [],
    });
    const checkpoint = await app.models.copilotContextMemory.putCheckpoint({
      sessionId: scope.sessionId,
      strategyVersion: 'deletion-test/v1',
      strategyFingerprint: 'strategy-fingerprint',
      summary: '- private rolling summary',
      summarizedMessageCount: 1,
      sourceFingerprint: 'source-fingerprint',
      diagnostics: { retained: 1 },
    });
    await app.models.copilotContextMemory.requestContextCompaction({
      sessionId: scope.sessionId,
      actorUserId: scope.actorId,
      sourceMessageIds: [message.id],
      sourceFingerprint: fingerprintContextCompactionMessages([message]),
      summarizedMessageCount: 1,
      strategyVersion: 'deletion-compaction-test/v1',
      strategyFingerprint: 'deletion-compaction-strategy',
      routeFingerprint: 'deletion-compaction-route',
      candidateSummary: '- private candidate summary',
      candidateDiagnostics: { inputMessageCount: 1 },
    });
    await t.throwsAsync(
      db.aiContextCheckpoint.update({
        where: { id: checkpoint.id },
        data: { summary: 'forged rolling summary' },
      })
    );
    await t.throwsAsync(
      db.aiContextCheckpoint.delete({ where: { id: checkpoint.id } })
    );
    await app.models.copilotContextMemory.createPlanTrace({
      sessionId: scope.sessionId,
      sourceTurnId: message.id,
      strategyVersion: 'deletion-test/v1',
      strategyFingerprint: 'strategy-fingerprint',
      inputMessageCount: 1,
      retainedMessageCount: 1,
      omittedMessageCount: 0,
      candidateMemoryCount: 1,
      selectedMemoryCount: 1,
      summaryInjected: false,
      planningPasses: 1,
      contextCharBudget: 4_096,
      contextCharCount: 64,
      sourceFingerprint: 'source-fingerprint',
      outputFingerprint: 'output-fingerprint',
      candidateMemoryIds: [memoryId],
      selectedMemories: [
        {
          id: memoryId,
          scope: 'project',
          kind: 'auto_memory',
          score: 1,
          rank: 1,
          sourceType: 'memory',
        },
      ],
      scope: { projectId: scope.projectId },
    });

    t.deepEqual(
      await app.models.copilotSession.cleanup({
        userId: scope.actorId,
        workspaceId: null,
        selectedContextProjectId: scope.projectId,
        docId: null,
        sessionIds: [scope.sessionId],
      }),
      [scope.sessionId]
    );
    t.is(await app.models.copilotSession.getMeta(scope.sessionId), null);
    const requested = await db.aiSessionDeletion.findUniqueOrThrow({
      where: { sessionId: scope.sessionId },
    });
    t.is(requested.status, 'requested');
    t.is(requested.projectIdSnapshot, scope.projectId);
    t.is(
      (await db.aiContextMemory.findUniqueOrThrow({ where: { id: memoryId } }))
        .sourceSessionId,
      scope.sessionId
    );

    const staleLeaseId = 'stale-project-session-deletion-test';
    const staleClaim = await app.models.copilotSession.claimSessionDeletion({
      sessionId: scope.sessionId,
      leaseId: staleLeaseId,
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    t.truthy(staleClaim);
    const leaseId = 'project-session-deletion-test';
    const claimed = await app.models.copilotSession.claimSessionDeletion({
      sessionId: scope.sessionId,
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    t.truthy(claimed);
    t.is(claimed!.attempt, 2);
    t.is(
      await app.models.copilotSession.purgeSessionDeletion({
        sessionId: scope.sessionId,
        leaseId: staleLeaseId,
        contextEpoch: staleClaim!.contextEpoch,
      }),
      null
    );
    const counts = await app.models.copilotSession.purgeSessionDeletion({
      sessionId: scope.sessionId,
      leaseId,
      contextEpoch: claimed!.contextEpoch,
    });
    t.deepEqual(counts, {
      messages: 1,
      contexts: 0,
      projectContexts: 1,
      compactions: 1,
      checkpoints: 1,
      traces: 1,
      sources: 1,
      redactedAgentRuns: 0,
    });
    t.is(await db.aiSessionMessage.count(), 0);
    t.is(await db.projectChatContext.count(), 0);
    t.is(await db.aiContextCheckpoint.count(), 0);
    t.is(await db.aiContextCompactionTask.count(), 0);
    t.is(await db.aiContextPlanTrace.count(), 0);
    const preserved = await db.aiContextMemory.findUniqueOrThrow({
      where: { id: memoryId },
    });
    t.is(preserved.content, 'the project launch window is October');
    t.is(preserved.sourceSessionId, null);
    t.is(
      (
        await db.aiContextMemoryEvent.findUniqueOrThrow({
          where: { id: event!.id },
        })
      ).sourceSessionId,
      null
    );
    const completed = await db.aiSessionDeletion.findUniqueOrThrow({
      where: { sessionId: scope.sessionId },
    });
    t.is(completed.status, 'completed');
    t.truthy(completed.receiptFingerprint);
    t.is(
      await app.models.copilotSession.claimSessionDeletion({
        sessionId: scope.sessionId,
        leaseId: 'duplicate-lease',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      }),
      null
    );
    t.is(
      await app.models.copilotSession.purgeSessionDeletion({
        sessionId: scope.sessionId,
        leaseId,
        contextEpoch: claimed!.contextEpoch,
      }),
      null
    );
  }
);

test.serial(
  'Project session deletion physically removes only session-exclusive attachment blobs',
  async t => {
    const { db, ...scope } = await fixture();
    const contexts = app.get(ProjectContextService);
    let context = await contexts.upload({
      ...scope,
      expectedVersion: 0,
      name: 'exclusive.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('SESSION_EXCLUSIVE_ATTACHMENT'),
    });
    const exclusive = context.items.find(
      item => item.kind === 'blob' && item.name === 'exclusive.txt'
    );
    t.truthy(exclusive && exclusive.kind === 'blob');
    context = await contexts.upload({
      ...scope,
      expectedVersion: context.version,
      name: 'shared.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('SHARED_ATTACHMENT'),
    });
    const shared = context.items.find(
      item => item.kind === 'blob' && item.name === 'shared.txt'
    );
    t.truthy(shared && shared.kind === 'blob');
    if (
      !exclusive ||
      exclusive.kind !== 'blob' ||
      !shared ||
      shared.kind !== 'blob'
    ) {
      return;
    }

    const other = await app.gql<{
      createCopilotSessionWithHistory: { sessionId: string };
    }>(
      'mutation($options: CreateChatSessionInput!) { createCopilotSessionWithHistory(options: $options) { sessionId } }',
      {
        options: {
          projectId: scope.projectId,
          promptName: 'Chat With LocalMind AI',
          reuseLatestChat: false,
        },
      }
    );
    await app.models.copilotProjectContext.set({
      projectId: scope.projectId,
      actorId: scope.actorId,
      sessionId: other.createCopilotSessionWithHistory.sessionId,
      expectedVersion: 0,
      items: [{ kind: 'blob', blobKey: shared.blobKey, name: shared.name }],
    });
    t.is(await db.aiSessionProjectBlobReference.count(), 3);

    await app.models.copilotSession.cleanup({
      userId: scope.actorId,
      workspaceId: null,
      selectedContextProjectId: scope.projectId,
      docId: null,
      sessionIds: [scope.sessionId],
    });
    await app.get(ChatSessionService).purgeDeletedSession({
      sessionId: scope.sessionId,
    });

    const deletion = await db.aiSessionDeletion.findUniqueOrThrow({
      where: { sessionId: scope.sessionId },
    });
    t.is(deletion.status, 'completed');
    t.is(
      await db.projectBlob.count({
        where: { projectId: scope.projectId, key: exclusive.blobKey },
      }),
      0
    );
    t.is(
      await db.projectBlob.count({
        where: { projectId: scope.projectId, key: shared.blobKey },
      }),
      1
    );
    t.is(
      await db.aiSessionProjectBlobReference.count({
        where: {
          sessionId: other.createCopilotSessionWithHistory.sessionId,
          blobKey: shared.blobKey,
        },
      }),
      1
    );
    t.is(
      (
        await app.get(ProjectBlobStorage).read({
          projectId: scope.projectId,
          actorId: scope.actorId,
          key: shared.blobKey,
        })
      ).bytes.toString(),
      'SHARED_ATTACHMENT'
    );
  }
);

test.serial(
  'session deletion hold revokes access immediately and resumes after the hold is released',
  async t => {
    const { db, ...scope } = await fixture();
    await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'PRIVATE_HELD_MESSAGE',
      },
    });
    await db.localMindLogPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', legalHold: true },
      update: { legalHold: true },
    });
    await app.models.copilotSession.cleanup({
      userId: scope.actorId,
      workspaceId: null,
      selectedContextProjectId: scope.projectId,
      docId: null,
      sessionIds: [scope.sessionId],
    });
    t.is(await app.models.copilotSession.getMeta(scope.sessionId), null);
    t.is(
      (
        await db.aiSessionDeletion.findUniqueOrThrow({
          where: { sessionId: scope.sessionId },
        })
      ).status,
      'held'
    );
    t.is(await db.aiSessionMessage.count(), 1);
    const deletionStatusQuery = `query($sessionId: ID!) {
      currentUser { copilot { sessionDeletion(sessionId: $sessionId) {
        status backupStatus holdReason progress resultCounts
      } } }
    }`;
    const heldStatus = await app.gql<{
      currentUser: {
        copilot: {
          sessionDeletion: { status: string; backupStatus: string };
        };
      };
    }>(deletionStatusQuery, { sessionId: scope.sessionId });
    t.is(heldStatus.currentUser.copilot.sessionDeletion.status, 'held');
    t.is(heldStatus.currentUser.copilot.sessionDeletion.backupStatus, 'held');
    await app.get(ChatSessionService).purgeDeletedSession({
      sessionId: scope.sessionId,
    });
    t.is(await db.aiSessionMessage.count(), 1);

    await db.localMindLogPolicy.update({
      where: { id: 'default' },
      data: { legalHold: false },
    });
    t.true(
      (await app.models.copilotSession.listDueSessionDeletions()).some(
        deletion => deletion.sessionId === scope.sessionId
      )
    );
    await app.get(ChatSessionService).purgeDeletedSession({
      sessionId: scope.sessionId,
    });
    const completed = await db.aiSessionDeletion.findUniqueOrThrow({
      where: { sessionId: scope.sessionId },
    });
    t.is(completed.status, 'completed');
    t.truthy(completed.releasedAt);
    t.is(await db.aiSessionMessage.count(), 0);
    const completedStatus = await app.gql<{
      currentUser: {
        copilot: {
          sessionDeletion: { status: string; backupStatus: string };
        };
      };
    }>(deletionStatusQuery, { sessionId: scope.sessionId });
    t.is(
      completedStatus.currentUser.copilot.sessionDeletion.status,
      'completed'
    );
    t.is(
      completedStatus.currentUser.copilot.sessionDeletion.backupStatus,
      'pending_retention_expiry'
    );
  }
);

test.serial(
  'signed recovery barrier blocks restored session content before cleanup resumes',
  async t => {
    const { db, ...scope } = await fixture();
    await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'PRIVATE_PRE_BACKUP_MESSAGE',
      },
    });
    await app.models.copilotSession.cleanup({
      userId: scope.actorId,
      workspaceId: null,
      selectedContextProjectId: scope.projectId,
      docId: null,
      sessionIds: [scope.sessionId],
    });
    await app.get(ChatSessionService).purgeDeletedSession({
      sessionId: scope.sessionId,
    });
    const keyring = {
      activeKeyVersion: 'test-v1',
      keys: { 'test-v1': 'recovery-barrier-test-key-material-1' },
    };
    const barrier = await buildContextSessionRecoveryBarrier(db, keyring);

    // Recreate the security-relevant shape of a snapshot taken before the
    // deletion. The barrier must revoke reads synchronously and schedule the
    // restored payload for the normal idempotent purge worker.
    await db.aiSessionDeletion.delete({
      where: { sessionId: scope.sessionId },
    });
    await db.aiSession.update({
      where: { id: scope.sessionId },
      data: { deletedAt: null, title: 'Restored private title' },
    });
    await db.aiSessionMessage.create({
      data: {
        sessionId: scope.sessionId,
        role: 'user',
        content: 'PRIVATE_RESTORED_MESSAGE',
      },
    });

    const replay = await applyContextSessionRecoveryBarrier(
      db,
      barrier,
      keyring
    );
    t.true(replay.applied);
    t.is(await app.models.copilotSession.getMeta(scope.sessionId), null);
    const deletion = await db.aiSessionDeletion.findUniqueOrThrow({
      where: { sessionId: scope.sessionId },
    });
    t.is(deletion.status, 'requested');
    t.is(await db.aiSessionMessage.count(), 1);

    await app.get(ChatSessionService).purgeDeletedSession({
      sessionId: scope.sessionId,
    });
    t.is(await db.aiSessionMessage.count(), 0);
    t.is(
      (
        await db.aiSessionDeletion.findUniqueOrThrow({
          where: { sessionId: scope.sessionId },
        })
      ).status,
      'completed'
    );
    t.false(
      (await applyContextSessionRecoveryBarrier(db, barrier, keyring)).applied
    );
  }
);

test.serial(
  'Project context API checks actor, resource owner, optimistic versions and revoked or trashed sources',
  async t => {
    const { db, ...scope } = await fixture();
    const doc = await app.get(ProjectResourceService).createDocument({
      ...scope,
      title: 'Private context',
      markdown: 'PRIVATE_MARKER',
      requestKey: 'private',
    });
    const query = `query($projectId: String!, $sessionId: String!) { projectChatContext(projectId: $projectId, sessionId: $sessionId) { version items { kind resourceId sequence title available } } }`;
    const mutation = `mutation($projectId: String!, $sessionId: String!, $expectedVersion: Int!, $items: [ProjectChatContextItemInput!]!) { updateProjectChatContext(projectId: $projectId, sessionId: $sessionId, expectedVersion: $expectedVersion, items: $items) { version items { resourceId } } }`;
    const item = { kind: 'resource', resourceId: doc.id, sequence: 1 };
    await app.gql(mutation, {
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      expectedVersion: 0,
      items: [item],
    });
    await t.throwsAsync(
      app.gql(mutation, {
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        expectedVersion: 0,
        items: [],
      })
    );
    await t.throwsAsync(
      app.models.copilotProjectContext.set({
        ...scope,
        expectedVersion: 1,
        items: [item, item],
      })
    );
    const other = await db.aiContextProject.create({
      data: {
        name: 'Other',
        members: { create: { userId: scope.actorId, role: 'owner' } },
      },
    });
    await t.throwsAsync(
      app.gql(query, { projectId: other.id, sessionId: scope.sessionId })
    );
    await t.throwsAsync(
      db.projectChatContext.update({
        where: { sessionId: scope.sessionId },
        data: { projectId: other.id, version: 2 },
      })
    );
    const snapshot = await app.models.copilotProjectContext.snapshot(scope);
    await app.models.projectResource.change({
      ...scope,
      resourceId: doc.id,
      expectedVersion: doc.version,
      trash: true,
    });
    const hidden = await app.gql<{
      projectChatContext: { items: { available: boolean; title: string }[] };
    }>(query, { projectId: scope.projectId, sessionId: scope.sessionId });
    t.false(hidden.projectChatContext.items[0].available);
    t.false(JSON.stringify(hidden).includes('PRIVATE_MARKER'));
    await t.throwsAsync(
      app.get(ProjectContextService).materialize({ ...scope, snapshot })
    );
    await db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: scope.projectId, userId: scope.actorId },
      },
    });
    await t.throwsAsync(
      app.gql(query, { projectId: scope.projectId, sessionId: scope.sessionId })
    );
  }
);

test.serial(
  'Project Office selections retain native identity and inbox freezes server-owned context over caller metadata',
  async t => {
    const { db, ...scope } = await fixture();
    const blob = await app.get(ProjectBlobStorage).put({
      ...scope,
      bytes: Buffer.from(createMinimalXlsxFixture()),
      mimeType: OFFICE_FORMATS.xlsx.mimeType,
    });
    const imported = await app.get(OfficeImportService).import({
      ...scope,
      title: 'Workbook',
      sourceFileName: 'workbook.xlsx',
      sourceBlobKey: blob.key,
      importIdempotencyKey: 'context-workbook',
    });
    await app.models.copilotProjectContext.set({
      ...scope,
      expectedVersion: 0,
      items: [
        { kind: 'resource', resourceId: imported.artifact.id, sequence: 1 },
      ],
    });
    const id = await app
      .get(ConversationInboxService)
      .createMessage(scope.actorId, {
        sessionId: scope.sessionId,
        content: 'Read the selected workbook',
        params: { projectContext: { projectId: 'forged', items: [] } },
      });
    const submission = await app.get(CompatSubmissionStore).get(id);
    const snapshot = submission?.params?.projectContext;
    t.true(JSON.stringify(snapshot).includes(imported.artifact.id));
    t.false(JSON.stringify(snapshot).includes('forged'));
    const source = await app
      .get(ProjectContextService)
      .materialize({ ...scope, snapshot });
    t.true(source?.content.includes('workbook'));
    t.is(
      await db.officeArtifact.count({ where: { workspaceId: { not: null } } }),
      0
    );
  }
);
