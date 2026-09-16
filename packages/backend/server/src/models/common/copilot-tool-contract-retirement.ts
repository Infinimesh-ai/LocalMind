import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { hasRetiredToolContract } from './copilot-tool-contract';

const ACTIVE_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'waiting_for_location',
  'waiting_lease',
];
const WORKFLOWS = [
  'agent_runtime_localmind_tool_agent',
  'agent_runtime_project_resource',
];
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Run with workers paused. Never changes terminal tasks, checkpoints or original inputs. */
export async function retireToolContracts(db: PrismaClient, apply = false) {
  const report = {
    scannedRuns: 0,
    affectedRuns: 0,
    retiredRuns: 0,
    retiredDelegations: 0,
    cancelledCallbacks: 0,
    appendedTimelineEvents: 0,
    concurrentSkips: 0,
  };
  let cursor: string | undefined;
  for (;;) {
    const candidates = await db.aiAgentRun.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        workflow: { in: WORKFLOWS },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      include: { steps: true },
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    for (const candidate of candidates) {
      report.scannedRuns++;
      if (!hasRetiredToolContract(candidate)) continue;
      report.affectedRuns++;
      if (!apply) continue;
      const changed = await db.$transaction(
        async tx => {
          // Match the checkpoint lock order; stale executors cannot append calls during retirement.
          await tx.$queryRaw`SELECT id FROM ai_mcp_delegation_requests WHERE agent_run_id = ${candidate.id} ORDER BY id FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM ai_agent_runs WHERE id = ${candidate.id} FOR UPDATE`;
          const run = await tx.aiAgentRun.findUniqueOrThrow({
            where: { id: candidate.id },
            include: {
              steps: true,
              timelineEvents: { orderBy: { ordinal: 'asc' } },
            },
          });
          if (
            !ACTIVE_STATUSES.includes(run.status) ||
            !hasRetiredToolContract(run)
          )
            return null;
          const now = new Date(
            Math.max(
              Date.now(),
              run.updatedAt.getTime() + 1,
              ...run.steps.map(step => step.updatedAt.getTime() + 1)
            )
          );
          let ordinal = (run.timelineEvents.at(-1)?.ordinal ?? -1) + 1;
          const summary =
            'Tool contract retired; submit a new request using the scoped tool contract';
          const payload = {
            version: 'tool-contract-retirement/v1',
            executionAttempted: false,
            checkpointOutcome: 'preserved_without_replay',
            workflow: run.workflow,
            sourceType: run.sourceType,
            sourceId: run.sourceId,
            previousStatus: run.status,
            failureCode: 'tool_contract_retired',
            failureMessage: summary,
            workerLeaseId: run.workerLeaseId,
            workerAttempt: run.workerAttempt,
          };
          let appendedEvents = 0;
          const eventFingerprints = run.timelineEvents.map(
            event => event.eventFingerprint
          );
          const event = async (
            stepId: string | null,
            eventType: string,
            details: Prisma.InputJsonObject
          ) => {
            const identity = {
              runId: run.id,
              stepId,
              eventType,
              status: 'failed',
              ordinal: ordinal++,
              summary,
              payload: { ...payload, ...details },
            };
            const eventFingerprint = fingerprint(identity);
            await tx.aiAgentTimelineEvent.create({
              data: {
                ...identity,
                id: randomUUID(),
                workspaceId: run.workspaceId,
                projectId: run.projectId,
                actorId: run.actorId,
                eventFingerprint,
                createdAt: now,
              },
            });
            eventFingerprints.push(eventFingerprint);
            appendedEvents++;
          };
          for (const step of run.steps) {
            if (
              !['pending', 'running', 'waiting_approval'].includes(step.status)
            )
              continue;
            await event(step.id, 'step_error', {
              stepKey: step.stepKey,
              stepType: step.stepType,
            });
            await tx.aiAgentStep.update({
              where: { id: step.id },
              data: { status: 'failed', completedAt: now, updatedAt: now },
            });
          }
          await event(null, 'run_status', {});
          await tx.aiAgentRun.update({
            where: { id: run.id },
            data: {
              status: 'failed',
              completedAt: now,
              updatedAt: now,
              queuedAt: null,
              workerLeaseId: null,
              workerLeaseExpiresAt: null,
              waitingLeaseId: null,
              waitingLeaseResourceId: null,
              failureCode: 'tool_contract_retired',
              failureMessage: summary,
              timelineFingerprint: fingerprint({
                version: 'tool-contract-retirement/v1',
                eventFingerprints,
              }),
            },
          });
          await tx.projectResourceEditLease.deleteMany({
            where: { taskId: run.id, kind: 'ai_task' },
          });
          const delegations = await tx.aiMcpDelegationRequest.findMany({
            where: {
              agentRunId: run.id,
              status: {
                in: ['processing', 'waiting_approval', 'waiting_for_location'],
              },
            },
          });
          let cancelledCallbacks = 0;
          for (const request of delegations) {
            const previous =
              request.result &&
              typeof request.result === 'object' &&
              !Array.isArray(request.result)
                ? (request.result as Prisma.JsonObject)
                : {};
            await tx.aiMcpDelegationRequest.update({
              where: { id: request.id },
              data: {
                status: 'failed',
                updatedAt: now,
                result: {
                  ...previous,
                  code: 'tool_contract_retired',
                  retirement: {
                    version: 'tool-contract-retirement/v1',
                    fingerprint: fingerprint(payload),
                    checkpointOutcome: 'preserved_without_replay',
                  },
                  retryable: false,
                  execution: 'failed',
                },
              },
            });
            // Keep payloads, checkpoints and execution-result evidence intact.
            // A stopped in-flight call has an unknown outcome; never invent a
            // completed call or claim that prior side effects were rolled back.
            const cancelled =
              await tx.aiMcpDelegationCallbackDelivery.updateMany({
                where: {
                  requestId: request.id,
                  status: { in: ['queued', 'retry_scheduled', 'processing'] },
                },
                data: {
                  status: 'cancelled',
                  nextAttemptAt: null,
                  workerLeaseId: null,
                  workerLeaseExpiresAt: null,
                  lastErrorCode: 'tool_contract_retired',
                  lastErrorMessage: summary,
                  updatedAt: now,
                },
              });
            cancelledCallbacks += cancelled.count;
          }
          return {
            delegations: delegations.length,
            cancelledCallbacks,
            appendedEvents,
          };
        },
        { timeout: 30000 }
      );
      if (changed !== null) {
        report.retiredRuns++;
        report.retiredDelegations += changed.delegations;
        report.cancelledCallbacks += changed.cancelledCallbacks;
        report.appendedTimelineEvents += changed.appendedEvents;
      } else {
        report.concurrentSkips++;
      }
    }
  }
  return report;
}

/** Reconcile stale failure projections without rewriting terminal execution history. */
export async function reconcileStaleMcpDelegations(
  db: PrismaClient,
  before: Date,
  apply = false
) {
  if (
    !Number.isFinite(before.getTime()) ||
    before.getTime() > Date.now() - 3600000
  )
    throw new Error(
      'Reconciliation cutoff must be at least one hour in the past'
    );
  const report = {
    scannedRequests: 0,
    eligibleRequests: 0,
    reconciledRequests: 0,
    activeRuns: 0,
    unresolvedRequests: 0,
    cancelledCallbacks: 0,
    concurrentSkips: 0,
  };
  let cursor: string | undefined;
  for (;;) {
    const candidates = await db.aiMcpDelegationRequest.findMany({
      where: {
        status: 'processing',
        updatedAt: { lt: before },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    for (const candidate of candidates) {
      report.scannedRequests++;
      const outcome = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM ai_mcp_delegation_requests WHERE id = ${candidate.id} FOR UPDATE`;
        const request = await tx.aiMcpDelegationRequest.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        if (request.status !== 'processing' || request.updatedAt >= before)
          return { kind: 'concurrent' as const };
        if (request.agentRunId)
          await tx.$queryRaw`SELECT id FROM ai_agent_runs WHERE id = ${request.agentRunId} FOR UPDATE`;
        const run = request.agentRunId
          ? await tx.aiAgentRun.findUnique({
              where: { id: request.agentRunId },
              include: { steps: true },
            })
          : null;
        if (run && ACTIVE_STATUSES.includes(run.status))
          return { kind: 'active' as const };
        let reason: string | undefined;
        if (
          run &&
          run.sourceType === 'mcp_ai_delegation' &&
          run.sourceId === request.id &&
          run.workspaceId === request.workspaceId &&
          run.actorId === request.actorId &&
          !run.projectId
        ) {
          if (run.status === 'failed') reason = 'terminal_run_failed';
          if (
            run.status === 'completed' &&
            run.workflow === 'agent_runtime_record_only'
          ) {
            const resultStep = run.steps.find(
              step => step.stepKey === 'delegation_result'
            );
            const summary = resultStep?.outputSummary as
              | Prisma.JsonObject
              | undefined;
            const result = summary?.delegationResult as
              | Prisma.JsonObject
              | undefined;
            if (
              result?.version === 'mcp-ai-delegation-terminal-result/v1' &&
              result.status === 'failed'
            )
              reason = 'terminal_failure_receipt';
          }
        } else if (
          !request.agentRunId &&
          !request.executionSessionId &&
          !request.planFingerprint &&
          !request.locationOperationId &&
          !(await tx.aiMcpDelegationToolCall.count({
            where: { requestId: request.id },
          })) &&
          !(await tx.aiAgentRun.count({
            where: { sourceType: 'mcp_ai_delegation', sourceId: request.id },
          }))
        ) {
          reason = 'planning_interrupted_before_execution';
        }
        if (!reason) return { kind: 'unresolved' as const };
        if (!apply) return { kind: 'eligible' as const, cancelled: 0 };
        const previous =
          request.result &&
          typeof request.result === 'object' &&
          !Array.isArray(request.result)
            ? (request.result as Prisma.JsonObject)
            : {};
        const evidence = {
          version: 'mcp-stale-reconciliation/v1',
          reason,
          cutoff: before.toISOString(),
          previousStatus: request.status,
          previousResultFingerprint: fingerprint(request.result),
          requestFingerprint: request.requestFingerprint,
          runId: run?.id ?? null,
          runStatus: run?.status ?? null,
          runEvidenceFingerprint: run?.evidenceFingerprint ?? null,
          checkpointOutcome: 'preserved_without_replay',
          executionAttempted: false,
        };
        const code =
          reason === 'planning_interrupted_before_execution'
            ? 'delegation_planning_interrupted'
            : 'delegation_terminal_reconciled';
        await tx.aiMcpDelegationRequest.update({
          where: { id: request.id },
          data: {
            status: 'failed',
            result: {
              ...previous,
              status: 'failed',
              code,
              execution: 'failed',
              retryable: false,
              reconciliation: {
                ...evidence,
                fingerprint: fingerprint(evidence),
              },
            },
          },
        });
        const callbacks = await tx.aiMcpDelegationCallbackDelivery.updateMany({
          where: {
            requestId: request.id,
            status: { in: ['queued', 'retry_scheduled', 'processing'] },
          },
          data: {
            status: 'cancelled',
            nextAttemptAt: null,
            workerLeaseId: null,
            workerLeaseExpiresAt: null,
            lastErrorCode: code,
            lastErrorMessage:
              'Stale delegation failure reconciled from persisted evidence',
          },
        });
        return { kind: 'eligible' as const, cancelled: callbacks.count };
      });
      if (outcome.kind === 'eligible') {
        report.eligibleRequests++;
        if (apply) report.reconciledRequests++;
        report.cancelledCallbacks += outcome.cancelled;
      } else if (outcome.kind === 'active') report.activeRuns++;
      else if (outcome.kind === 'unresolved') report.unresolvedRequests++;
      else report.concurrentSkips++;
    }
  }
  return report;
}
