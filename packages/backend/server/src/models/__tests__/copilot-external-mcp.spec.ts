import {
  ExternalMcpConnectionStatus,
  ExternalMcpToolExecutionStatus,
} from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { CopilotExternalMcpModel } from '../copilot-external-mcp';

const test = ava.serial as TestFn;

class TestingCopilotExternalMcpModel extends CopilotExternalMcpModel {
  constructor(private readonly testingDb: any) {
    super();
  }

  protected override get db() {
    return this.testingDb;
  }
}

test('reauthentication failure clears the unusable encrypted session', async t => {
  const update = Sinon.stub().resolves({});
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpConnection: { update },
  });

  await model.recordFailure(
    'connection-1',
    ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    'mcp_session_invalid',
    'Session expired'
  );

  t.deepEqual(update.firstCall.args[0].data, {
    status: ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    encryptedSessionId: null,
    sessionFingerprint: null,
    lastCheckedAt: update.firstCall.args[0].data.lastCheckedAt,
    lastErrorCode: 'mcp_session_invalid',
    lastErrorMessage: 'Session expired',
  });
  t.true(update.firstCall.args[0].data.lastCheckedAt instanceof Date);
});

test('tool execution ledger claims a new idempotency key once', async t => {
  const upsert = Sinon.stub().callsFake(async input => ({
    ...input.create,
    status: ExternalMcpToolExecutionStatus.RUNNING,
    attemptCount: 1,
    completedAt: null,
    resultFingerprint: null,
    encryptedResult: null,
    errorCode: null,
  }));
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: { upsert },
  });

  const claim = await model.claimToolExecution({
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
    actorId: 'user-1',
    toolName: 'sparkclaw.task.create',
    risk: 'write',
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
    now: new Date('2026-08-26T12:00:00.000Z'),
  });

  t.is(claim.state, 'claimed');
  t.is(claim.execution.attemptCount, 1);
  t.truthy(claim.execution.leaseId);
  t.deepEqual(
    claim.execution.leaseExpiresAt,
    new Date('2026-08-26T12:00:45.000Z')
  );
});

test('tool execution ledger replays completion and rejects changed arguments', async t => {
  const completed = {
    id: 'execution-1',
    connectionId: 'connection-1',
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    toolName: 'sparkclaw.task.create',
    risk: 'write',
    status: ExternalMcpToolExecutionStatus.COMPLETED,
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
    resultFingerprint: 'result-1',
    encryptedResult: 'encrypted-result',
    errorCode: null,
    attemptCount: 1,
    leaseId: null,
    leaseExpiresAt: null,
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: {
      upsert: Sinon.stub().resolves(completed),
    },
  });
  const baseInput = {
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
    actorId: 'user-1',
    toolName: 'sparkclaw.task.create',
    risk: 'write' as const,
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
  };

  t.is((await model.claimToolExecution(baseInput)).state, 'completed');
  t.is(
    (
      await model.claimToolExecution({
        ...baseInput,
        argumentsFingerprint: 'changed-arguments',
      })
    ).state,
    'terminal'
  );
});

test('tool execution ledger replays pending operations and does not retry remote terminals', async t => {
  const base = {
    id: 'execution-1',
    connectionId: 'connection-1',
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    toolName: 'sparkclaw.conversation.send',
    risk: 'write',
    idempotencyKey: 'conversation-1',
    argumentsFingerprint: 'arguments-1',
    resultFingerprint: null,
    encryptedResult: null,
    errorCode: null,
    attemptCount: 1,
    remoteOperationId: 'operation-1',
    remoteState: 'running',
    remoteDeadlineAt: new Date(),
    nextPollAt: new Date(),
    pollAttemptCount: 1,
    leaseId: null,
    leaseExpiresAt: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const upsert = Sinon.stub().resolves({
    ...base,
    status: ExternalMcpToolExecutionStatus.PENDING,
  });
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: { upsert },
  });
  const input = {
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
    actorId: 'user-1',
    toolName: 'sparkclaw.conversation.send',
    risk: 'write' as const,
    idempotencyKey: 'conversation-1',
    argumentsFingerprint: 'arguments-1',
  };

  t.is((await model.claimToolExecution(input)).state, 'remote_pending');
  upsert.resolves({
    ...base,
    status: ExternalMcpToolExecutionStatus.FAILED,
    remoteState: 'failed',
    errorCode: 'sparkclaw_workflow_failed',
    nextPollAt: null,
    completedAt: new Date(),
  });
  t.is((await model.claimToolExecution(input)).state, 'terminal');
});

test('remote operation poll reclaim keeps the bounded maximum attempt count', async t => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const current = {
    id: 'execution-1',
    status: ExternalMcpToolExecutionStatus.PENDING,
    remoteOperationId: 'operation-1',
    pollAttemptCount: 20,
    nextPollAt: new Date('2026-08-27T11:59:00.000Z'),
    leaseExpiresAt: null,
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
  };
  const updateMany = Sinon.stub().resolves({ count: 1 });
  const findUnique = Sinon.stub().resolves(current);
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: { findUnique, updateMany },
  });

  const claimed = await model.claimRemoteOperationPoll(current.id, now);

  t.truthy(claimed);
  t.false(
    Object.hasOwn(updateMany.firstCall.args[0].data, 'pollAttemptCount'),
    'a crash recovery at the maximum must not violate the database bound'
  );
  t.is(
    updateMany.firstCall.args[0].data.status,
    ExternalMcpToolExecutionStatus.RUNNING
  );
});

test('tool execution ledger reclaims an expired lease with a fenced attempt', async t => {
  const now = new Date('2026-08-26T12:00:00.000Z');
  const expired = {
    id: 'execution-1',
    connectionId: 'connection-1',
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    toolName: 'sparkclaw.task.create',
    risk: 'write',
    status: ExternalMcpToolExecutionStatus.RUNNING,
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
    resultFingerprint: null,
    encryptedResult: null,
    errorCode: null,
    attemptCount: 1,
    leaseId: 'expired-lease',
    leaseExpiresAt: new Date('2026-08-26T11:59:59.000Z'),
    startedAt: new Date('2026-08-26T11:59:29.000Z'),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const updateMany = Sinon.stub().resolves({ count: 1 });
  const findUnique = Sinon.stub().callsFake(async () => ({
    ...expired,
    attemptCount: 2,
    leaseId: updateMany.firstCall.args[0].data.leaseId,
    leaseExpiresAt: updateMany.firstCall.args[0].data.leaseExpiresAt,
    startedAt: now,
  }));
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: {
      upsert: Sinon.stub().resolves(expired),
      updateMany,
      findUnique,
    },
  });

  const claim = await model.claimToolExecution({
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
    actorId: 'user-2',
    toolName: 'sparkclaw.task.create',
    risk: 'write',
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
    now,
  });

  t.is(claim.state, 'claimed');
  t.is(claim.execution.attemptCount, 2);
  Sinon.assert.calledOnce(updateMany);
  t.deepEqual(updateMany.firstCall.args[0].where, {
    id: 'execution-1',
    attemptCount: 1,
    OR: [
      { status: ExternalMcpToolExecutionStatus.FAILED },
      {
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      },
    ],
  });
});

test('tool execution ledger stops retrying after three attempts', async t => {
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpToolExecution: {
      upsert: Sinon.stub().resolves({
        id: 'execution-1',
        toolName: 'sparkclaw.task.create',
        argumentsFingerprint: 'arguments-1',
        status: ExternalMcpToolExecutionStatus.FAILED,
        attemptCount: 3,
      }),
      updateMany: Sinon.stub(),
    },
  });

  const claim = await model.claimToolExecution({
    connection: { id: 'connection-1', workspaceId: 'workspace-1' },
    actorId: 'user-1',
    toolName: 'sparkclaw.task.create',
    risk: 'write',
    idempotencyKey: 'task-1-create',
    argumentsFingerprint: 'arguments-1',
  });

  t.is(claim.state, 'terminal');
});
