import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { JOB_SIGNAL, OnJob } from '../../base';
import { Models } from '../../models';
import { modelRegistryRevisionFingerprint } from '../../models/copilot-model-registry-revision';
import { promptRegistryRevisionFingerprint } from '../../models/copilot-prompt-registry-revision';
import {
  providerRegistryRevisionFingerprint,
  type ProviderRegistrySourceChainEntry,
} from '../../models/copilot-provider-registry-revision';
import type {
  CopilotRepairExecutionApprovedSideEffectResult,
  CopilotRepairExecutionRecord,
} from '../../models/copilot-repair-execution';
import {
  taskRoutePolicyRevisionFingerprint,
} from '../../models/copilot-task-route-policy-revision';
import {
  providerProfileConfigPathHint,
  type NormalizedCopilotProviderProfile,
} from './providers/provider-registry';
import { CopilotProviderRegistryService } from './providers/registry-service';

const REPAIR_EXECUTION_WORKER_LEASE_MS = 5 * 60 * 1000;

const FORWARD_ONLY_ROLLBACK_CONTRACT = {
  version: 'repair-execution-side-effect-rollback-contract/v1',
  supported: false,
  mode: 'forward_only_followup_revision',
  reason: 'constrained_db_registry_revision_publish',
  recoveryPath: 'publish_follow_up_registry_revision',
} as const;

declare global {
  interface Jobs {
    'copilot.repairExecution.run': {
      workspaceId: string;
      executionRequestId: string;
    };
  }
}

@Injectable()
export class CopilotRepairExecutionWorker {
  private readonly logger = new Logger(CopilotRepairExecutionWorker.name);

  constructor(
    private readonly models: Models,
    private readonly providerRegistry: CopilotProviderRegistryService
  ) {}

  @OnJob('copilot.repairExecution.run')
  async runRepairExecution(params: Jobs['copilot.repairExecution.run']) {
    const workerId = `repair-execution-worker-${randomUUID()}`;
    const record = await this.models.copilotRepairExecution.acquireWorkerLease({
      workspaceId: params.workspaceId,
      id: params.executionRequestId,
      workerId,
      leaseMs: REPAIR_EXECUTION_WORKER_LEASE_MS,
    });

    if (!record) {
      this.logger.debug(
        `Repair execution ${params.executionRequestId} was not leaseable`
      );
      return JOB_SIGNAL.Done;
    }

    await this.models.copilotAgentRuntime?.syncRepairExecution({ record });

    try {
      const cancelled =
        await this.models.copilotRepairExecution.cancelLeasedExecutionIfCancellationRequested(
          {
            workspaceId: record.workspaceId,
            id: record.id,
            workerLeaseId: workerId,
            workerAttempt: record.workerAttempt,
          }
        );
      if (cancelled) {
        await this.models.copilotAgentRuntime?.syncRepairExecution({
          record: cancelled,
        });
        return JOB_SIGNAL.Done;
      }

      const current =
        await this.models.copilotRepairExecution.currentLeasedExecutionBeforeSideEffect(
          {
            workspaceId: record.workspaceId,
            id: record.id,
            workerLeaseId: workerId,
            workerAttempt: record.workerAttempt,
          }
        );
      if (!current) {
        this.logger.debug(
          `Repair execution ${record.id} worker lease changed before side effect`
        );
        return JOB_SIGNAL.Done;
      }

      const sideEffect = await this.applySideEffect(current);
      const completed =
        await this.models.copilotRepairExecution.completeWorkerExecution({
          workspaceId: current.workspaceId,
          id: current.id,
          workerLeaseId: workerId,
          workerAttempt: current.workerAttempt,
          sideEffect,
        });
      await this.models.copilotAgentRuntime?.syncRepairExecution({
        record: completed,
      });
      return JOB_SIGNAL.Done;
    } catch (error) {
      const code = this.failureCode(error);
      const message = this.failureMessage(error);
      const failure =
        await this.models.copilotRepairExecution.failWorkerExecution({
          workspaceId: record.workspaceId,
          id: record.id,
          workerLeaseId: workerId,
          workerAttempt: record.workerAttempt,
          code,
          message,
          retryable: this.failureRetryable(code),
        });
      await this.models.copilotAgentRuntime?.syncRepairExecution({
        record: failure.record,
      });
      return failure.retryScheduled ? JOB_SIGNAL.Retry : JOB_SIGNAL.Done;
    }
  }

  private async applySideEffect(
    record: CopilotRepairExecutionRecord
  ): Promise<CopilotRepairExecutionApprovedSideEffectResult | null> {
    const payload = record.executorPayload;
    if (
      payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kind ===
        'model_registry_revision_publish'
    ) {
      const revision =
        await this.models.copilotModelRegistryRevision.publishWorkspaceRepairRevision(
          {
            workspaceId: record.workspaceId,
            actorId: record.actorId,
            executionRequestId: record.id,
            requestFingerprint: record.requestFingerprint,
            candidateEvidenceSetFingerprint:
              record.candidateEvidenceSetFingerprint,
            taskRouteEvidenceSetFingerprint:
              record.taskRouteEvidenceSetFingerprint,
            repairJobFingerprint: record.repairJobFingerprint,
            approvalRecordFingerprint: record.approvalRecordFingerprint,
            payload,
          }
        );
      const summary = this.sideEffectSummary({
        version: 'repair-execution-side-effect-summary/v1',
        providerId: revision.providerId,
        modelId: revision.modelId,
        revision: revision.revision,
        revisionId: revision.id,
        revisionFingerprint: revision.fingerprint,
        scope: revision.scopeType,
        workspaceId: revision.workspaceId ?? null,
        rawModelId: revision.modelDefinition.rawModelId ?? null,
      });
      const fingerprint = modelRegistryRevisionFingerprint({
        version: 'repair-execution-side-effect/v1',
        kind: 'model_registry_revision',
        executionRequestId: record.id,
        summary,
      });

      return {
        fingerprint,
        kind: 'model_registry_revision',
        recordId: revision.id,
        summary,
      };
    }

    if (
      payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kind ===
        'provider_registry_revision_publish'
    ) {
      const profile = this.configuredProviderProfileForPayload(
        payload
      );
      const revision =
        await this.models.copilotProviderRegistryRevision.publishWorkspaceRepairRevision(
          {
            workspaceId: record.workspaceId,
            actorId: record.actorId,
            executionRequestId: record.id,
            requestFingerprint: record.requestFingerprint,
            candidateEvidenceSetFingerprint:
              record.candidateEvidenceSetFingerprint,
            taskRouteEvidenceSetFingerprint:
              record.taskRouteEvidenceSetFingerprint,
            repairJobFingerprint: record.repairJobFingerprint,
            approvalRecordFingerprint: record.approvalRecordFingerprint,
            payload: {
              ...payload,
              providerType: profile.type,
              fallbackSourceChain:
                this.providerRegistryFallbackSourceChain(profile),
            },
          }
        );
      const summary = this.sideEffectSummary({
        version: 'repair-execution-side-effect-summary/v1',
        providerId: revision.providerId,
        providerType: revision.providerType ?? null,
        revision: revision.revision,
        revisionId: revision.id,
        revisionFingerprint: revision.fingerprint,
        scope: revision.scopeType,
        workspaceId: revision.workspaceId ?? null,
        displayName: revision.providerProfile.displayName ?? null,
        modelCount: revision.providerProfile.modelDefinitions?.length ?? 0,
      });
      const fingerprint = providerRegistryRevisionFingerprint({
        version: 'repair-execution-side-effect/v1',
        kind: 'provider_registry_revision',
        executionRequestId: record.id,
        summary,
      });

      return {
        fingerprint,
        kind: 'provider_registry_revision',
        recordId: revision.id,
        summary,
      };
    }

    if (
      payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kind ===
        'prompt_registry_revision_publish'
    ) {
      const revision =
        await this.models.copilotPromptRegistryRevision.publishWorkspaceRepairRevision(
          {
            workspaceId: record.workspaceId,
            actorId: record.actorId,
            promptName: record.promptName,
            executionRequestId: record.id,
            requestFingerprint: record.requestFingerprint,
            candidateEvidenceSetFingerprint:
              record.candidateEvidenceSetFingerprint,
            taskRouteEvidenceSetFingerprint:
              record.taskRouteEvidenceSetFingerprint,
            repairJobFingerprint: record.repairJobFingerprint,
            approvalRecordFingerprint: record.approvalRecordFingerprint,
            payload,
          }
        );
      const summary = this.sideEffectSummary({
        version: 'repair-execution-side-effect-summary/v1',
        promptName: revision.promptName,
        revision: revision.revision,
        revisionId: revision.id,
        revisionFingerprint: revision.fingerprint,
        scope: revision.scopeType,
        workspaceId: revision.workspaceId ?? null,
      });
      const fingerprint = promptRegistryRevisionFingerprint({
        version: 'repair-execution-side-effect/v1',
        kind: 'prompt_registry_revision',
        executionRequestId: record.id,
        summary,
      });

      return {
        fingerprint,
        kind: 'prompt_registry_revision',
        recordId: revision.id,
        summary,
      };
    }

    if (
      payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).kind ===
        'task_route_policy_revision_publish'
    ) {
      const revision =
        await this.models.copilotTaskRoutePolicyRevision.publishWorkspaceRepairRevision(
          {
            workspaceId: record.workspaceId,
            actorId: record.actorId,
            executionRequestId: record.id,
            requestFingerprint: record.requestFingerprint,
            candidateEvidenceSetFingerprint:
              record.candidateEvidenceSetFingerprint,
            taskRouteEvidenceSetFingerprint:
              record.taskRouteEvidenceSetFingerprint,
            repairJobFingerprint: record.repairJobFingerprint,
            approvalRecordFingerprint: record.approvalRecordFingerprint,
            payload,
          }
        );
      const summary = this.sideEffectSummary({
        version: 'repair-execution-side-effect-summary/v1',
        featureKind: revision.featureKind,
        revision: revision.revision,
        revisionId: revision.id,
        revisionFingerprint: revision.fingerprint,
        scope: revision.scopeType,
        workspaceId: revision.workspaceId ?? null,
        modelId: revision.modelId ?? null,
        configKey: revision.configKey ?? null,
        configPath: revision.configPath ?? null,
      });
      const fingerprint = taskRoutePolicyRevisionFingerprint({
        version: 'repair-execution-side-effect/v1',
        kind: 'task_route_policy_revision',
        executionRequestId: record.id,
        summary,
      });

      return {
        fingerprint,
        kind: 'task_route_policy_revision',
        recordId: revision.id,
        summary,
      };
    }

    if (record.approvalState === 'approved') {
      throw new Error('Unsupported repair execution executor payload');
    }

    return null;
  }

  private sideEffectSummary<T extends Record<string, unknown>>(summary: T) {
    return {
      ...summary,
      rollbackContract: FORWARD_ONLY_ROLLBACK_CONTRACT,
    };
  }

  private configuredProviderProfileForPayload(
    payload: unknown
  ): NormalizedCopilotProviderProfile {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid repair execution executor payload');
    }

    const record = payload as Record<string, unknown>;
    const providerId = record.providerId;
    if (typeof providerId !== 'string' || !providerId) {
      throw new Error(
        'Invalid repair execution executor payload field: providerId'
      );
    }

    const profile = this.providerRegistry.getProviderProfile(providerId);
    if (!profile || record.providerType !== profile.type) {
      throw new Error(
        'Invalid repair execution executor payload field: providerType'
      );
    }
    return profile;
  }

  private providerRegistryFallbackSourceChain(
    profile: NormalizedCopilotProviderProfile
  ): ProviderRegistrySourceChainEntry[] {
    return [
      {
        source:
          profile.source === 'legacy' ? 'legacy_profile' : 'provider_profile',
        scope: 'global',
        status: profile.enabled ? 'available' : 'disabled',
        providerId: profile.id,
        providerType: profile.type,
        revision: profile.source,
        fingerprint: providerRegistryRevisionFingerprint({
          version: 'provider-registry-publish-fallback-source/v1',
          providerId: profile.id,
          providerProfileConfigPath: providerProfileConfigPathHint(profile),
          providerSource: profile.source,
          providerType: profile.type,
        }),
      },
    ];
  }

  private failureCode(error: unknown) {
    const message = this.failureMessage(error);
    if (message.includes('Unsupported repair execution executor payload')) {
      return 'unsupported_executor_payload';
    }
    if (message.includes('Invalid repair execution executor payload')) {
      return 'invalid_executor_payload';
    }
    if (message.includes('already exists with different fingerprint')) {
      return 'side_effect_revision_conflict';
    }
    return 'repair_execution_worker_failed';
  }

  private failureRetryable(code: string) {
    return (
      code !== 'unsupported_executor_payload' &&
      code !== 'invalid_executor_payload' &&
      code !== 'side_effect_revision_conflict'
    );
  }

  private failureMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message.slice(0, 2000);
    }
    return String(error).slice(0, 2000);
  }
}
