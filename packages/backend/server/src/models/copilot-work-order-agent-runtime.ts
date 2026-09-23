import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { type AiAgentRun, Prisma } from '@prisma/client';
import { z } from 'zod';

import { BadRequest, NotFound } from '../base';
import { BaseModel } from './base';
import { agentRuntimeFingerprint } from './copilot-agent-runtime';

export const WORK_ORDER_PRIVATE_FILE_WORKFLOW =
  'work_order_private_file_generation';
export const WORK_ORDER_PRIVATE_FILE_SOURCE = 'work_order_tool_call';

const id = z.string().trim().min(1).max(256);
const requestKey = z.string().trim().min(1).max(256);
const activeOrderStatuses = [
  'open',
  'waiting_sender',
  'validating',
  'delivered',
];
const runInclude = {
  steps: { orderBy: { order: 'asc' as const } },
  timelineEvents: { orderBy: { ordinal: 'asc' as const } },
  workOrderExecutionResults: { orderBy: { workerAttempt: 'asc' as const } },
} satisfies Prisma.AiAgentRunInclude;

export type WorkOrderPrivateFileRun = Prisma.AiAgentRunGetPayload<{
  include: typeof runInclude;
}> & { workspaceId: null; projectId: null; workOrderId: string };

export type WorkOrderPrivateFileLease = {
  workOrderId: string;
  actorId: string;
  runId: string;
  workerLeaseId: string;
  workerAttempt: number;
};

@Injectable()
export class CopilotWorkOrderAgentRuntimeModel extends BaseModel {
  @Transactional()
  async preparePrivateFile(input: {
    workOrderId: string;
    actorId: string;
    sessionId: string;
    requirementId: string;
    requestKey: string;
    title: string;
    command: Prisma.InputJsonObject;
  }) {
    const workOrderId = id.parse(input.workOrderId);
    const actorId = id.parse(input.actorId);
    const sessionId = id.parse(input.sessionId);
    const requirementId = id.parse(input.requirementId);
    const sourceId = requestKey.parse(input.requestKey);
    const title = z.string().trim().min(1).max(512).parse(input.title);
    if (Buffer.byteLength(JSON.stringify(input.command)) > 2 * 1024 * 1024)
      throw new BadRequest('Work-order file command exceeds its bounds');

    await this.lockWorkOrder(workOrderId);
    const order = await this.db.workOrder.findFirst({
      where: { id: workOrderId, recipientId: actorId },
      include: { sessionBinding: true },
    });
    if (!order) throw new NotFound('Work order unavailable');
    if (
      !activeOrderStatuses.includes(order.status) ||
      order.sessionBinding?.sessionId !== sessionId ||
      order.sessionBinding.ownerUserId !== actorId
    ) {
      throw new BadRequest('Work order no longer accepts generated drafts');
    }
    const requirement = await this.db.workOrderRequirement.findFirst({
      where: { id: requirementId, workOrderId, kind: 'file' },
    });
    if (!requirement) throw new NotFound('File requirement unavailable');

    const targetFingerprint = agentRuntimeFingerprint({
      workOrderId,
      requirementId,
      command: input.command,
    });
    const existing = await this.db.aiAgentRun.findUnique({
      where: {
        workOrderId_sourceType_sourceId: {
          workOrderId,
          sourceType: WORK_ORDER_PRIVATE_FILE_SOURCE,
          sourceId,
        },
      },
      include: runInclude,
    });
    if (existing) {
      if (
        existing.actorId !== actorId ||
        existing.sessionId !== sessionId ||
        existing.workflow !== WORK_ORDER_PRIVATE_FILE_WORKFLOW ||
        existing.targetFingerprint !== targetFingerprint
      ) {
        throw new BadRequest(
          'Work-order file request was reused with different input'
        );
      }
      return this.asPrivateRun(existing);
    }

    const now = new Date();
    const run = await this.db.aiAgentRun.create({
      data: {
        id: randomUUID(),
        workspaceId: null,
        projectId: null,
        workOrderId,
        actorId,
        sessionId,
        workflow: WORK_ORDER_PRIVATE_FILE_WORKFLOW,
        sourceType: WORK_ORDER_PRIVATE_FILE_SOURCE,
        sourceId,
        status: 'queued',
        title,
        targetFingerprint,
        evidenceFingerprint: agentRuntimeFingerprint({
          actorId,
          sessionId,
          workOrderId,
          requirementId,
          sourceId,
        }),
        timelineFingerprint: targetFingerprint,
        startedAt: now,
        queuedAt: now,
        workerMaxAttempts: 3,
        createdAt: now,
        updatedAt: now,
      },
    });
    const step = await this.db.aiAgentStep.create({
      data: {
        id: randomUUID(),
        runId: run.id,
        workspaceId: null,
        projectId: null,
        workOrderId,
        actorId,
        stepKey: 'generate_private_file',
        stepType: 'tool',
        status: 'pending',
        title,
        order: 0,
        evidenceFingerprint: run.evidenceFingerprint,
        input: {
          requirementId,
          file: input.command,
        },
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.event(run, 'queued', 'Private file generation queued', {}, now);
    await this.event(
      run,
      'pending',
      'Private file generation prepared',
      { requirementId },
      now,
      step.id,
      'tool_step'
    );
    return this.read(workOrderId, run.id);
  }

  async pendingPrivateFiles(limit = 50) {
    return this.db.aiAgentRun.findMany({
      where: {
        workspaceId: null,
        projectId: null,
        workOrderId: { not: null },
        workflow: WORK_ORDER_PRIVATE_FILE_WORKFLOW,
        OR: [
          { status: 'queued' },
          { status: 'running', workerLeaseExpiresAt: { lte: new Date() } },
        ],
      },
      select: { id: true, workOrderId: true },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  @Transactional()
  async acquirePrivateFile(input: {
    workOrderId: string;
    runId: string;
    workerLeaseId: string;
    leaseMs?: number;
  }) {
    const workOrderId = id.parse(input.workOrderId);
    const runId = id.parse(input.runId);
    const workerLeaseId = id.parse(input.workerLeaseId);
    const leaseMs = input.leaseMs ?? 300_000;
    if (leaseMs < 100 || leaseMs > 900_000)
      throw new BadRequest('Invalid work-order worker lease');
    await this.lockWorkOrder(workOrderId);
    await this.lockRun(workOrderId, runId);
    let run = await this.read(workOrderId, runId);
    const now = new Date();
    if (
      run.status === 'running' &&
      run.workerLeaseExpiresAt &&
      run.workerLeaseExpiresAt <= now
    ) {
      if (run.workerAttempt >= run.workerMaxAttempts) {
        await this.finishFailure(
          run,
          'stale_worker_lease',
          'Work-order file generation exhausted its worker leases',
          'agent_runtime_stale_recovery_worker'
        );
        return null;
      }
      run = await this.transition(
        run,
        'queued',
        'Expired work-order worker lease recovered',
        {
          previousWorkerLeaseId: run.workerLeaseId,
          previousWorkerAttempt: run.workerAttempt,
        },
        {
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
          queuedAt: now,
        },
        now
      );
    } else if (run.status !== 'queued') {
      return null;
    }
    if (!(await this.isActive(run))) {
      await this.cancelCurrent(run, 'Work order no longer accepts writes');
      return null;
    }
    if (run.workerAttempt >= run.workerMaxAttempts) return null;
    const leased = await this.transition(
      run,
      'running',
      'Work-order worker lease acquired',
      {},
      {
        workerLeaseId,
        workerLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        workerAttempt: run.workerAttempt + 1,
        lastAttemptAt: now,
        queuedAt: null,
      },
      now
    );
    await this.stepStatus(leased, 'running');
    return this.read(workOrderId, runId);
  }

  @Transactional()
  async renewPrivateFile(input: WorkOrderPrivateFileLease) {
    await this.lockWorkOrder(input.workOrderId);
    await this.lockRun(input.workOrderId, input.runId);
    const run = await this.read(input.workOrderId, input.runId);
    this.requireLease(run, input);
    if (!(await this.isActive(run))) {
      await this.cancelCurrent(run, 'Work order no longer accepts writes');
      return false;
    }
    await this.transition(
      run,
      'running',
      'Work-order worker lease renewed',
      { action: 'worker_lease_renewed' },
      { workerLeaseExpiresAt: new Date(Date.now() + 300_000) }
    );
    return true;
  }

  @Transactional()
  async completePrivateFile(
    input: WorkOrderPrivateFileLease,
    receipt: Prisma.InputJsonObject
  ) {
    if (Buffer.byteLength(JSON.stringify(receipt)) > 64 * 1024)
      throw new BadRequest('Work-order file receipt exceeds its bounds');
    await this.lockWorkOrder(input.workOrderId);
    await this.lockRun(input.workOrderId, input.runId);
    const run = await this.read(input.workOrderId, input.runId);
    this.requireLease(run, input);
    if (!(await this.isActive(run))) {
      await this.cancelCurrent(run, 'Work order no longer accepts writes');
      return null;
    }
    return this.finishCompleted(run, receipt);
  }

  @Transactional()
  async failPrivateFile(
    input: WorkOrderPrivateFileLease,
    code: string,
    message: string
  ) {
    await this.lockWorkOrder(input.workOrderId);
    await this.lockRun(input.workOrderId, input.runId);
    const run = await this.read(input.workOrderId, input.runId);
    if (
      run.status !== 'running' ||
      run.workerLeaseId !== input.workerLeaseId ||
      run.workerAttempt !== input.workerAttempt
    ) {
      return run;
    }
    if (!(await this.isActive(run)))
      return this.cancelCurrent(run, 'Work order no longer accepts writes');
    return this.finishFailure(
      run,
      z.string().trim().min(1).max(128).catch('execution_failed').parse(code),
      z
        .string()
        .trim()
        .min(1)
        .max(1024)
        .catch('Work-order file generation failed')
        .parse(message),
      'agent_runtime_worker'
    );
  }

  @Transactional()
  async cancelForWorkOrder(workOrderId: string, summary: string) {
    const normalizedId = id.parse(workOrderId);
    const candidates = await this.db.aiAgentRun.findMany({
      where: {
        workOrderId: normalizedId,
        workflow: WORK_ORDER_PRIVATE_FILE_WORKFLOW,
        status: { in: ['queued', 'running'] },
      },
      select: { id: true },
    });
    for (const candidate of candidates) {
      await this.lockRun(normalizedId, candidate.id);
      const run = await this.read(normalizedId, candidate.id);
      if (['queued', 'running'].includes(run.status))
        await this.cancelCurrent(run, summary.slice(0, 1024));
    }
  }

  private async finishCompleted(
    run: WorkOrderPrivateFileRun,
    receipt: Prisma.InputJsonObject
  ) {
    const completedAt = new Date(Math.max(Date.now(), run.updatedAt.getTime()));
    const resultPayload = this.resultPayload(run, {
      completedAt,
      resultStatus: 'completed',
      sideEffectsApplied: true,
      sideEffectSummary: receipt,
      summary: 'Private work-order file staged',
    });
    const updated = await this.transition(
      run,
      'completed',
      'Private work-order file staged',
      { resultFingerprint: agentRuntimeFingerprint(resultPayload) },
      {
        completedAt,
        failureCode: null,
        failureMessage: null,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
      completedAt
    );
    await this.stepStatus(updated, 'completed', receipt);
    await this.createResult(run, {
      completedAt,
      resultStatus: 'completed',
      sideEffectsApplied: true,
      summary: 'Private work-order file staged',
      resultPayload,
    });
    return this.read(run.workOrderId, run.id);
  }

  private async finishFailure(
    run: WorkOrderPrivateFileRun,
    failureCode: string,
    failureMessage: string,
    executor: 'agent_runtime_worker' | 'agent_runtime_stale_recovery_worker'
  ) {
    const completedAt = new Date(Math.max(Date.now(), run.updatedAt.getTime()));
    const resultPayload = this.resultPayload(run, {
      completedAt,
      resultStatus: 'failed',
      sideEffectsApplied: false,
      summary: failureMessage,
      failureCode,
      failureMessage,
    });
    const updated = await this.transition(
      run,
      'failed',
      failureMessage,
      { failureCode },
      {
        completedAt,
        failureCode,
        failureMessage,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
      completedAt
    );
    await this.stepStatus(updated, 'failed', {
      failureCode,
      failureMessage,
    });
    await this.createResult(run, {
      completedAt,
      resultStatus: 'failed',
      sideEffectsApplied: false,
      summary: failureMessage,
      failureCode,
      failureMessage,
      executor,
      resultPayload,
    });
    return this.read(run.workOrderId, run.id);
  }

  private resultPayload(
    run: WorkOrderPrivateFileRun,
    input: {
      completedAt: Date;
      resultStatus: 'completed' | 'failed';
      sideEffectsApplied: boolean;
      summary: string;
      sideEffectSummary?: Prisma.InputJsonObject;
      failureCode?: string;
      failureMessage?: string;
    }
  ) {
    return {
      version: 'agent-runtime-worker-execution-result/v1',
      resultStatus: input.resultStatus,
      workflow: run.workflow,
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      adapterWorkflow: run.workflow,
      executor: 'agent_runtime_worker',
      sideEffectMode:
        input.resultStatus === 'completed' ? 'work_order_write' : 'none',
      sideEffectsApplied: input.sideEffectsApplied,
      summary: input.summary,
      workerAttempt: run.workerAttempt,
      workerLeaseId: run.workerLeaseId ?? 'expired-worker-lease',
      completedAt: input.completedAt.toISOString(),
      ...(input.sideEffectSummary
        ? { sideEffectSummary: input.sideEffectSummary }
        : {}),
      ...(input.failureCode
        ? {
            failureCode: input.failureCode,
            failureMessage: input.failureMessage,
          }
        : {
            adapterResolution: {
              version: 'agent-runtime-worker-adapter-resolution/v1',
              status: 'completed',
              workflow: run.workflow,
              requestedStepTypes: ['tool'],
              adapter: {
                workflow: run.workflow,
                supportedStepTypes: ['tool'],
                sideEffectMode: 'work_order_write',
              },
              registeredAdapters: [
                {
                  workflow: run.workflow,
                  supportedStepTypes: ['tool'],
                  sideEffectMode: 'work_order_write',
                },
              ],
            },
          }),
    } satisfies Prisma.InputJsonObject;
  }

  private async createResult(
    run: WorkOrderPrivateFileRun,
    input: {
      completedAt: Date;
      resultStatus: 'completed' | 'failed';
      sideEffectsApplied: boolean;
      summary: string;
      failureCode?: string;
      failureMessage?: string;
      executor?: string;
      resultPayload: Prisma.InputJsonObject;
    }
  ) {
    const workerLeaseId = run.workerLeaseId ?? 'expired-worker-lease';
    await this.db.aiAgentRuntimeExecutionResult.create({
      data: {
        id: randomUUID(),
        runId: run.id,
        workspaceId: null,
        projectId: null,
        workOrderId: run.workOrderId,
        actorId: run.actorId,
        workflow: run.workflow,
        sourceType: run.sourceType,
        sourceId: run.sourceId,
        adapterWorkflow: run.workflow,
        executor: input.executor ?? 'agent_runtime_worker',
        resultStatus: input.resultStatus,
        sideEffectMode:
          input.resultStatus === 'completed' ? 'work_order_write' : 'none',
        sideEffectsApplied: input.sideEffectsApplied,
        summary: input.summary,
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        resultPayload: input.resultPayload,
        resultFingerprint: agentRuntimeFingerprint(input.resultPayload),
        workerAttempt: run.workerAttempt,
        workerLeaseId,
        completedAt: input.completedAt,
        createdAt: input.completedAt,
      },
    });
  }

  private async isActive(run: WorkOrderPrivateFileRun) {
    const order = await this.db.workOrder.findFirst({
      where: {
        id: run.workOrderId,
        recipientId: run.actorId,
        status: { in: activeOrderStatuses },
      },
      include: { sessionBinding: true },
    });
    if (
      !order ||
      !run.sessionId ||
      order.sessionBinding?.sessionId !== run.sessionId ||
      order.sessionBinding.ownerUserId !== run.actorId
    ) {
      return false;
    }
    const session = await this.db.aiSession.findFirst({
      where: {
        id: run.sessionId,
        userId: run.actorId,
        scopeType: 'work_order',
        workspaceId: null,
        selectedContextProjectId: null,
        deletedAt: null,
      },
    });
    return !!session;
  }

  private requireLease(
    run: WorkOrderPrivateFileRun,
    input: WorkOrderPrivateFileLease
  ) {
    if (
      run.actorId !== input.actorId ||
      run.status !== 'running' ||
      run.workerLeaseId !== input.workerLeaseId ||
      run.workerAttempt !== input.workerAttempt ||
      !run.workerLeaseExpiresAt ||
      run.workerLeaseExpiresAt <= new Date()
    ) {
      throw new BadRequest('Work-order worker lease changed');
    }
  }

  private async cancelCurrent(run: WorkOrderPrivateFileRun, summary: string) {
    const now = new Date(Math.max(Date.now(), run.updatedAt.getTime()));
    const updated = await this.transition(
      run,
      'cancelled',
      summary,
      { action: 'work_order_cancelled' },
      {
        completedAt: now,
        queuedAt: null,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
      now,
      'run_cancellation'
    );
    await this.stepStatus(updated, 'skipped');
    return this.read(run.workOrderId, run.id);
  }

  private async transition(
    run: WorkOrderPrivateFileRun,
    status: string,
    summary: string,
    payload: Prisma.InputJsonObject,
    data: Prisma.AiAgentRunUncheckedUpdateInput,
    now = new Date(),
    eventType = 'run_status'
  ) {
    now = new Date(Math.max(now.getTime(), run.updatedAt.getTime()));
    const updated = await this.db.aiAgentRun.update({
      where: { id: run.id },
      data: {
        ...data,
        status,
        updatedAt: now,
        timelineFingerprint: agentRuntimeFingerprint({
          previous: run.timelineFingerprint,
          status,
          payload,
          now: now.toISOString(),
        }),
      },
      include: runInclude,
    });
    await this.event(
      updated,
      status,
      summary,
      {
        ...payload,
        previousStatus: run.status,
        workerAttempt: updated.workerAttempt,
      },
      now,
      undefined,
      eventType
    );
    return this.asPrivateRun(updated);
  }

  private async stepStatus(
    run: WorkOrderPrivateFileRun,
    status: 'running' | 'completed' | 'failed' | 'skipped',
    output?: Prisma.InputJsonObject
  ) {
    const step = run.steps.find(
      candidate => candidate.stepKey === 'generate_private_file'
    );
    if (!step) throw new BadRequest('Work-order file step is missing');
    const now = new Date(
      Math.max(Date.now(), run.updatedAt.getTime(), step.updatedAt.getTime())
    );
    await this.db.aiAgentStep.update({
      where: { id: step.id },
      data: {
        status,
        completedAt: status === 'running' ? null : now,
        updatedAt: now,
        ...(output ? { outputSummary: output } : {}),
      },
    });
    await this.event(
      run,
      status,
      `Private file generation ${status}`,
      {},
      now,
      step.id,
      'tool_step'
    );
  }

  private async event(
    run: AiAgentRun,
    status: string,
    summary: string,
    input: Prisma.InputJsonObject,
    now: Date,
    stepId?: string,
    eventType = 'run_status'
  ) {
    const last = await this.db.aiAgentTimelineEvent.aggregate({
      where: { runId: run.id },
      _max: { ordinal: true },
    });
    const payload = {
      version: 'agent-runtime-work-order/v1',
      ...input,
      workflow: run.workflow,
      sourceType: run.sourceType,
      sourceId: run.sourceId,
    };
    await this.db.aiAgentTimelineEvent.create({
      data: {
        id: randomUUID(),
        runId: run.id,
        stepId,
        workspaceId: null,
        projectId: null,
        workOrderId: run.workOrderId,
        actorId: run.actorId,
        eventType,
        status,
        ordinal: (last._max.ordinal ?? -1) + 1,
        summary,
        payload,
        eventFingerprint: agentRuntimeFingerprint({
          status,
          payload,
          stepId,
          now: now.toISOString(),
        }),
        createdAt: now,
      },
    });
  }

  private async read(workOrderId: string, runId: string) {
    const run = await this.db.aiAgentRun.findFirst({
      where: {
        id: runId,
        workOrderId,
        workspaceId: null,
        projectId: null,
        workflow: WORK_ORDER_PRIVATE_FILE_WORKFLOW,
      },
      include: runInclude,
    });
    if (!run) throw new NotFound('Work-order file run is unavailable');
    return this.asPrivateRun(run);
  }

  private asPrivateRun(
    run: Prisma.AiAgentRunGetPayload<{ include: typeof runInclude }>
  ) {
    if (!run.workOrderId || run.workspaceId !== null || run.projectId !== null)
      throw new BadRequest('Invalid work-order Agent Runtime owner');
    return {
      ...run,
      workspaceId: null,
      projectId: null,
      workOrderId: run.workOrderId,
    } satisfies WorkOrderPrivateFileRun;
  }

  private async lockWorkOrder(workOrderId: string) {
    await this.db.$queryRaw(
      Prisma.sql`SELECT id FROM work_orders WHERE id = ${workOrderId} FOR UPDATE`
    );
  }

  private async lockRun(workOrderId: string, runId: string) {
    await this.db.$queryRaw(
      Prisma.sql`SELECT id FROM ai_agent_runs WHERE id = ${runId} AND work_order_id = ${workOrderId} FOR UPDATE`
    );
  }
}
